import { D, VM } from "../state.js";
import { buildVM } from "../vm.js";
import { filterHTML } from "./filters.js";
import { structureHTML } from "./structure.js";
import { alertsHTML } from "./alerts.js";
import { metricsHTML } from "./metrics.js";
import { chartHTML } from "./chart.js";
import { ordersHTML } from "./orders.js";
import { stocksHTML, stocksTbl, fbsStocksHTML, fbsStocksTbl } from "./stocks.js";
import { deficitHTML, defTbl, rawModeTog } from "./deficit.js";
import { issuesHTML } from "./issues.js";
import { setRawScope } from "../api/sheets.js";

/* Артикулы кабинета (без фильтров) — чтобы общий пул сырья показывался
   у артикула, который есть именно в этом кабинете. Для Ozon не меняем. */
function scopeFor(n) {
  const d = D[n];
  if (!d || d.isOz) { setRawScope(null); return; }
  const s = new Set();
  for (const r of d.stocks || []) s.add(r.supplierArticle);
  for (const o of d.allOrders || []) s.add(o.supplierArticle);
  for (const k of Object.keys(d.fbs || {})) s.add(k.split(" · ")[0]);
  setRawScope(s);
}

/* Раньше renderWB и renderOZ были почти одинаковыми копиями.
   Разница между кабинетами сводится к типу — 'wb' или 'oz'. */
export function renderCabinet(n) {
  const el = document.getElementById("v" + n);
  if (!el || !D[n]) return;

  scopeFor(n);
  const vm = buildVM(n);
  const type = vm.isOz ? "oz" : "wb";

  el.innerHTML =
    issuesHTML(n) +
    `<div class="top3" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px">
       <div class="top3c" style="flex:0 1 245px;min-width:225px">${filterHTML(n)}</div>
       <div class="top3c" style="flex:1 1 280px;min-width:260px">${alertsHTML(n)}</div>
       <div class="top3c" style="flex:1.6 1 360px;min-width:300px">${structureHTML(n)}</div>
     </div>` +
    metricsHTML(n, vm, type) +
    chartHTML(n, vm, type) +
    ordersHTML(n, vm, type) +
    deficitHTML(n) +
    stocksHTML(n) +
    fbsStocksHTML(n);
}

/* Точечная перерисовка — сортировка таблицы не должна пересобирать график */
export function repaintStocks(n) {
  scopeFor(n);
  const el = document.getElementById("stbl" + n);
  if (el && VM[n]) el.innerHTML = stocksTbl(n);
}

export function repaintDeficit(n) {
  scopeFor(n);
  const el = document.getElementById("dtbl" + n);
  if (el && VM[n]) el.innerHTML = defTbl(n);
  const tg = document.getElementById("drw" + n);   /* тумблер «С сырьём / Без сырья» */
  if (tg) tg.innerHTML = rawModeTog(n);
}

export function repaintFbsStocks(n) {
  scopeFor(n);
  const el = document.getElementById("fbstbl" + n);
  if (el && VM[n]) el.innerHTML = fbsStocksTbl(n);
}
