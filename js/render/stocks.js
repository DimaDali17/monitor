import { VM, SS, FSS, FS, FSZ, OA, EXS, EXFS, FA } from "../state.js";
import { LIM } from "../config.js";
import { esc, q, szCmp } from "../utils.js";
import { getStocksForArt, getStocksForSz, dedupRawTotal, rawPoolForSz } from "../api/sheets.js";
import { FBS_WAREHOUSES, canonWh, FBS_LOW, FBS_LOW_DAYS, ruleFor, ruleText, whRequired, poolMates } from "../fbsRules.js";

/* Из чего можно сделать FBS: СГП артикула + сырьё всего пула (у «спутника» пула
   в колонке сырья «—», но сырьё у него есть — лежит на главном артикуле). */
const srcForArt = (a) => getStocksForArt(a).sgp + dedupRawTotal(poolMates(a));
const srcForSz = (a, sz) => getStocksForSz(a, sz).sgp + rawPoolForSz(poolMates(a), sz);

/* Каркас секции. Тело таблицы рисуется отдельно — сортировка
   и раскрытие артикула перерисовывают только #stbl, а не весь экран. */
export function stocksHTML(n) {
  const vm = VM[n];
  if (!vm) return "";
  const count = Object.keys(vm.arts).length;
  const fbsWhCount = Object.keys(vm.fbsWh || {}).length;
  const whCount = vm.whList.length + fbsWhCount;
  const msk = vm.mskWhs.length
    ? `<span class="sm2" style="color:var(--sgp)">МСК: ${vm.mskWhs.join(", ")}</span>`
    : "";
  const fbsNote = fbsWhCount
    ? `<span class="sm2" style="color:#8B4513">FBS: ${fbsWhCount} скл.</span>`
    : "";

  return `<div class="sec">
    <div class="sh">
      <span class="st" data-tip="Итого = FBW (склады WB) + FBS (склады продавца). СГП и сырьё сюда не входят — поэтому «Итого» не совпадает с «Общий» в дефиците">Остатки FBW + FBS (без сырья и СГП)</span>
      <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="sm2">${count} позиций · ${whCount} складов</span>${fbsNote}${msk}
        <button class="b" style="padding:3px 9px;font-size:10px" onclick="App.exportXlsx(this,'Остатки','ostatki')" data-tip="Скачать в Excel — как на экране">⤓ Excel</button>
      </span>
    </div>
    <div class="sw" id="stbl${n}">${stocksTbl(n)}</div>
  </div>`;
}

/* ❗ у «Итого», если FBW+FBS больше общего остатка из дефицита (FBW+СГП+Сырьё),
   т.е. FBS больше, чем СГП+Сырьё, — FBS на WB, вероятно, завышен (как ❗ в других таблицах) */
function totalOverMark(itogo, fbw, fbs, base) {
  return ` <span style="color:#B3261E;font-weight:700;cursor:help" data-tip="Итого FBW+FBS (${fbw} + ${fbs} = ${itogo}) больше общего остатка из дефицита FBW+СГП+Сырьё (${fbw} + ${base} = ${fbw + base}): FBS (${fbs}) больше, чем СГП+Сырьё (${base}) — возможно, остаток FBS на WB завышен">❗</span>`;
}

