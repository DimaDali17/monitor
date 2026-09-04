import { D, OAC, CONSO, cabShort } from "../state.js";
import { MSK_RE } from "../config.js";
import { fmt, esc, q, szCmp, fmtDays, sitePrice, wbPrice, pct } from "../utils.js";
import { getBuyrate, getStocksForArt, getStocksForSz, parseOzonArt, rawSharedWith, rawPrimaryFor, dedupRawTotal, artDisp } from "../api/sheets.js";

const CABS = [
  { n: 1, key: "ef", label: "Easyform", short: "EF", color: "#FFF8F0", accent: "#E65100" },
  { n: 2, key: "ezfr", label: "EZFR", short: "EZFR", color: "#F0F4FF", accent: "#1565C0" },
  { n: 3, key: "oz", label: "Ozon", short: "Ozon", color: "#F0F0FF", accent: "var(--blue)" },
];

export function logConso(msg) {
  CONSO.log.push(
    new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " " + msg
  );
  const el = document.getElementById("consoLog");
  if (el) el.innerHTML = tailLog();
}
const tailLog = () =>
  CONSO.log.slice(-8).map((l) => `<div>${esc(l)}</div>`).join("") || "<div>— лог загрузки —</div>";

/* data[art][sz] = { stk:{ef,ezfr,oz}, o7:{...}, msk:{ef,ezfr} } */
function buildConsoData() {
  const data = {};
  const cell = (art, sz) => {
    (data[art] ||= {});
    return (data[art][sz] ||= {
      stk: { ef: 0, ezfr: 0, oz: 0 },
      o7: { ef: 0, ezfr: 0, oz: 0 },
      msk: { ef: 0, ezfr: 0 },
    });
  };

  [1, 2].forEach((n) => {
    const d = D[n];
    if (!d) return;
    const key = n === 1 ? "ef" : "ezfr";

    (d.stocks || []).forEach((s) => {
      const art = s.supplierArticle;
      if (!art) return;
      const c = cell(art, s.techSize || "—");
      c.stk[key] += s.quantity || 0;
      if (MSK_RE.test(s.warehouseName || "")) c.msk[key] += s.quantity || 0;
    });

    (d.orders7 || []).forEach((o) => {
      if (!o.supplierArticle) return;
      cell(o.supplierArticle, o.techSize || "—").o7[key] += o.quantity || 1;
    });
  });

  const oz = D[3];
  if (oz) {
    (oz.stocks || []).forEach((s) => {
      const id = s.item_code || s.offer_id;
      if (!id) return;
      const { baseArt, wbSz } = parseOzonArt(id);
      cell(baseArt, wbSz).stk.oz += s.free_to_sell_amount || s.quantity || 0;
    });
    (oz.orders7 || []).forEach((o) => {
      (o.products || []).forEach((p) => {
        if (!p.offer_id) return;
        const { baseArt, wbSz } = parseOzonArt(p.offer_id);
        cell(baseArt, wbSz).o7.oz += p.quantity || 1;
      });
    });
  }

  return data;
}

export function renderConso() {
  const el = document.getElementById("v4");
  if (!el) return;

  const loaded = CABS.filter((c) => D[c.n]);
  el.innerHTML = loaded.length
    ? loaderPanel() + summaryCards(loaded) + ordersFeed() + deficitTable(loaded) + warehouseSummary()
    : `<div style="max-width:520px;margin:40px auto">
         <div class="sh"><span class="st">📊 Консолидация — загрузка данных</span></div>
         ${loaderPanel()}
       </div>`;
}

