import { D, FA, FP, FG } from "../state.js";
import { artGroup } from "../api/sheets.js";
import { esc, wbPrice } from "../utils.js";
import { ADS } from "../api/ads.js";
import { cardByNm, cardsNmList } from "../api/wb.js";
import { ADS_DRR_TARGET, ADS_DAY_BUDGET } from "../config.js";

/* ══════════════════════════════════════════════════════════
   Блок «📣 Эффективность рекламы» (кабинеты WB).
   Из рекламного кабинета: показы, клики, CTR, CPC, корзины, расход (по товару, по дням).
   Заказы — реальные, из API статистики монитора (allOrders) по тем же товарам и дням,
   а не атрибуция WB (её не показываем).
   ДРР = расход / сумма реальных заказов рекламируемых товаров (вкл. органику).
   Цена заказа = расход / реальные заказы. CR — клики → корзины.
   ══════════════════════════════════════════════════════════ */

const LS = (k, ok, def) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : def; } catch { return def; } };
const SV = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
let PER = LS("adPer", ["1", "7", "14", "30"], "7");
let ROWS = LS("adRows", ["g", "a"], "a");
export function setAdPer(p) { PER = ["1", "7", "14", "30"].includes(p) ? p : "7"; SV("adPer", PER); }
export function setAdRows(r) { ROWS = r === "g" ? "g" : "a"; SV("adRows", ROWS); }

const pill = (opts, cur, fn, n) => `<span style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;font-size:10px">
    ${opts.map(([k, t]) => `<span onclick="App.${fn}(${n},'${k}')" style="padding:1px 7px;cursor:pointer;white-space:nowrap;${cur === k ? "background:var(--ink);color:var(--bg3)" : "color:var(--ink2)"}">${t}</span>`).join("")}
  </span>`;
const nf = (x) => Math.round(x).toLocaleString("ru-RU");
const rub = (x) => {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " млн";
  if (a >= 1e4) return Math.round(x / 1e3).toLocaleString("ru-RU") + " тыс";
  return Math.round(x).toLocaleString("ru-RU");
};
const pct = (a, b, d = 1) => (b > 0 ? ((a / b) * 100).toLocaleString("ru-RU", { maximumFractionDigits: d }) + "%" : "—");
const addDays = (iso, k) => new Date(Date.parse(iso + "T00:00:00Z") + k * 864e5).toISOString().slice(0, 10);
const dShort = (iso) => `${+iso.slice(8, 10)}.${iso.slice(5, 7)}`;
/* ДРР: зелёный — в пределах цели (ADS_DRR_TARGET), жёлтый — до 1,5 цели, красный выше */
const drrTone = (v) => (v == null ? "var(--ink3)" : v <= ADS_DRR_TARGET ? "var(--green)" : v <= ADS_DRR_TARGET * 1.5 ? "#B7791F" : "var(--red)");

/* Фильтры кабинета: артикул / предмет / группа («Кратко») */
function filterFor(n) {
  const arts = FA[n].map((x) => String(x).trim().toLowerCase());
  const subs = FP[n].map((x) => String(x).trim().toLowerCase());
  const grps = FG[n].map((x) => String(x).trim().toLowerCase());
  if (!arts.length && !subs.length && !grps.length) return null;
  return (art, subj) => {
    const a = String(art || "").toLowerCase(), nm = artGroup(a);
    if (arts.length && !arts.includes(a)) return false;
    if (subs.length && !subs.includes(String(subj || (nm && nm.predmet) || "").trim().toLowerCase())) return false;
    if (grps.length && !grps.includes(String((nm && nm.kratko) || "").trim().toLowerCase())) return false;
    return true;
  };
}