export function stocksTbl(n) {
  const vm = VM[n];
  if (!vm) return '<div class="em">Нет данных</div>';

  const { arts, whList } = vm;
  const fbsCells = vm.fbsCells || {};
  /* FBS-склады продавца — отдельные колонки справа, справочно, но в «Итого» входят */
  const fbsWhList = Object.keys(vm.fbsWh || {}).sort((a, b) => (vm.fbsWh[b] || 0) - (vm.fbsWh[a] || 0));

  const { c, d: dir } = SS[n];
  const fa = (FS[n] || "").trim().toLowerCase();
  const fz = (FSZ[n] || "").trim().toLowerCase();

  /* Группировка по артикулу */
  const byArt = {};
  for (const v of Object.values(arts)) {
    if (fa && !v.art.toLowerCase().includes(fa) && !(v.name || "").toLowerCase().includes(fa)) continue;
    if (fz && !v.sz.toLowerCase().includes(fz)) continue;
    const g = (byArt[v.art] ||= { name: v.name, total: 0, fbw: 0, fbs: 0, wh: {}, fbsWh: {}, sizes: [] });
    g.total += v.total; g.fbw += v.total;
    g.sizes.push(v);
    for (const [w, qy] of Object.entries(v.wh)) g.wh[w] = (g.wh[w] || 0) + qy;
    /* FBS для этого артикул·размера */
    const fc = fbsCells[v.art + " · " + v.sz] || {};
    for (const [w, qy] of Object.entries(fc)) { g.fbsWh[w] = (g.fbsWh[w] || 0) + qy; g.total += qy; g.fbs += qy; }
  }

  const getSort = (o) => (c === "total" ? o.total : (o.wh[c] ?? o.fbsWh[c] ?? 0));
  const keys = Object.keys(byArt).sort((a, b) =>
    c === "art" ? a.localeCompare(b) * dir : (getSort(byArt[a]) - getSort(byArt[b])) * dir);

  const arrow = (k) => (SS[n].c === k ? (SS[n].d < 0 ? " ↓" : " ↑") : " ↕");
  const cls = (k) => (SS[n].c === k ? " sa" : "");
  const qc = (v, lo) => (v === 0 ? "qx" : v < lo ? "ql" : "qo");

  const whHead = whList.map((w) =>
    `<th class="${cls(w)}" data-sort style="background:var(--bg2);color:var(--ink2)" onclick="App.sortS(${n},'${q(w)}')">` +
    `<span style="font-size:8px">${esc(w.slice(0, 14))}</span>${arrow(w)}</th>`
  ).join("");

  const fbsHead = fbsWhList.map((w) =>
    `<th class="${cls(w)}" data-sort style="background:#FBE9E7;color:#8B4513" onclick="App.sortS(${n},'${q(w)}')" data-tip="FBS-склад продавца: ${esc(w)}">` +
    `<span style="font-size:8px">FBS·${esc(w)}</span>${arrow(w)}</th>`
  ).join("");

  const shown = EXS[n] ? keys : keys.slice(0, LIM);
  let rows = "";

  for (const a of shown) {
    const g = byArt[a];
    const open = OA[n].has(a);
    const hasSizes = g.sizes.length > 1;
    const tog = hasSizes ? `<span class="tog">${open ? "▼" : "▶"}</span>` : '<span class="tog"> </span>';

    const cells = whList.map((w) => {
      const qy = g.wh[w] || 0;
      return `<td class="${qc(qy, 10)}" style="text-align:center">${qy || "—"}</td>`;
    }).join("");
    const cellsF = fbsWhList.map((w) => {
      const qy = g.fbsWh[w] || 0;
      return `<td class="${qy === 0 ? "qx" : ""}" style="text-align:center;color:#8B4513">${qy || "—"}</td>`;
    }).join("");

    /* сверка с дефицитом — только для WB и без фильтра по размеру (иначе суммы неполные) */
    let mark = "";
    if (!vm.isOz && !fz && g.fbs > 0) {
      const base = srcForArt(a);
      if (g.fbs > base) mark = totalOverMark(g.total, g.fbw, g.fbs, base);
    }

    rows += `<tr class="ar-row"${hasSizes ? ` onclick="App.togArt(${n},'${q(a)}')"` : ""}>
      <td style="white-space:nowrap">${tog}<span class="art">${esc(a)}</span><span style="font-size:10px;color:var(--ink3);margin-left:6px">${esc(g.name.slice(0, 22))}</span></td>
      <td class="tc ${qc(g.total, 10)}"${mark ? ' style="color:#B3261E"' : ""}>${g.total}${mark}</td>${cells}${cellsF}
    </tr>`;

    if (open) {
      for (const sv of [...g.sizes].sort((x, y) => szCmp(x.sz, y.sz))) {
        const fc = fbsCells[a + " · " + sv.sz] || {};
        const szFbs = Object.values(fc).reduce((s, x) => s + x, 0);
        const sc = whList.map((w) => {
          const qy = sv.wh[w] || 0;
          return `<td class="${qy === 0 ? "qx" : qy < 10 ? "ql" : ""}" style="text-align:center;font-size:11px">${qy || "—"}</td>`;
        }).join("");
        const scF = fbsWhList.map((w) => {
          const qy = fc[w] || 0;
          return `<td class="${qy === 0 ? "qx" : ""}" style="text-align:center;font-size:11px;color:#8B4513">${qy || "—"}</td>`;
        }).join("");
        let markSz = "";
        if (!vm.isOz && szFbs > 0) {
          const base = srcForSz(a, sv.sz);
          if (szFbs > base) markSz = totalOverMark(sv.total + szFbs, sv.total, szFbs, base);
        }
        rows += `<tr class="sz-row">
          <td style="padding-left:28px">${esc(sv.sz)}</td>
          <td class="${qc(sv.total + szFbs, 10)}" style="text-align:center;font-weight:600${markSz ? ";color:#B3261E" : ""}">${sv.total + szFbs}${markSz}</td>${sc}${scF}
        </tr>`;
      }
    }
  }

  const span = whList.length + fbsWhList.length + 2;
  const more = keys.length > LIM
    ? `<tr class="er"><td class="stick" colspan="${span}"><button class="eb" onclick="App.togExS(${n})">${EXS[n] ? "▲ Свернуть" : "▼ Все " + keys.length}</button></td></tr>`
    : "";

  return `<table>
    <thead><tr>
      <th class="${cls('art')}" data-sort style="text-align:left" onclick="App.sortS(${n},'art')">Артикул${arrow('art')}</th>
      <th class="${cls("total")}" data-sort style="background:var(--bg3)" onclick="App.sortS(${n},'total')">Итого${arrow("total")}</th>
      ${whHead}${fbsHead}
    </tr></thead>
    <tbody>${rows || '<tr><td class="em" colspan="99">Ничего не найдено</td></tr>'}${more}</tbody>
  </table>`;
}

