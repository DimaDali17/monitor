import { VM, SS, FSS, FS, FSZ, OA, OAF, EXS, EXFS, FA } from "../state.js";
import { LIM } from "../config.js";
import { esc, q, szCmp, normSz } from "../utils.js";
import { getStocksForArt, getStocksForSz, dedupRawTotal, rawPoolForSz } from "../api/sheets.js";
import { ozBase, FBS_WAREHOUSES, canonWh, FBS_LOW, FBS_LOW_DAYS, ruleFor, ruleText, whRequired, poolMates } from "../fbsRules.js";

/* Из чего можно сделать FBS: СГП артикула + сырьё всего пула (у «спутника» пула
   в колонке сырья «—», но сырьё у него есть — лежит на главном артикуле). */
const srcForArt = (a) => getStocksForArt(a).sgp + dedupRawTotal(poolMates(a));
const srcForSz = (a, sz) => getStocksForSz(a, sz).sgp + rawPoolForSz(poolMates(a), sz);

/* ── Кнопка «Все размеры / Свернуть размеры» (как в дефиците) ── */
export function sizeBtn(id, open, onclick) {
  return `<button class="b" id="${id}" style="padding:3px 9px;font-size:10px" onclick="${onclick}" data-tip="Раскрыть все артикулы до размеров или свернуть обратно">${open ? "▲ Свернуть размеры" : "▼ Все размеры"}</button>`;
}
/* Артикулы с несколькими размерами — в «Остатки FBW + FBS» */
export function stocksSizeArts(n) {
  const vm = VM[n];
  if (!vm) return [];
  const bySz = {};
  for (const v of Object.values(vm.arts || {})) (bySz[v.art] ||= new Set()).add(v.sz);
  return Object.keys(bySz).filter((a) => bySz[a].size > 1);
}
export const stocksAllOpen = (n) => { const a = stocksSizeArts(n); return a.length > 0 && a.every((x) => OA[n].has(x)); };
/* …и в «Остатки по FBS» (там размеры есть только у артикулов с правилами, WB) */
export function fbsSizeArts(n) {
  if (!VM[n]) return [];
  return fbsRows(n).rows.filter((r) => r.sizes && r.sizes.length > 1).map((r) => r.art);
}
export const fbsAllOpen = (n) => { const a = fbsSizeArts(n); return a.length > 0 && a.every((x) => OAF[n].has(x)); };

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
        ${stocksSizeArts(n).length ? sizeBtn("szs" + n, stocksAllOpen(n), `App.togAllSizesS(${n})`) : ""}
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
export function fbsRows(n) {
  const vm = VM[n];
  const fbsMap = vm.fbs || {};
  const fbsCells = vm.fbsCells || {};
  /* Колонки: всегда наши 5 FBS-складов (по правилам «все склады» — это они), плюс
     склады кабинета, которые не удалось сопоставить, — справа. */
  const fixed = FBS_WAREHOUSES.map((w) => w.name);
  /* «FBS» — условный склад, когда маркетплейс не дал разбивку (Ozon): отдельной колонкой
     не показываем — это дубль «FBS общий». */
  const noBreakdown = Object.keys(vm.fbsWh || {}).some((w) => w === "FBS");
  const extraWh = [...new Set(Object.keys(vm.fbsWh || {}).map(canonWh))].filter((w) => !fixed.includes(w) && w !== "FBS").sort();
  /* Ozon: FBS одной общей цифрой — колонок складов нет, правила проверяем по общему остатку */
  const whList = vm.isOz ? [] : [...fixed, ...extraWh];
  const whInCab = new Set(Object.keys(vm.fbsWh || {}).map(canonWh));

  /* У Ozon артикул бывает с размером («…_XL») — сводим к базовому, как у WB */
  const artOf = (k) => { const a = k.split(" · ")[0]; return vm.isOz ? ozBase(a) : a; };
  const byArt = {};
  const add = (art) => (byArt[(art || "").toLowerCase()] ||= { art, fbs: 0, wh: {} });
  for (const [k, v] of Object.entries(fbsMap)) { const g = add(artOf(k)); g.fbs += v; }
  for (const [k, wm] of Object.entries(fbsCells)) { const g = add(artOf(k)); for (const [w0, qy] of Object.entries(wm)) { const w = canonWh(w0); g.wh[w] = (g.wh[w] || 0) + qy; } }

  /* Артикулы с правилом, у которых FBS нет совсем, — тоже показываем (это и есть тревога).
     Только те, что есть в кабинете (с учётом фильтров). */
  {
    const present = new Set();
    if (vm.isOz) {
      for (const r of vm.stocks || []) present.add(ozBase(r.item_code || r.offer_id));
      for (const o of vm.allOrders || []) for (const p of o.products || []) present.add(ozBase(p.offer_id));
    } else {
      for (const r of vm.stocks || []) present.add(r.supplierArticle);
      for (const o of vm.allOrders || []) present.add(o.supplierArticle);
    }
    for (const art of present) if (art && ruleFor(art, n) && !byArt[art.toLowerCase()]) add(art);
  }

  /* Темп FBS-заказов по складу: заказы 7 дней (с учётом фильтров), у которых известен
     склад продавца (сопоставлено по сборочным заданиям). Шт/день. */
  const rate = {};
  let hasWhData = false;
  const rateTot = {};   /* Ozon: FBS-заказов в день по товару (все склады вместе) */
  if (vm.isOz) for (const o of vm.orders7 || []) {
    if (!o._fbs) continue;
    for (const p of o.products || []) { const k = ozBase(p.offer_id).toLowerCase(); rateTot[k] = (rateTot[k] || 0) + (p.quantity || 1) / 7; }
  }
  for (const o of vm.orders7 || []) {
    if (!o.fbsWarehouse) continue;
    hasWhData = true;
    const w = canonWh(o.fbsWarehouse);
    const lines = vm.isOz ? (o.products || []).map((p) => [ozBase(p.offer_id), p.quantity || 1]) : [[o.supplierArticle, o.quantity || 1]];
    for (const [a, qn] of lines) {
      const k = (a || "").toLowerCase();
      (rate[k] ||= {})[w] = ((rate[k] || {})[w] || 0) + qn / 7;
    }
  }
  const daysAt = (art, w, qy) => {
    const r = (rate[art.toLowerCase()] || {})[w] || 0;
    return r > 0 ? qy / r : Infinity;
  };
  const isLow = (art, w, qy) => qy > 0 && (hasWhData ? daysAt(art, w, qy) <= FBS_LOW_DAYS : qy <= FBS_LOW);

  /* Темп по размеру и складу (WB): «артикул|размер» → склад → шт/день */
  const rateSz = {};
  if (!vm.isOz) for (const o of vm.orders7 || []) {
    if (!o.fbsWarehouse) continue;
    const k = (o.supplierArticle || "").toLowerCase() + "|" + normSz(o.techSize || "");
    const w = canonWh(o.fbsWarehouse);
    (rateSz[k] ||= {})[w] = ((rateSz[k] || {})[w] || 0) + (o.quantity || 1) / 7;
  }
  const rateOf = (art, sz, w) => sz == null ? ((rate[art.toLowerCase()] || {})[w] || 0) : ((rateSz[art.toLowerCase() + "|" + normSz(sz)] || {})[w] || 0);
  const isLowU = (art, sz, w, qy) => {
    if (!(qy > 0)) return false;
    if (!hasWhData) return qy <= FBS_LOW;
    const r = rateOf(art, sz, w);
    return r > 0 && qy / r <= FBS_LOW_DAYS;
  };

  /* Оценка одной «единицы» — артикула целиком или одного размера */
  const evalUnit = (art, sz, rule, wh, fbsQty) => {
    let empty = [], low = [], extra = [], st = "none";
    if (rule && rule.rule === "none") {
      extra = vm.isOz ? (fbsQty > 0 ? ["всего"] : []) : whList.filter((w) => wh[w] > 0);
      st = extra.length ? "amber" : "ok";
    } else if (rule && vm.isOz) {
      /* Ozon — по общему FBS: 0 → пусто; хватит на ≤2 дн. по FBS-заказам → мало */
      const r = rateTot[art.toLowerCase()] || 0;
      st = !(fbsQty > 0) ? "red" : (r > 0 && fbsQty / r <= FBS_LOW_DAYS) ? "amber" : "ok";
      if (st === "amber") low = ["всего"];
    } else if (rule && noBreakdown) {
      st = fbsQty > 0 ? "nobd" : "red";
    } else if (rule) {
      const req = whList.filter((w) => whRequired(rule.rule, w));
      empty = req.filter((w) => !(wh[w] > 0));
      low = req.filter((w) => isLowU(art, sz, w, wh[w] || 0));
      st = !req.length || empty.length ? "red" : low.length ? "amber" : "ok";
    }
    return { empty, low, extra, st };
  };

  /* Размеры артикула (WB): из остатков FBW и из FBS. «—»/«0» — безразмерный товар. */
  const sizesOf = {};
  if (!vm.isOz) {
    const addSz = (art, sz) => { if (!art || !sz || sz === "—" || sz === "0") return; (sizesOf[art.toLowerCase()] ||= new Set()).add(sz); };
    for (const r of vm.stocks || []) addSz(r.supplierArticle, r.techSize);
    for (const k of Object.keys(fbsCells)) { const [a, z] = k.split(" · "); addSz(a, z); }
  }

  /* Потребность по размеру: заказы за 7 дней (любой канал). Размер без заказов —
     выведен или не продаётся — правилом не проверяем. Размеры сравниваем точно
     («42-44» и «42 44» — разные размеры), без учёта регистра. */
  const szKey = (a, z) => String(a || "").toLowerCase() + "|" + String(z || "").trim().toLowerCase();
  const demand = {};
  if (!vm.isOz) for (const o of vm.orders7 || []) {
    const k = szKey(o.supplierArticle, o.techSize);
    demand[k] = (demand[k] || 0) + (o.quantity || 1);
  }

  const RANK = { red: 0, amber: 1, nobd: 2, ok: 3, nodem: 4, none: 5 };
  const rows = Object.values(byArt).map((g) => {
    const base = srcForArt(g.art);   /* у Ozon g.art уже базовый — те же СГП/сырьё, что у WB */
    const rule = ruleFor(g.art, n);
    /* WB с размерами — правило проверяем по каждому размеру; строка артикула = худший размер */
    const szSet = sizesOf[g.art.toLowerCase()];
    let sizes = null;
    if (rule && szSet && szSet.size > 1) {
      sizes = [...szSet].sort(szCmp).map((sz) => {
        /* размер у FBS-ключа может быть записан иначе (регистр) — ищем без учёта регистра */
        const wh = {};
        let fq = 0;
        for (const [k, wm] of Object.entries(fbsCells)) {
          const [a, z] = k.split(" · ");
          if (szKey(a, z) !== szKey(g.art, sz)) continue;
          for (const [w0, qy] of Object.entries(wm)) { const w = canonWh(w0); wh[w] = (wh[w] || 0) + qy; fq += qy; }
        }
        const dem = demand[szKey(g.art, sz)] || 0;
        let ev;
        if (rule.rule !== "none" && !dem) {
          ev = { st: "nodem", empty: [], low: [], extra: [] };       /* нет заказов за 7 дней — не проверяем */
        } else {
          ev = evalUnit(g.art, sz, rule, wh, fq);
          /* нехватка отдельного размера — жёлтым, не красным */
          if (ev.st === "red" && rule.rule !== "none") ev.st = "amber";
        }
        return { sz, wh, fbs: fq, dem, base: srcForSz(g.art, sz), ...ev, rank: RANK[ev.st] };
      });
    }
    let ev;
    if (sizes) {
      const worst = Math.min(...sizes.map((x) => x.rank));
      let st = Object.keys(RANK).find((k) => RANK[k] === worst);
      if (st === "nodem") st = "ok";   /* ни у одного размера нет спроса — тревоги нет */
      ev = { st, empty: [], low: [], extra: [],
        badSizes: sizes.filter((x) => x.st === "red" || x.st === "amber") };
    } else {
      ev = evalUnit(g.art, null, rule, g.wh, g.fbs);
    }
    return { art: g.art, base, fbs: g.fbs, wh: g.wh, rule, sizes, ...ev, rank: RANK[ev.st] };
  });
  return { rows, whList, whInCab, isLow, isLowU, rateOf, daysAt, rate, rateTot, hasWhData, noBreakdown };
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
        ${rows.some((r) => r.sizes && r.sizes.length > 1) ? sizeBtn("szf" + n, fbsAllOpen(n), `App.togAllSizesF(${n})`) : ""}
        <button class="b" style="padding:3px 9px;font-size:10px" onclick="App.exportXlsx(this,'FBS','fbs')" data-tip="Скачать в Excel — как на экране">⤓ Excel</button>
      </span>
    </div>
    <div class="sw" id="fbstbl${n}">${fbsStocksTbl(n)}</div>
  </div>`;
}

export function fbsStocksTbl(n) {
  const vm = VM[n];
  if (!vm) return '<div class="em">Нет данных</div>';
  const { rows, whList, whInCab, isLowU, rateOf, rateTot, hasWhData, noBreakdown } = fbsRows(n);
  const lowTxt = hasWhData ? `хватит на ≤${FBS_LOW_DAYS} дн.` : `≤${FBS_LOW} шт`;
  const daysTip = (art, w, qy, sz = null) => {
    const r = rateOf(art, sz, w);
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
    `<th class="${cls(w)}" data-sort style="text-align:center;background:#FBE9E7;color:#8B4513${whInCab.has(w) || noBreakdown ? "" : ";opacity:.6"}" onclick="App.sortFS(${n},'${q(w)}')" data-tip="${esc(whInCab.has(w) ? "FBS-склад продавца: " + w : "Склада «" + w + "» в этом кабинете нет — по правилу «все склады» он считается пустым")}">` +
    `<span style="font-size:9px">${esc(w)}${whInCab.has(w) || noBreakdown ? "" : " ⚠"}</span>${arrow(w)}</th>`).join("");

  const RED = "background:#F7DDD9;color:#B3261E;font-weight:700", AMB = "background:#FBEBCF;color:#8A5A00;font-weight:700";
  const chip = (style, txt) => `<span style="${style};padding:1px 8px;border-radius:10px;font-size:11px">${txt}</span>`;
  const statusCell = (r) => {
    if (!r.rule) return `<td style="text-align:center;color:var(--ink3)">—</td>`;
    if (r.sizes && r.rule.rule !== "none") {
      /* правило по размерам: сколько размеров с проблемой, подсказка — какие и где */
      const bad = r.sizes.filter((x) => x.st === "amber" || x.st === "red");
      if (!bad.length) return `<td style="text-align:center">${chip("background:#E1EFE4;color:#2F7D55;font-weight:700", "✅")}</td>`;
      const lines = bad.map((x) => `${x.sz}: ${[x.empty.length ? "нет — " + x.empty.join(", ") : "", x.low.length ? "мало — " + x.low.join(", ") : ""].filter(Boolean).join("; ")}`);
      const parts = chip(AMB, `🟠 ${bad.length} разм.`);
      return `<td style="text-align:center;white-space:nowrap" data-tip="${esc(lines.join("; "))}">${parts}${!(r.base > 0) ? `<div style="font-size:9px;color:#B3261E">нечем пополнить</div>` : ""}</td>`;
    }
    if (r.rule.rule === "none") {
      return r.st === "amber"
        ? `<td style="text-align:center;white-space:nowrap" data-tip="${esc("По правилу на FBS должно быть 0 (всё на FBO), а есть: " + (vm.isOz ? r.fbs + " шт" : r.extra.map((w) => w + " " + r.wh[w]).join(", ")))}"><span style="${AMB};padding:1px 8px;border-radius:10px;font-size:11px">🟠 есть на FBS</span></td>`
        : `<td style="text-align:center" data-tip="По правилу на FBS ничего нет — всё на FBO"><span style="background:#E1EFE4;color:#2F7D55;font-weight:700;padding:1px 8px;border-radius:10px;font-size:11px">✅ FBO</span></td>`;
    }
    if (r.st === "nobd") return `<td style="text-align:center;white-space:nowrap" data-tip="Маркетплейс не отдал FBS по складам — правило по складам проверить нельзя, всего на FBS ${r.fbs} шт"><span style="background:var(--bg2);color:var(--ink2);font-weight:700;padding:1px 8px;border-radius:10px;font-size:11px">без разбивки</span></td>`;
    const noSrc = r.sz == null && (r.st === "red" || r.st === "amber") && !(r.base > 0);   /* только у артикула, не у размера */
    const srcNote = noSrc ? `<div style="font-size:9px;color:#B3261E">нечем пополнить</div>` : "";
    if (vm.isOz && (r.st === "red" || r.st === "amber")) {
      const rt = rateTot[r.art.toLowerCase()] || 0;
      const tip = r.st === "red" ? "На FBS Ozon 0 шт" : `На FBS ${r.fbs} шт, FBS-заказов ~${(Math.round(rt * 10) / 10).toLocaleString("ru")}/день → хватит на ~${Math.round(r.fbs / rt * 10) / 10} дн.`;
      const chip = r.st === "red" ? `<span style="${RED};padding:1px 8px;border-radius:10px;font-size:11px">🔴 пусто</span>` : `<span style="${AMB};padding:1px 8px;border-radius:10px;font-size:11px">🟠 мало</span>`;
      return `<td style="text-align:center;white-space:nowrap" data-tip="${esc(tip)}">${chip}${noSrc ? `<div style="font-size:9px;color:#B3261E">нечем пополнить</div>` : ""}</td>`;
    }
    if (r.st === "nodem") return `<td style="text-align:center" data-tip="Заказов этого размера за 7 дней не было — правило к нему не применяется"><span style="color:var(--ink3);font-size:10px">нет спроса</span></td>`;
    if (r.sz != null && r.st === "amber" && r.empty.length) {
      return `<td style="text-align:center;white-space:nowrap" data-tip="${esc("Нет на складах: " + r.empty.join(", ") + (r.low.length ? "; мало: " + r.low.join(", ") : ""))}">${chip(AMB, "🟠 нет " + r.empty.length)}</td>`;
    }
    if (r.st === "red") {
      const tip = r.empty.length ? "Пусто на обязательных складах: " + r.empty.join(", ") : "Нет обязательного склада среди FBS-складов";
      return `<td style="text-align:center;white-space:nowrap" data-tip="${esc(tip)}"><span style="${RED};padding:1px 8px;border-radius:10px;font-size:11px">🔴 пусто ${r.empty.length || ""}</span>${srcNote}</td>`;
    }
    if (r.st === "amber") return `<td style="text-align:center;white-space:nowrap" data-tip="${esc("Мало (" + lowTxt + "): " + r.low.map((w) => hasWhData ? daysTip(r.art, w, r.wh[w], r.sz ?? null) : w + " " + r.wh[w]).join("; "))}"><span style="${AMB};padding:1px 8px;border-radius:10px;font-size:11px">🟠 мало</span>${srcNote}</td>`;
    return `<td style="text-align:center"><span style="background:#E1EFE4;color:#2F7D55;font-weight:700;padding:1px 8px;border-radius:10px;font-size:11px">✅</span></td>`;
  };

  /* Свёрнуто до LIM строк, ниже — кнопка «Все N / Свернуть» (как в «Остатки по складам»). */
  const shown = EXFS[n] ? rows : rows.slice(0, LIM);
  /* Ячейки складов для «единицы» (артикул без размеров или один размер) */
  const unitCell = (u, art, sz, w) => {
    const qy = u.wh[w] || 0;
    if (!u.rule) return `<td style="text-align:center;font-size:11px;color:#8B4513">${qy || "—"}</td>`;
    if (noBreakdown) return `<td style="text-align:center;font-size:11px;color:var(--ink3)" data-tip="Нет разбивки по складам">—</td>`;
    if (u.rule.rule === "none") {
      return qy > 0
        ? `<td style="text-align:center;font-size:11px;${AMB}" data-tip="По правилу здесь должно быть 0">${qy}</td>`
        : `<td style="text-align:center;font-size:11px;color:var(--ink3)">·</td>`;
    }
    if (!whRequired(u.rule.rule, w)) return `<td style="text-align:center;font-size:11px;color:var(--ink3)" data-tip="По правилу «${esc(ruleText(u.rule.rule))}» этот склад не обязателен">${qy || "·"}</td>`;
    if (u.st === "nodem") return `<td style="text-align:center;font-size:11px;color:var(--ink3)">${qy || "·"}</td>`;
    const style = qy === 0 ? (sz != null ? AMB : RED) : isLowU(art, sz, w, qy) ? AMB : "color:#8B4513";
    const tip = qy > 0 ? daysTip(art, w, qy, sz) : "";
    return `<td style="text-align:center;font-size:11px;${style}"${tip ? ` data-tip="${esc(tip)}"` : ""}>${qy || "0"}</td>`;
  };

  /* Строка артикула с размерами: сумма по складу, цвет — худший размер на этом складе */
  const artCell = (r, w) => {
    if (r.rule.rule === "none" || !whRequired(r.rule.rule, w)) return unitCell(r, r.art, null, w);
    const qy = r.wh[w] || 0;
    const act = r.sizes.filter((x) => x.st !== "nodem");   /* размеры со спросом */
    const emptySz = act.filter((x) => !(x.wh[w] > 0)).map((x) => x.sz);
    const lowSz = act.filter((x) => isLowU(r.art, x.sz, w, x.wh[w] || 0)).map((x) => x.sz);
    const style = emptySz.length || lowSz.length ? AMB : "color:#8B4513";
    const tip = emptySz.length ? `${w}: нет размеров ${emptySz.join(", ")}` : lowSz.length ? `${w}: мало — ${lowSz.join(", ")}` : "";
    return `<td style="text-align:center;font-size:11px;${style}"${tip ? ` data-tip="${esc(tip)}"` : ""}>${qy}</td>`;
  };

  const rowHTML = (r, isSz, open) => {
    const over = !isSz && (!vm.isOz || r.base > 0) && r.fbs > r.base;   /* у Ozon — только если справочник нашёл СГП/сырьё */
    const hasSz = !isSz && !!r.sizes && r.sizes.length > 1;
    const tog = hasSz ? `<span class="tog">${open ? "▼" : "▶"}</span>` : '<span class="tog"> </span>';
    const name = isSz
      ? `<td style="padding-left:28px;font-weight:600">${esc(r.sz)}</td>`
      : `<td style="white-space:nowrap">${tog}<span class="art">${esc(r.art)}</span></td>`;
    const cells = whList.map((w) => (hasSz ? artCell(r, w) : unitCell(r, r.art, isSz ? r.sz : null, w))).join("");
    const baseRed = !isSz && !(r.base > 0) && r.rule && r.rule.rule !== "none" && r.st !== "ok";
    return `<tr class="${isSz ? "sz-row" : hasSz ? "ar-row" : ""}"${hasSz ? ` onclick="App.togArtF(${n},'${q(r.art)}')"` : ""}>
      ${name}
      <td style="text-align:center;font-size:10px;color:var(--ink2);white-space:nowrap">${isSz ? "" : r.rule ? `<span data-tip="${esc(r.rule.name)}">${esc(ruleText(r.rule.rule))}</span>` : "—"}</td>
      ${statusCell(r)}
      <td style="text-align:center;${isSz ? "font-size:11px;" : ""}${baseRed ? "color:#B3261E;font-weight:700" : ""}">${r.base || "—"}</td>
      <td class="${isSz ? "" : "tc"}" style="text-align:center;font-weight:700;${isSz ? "font-size:11px;" : ""}${over ? "color:#B3261E" : ""}">${r.fbs || "0"}${over ? ` <span style="cursor:help" data-tip="FBS (${r.fbs}) больше, чем Сырьё+СГП (${r.base}) — возможно завышен">❗</span>` : ""}</td>
      ${cells}
    </tr>`;
  };

  const body = shown.map((r) => {
    const open = OAF[n].has(r.art);
    let h = rowHTML(r, false, open);
    if (open && r.sizes) for (const z of r.sizes) h += rowHTML({ ...z, art: r.art, rule: r.rule }, true, false);
    return h;
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
