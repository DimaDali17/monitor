import { VM } from "../state.js";
import { esc } from "../utils.js";
import { getBuyrate } from "../api/sheets.js";

/* Тревоги на утро: у каких артикулов остаток (FBS или FBW) кончается — меньше LIMIT дней
   при текущем темпе продаж (заказы/день × выкупаемость). Главное — не обнулился ли FBS. */
const LIMIT = 5;

export function alertsHTML(n) {
  const vm = VM[n];
  if (!vm) return "";
  const { arts, orderMap } = vm;
  const fbsMap = vm.fbs || {};
  const stkLabel = vm.isOz ? "OZ" : "FBW";

  const byArt = {};
  const add = (art) => (byArt[(art || "").toLowerCase()] ||= { art, stk: 0, o7: 0, fbs: 0 });
  for (const [key, v] of Object.entries(arts)) {
    const g = add(v.art); g.art = v.art; g.stk += v.total; g.o7 += orderMap[key] || 0;
  }
  for (const [k, val] of Object.entries(fbsMap)) add(k.split(" · ")[0]).fbs += val;

  const alerts = [];
  for (const g of Object.values(byArt)) {
    const eff = (g.o7 / 7) * getBuyrate(g.art).val;
    if (eff <= 0) continue;
    if (g.fbs > 0) { const d = Math.round(g.fbs / eff); if (d < LIMIT) alerts.push({ art: g.art, ch: "FBS", d }); }
    if (g.stk > 0) { const d = Math.round(g.stk / eff); if (d < LIMIT) alerts.push({ art: g.art, ch: stkLabel, d }); }
  }
  alerts.sort((a, b) => a.d - b.d || a.ch.localeCompare(b.ch));

  const has = alerts.length > 0;
  const shown = alerts.slice(0, 6);
  const rest = alerts.length - shown.length;

  const chip = (ch) => {
    const fbs = ch === "FBS";
    return `<span style="flex:0 0 auto;padding:0 5px;border-radius:7px;font-size:9px;font-weight:700;background:${fbs ? "#FBEBCF" : "#F7DDD9"};color:${fbs ? "#8A5A00" : "#B3261E"}">${ch}</span>`;
  };
  const rows = shown.map((a) =>
    `<div style="display:flex;align-items:center;gap:6px;font-size:11px;line-height:18px">
      ${chip(a.ch)}
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(a.art)}">${esc(a.art)}</span>
      <span style="font-weight:700;font-variant-numeric:tabular-nums;color:${a.d < 2 ? "#B3261E" : "#8A5A00"}">${a.d}д</span>
    </div>`
  ).join("");

  const restRow = rest > 0
    ? `<div style="font-size:10px;color:var(--ink3);margin-top:3px">…и ещё ${rest}</div>`
    : "";

  const body = has
    ? `<div style="max-height:150px;overflow:auto">${rows}${restRow}</div>`
    : `<div style="font-size:11px;color:var(--green);padding:6px 0">✓ Остатков хватает (более ${LIMIT} дней)</div>`;

  return `<div class="filter-bar" style="border-top:3px solid ${has ? "var(--red)" : "var(--green)"}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
      <span class="st">🔔 Остатки заканчиваются</span>
      <span style="font-size:11px;color:var(--ink3)">&lt; ${LIMIT} дн${has ? " · " + alerts.length : ""}</span>
    </div>
    ${body}
  </div>`;
}
