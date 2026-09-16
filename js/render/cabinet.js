import { D, VM } from "../state.js";
import { buildVM } from "../vm.js";
import { filterHTML } from "./filters.js";
import { structureHTML } from "./structure.js";
import { alertsHTML } from "./alerts.js";
import { metricsHTML } from "./metrics.js";
import { chartHTML } from "./chart.js";
import { ordersHTML } from "./orders.js";
import { stocksHTML, stocksTbl } from "./stocks.js";
import { deficitHTML, defTbl } from "./deficit.js";

/* Раньше renderWB и renderOZ были почти одинаковыми копиями.
   Разница между кабинетами сводится к типу — 'wb' или 'oz'. */
export function renderCabinet(n) {
  const el = document.getElementById("v" + n);
  if (!el || !D[n]) return;

  const vm = buildVM(n);
  const type = vm.isOz ? "oz" : "wb";

  el.innerHTML =
    `<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
       <div style="flex:1 1 320px;min-width:270px">${filterHTML(n)}</div>
       <div style="flex:1 1 300px;min-width:260px">${alertsHTML(n)}</div>
       <div style="flex:1 1 320px;min-width:280px">${structureHTML(n)}</div>
     </div>` +
    metricsHTML(n, vm, type) +
    chartHTML(n, vm, type) +
    ordersHTML(n, vm, type) +
    deficitHTML(n) +
    stocksHTML(n);
}

/* Точечная перерисовка — сортировка таблицы не должна пересобирать график */
export function repaintStocks(n) {
  const el = document.getElementById("stbl" + n);
  if (el && VM[n]) el.innerHTML = stocksTbl(n);
}

export function repaintDeficit(n) {
  const el = document.getElementById("dtbl" + n);
  if (el && VM[n]) el.innerHTML = defTbl(n);
}