/* ══════════ Остатки по FBS (отдельный блок) ══════════
   Артикул · Сырьё+СГП · FBS общий · FBS по складам (колонки).
   Каркас + тело: сортировка перерисовывает только #fbstbl, как и в остальных таблицах. */
/* ── «Остатки по FBS» + правила наличия на складах (js/fbsRules.js) ── */
function fbsRows(n) {
  const vm = VM[n];
  const fbsMap = vm.fbs || {};
  const fbsCells = vm.fbsCells || {};
  /* Колонки: всегда наши 5 FBS-складов (по правилам «все склады» — это они), плюс
     склады кабинета, которые не удалось сопоставить, — справа. */
  const fixed = FBS_WAREHOUSES.map((w) => w.name);
  const extraWh = [...new Set(Object.keys(vm.fbsWh || {}).map(canonWh))].filter((w) => !fixed.includes(w)).sort();
  const whList = [...fixed, ...extraWh];
  const whInCab = new Set(Object.keys(vm.fbsWh || {}).map(canonWh));

  const byArt = {};
  const add = (art) => (byArt[(art || "").toLowerCase()] ||= { art, fbs: 0, wh: {} });
  for (const [k, v] of Object.entries(fbsMap)) { const g = add(k.split(" · ")[0]); g.art = k.split(" · ")[0]; g.fbs += v; }
  for (const [k, wm] of Object.entries(fbsCells)) { const g = add(k.split(" · ")[0]); for (const [w0, qy] of Object.entries(wm)) { const w = canonWh(w0); g.wh[w] = (g.wh[w] || 0) + qy; } }

  /* Артикулы с правилом, у которых FBS нет совсем, — тоже показываем (это и есть тревога).
     Только те, что есть в кабинете (с учётом фильтров). */
  if (!vm.isOz) {
    const present = new Set();
    for (const r of vm.stocks || []) present.add(r.supplierArticle);
    for (const o of vm.allOrders || []) present.add(o.supplierArticle);
    for (const art of present) if (art && ruleFor(art, n) && !byArt[art.toLowerCase()]) add(art);
  }

  /* Темп FBS-заказов по складу: заказы 7 дней (с учётом фильтров), у которых известен
     склад продавца (сопоставлено по сборочным заданиям). Шт/день. */
  const rate = {};
  let hasWhData = false;
  if (!vm.isOz) {
    for (const o of vm.orders7 || []) {
      if (!o.fbsWarehouse) continue;
      hasWhData = true;
      const k = (o.supplierArticle || "").toLowerCase(), w = canonWh(o.fbsWarehouse);
      (rate[k] ||= {})[w] = ((rate[k] || {})[w] || 0) + (o.quantity || 1) / 7;
    }
  }
  const daysAt = (art, w, qy) => {
    const r = (rate[art.toLowerCase()] || {})[w] || 0;
    return r > 0 ? qy / r : Infinity;
  };
  const isLow = (art, w, qy) => qy > 0 && (hasWhData ? daysAt(art, w, qy) <= FBS_LOW_DAYS : qy <= FBS_LOW);

  const RANK = { red: 0, amber: 1, ok: 2, none: 3 };
  const rows = Object.values(byArt).map((g) => {
    const base = vm.isOz ? 0 : srcForArt(g.art);
    const rule = vm.isOz ? null : ruleFor(g.art, n);
    let empty = [], low = [], st = "none";
    let extra = [];
    if (rule && rule.rule === "none") {
      /* «не держим на FBS»: норма — пусто везде; остаток где-то — жёлтый сигнал */
      extra = whList.filter((w) => g.wh[w] > 0);
      st = extra.length ? "amber" : "ok";
    } else if (rule) {
      const req = whList.filter((w) => whRequired(rule.rule, w));
      empty = req.filter((w) => !(g.wh[w] > 0));
      low = req.filter((w) => isLow(g.art, w, g.wh[w] || 0));
      st = !req.length || empty.length ? "red" : low.length ? "amber" : "ok";
    }
    return { art: g.art, base, fbs: g.fbs, wh: g.wh, rule, empty, low, extra, st, rank: RANK[st] };
  });
  return { rows, whList, whInCab, isLow, daysAt, rate, hasWhData };
}