export function adsHTML(n) {
  if (n === 3) return "";
  const box = (inner) => `<div id="ads${n}" class="filter-bar" style="margin:18px 0">${inner}</div>`;
  const title = `<span class="st">📣 Эффективность рекламы</span>`;
  const A = ADS[n];
  if (!A) return box(`${title}<div style="font-size:11px;color:var(--ink3);margin-top:6px">загружаем статистику рекламы… (WB даёт 3 запроса в минуту — может занять минуту-две)</div>`);
  if (A.error) return box(`${title}<div style="font-size:11px;color:var(--red);margin-top:6px">Реклама не загрузилась: ${esc(A.error)}</div>
    <button class="loadbtn" onclick="App.reloadAds(${n})">↻ Попробовать снова</button>`);

  const to = A.to, from = addDays(to, -(+PER - 1));
  const ok = filterFor(n);

  /* nmId → артикул / предмет: из заказов, остатков и карточек кабинета */
  const d = D[n] || {};
  const art = {}, subj = {};
  for (const o of [...(d.allOrders || []), ...(d.stocks || [])]) {
    if (!o.nmId) continue;
    art[o.nmId] ||= o.supplierArticle;
    subj[o.nmId] ||= o.subject || o.category;
  }
  for (const nm of cardsNmList(n)) { const c = cardByNm(n, nm); if (c) { art[nm] ||= c.supplierArticle; subj[nm] ||= c.subject; } }

  /* Объединяем по «Кратко» (номенклатура): реклама одного артикула продаёт и остальные
     артикулы группы — считаем группу целиком. Нет «Кратко» — артикул сам по себе. */
  const glue = (nm) => { const a = art[nm] || ""; const g = artGroup(a); return (g && g.kratko) || a || "nm" + nm; };
  const members = {};
  for (const nm of new Set([...cardsNmList(n), ...Object.keys(art), ...Object.keys(A.nm)])) (members[glue(nm)] ||= new Set()).add(String(nm));

  /* реклама по склейкам за период */
  const adG = {}, days = {};
  for (const [nmId, byDay] of Object.entries(A.nm)) {
    const gk = glue(nmId);
    const s = (adG[gk] ||= { views: 0, clicks: 0, atbs: 0, sum: 0 });
    for (const [day, x] of Object.entries(byDay)) {
      if (day < from || day > to) continue;
      s.views += x.views; s.clicks += x.clicks; s.atbs += x.atbs; s.sum += x.sum;
    }
  }
  /* склейки с рекламой за период, прошедшие фильтр (хотя бы один артикул склейки) */
  const live = new Set(Object.entries(adG).filter(([gk, s]) => (s.views || s.sum) &&
    (!ok || [...(members[gk] || [])].some((nm) => ok(art[nm] || "", subj[nm])))).map(([gk]) => gk));
  for (const [nmId, byDay] of Object.entries(A.nm)) {
    if (!live.has(glue(nmId))) continue;
    for (const [day, x] of Object.entries(byDay)) if (day >= from && day <= to) (days[day] ||= { sum: 0, r: 0 }).sum += x.sum;
  }
  /* реальные заказы всей склейки (вкл. нерекламируемые цвета) */
  const real = {};
  for (const o of d.allOrders || []) {
    const day = (o.date || "").slice(0, 10);
    if (!o.nmId || day < from || day > to) continue;
    const gk = glue(o.nmId);
    if (!live.has(gk)) continue;
    const r = (real[gk] ||= { q: 0, r: 0 });
    const q = o.quantity || 1;
    r.q += q; r.r += wbPrice(o);
    (days[day] ||= { sum: 0, r: 0 }).r += wbPrice(o);
  }

  const nameOf = (gk) => ({ label: gk, all: [...new Set([...(members[gk] || [])].map((nm) => art[nm]).filter(Boolean))].sort((x, y) => x.localeCompare(y)) });
  const rows = {};
  const T = { views: 0, clicks: 0, atbs: 0, sum: 0, q: 0, r: 0 };
  for (const gk of live) {
    const s = adG[gk], re = real[gk] || { q: 0, r: 0 };
    const nm = nameOf(gk);
    const key = nm.label;
    const R = (rows[key] ||= { views: 0, clicks: 0, atbs: 0, sum: 0, q: 0, r: 0, arts: [] });
    R.views += s.views; R.clicks += s.clicks; R.atbs += s.atbs; R.sum += s.sum; R.q += re.q; R.r += re.r;
    R.arts.push(...nm.all);
    T.views += s.views; T.clicks += s.clicks; T.atbs += s.atbs; T.sum += s.sum; T.q += re.q; T.r += re.r;
  }

  const drr = (x) => (x.r > 0 ? (x.sum / x.r) * 100 : null);
  const cells = (x, bold) => {
    const v = drr(x);
    const b = bold ? "font-weight:700;" : "";
    return `<td style="text-align:right">${nf(x.views)}</td>
      <td style="text-align:right">${nf(x.clicks)}</td>
      <td style="text-align:right">${pct(x.clicks, x.views, 2)}</td>
      <td style="text-align:right">${x.clicks ? (x.sum / x.clicks).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"}</td>
      <td style="text-align:right">${nf(x.atbs)}</td>
      <td style="text-align:right">${pct(x.atbs, x.clicks)}</td>
      <td style="text-align:right;${b}border-left:1px solid var(--border)">${rub(x.sum)}</td>
      <td style="text-align:right;${b}">${nf(x.q)}</td>
      <td style="text-align:right;${b}">${rub(x.r)}</td>
      <td style="text-align:right;font-weight:700;color:${drrTone(v)}">${v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%"}</td>
      <td style="text-align:right">${x.q ? nf(x.sum / x.q) : "—"}</td>`;
  };
  const list = Object.entries(rows).sort((a, b) => b[1].sum - a[1].sum);
  const body = list.map(([k, x]) => {
    const others = [...new Set(x.arts)].filter((a) => a !== k);
    const all = [...new Set(x.arts)];
    const tip = all.length ? ` data-tip="${esc("Артикулы: " + all.join(", "))}"` : "";
    return `<tr><td style="white-space:nowrap"${tip}>${esc(k)}${all.length > 1 ? ` <span style="color:var(--ink3);font-size:10px">${all.length} арт.</span>` : ""}</td>${cells(x)}</tr>`;
  }).join("");
  const table = list.length ? `<div class="sw" style="margin-top:10px"><table style="font-size:12px">
    <thead>
      <tr><th></th><th colspan="6" style="text-align:center">Рекламный кабинет</th><th colspan="5" style="text-align:center;border-left:1px solid var(--border)">Расход и реальные заказы</th></tr>
      <tr><th>Группа (Кратко)</th><th style="text-align:right">Показы</th><th style="text-align:right">Клики</th><th style="text-align:right">CTR</th><th style="text-align:right">CPC, ₽</th><th style="text-align:right">Корзины</th><th style="text-align:right" data-tip="Клики → добавления в корзину">CR</th>
        <th style="text-align:right;border-left:1px solid var(--border)">Расход, ₽</th><th style="text-align:right" data-tip="Все реальные заказы группы за период — все артикулы, вкл. нерекламируемые и органику; из API монитора">Заказы, шт</th><th style="text-align:right">Заказы, ₽</th><th style="text-align:right" data-tip="Доля рекламных расходов: расход / сумма реальных заказов">ДРР</th><th style="text-align:right" data-tip="Расход / реальные заказы, шт">₽ на заказ</th></tr>
    </thead>
    <tbody>${body}<tr style="border-top:2px solid var(--border2)"><td><b>Итого</b></td>${cells(T, true)}</tr></tbody>
  </table></div>` : `<div style="font-size:12px;color:var(--ink3);margin-top:10px">За этот период рекламы${ok ? " по фильтру" : ""} не было.</div>`;

  /* KPI сверху */
  const tDrr = drr(T);
  const kpi = (lbl, val, sub, col) => `<div class="mc"><div class="ml">${lbl}</div><div class="mv sm"${col ? ` style="color:${col}"` : ""}>${val}</div>${sub ? `<div class="md" style="color:var(--ink3)">${sub}</div>` : ""}</div>`;
  const kpis = `<div class="mg" style="margin:10px 0 0">
    ${kpi("Расход на рекламу", rub(T.sum) + " ₽", PER === "1" ? `вчера, ${dShort(to)}` : `${dShort(from)} – ${dShort(to)}`)}
    ${kpi("Реальные заказы этих групп", rub(T.r) + " ₽", nf(T.q) + " шт")}
    ${kpi("ДРР", tDrr == null ? "—" : tDrr.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%", T.q ? `≈ ${nf(T.sum / T.q)} ₽ рекламы на заказ` : "", drrTone(tDrr))}
    ${kpi("Воронка", pct(T.clicks, T.views, 2) + " CTR", `${T.clicks ? (T.sum / T.clicks).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"} ₽ клик · ${pct(T.atbs, T.clicks)} в корзину`)}
  </div>`;

  /* По дням: расход и ДРР — два маленьких графика (одна шкала на график) */
  const dl = []; for (let x = from; x <= to; x = addDays(x, 1)) dl.push(x);
  /* Маленький график: значения подписаны над столбцами/точками, пунктир — цель */
  const mini = (vals, fmtv, color, label, isLine, target, targetTxt) => {
    const VW = 520, VH = 160, pl = 10, pr = 10, pt = 20, pb = 18;
    const mx = Math.max(1, target || 0, ...vals.filter((v) => v != null)) * 1.15;
    const w = (VW - pl - pr) / vals.length;
    const ys = (v) => pt + (VH - pt - pb) * (1 - v / mx);
    const xc = (i) => pl + (i + 0.5) * w;
    const fs = vals.length > 16 ? 8 : 10;                                 /* 30 дней — подписи мельче */
    let g = `<line x1="${pl}" x2="${VW - pr}" y1="${ys(0)}" y2="${ys(0)}" stroke="var(--border)"/>`;
    if (isLine) {
      const pts = vals.map((v, i) => (v == null ? null : [xc(i), ys(v)]));
      g += `<path d="${pts.filter(Boolean).map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("")}" fill="none" stroke="${color}" stroke-width="2"/>`;
      pts.forEach((p, i) => { if (p) g += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${color}"/><text x="${p[0]}" y="${p[1] - 6}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="var(--ink)">${fmtv(vals[i])}</text>`; });
    } else {
      vals.forEach((v, i) => {
        const y = ys(v || 0);
        g += `<rect x="${pl + i * w + 1}" y="${y}" width="${Math.max(1, w - 2)}" height="${ys(0) - y}" rx="2" fill="${color}"/>`;
        if (v) g += `<text x="${xc(i)}" y="${y - 4}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="var(--ink)">${fmtv(v)}</text>`;
      });
    }
    if (target) g += `<line x1="${pl}" x2="${VW - pr}" y1="${ys(target)}" y2="${ys(target)}" stroke="#B3261E" stroke-width="1.5" stroke-dasharray="6 4"/>
      <text x="${VW - pr}" y="${ys(target) - 4}" text-anchor="end" font-size="10" font-weight="700" fill="#B3261E">${targetTxt}</text>`;
    const step = vals.length > 16 ? 3 : 1;
    vals.forEach((_, i) => { if (i % step === 0 || i === vals.length - 1) g += `<text x="${xc(i)}" y="${VH - 4}" text-anchor="middle" font-size="${fs}" fill="var(--ink3)">${dShort(dl[i])}</text>`; });
    vals.forEach((v, i) => { g += `<rect x="${pl + i * w}" y="${pt}" width="${w}" height="${VH - pt - pb}" fill="transparent" data-tip="${dShort(dl[i])}: ${label} ${v == null ? "—" : fmtv(v)}"/>`; });
    return `<svg viewBox="0 0 ${VW} ${VH}" style="width:100%;height:auto;display:block">${g}</svg>`;
  };
  const spend = dl.map((x) => (days[x] ? days[x].sum : 0));
  const drrD = dl.map((x) => (days[x] && days[x].r > 0 ? (days[x].sum / days[x].r) * 100 : null));
  const charts = list.length && PER !== "1" ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin-top:12px">
      <div><div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--ink3);text-transform:uppercase">Расход по дням, ₽</div>${mini(spend, (v) => (v >= 1000 ? (v / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "т" : nf(v)), "#8B4513", "расход", false, ok ? 0 : ADS_DAY_BUDGET[n], "бюджет " + nf(ADS_DAY_BUDGET[n]) + " ₽/день")}</div>
      <div><div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--ink3);text-transform:uppercase">ДРР по дням, %</div>${mini(drrD, (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%", "#4A6FA5", "ДРР", true, ADS_DRR_TARGET, "цель " + ADS_DRR_TARGET + "%")}</div>
    </div>` : "";

  return box(`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span>${title}${ok ? ` <span style="font-size:11px;color:var(--ink3)">· по фильтру</span>` : ""}</span>
      <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${pill([["1", "Вчера"], ["7", "7 дней"], ["14", "14 дней"], ["30", "30 дней"]], PER, "setAdPer", n)}
        <span onclick="App.reloadAds(${n})" style="font-size:10px;color:var(--ink2);cursor:pointer;border-bottom:1px dotted var(--ink3)" data-tip="Загрузить статистику рекламы заново">↻</span>
      </span>
    </div>
    <div style="font-size:11px;color:var(--ink3);margin-top:4px">Показы, клики, корзины и расход — из рекламного кабинета WB (кампаний за период: ${A.campaigns}). Артикулы объединены по группе «Кратко» (реклама одного артикула продаёт и остальные): заказы — реальные, из API статистики, по всем артикулам группы, вкл. органику. Полные дни, без сегодня.</div>
    ${kpis}${charts}${table}`);
}

export function repaintAds(n) {
  const el = document.getElementById("ads" + n);
  if (el) el.outerHTML = adsHTML(n);
}
