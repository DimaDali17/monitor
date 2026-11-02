import { D, FA, FP, FG } from "../state.js";
import { artGroup } from "../api/sheets.js";
import { esc, wbPrice } from "../utils.js";
import { ADS } from "../api/ads.js";

/* ══════════════════════════════════════════════════════════
   Блок «📣 Эффективность рекламы» (кабинеты WB).
   Из рекламного кабинета: показы, клики, CTR, CPC, корзины, расход (по товару, по дням).
   Заказы — реальные, из API статистики монитора (allOrders) по тем же товарам и дням,
   а не атрибуция WB (её показываем серым для сравнения).
   ДРР = расход / сумма реальных заказов рекламируемых товаров (вкл. органику).
   Цена заказа = расход / реальные заказы. CR — клики → корзины.
   ══════════════════════════════════════════════════════════ */

const LS = (k, ok, def) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : def; } catch { return def; } };
const SV = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
let PER = LS("adPer", ["7", "14", "30"], "7");
let ROWS = LS("adRows", ["g", "a"], "a");
export function setAdPer(p) { PER = ["7", "14", "30"].includes(p) ? p : "7"; SV("adPer", PER); }
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
/* ДРР: зелёный ≤ 10%, жёлтый ≤ 20%, красный выше */
const drrTone = (v) => (v == null ? "var(--ink3)" : v <= 10 ? "var(--green)" : v <= 20 ? "#B7791F" : "var(--red)");

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

  /* nmId → артикул / предмет: из заказов и остатков кабинета */
  const d = D[n] || {};
  const art = {}, subj = {};
  for (const o of [...(d.allOrders || []), ...(d.stocks || [])]) {
    if (!o.nmId) continue;
    art[o.nmId] ||= o.supplierArticle;
    subj[o.nmId] ||= o.subject || o.category;
  }
  /* реальные заказы по nmId за период */
  const real = {}, realDay = {};
  for (const o of d.allOrders || []) {
    const day = (o.date || "").slice(0, 10);
    if (!o.nmId || day < from || day > to) continue;
    const r = (real[o.nmId] ||= { q: 0, r: 0 });
    const q = o.quantity || 1;
    r.q += q; r.r += wbPrice(o);
    const rd = ((realDay[o.nmId] ||= {})[day] ||= { q: 0, r: 0 });
    rd.q += q; rd.r += wbPrice(o);
  }

  const rows = {}, days = {};
  const T = { views: 0, clicks: 0, atbs: 0, sum: 0, wbo: 0, q: 0, r: 0 };
  for (const [nmId, byDay] of Object.entries(A.nm)) {
    const a = art[nmId] || A.names[nmId] || "nm " + nmId;
    if (ok && !ok(art[nmId] || "", subj[nmId])) continue;
    const s = { views: 0, clicks: 0, atbs: 0, sum: 0, wbo: 0 };
    for (const [day, x] of Object.entries(byDay)) {
      if (day < from || day > to) continue;
      s.views += x.views; s.clicks += x.clicks; s.atbs += x.atbs; s.sum += x.sum; s.wbo += x.orders;
      const D1 = (days[day] ||= { sum: 0, r: 0 });
      D1.sum += x.sum;
    }
    if (!s.views && !s.sum) continue;
    const re = real[nmId] || { q: 0, r: 0 };
    for (const [day, x] of Object.entries(realDay[nmId] || {})) (days[day] ||= { sum: 0, r: 0 }).r += x.r;
    const key = ROWS === "g" ? ((artGroup(a) && artGroup(a).kratko) || "Прочее") : a;
    const R = (rows[key] ||= { views: 0, clicks: 0, atbs: 0, sum: 0, wbo: 0, q: 0, r: 0, nm: nmId });
    R.views += s.views; R.clicks += s.clicks; R.atbs += s.atbs; R.sum += s.sum; R.wbo += s.wbo; R.q += re.q; R.r += re.r;
    for (const k of Object.keys(T)) T[k] += k === "q" ? re.q : k === "r" ? re.r : s[k];
  }

  const drr = (x) => (x.r > 0 ? (x.sum / x.r) * 100 : null);
  const cells = (x, bold) => {
    const v = drr(x);
    const b = bold ? "font-weight:700;" : "";
    return `<td style="text-align:right">${nf(x.views)}</td>
      <td style="text-align:right">${nf(x.clicks)}</td>
      <td style="text-align:right">${pct(x.clicks, x.views, 2)}</td>
      <td style="text-align:right">${x.clicks ? nf(x.sum / x.clicks) : "—"}</td>
      <td style="text-align:right">${nf(x.atbs)}</td>
      <td style="text-align:right">${pct(x.atbs, x.clicks)}</td>
      <td style="text-align:right;${b}border-left:1px solid var(--border)">${rub(x.sum)}</td>
      <td style="text-align:right;${b}">${nf(x.q)}</td>
      <td style="text-align:right;${b}">${rub(x.r)}</td>
      <td style="text-align:right;font-weight:700;color:${drrTone(v)}">${v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%"}</td>
      <td style="text-align:right">${x.q ? nf(x.sum / x.q) : "—"}</td>
      <td style="text-align:right;color:var(--ink3);border-left:1px solid var(--border)">${nf(x.wbo)}${x.q ? ` <span style="font-size:10px">(${pct(x.wbo, x.q, 0)})</span>` : ""}</td>`;
  };
  const list = Object.entries(rows).sort((a, b) => b[1].sum - a[1].sum);
  const body = list.map(([k, x]) => `<tr><td style="white-space:nowrap"><span class="${ROWS === "a" ? "art" : ""}">${esc(k)}</span></td>${cells(x)}</tr>`).join("");
  const table = list.length ? `<div class="sw" style="margin-top:10px"><table style="font-size:12px">
    <thead>
      <tr><th></th><th colspan="6" style="text-align:center">Рекламный кабинет</th><th colspan="5" style="text-align:center;border-left:1px solid var(--border)">Расход и реальные заказы</th><th style="text-align:center;border-left:1px solid var(--border)">WB</th></tr>
      <tr><th>${ROWS === "g" ? "Группа" : "Артикул"}</th><th style="text-align:right">Показы</th><th style="text-align:right">Клики</th><th style="text-align:right">CTR</th><th style="text-align:right">CPC, ₽</th><th style="text-align:right">Корзины</th><th style="text-align:right" data-tip="Клики → добавления в корзину">CR</th>
        <th style="text-align:right;border-left:1px solid var(--border)">Расход, ₽</th><th style="text-align:right" data-tip="Все реальные заказы рекламируемых товаров за период (вкл. органику), из API монитора">Заказы, шт</th><th style="text-align:right">Заказы, ₽</th><th style="text-align:right" data-tip="Доля рекламных расходов: расход / сумма реальных заказов">ДРР</th><th style="text-align:right" data-tip="Расход / реальные заказы, шт">₽ на заказ</th>
        <th style="text-align:right;border-left:1px solid var(--border)" data-tip="Заказы по атрибуции рекламного кабинета WB — для сравнения; в скобках — доля от реальных">заказы по WB</th></tr>
    </thead>
    <tbody>${body}<tr style="border-top:2px solid var(--border2)"><td><b>Итого</b></td>${cells(T, true)}</tr></tbody>
  </table></div>` : `<div style="font-size:12px;color:var(--ink3);margin-top:10px">За этот период рекламы${ok ? " по фильтру" : ""} не было.</div>`;

  /* KPI сверху */
  const tDrr = drr(T);
  const kpi = (lbl, val, sub, col) => `<div class="mc"><div class="ml">${lbl}</div><div class="mv sm"${col ? ` style="color:${col}"` : ""}>${val}</div>${sub ? `<div class="md" style="color:var(--ink3)">${sub}</div>` : ""}</div>`;
  const kpis = `<div class="mg" style="margin:10px 0 0">
    ${kpi("Расход на рекламу", rub(T.sum) + " ₽", `${dShort(from)} – ${dShort(to)}`)}
    ${kpi("Реальные заказы этих товаров", rub(T.r) + " ₽", nf(T.q) + " шт")}
    ${kpi("ДРР", tDrr == null ? "—" : tDrr.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%", T.q ? `≈ ${nf(T.sum / T.q)} ₽ рекламы на заказ` : "", drrTone(tDrr))}
    ${kpi("Воронка", pct(T.clicks, T.views, 2) + " CTR", `${T.clicks ? nf(T.sum / T.clicks) : "—"} ₽ клик · ${pct(T.atbs, T.clicks)} в корзину`)}
  </div>`;

  /* По дням: расход и ДРР — два маленьких графика (одна шкала на график) */
  const dl = []; for (let x = from; x <= to; x = addDays(x, 1)) dl.push(x);
  const mini = (vals, fmtv, color, label, isLine) => {
    const VW = 480, VH = 120, pl = 44, pr = 8, pt = 8, pb = 18;
    const mx = Math.max(1, ...vals.filter((v) => v != null)) * 1.12;
    const w = (VW - pl - pr) / vals.length;
    const ys = (v) => pt + (VH - pt - pb) * (1 - v / mx);
    let g = `<line x1="${pl}" x2="${VW - pr}" y1="${ys(0)}" y2="${ys(0)}" stroke="var(--border)"/>`;
    g += `<text x="${pl - 5}" y="${ys(mx / 1.12) + 4}" text-anchor="end" font-size="10" fill="var(--ink3)">${fmtv(mx / 1.12)}</text><line x1="${pl}" x2="${VW - pr}" y1="${ys(mx / 1.12)}" y2="${ys(mx / 1.12)}" stroke="var(--border)" stroke-dasharray="2 3"/>`;
    if (isLine) {
      const pts = vals.map((v, i) => (v == null ? null : [pl + (i + 0.5) * w, ys(v)]));
      g += `<path d="${pts.filter(Boolean).map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("")}" fill="none" stroke="${color}" stroke-width="2"/>`;
      pts.forEach((p) => { if (p) g += `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${color}"/>`; });
    } else {
      vals.forEach((v, i) => { const h = ys(0) - ys(v || 0); g += `<rect x="${pl + i * w + 1}" y="${ys(v || 0)}" width="${Math.max(1, w - 2)}" height="${h}" rx="2" fill="${color}"/>`; });
    }
    [0, Math.floor(vals.length / 2), vals.length - 1].forEach((i) => { g += `<text x="${pl + (i + 0.5) * w}" y="${VH - 4}" text-anchor="middle" font-size="10" fill="var(--ink3)">${dShort(dl[i])}</text>`; });
    vals.forEach((v, i) => { g += `<rect x="${pl + i * w}" y="${pt}" width="${w}" height="${VH - pt - pb}" fill="transparent" data-tip="${dShort(dl[i])}: ${label} ${v == null ? "—" : fmtv(v)}"/>`; });
    return `<svg viewBox="0 0 ${VW} ${VH}" style="width:100%;height:auto;display:block">${g}</svg>`;
  };
  const spend = dl.map((x) => (days[x] ? days[x].sum : 0));
  const drrD = dl.map((x) => (days[x] && days[x].r > 0 ? (days[x].sum / days[x].r) * 100 : null));
  const charts = list.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin-top:12px">
      <div><div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--ink3);text-transform:uppercase">Расход по дням, ₽</div>${mini(spend, (v) => rub(v), "#8B4513", "расход", false)}</div>
      <div><div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--ink3);text-transform:uppercase">ДРР по дням, %</div>${mini(drrD, (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%", "#4A6FA5", "ДРР", true)}</div>
    </div>` : "";

  return box(`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span>${title}${ok ? ` <span style="font-size:11px;color:var(--ink3)">· по фильтру</span>` : ""}</span>
      <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${pill([["7", "7 дней"], ["14", "14 дней"], ["30", "30 дней"]], PER, "setAdPer", n)}
        ${pill([["g", "Группы"], ["a", "Артикулы"]], ROWS, "setAdRows", n)}
        <span onclick="App.reloadAds(${n})" style="font-size:10px;color:var(--ink2);cursor:pointer;border-bottom:1px dotted var(--ink3)" data-tip="Загрузить статистику рекламы заново">↻</span>
      </span>
    </div>
    <div style="font-size:11px;color:var(--ink3);margin-top:4px">Показы, клики, корзины и расход — из рекламного кабинета WB (кампаний за период: ${A.campaigns}). Заказы — реальные, из API статистики (все заказы этих товаров, вкл. органику). Полные дни, без сегодня.</div>
    ${kpis}${charts}${table}`);
}

export function repaintAds(n) {
  const el = document.getElementById("ads" + n);
  if (el) el.outerHTML = adsHTML(n);
}