function loaderPanel() {
  const steps = CABS.map((c) => {
    const d = D[c.n];
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;
        background:${d ? "#E8F5E9" : "var(--bg3)"};border:1px solid ${d ? "#4CAF50" : "var(--border2)"};
        border-radius:9px;flex:1;min-width:200px">
      <span style="font-size:16px">${d ? "✅" : "⏳"}</span>
      <span style="font-weight:700;font-size:12px">${c.label}</span>
      ${d
        ? `<span style="font-size:10px;color:var(--green)">· ${(d.stocks || []).length} стоков · ${(d.orders7 || []).length} зак/7д</span>`
        : `<button class="loadbtn" style="margin:0;padding:5px 12px;font-size:10px" onclick="App.reloadForConso(${c.n})">↻ Загрузить</button>`}
    </div>`;
  }).join("");

  return `<div style="max-width:820px;margin:0 0 16px">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">${steps}</div>
    <div id="consoLog" style="font-size:10px;color:var(--ink3);margin-top:8px;font-family:monospace;line-height:1.8">${tailLog()}</div>
  </div>`;
}

/* Общий пул сырья: сырьё на первом артикуле (бейдж «пул»), остальным «—». */
function rawPoolBadge(art, sibs) {
  const members = [art, ...sibs.map(artDisp)].join(", ");
  const tip = "Весь остаток общего пула сырья показан здесь. Пул делят артикулы: " + esc(members) + ".";
  return `<span style="font-size:9px;color:#8B4513;border:1px solid #8B4513;border-radius:3px;padding:0 3px;margin-left:4px;vertical-align:middle;cursor:help" data-tip="${tip}">пул</span>`;
}
function rawPoolDash(primaryLower) {
  const tip = "Сырьё общего пула показано у артикула " + esc(artDisp(primaryLower)) + " (первый по номеру).";
  return `<span style="cursor:help;border-bottom:1px dotted var(--ink3)" data-tip="${tip}">—</span>`;
}
function consoRawCell(art, raw) {
  const sibs = rawSharedWith(art);
  if (!sibs.length) return raw ? String(raw) : "—";
  const amPrimary = rawPrimaryFor(art) === (art || "").toLowerCase();
  if (amPrimary) return raw ? raw + rawPoolBadge(art, sibs) : "—";
  return rawPoolDash(rawPrimaryFor(art));
}

function totals() {
  const data = buildConsoData();
  const arts = Object.keys(data).sort();
  const stk = { ef: 0, ezfr: 0, oz: 0 }, o7 = { ef: 0, ezfr: 0, oz: 0 };

  for (const a of arts) for (const sz of Object.keys(data[a])) {
    const r = data[a][sz];
    ["ef", "ezfr", "oz"].forEach((k) => { stk[k] += r.stk[k]; o7[k] += r.o7[k]; });
  }

  const sheetStk = {
    sgp: arts.reduce((s, a) => s + getStocksForArt(a).sgp, 0),
    raw: dedupRawTotal(arts), /* общий пул считаем один раз */
  };

  const mp = stk.ef + stk.ezfr + stk.oz;
  const total = mp + sheetStk.sgp + sheetStk.raw;
  const o7All = o7.ef + o7.ezfr + o7.oz;

  return { data, arts, stk, o7, sheetStk, total, o7All, need30: Math.round((o7All / 7) * 30) };
}

function summaryCards(loaded) {
  const t = totals();
  const has = (k) => loaded.some((c) => c.key === k);
  const part = (k, label, v) => (has(k) ? `${label}: ${v} · ` : "");
  const balance = t.total - t.need30;

  return `<div class="mg" style="grid-template-columns:repeat(5,1fr)">
    <div class="mc" style="border-top:3px solid var(--ink)">
      <div class="ml">Общий сток</div><div class="mv">${t.total.toLocaleString("ru")}</div>
      <div class="md" style="font-size:10px;color:var(--ink3)">
        ${part("ef", "EF", t.stk.ef)}${part("ezfr", "EZFR", t.stk.ezfr)}${part("oz", "OZ", t.stk.oz)}СГП: ${t.sheetStk.sgp} · Сырьё: ${t.sheetStk.raw}
      </div>
    </div>
    <div class="mc" style="border-top:3px solid var(--green)">
      <div class="ml">Заказов в день (7д)</div><div class="mv g">${Math.round(t.o7All / 7)}</div>
      <div class="md" style="font-size:10px;color:var(--ink3)">
        ${part("ef", "EF", Math.round(t.o7.ef / 7))}${part("ezfr", "EZFR", Math.round(t.o7.ezfr / 7))}${has("oz") ? "OZ: " + Math.round(t.o7.oz / 7) : ""}
      </div>
    </div>
    <div class="mc" style="border-top:3px solid var(--amber)">
      <div class="ml">Потребность 30 дней</div><div class="mv a">${t.need30.toLocaleString("ru")}</div>
    </div>
    <div class="mc" style="border-top:3px solid var(--red)">
      <div class="ml">Баланс</div>
      <div class="mv" style="color:${balance < 0 ? "var(--red)" : "var(--green)"}">${
        balance < 0 ? "−" + Math.abs(balance).toLocaleString("ru") : "✓ +" + balance.toLocaleString("ru")}</div>
    </div>
    <div class="mc" style="border-top:3px solid #5B3FA0">
      <div class="ml">Кабинеты</div><div class="mv" style="font-size:18px">${loaded.map((c) => c.short).join(" · ")}</div>
    </div>
  </div>`;
}

function ordersFeed() {
  const all = [];

  [1, 2].forEach((n) => {
    (D[n]?.todayO || []).forEach((o) => all.push({
      t: o.date, art: o.supplierArticle || "—", sz: o.techSize || "—",
      qty: o.quantity || 1, price: wbPrice(o), cab: cabShort(n),
    }));
  });

  (D[3]?.todayO || []).forEach((o) => {
    (o.products || []).forEach((p) => {
      const { baseArt, wbSz } = parseOzonArt(p.offer_id || "");
      all.push({
        t: o.in_process_at || o.created_at, art: baseArt, sz: wbSz,
        qty: p.quantity || 1, price: parseFloat(p.price || p.offer_price || 0), cab: "Ozon",
      });
    });
  });

  all.sort((a, b) => new Date(b.t) - new Date(a.t));
  const LIM_C = 15;
  const shown = CONSO.expandOrders ? all : all.slice(0, LIM_C);
  const colorOf = (c) => (c === "EF" ? "#E65100" : c === "EZFR" ? "#1565C0" : "var(--blue)");

  const rows = shown.map((o) => {
    const t = o.t ? new Date(o.t).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }) : "—";
    const p = sitePrice(o.price);
    return `<tr>
      <td><span class="tp">${t}</span></td>
      <td><span class="fl2" style="background:${colorOf(o.cab)}22;color:${colorOf(o.cab)}">${o.cab}</span></td>
      <td><span class="art">${esc(o.art)}</span></td>
      <td>${esc(o.sz)}</td><td>${o.qty}</td><td>${p ? fmt(p) : "—"}</td>
    </tr>`;
  }).join("");

  const more = all.length > LIM_C
    ? `<tr class="er"><td colspan="6"><button class="eb" onclick="App.togExpC()">${CONSO.expandOrders ? "▲ Свернуть" : "▼ Все " + all.length}</button></td></tr>`
    : "";

  return `<div class="sec">
    <div class="sh"><span class="st">🛒 Заказы сегодня · все кабинеты</span><span class="sm2">${all.length} заказов</span></div>
    <div class="tw"><table>
      <thead><tr><th>Время</th><th>Кабинет</th><th>Артикул</th><th>Размер</th><th>Кол-во</th><th>Цена на сайте</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="em">Нет заказов</td></tr>'}${more}</tbody>
    </table></div>
  </div>`;
}

function deficitTable(loaded) {
  const t = totals();
  const cols = loaded;

  const head = `<tr style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">
    <th rowspan="2" style="text-align:left;background:var(--bg3);vertical-align:middle">Артикул / Размер</th>
    ${cols.map((c) => `<th colspan="2" style="text-align:center;background:${c.color};color:${c.accent};border-bottom:2px solid ${c.accent}">${c.label}</th>`).join("")}
    <th style="text-align:center;background:#EDE7F6;color:#5B3FA0;border-bottom:2px solid #5B3FA0">🏭 СГП</th>
    <th style="text-align:center;background:#FBE9E7;color:#8B4513;border-bottom:2px solid #8B4513">🧵 Сырьё</th>
    <th style="text-align:center;background:#E8F5E9;color:#1B5E20;border-bottom:2px solid #4CAF50">📊 Общий</th>
    <th colspan="4" style="text-align:center;background:#FFF8E1;color:#F57F17;border-bottom:2px solid #FFC107">📈 Потребность и дефицит</th>
    <th colspan="2" style="text-align:center;background:#E0F2F1;color:#004D40;border-bottom:2px solid #26A69A">⏱ Запас дней ×выкуп</th>
  </tr>
  <tr style="font-size:9px;font-weight:700;text-transform:uppercase">
    ${cols.map((c) => `
      <th style="text-align:center;background:${c.color};color:${c.accent}" data-tip="Остаток на складах ${c.label}">Сток</th>
      <th style="text-align:center;background:${c.color};color:${c.accent}" data-tip="Заказов в день за 7 дней — ${c.label}">Зак/д</th>`).join("")}
    <th style="text-align:center;background:#EDE7F6;color:#5B3FA0" data-tip="Готовая продукция на складе">СГП</th>
    <th style="text-align:center;background:#FBE9E7;color:#8B4513" data-tip="Полуфабрикаты (nobrand суммируется)">Сырьё</th>
    <th style="text-align:center;background:#E8F5E9;color:#1B5E20" data-tip="Маркетплейсы + СГП + Сырьё">ИТОГО</th>
    <th style="text-align:center;background:#FFF8E1;color:#F57F17" data-tip="Заказов в день по всем кабинетам">Зак/д ∑</th>
    <th style="text-align:center;background:#FFF8E1;color:#F57F17" data-tip="Потребность на 30 дней">Мес.</th>
    <th style="text-align:center;background:#FFF8E1;color:#F57F17" data-tip="Доля в заказах">Доля</th>
    <th style="text-align:center;background:#FFF8E1;color:#F57F17" data-tip="Потребность минус общий сток">Дефицит</th>
    <th style="text-align:center;background:#E0F2F1;color:#004D40" data-tip="Дней хватит стока маркетплейсов">МП×</th>
    <th style="text-align:center;background:#E0F2F1;color:#004D40" data-tip="Дней хватит всего стока">Всё×</th>
  </tr>`;

  const qc = (v, lo) => (v === 0 ? "qx" : v < lo ? "ql" : "qo");
  let rows = "";

  for (const art of t.arts) {
    const szMap = t.data[art];
    const szList = Object.keys(szMap).sort(szCmp);
    const br = getBuyrate(art);
    const { sgp, raw } = getStocksForArt(art);

    const stk = { ef: 0, ezfr: 0, oz: 0 }, o7 = { ef: 0, ezfr: 0, oz: 0 };
    szList.forEach((sz) => ["ef", "ezfr", "oz"].forEach((k) => {
      stk[k] += szMap[sz].stk[k]; o7[k] += szMap[sz].o7[k];
    }));

    const mp = stk.ef + stk.ezfr + stk.oz;
    const total = mp + sgp + raw;
    const o7All = o7.ef + o7.ezfr + o7.oz;
    const dr = o7All / 7;
    const need = Math.round(dr * 30);
    const def = need - total;
    const eff = dr * br.val;
    const dMp = eff > 0 ? Math.round(mp / eff) : null;
    const dAll = eff > 0 ? Math.round(total / eff) : null;

    const open = OAC.has(art);
    const hasSz = szList.length > 1;
    const tog = hasSz ? `<span class="tog">${open ? "▼" : "▶"}</span>` : '<span class="tog"> </span>';

    rows += `<tr class="ar-row"${hasSz ? ` onclick="App.togConsoArt('${q(art)}')"` : ""}>
      <td>${tog}<span class="art">${esc(art)}</span>
        <span class="buyrate ${br.est ? "buyrate-est" : "buyrate-ok"}">${Math.round(br.val * 100)}%${br.est ? "~" : ""}</span></td>
      ${cols.map((c) => `
        <td class="${qc(stk[c.key], 20)}" style="text-align:center;background:${c.color}">${stk[c.key] || "—"}</td>
        <td style="text-align:center;background:${c.color};font-size:11px">${Math.round(o7[c.key] / 7) || "—"}</td>`).join("")}
      <td style="text-align:center;color:#5B3FA0">${sgp || "—"}</td>
      <td style="text-align:center;color:#8B4513">${consoRawCell(art, raw)}</td>
      <td class="${qc(total, 30)}" style="text-align:center;font-weight:900;font-size:14px">${total}</td>
      <td style="text-align:center;font-weight:600">${Math.round(dr)}</td>
      <td style="text-align:center">${need || "—"}</td>
      <td style="text-align:center;font-size:11px;color:var(--blue)">${pct(o7All, t.o7All)}</td>
      <td style="text-align:center;font-weight:700;color:${def > 0 ? "var(--red)" : "var(--green)"}">${
        def > 0 ? "−" + def.toLocaleString("ru") : "✓ +" + Math.abs(def).toLocaleString("ru")}</td>
      <td style="text-align:center">${fmtDays(dMp)}</td>
      <td style="text-align:center">${fmtDays(dAll)}</td>
    </tr>`;

    if (!open) continue;

    for (const sz of szList) {
      const r = szMap[sz];
      const szO7 = r.o7.ef + r.o7.ezfr + r.o7.oz;
      const szMp = r.stk.ef + r.stk.ezfr + r.stk.oz;
      const s2 = getStocksForSz(art, sz);
      const szTotal = szMp + s2.sgp + s2.raw;
      const szDr = szO7 / 7;
      const szNeed = Math.round(szDr * 30);
      const szDef = szNeed - szTotal;
      const szEff = szDr * br.val;

      rows += `<tr class="sz-row">
        <td style="padding-left:28px;font-weight:600">${esc(sz)}</td>
        ${cols.map((c) => `
          <td class="${qc(r.stk[c.key], 10)}" style="text-align:center;background:${c.color};font-size:11px">${r.stk[c.key] || "—"}</td>
          <td style="text-align:center;background:${c.color};font-size:10px;color:var(--ink3)">${Math.round(r.o7[c.key] / 7) || "—"}</td>`).join("")}
        <td style="text-align:center;font-size:11px;color:#5B3FA0">${s2.sgp || "—"}</td>
        <td style="text-align:center;font-size:11px;color:#8B4513">${consoRawCell(art, s2.raw)}</td>
        <td class="${qc(szTotal, 15)}" style="text-align:center;font-weight:700">${szTotal}</td>
        <td style="text-align:center;font-size:11px">${Math.round(szDr)}</td>
        <td style="text-align:center;font-size:11px">${szNeed || "—"}</td>
        <td style="text-align:center;font-size:11px;color:var(--blue)">${pct(szO7, o7All)}</td>
        <td style="text-align:center;font-size:11px;font-weight:700;color:${szDef > 0 ? "var(--red)" : "var(--green)"}">${
          szDef > 0 ? "−" + szDef.toLocaleString("ru") : "✓ +" + Math.abs(szDef).toLocaleString("ru")}</td>
        <td style="text-align:center;font-size:11px">${fmtDays(szEff > 0 ? Math.round(szMp / szEff) : null)}</td>
        <td style="text-align:center;font-size:11px">${fmtDays(szEff > 0 ? Math.round(szTotal / szEff) : null)}</td>
      </tr>`;
    }
  }

  return `<div class="sec">
    <div class="sh">
      <span class="st">📊 Консолидированный дефицит · ${loaded.map((c) => c.short).join(" + ")}</span>
      <span class="sm2">${t.arts.length} артикулов</span>
    </div>
    <div class="sw sw-sticky"><table><thead>${head}</thead>
      <tbody>${rows || '<tr><td class="em" colspan="20">Нет данных</td></tr>'}</tbody></table></div>
  </div>`;
}

function warehouseSummary() {
  let out = "";
  const chip = (label, val, accent) =>
    `<div style="background:var(--bg3);border:1px solid ${accent || "var(--border)"};border-radius:8px;padding:6px 10px;font-size:11px">
      <span style="color:var(--ink3)">${esc(String(label).slice(0, 18))}</span><br><b>${Number(val).toLocaleString("ru")}</b></div>`;

  [1, 2].forEach((n) => {
    const d = D[n];
    if (!d) return;

    /* Склады WB (FBW) */
    const byWh = {};
    (d.stocks || []).forEach((s) => {
      const w = s.warehouseName || "—";
      byWh[w] = (byWh[w] || 0) + (s.quantity || 0);
    });
    const top = Object.keys(byWh).sort((a, b) => byWh[b] - byWh[a]).slice(0, 8);
    const grand = Object.values(byWh).reduce((a, b) => a + b, 0);

    /* Склады FBS (склад продавца) */
    const fbsWh = d.fbsWh || {};
    const fbsList = Object.keys(fbsWh).sort((a, b) => fbsWh[b] - fbsWh[a]);
    const fbsGrand = Object.values(fbsWh).reduce((a, b) => a + b, 0);

    out += `<div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--ink2);margin-bottom:6px">
        ${cabShort(n)} · FBW — ${grand.toLocaleString("ru")} шт на ${Object.keys(byWh).length} складах</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${top.map((w) => chip(w, byWh[w])).join("")}
      </div>
      ${fbsList.length ? `
      <div style="font-size:11px;font-weight:700;color:#8B4513;margin:10px 0 6px">
        ${cabShort(n)} · FBS (склад продавца) — ${fbsGrand.toLocaleString("ru")} шт на ${fbsList.length} складах</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${fbsList.map((w) => chip(w, fbsWh[w], "#8B4513")).join("")}
      </div>` : `<div style="font-size:10px;color:var(--ink3);margin-top:6px">FBS: нет данных (нужен ключ «Маркетплейс» в воркере)</div>`}
    </div>`;
  });

  if (D[3]) {
    const total = (D[3].stocks || []).reduce((s, r) => s + (r.free_to_sell_amount || r.quantity || 0), 0);
    out += `<div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--blue)">Ozon — ${total.toLocaleString("ru")} шт (FBO)</div>
    </div>`;
  }

  return `<div class="sec"><div class="sh"><span class="st">📦 Остатки по складам · сводно</span></div>${out || '<div class="em">Нет данных</div>'}</div>`;
}