export function fbsStocksHTML(n) {
  const vm = VM[n];
  if (!vm) return "";
  const { rows, whList, hasWhData } = fbsRows(n);
  if (!rows.length) return "";          /* нет FBS-данных и правил — блок не показываем */

  const red = rows.filter((r) => r.st === "red").length, amber = rows.filter((r) => r.st === "amber").length;
  const okN = rows.filter((r) => r.st === "ok").length;
  const summary = (red || amber || okN)
    ? `<span class="sm2" data-tip="По правилам наличия на FBS-складах (js/fbsRules.js): пусто или мало (${hasWhData ? "хватит на ≤" + FBS_LOW_DAYS + " дн. по FBS-заказам этого склада за 7 дней" : "≤" + FBS_LOW + " шт — нет данных о складах заказов"}) на обязательном складе">Правила:
         ${red ? `<b style="color:#B3261E">🔴 ${red}</b>` : ""} ${amber ? `<b style="color:#8A5A00">🟠 ${amber}</b>` : ""} ${okN ? `<span style="color:#2F7D55">✅ ${okN}</span>` : ""}</span>`
    : "";

  return `<div class="sec">
    <div class="sh">
      <span class="st">Остатки по FBS</span>
      <span style="display:flex;align-items:center;gap:8px">
        ${summary}
        <span class="sm2">${rows.length} позиций · ${whList.length} складов</span>
        <button class="b" style="padding:3px 9px;font-size:10px" onclick="App.exportXlsx(this,'FBS','fbs')" data-tip="Скачать в Excel — как на экране">⤓ Excel</button>
      </span>
    </div>
    <div class="sw" id="fbstbl${n}">${fbsStocksTbl(n)}</div>
  </div>`;
}

export function fbsStocksTbl(n) {
  const vm = VM[n];
  if (!vm) return '<div class="em">Нет данных</div>';
  const { rows, whList, whInCab, isLow, daysAt, rate, hasWhData } = fbsRows(n);
  const lowTxt = hasWhData ? `хватит на ≤${FBS_LOW_DAYS} дн.` : `≤${FBS_LOW} шт`;
  const daysTip = (art, w, qy) => {
    const r = (rate[art.toLowerCase()] || {})[w] || 0;
    if (!hasWhData) return "";
    return r > 0 ? `${w}: ${qy} шт, FBS-заказов ~${(Math.round(r * 10) / 10).toLocaleString("ru")}/день → хватит на ~${Math.round(qy / r * 10) / 10} дн.`
                 : `${w}: ${qy} шт, FBS-заказов с этого склада за 7 дней не было`;
  };

  /* Сортировка: статус (сначала проблемы), артикул, Сырьё+СГП, FBS общий, любой склад. */
  const { c, d: dir } = FSS[n];
  const keyOf = (r) => (c === "st" ? r.rank : c === "base" ? r.base : c === "fbs" ? r.fbs : (r.wh[c] || 0));
  rows.sort((a, b) => {
    if (c === "art") return a.art.localeCompare(b.art) * dir;
    const d = (keyOf(a) - keyOf(b)) * dir;
    return d || a.art.localeCompare(b.art);
  });

  const arrow = (k) => (FSS[n].c === k ? (FSS[n].d < 0 ? " ↓" : " ↑") : " ↕");
  const cls = (k) => (FSS[n].c === k ? " sa" : "");

  const whHead = whList.map((w) =>
    `<th class="${cls(w)}" data-sort style="text-align:center;background:#FBE9E7;color:#8B4513${whInCab.has(w) ? "" : ";opacity:.6"}" onclick="App.sortFS(${n},'${q(w)}')" data-tip="${esc(whInCab.has(w) ? "FBS-склад продавца: " + w : "Склада «" + w + "» в этом кабинете нет — по правилу «все склады» он считается пустым")}">` +
    `<span style="font-size:9px">${esc(w)}${whInCab.has(w) ? "" : " ⚠"}</span>${arrow(w)}</th>`).join("");

  const RED = "background:#F7DDD9;color:#B3261E;font-weight:700", AMB = "background:#FBEBCF;color:#8A5A00;font-weight:700";
  const statusCell = (r) => {
    if (!r.rule) return `<td style="text-align:center;color:var(--ink3)">—</td>`;
    if (r.rule.rule === "none") {
      return r.st === "amber"
        ? `<td style="text-align:center;white-space:nowrap" data-tip="${esc("По правилу на FBS должно быть 0 (всё на FBO), а есть: " + r.extra.map((w) => w + " " + r.wh[w]).join(", "))}"><span style="${AMB};padding:1px 8px;border-radius:10px;font-size:11px">🟠 есть на FBS</span></td>`
        : `<td style="text-align:center" data-tip="По правилу на FBS ничего нет — всё на FBO"><span style="background:#E1EFE4;color:#2F7D55;font-weight:700;padding:1px 8px;border-radius:10px;font-size:11px">✅ FBO</span></td>`;
    }
    const noSrc = (r.st === "red" || r.st === "amber") && !(r.base > 0);
    const srcNote = noSrc ? `<div style="font-size:9px;color:#B3261E">нечем пополнить</div>` : "";
    if (r.st === "red") {
      const tip = r.empty.length ? "Пусто на обязательных складах: " + r.empty.join(", ") : "Нет обязательного склада среди FBS-складов";
      return `<td style="text-align:center;white-space:nowrap" data-tip="${esc(tip)}"><span style="${RED};padding:1px 8px;border-radius:10px;font-size:11px">🔴 пусто ${r.empty.length || ""}</span>${srcNote}</td>`;
    }
    if (r.st === "amber") return `<td style="text-align:center;white-space:nowrap" data-tip="${esc("Мало (" + lowTxt + "): " + r.low.map((w) => hasWhData ? daysTip(r.art, w, r.wh[w]) : w + " " + r.wh[w]).join("; "))}"><span style="${AMB};padding:1px 8px;border-radius:10px;font-size:11px">🟠 мало</span>${srcNote}</td>`;
    return `<td style="text-align:center"><span style="background:#E1EFE4;color:#2F7D55;font-weight:700;padding:1px 8px;border-radius:10px;font-size:11px">✅</span></td>`;
  };

  /* Свёрнуто до LIM строк, ниже — кнопка «Все N / Свернуть» (как в «Остатки по складам»). */
  const shown = EXFS[n] ? rows : rows.slice(0, LIM);
  const body = shown.map((r) => {
    const over = !vm.isOz && r.fbs > r.base;
    const cells = whList.map((w) => {
      const qy = r.wh[w] || 0;
      if (!r.rule) return `<td style="text-align:center;font-size:11px;color:#8B4513">${qy || "—"}</td>`;
      if (r.rule.rule === "none") {
        return qy > 0
          ? `<td style="text-align:center;font-size:11px;${AMB}" data-tip="По правилу здесь должно быть 0">${qy}</td>`
          : `<td style="text-align:center;font-size:11px;color:var(--ink3)">·</td>`;
      }
      const req = whRequired(r.rule.rule, w);
      if (!req) return `<td style="text-align:center;font-size:11px;color:var(--ink3)" data-tip="По правилу «${esc(ruleText(r.rule.rule))}» этот склад не обязателен">${qy || "·"}</td>`;
      const style = qy === 0 ? RED : isLow(r.art, w, qy) ? AMB : "color:#8B4513";
      const tip = qy > 0 ? daysTip(r.art, w, qy) : "";
      return `<td style="text-align:center;font-size:11px;${style}"${tip ? ` data-tip="${esc(tip)}"` : ""}>${qy || "0"}</td>`;
    }).join("");
    return `<tr>
      <td style="white-space:nowrap"><span class="art">${esc(r.art)}</span></td>
      <td style="text-align:center;font-size:10px;color:var(--ink2);white-space:nowrap">${r.rule ? `<span data-tip="${esc(r.rule.name)}">${esc(ruleText(r.rule.rule))}</span>` : "—"}</td>
      ${statusCell(r)}
      <td style="text-align:center;${!(r.base > 0) && r.rule && r.rule.rule !== "none" && r.st !== "ok" ? "color:#B3261E;font-weight:700" : ""}">${r.base || "—"}</td>
      <td class="tc" style="text-align:center;font-weight:700;${over ? "color:#B3261E" : ""}">${r.fbs || "0"}${over ? ` <span style="cursor:help" data-tip="FBS (${r.fbs}) больше, чем Сырьё+СГП (${r.base}) — возможно завышен">❗</span>` : ""}</td>
      ${cells}
    </tr>`;
  }).join("");

  const span = whList.length + 5;
  const more = rows.length > LIM
    ? `<tr class="er"><td class="stick" colspan="${span}"><button class="eb" onclick="App.togExFS(${n})">${EXFS[n] ? "▲ Свернуть" : "▼ Все " + rows.length}</button></td></tr>`
    : "";

  return `<table>
    <thead><tr>
      <th class="${cls('art')}" data-sort style="text-align:left" onclick="App.sortFS(${n},'art')">Артикул${arrow('art')}</th>
      <th style="text-align:center" data-tip="Где товар должен быть на FBS. Правила — в js/fbsRules.js">Правило</th>
      <th class="${cls('st')}" data-sort style="text-align:center" onclick="App.sortFS(${n},'st')" data-tip="🔴 пусто на обязательном складе · 🟠 мало (${lowTxt}) · ✅ правило выполняется. Клик — сортировка, проблемы сверху">Статус${arrow('st')}</th>
      <th class="${cls('base')}" data-sort style="text-align:center" onclick="App.sortFS(${n},'base')" data-tip="Из чего пополнить: СГП + сырьё (в наборах, всего пула)">Сырьё+СГП${arrow('base')}</th>
      <th class="${cls('fbs')}" data-sort style="text-align:center" onclick="App.sortFS(${n},'fbs')" data-tip="Остаток FBS по всем вашим складам">FBS общий${arrow('fbs')}</th>
      ${whHead}
    </tr></thead>
    <tbody>${body || '<tr><td class="em" colspan="99">Нет FBS-остатков</td></tr>'}${more}</tbody>
  </table>`;
}
