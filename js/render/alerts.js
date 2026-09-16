import { VM } from "../state.js";
import { esc } from "../utils.js";
import { getBuyrate } from "../api/sheets.js";

/* Тревоги на утро: у каких артикулов остаток (FBS или ВБ) кончается — меньше LIMIT дней
   при текущем темпе продаж (заказы/день × выкупаемость). Главное — не обнулился ли FBS. */
const LIMIT = 5;

export function alertsHTML(n) {
  const vm = VM[n];
  if (!vm) return "";
  const { arts, orderMap } = vm;
  const fbsMap = vm.fbs || {};
  const stkLabel = vm.isOz ? "OZ" : "ВБ";

  /* Свод по артикулу: остаток ВБ, заказы 7д, остаток FBS */
  const byArt = {};
  const add = (art) => (byArt[(art || "").toLowerCase()] ||= { art, name: "", stk: 0, o7: 0, fbs: 0 });
  for (const [key, v] of Object.entries(arts)) {
    const g = add(v.art); g.art = v.art; g.name = v.name; g.stk += v.total; g.o7 += orderMap[key] || 0;
  }
  for (const [k, val] of Object.entries(fbsMap)) {
    const g = add(k.split(" · ")[0]); g.fbs += val;
  }

  /* Алерты: остаток < LIMIT дней при текущем темпе */
  const alerts = [];
  for (const g of Object.values(byArt)) {
    const br = getBuyrate(g.art).val;
    const eff = (g.o7 / 7) * br;
    if (eff <= 0) continue;                         /* нет продаж — не сигналим */
    if (g.fbs > 0) { const d = Math.round(g.fbs / eff); if (d < LIMIT) alerts.push({ art: g.art, ch: "FBS", d }); }
    if (g.stk > 0) { const d = Math.round(g.stk / eff); if (d < LIMIT) alerts.push({ art: g.art, ch: stkLabel, d }); }
  }
  alerts.sort((a, b) => a.d - b.d || a.ch.localeCompare(b.ch));

  const has = alerts.length > 0;
  const shown = alerts.slice(0, 8);
  const rest = alerts.length - shown.length;

  const chip = (ch) => {
    const fbs = ch === "FBS";
    const bg = fbs ? "#FBEBCF" : "#F7DDD9", fg = fbs ? "#8A5A00" : "#B3261E";
    return `<span style="flex:0 0 auto;padding:0 6px;border-radius:8px;font-size:9px;font-weight:700;background:${bg};color:${fg}">${ch}</span>`;
  };
  const rows = shown.map((a) =>
    `<div style="display:flex;align-items:center;gap:7px;font-size:11px;margin:2px 0">
      ${chip(a.ch)}
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(a.art)}">${esc(a.art)}</span>
      <span style="font-weight:700;font-variant-numeric:tabular-nums;color:${a.d < 2 ? "#B3261E" : "#8A5A00"}">${a.d}д</span>
    </div>`
  ).join("");

  const restRow = rest > 0
    ? `<div style="font-size:10px;color:var(--ink3);margin-top:4px;padding-top:4px;border-top:1px solid var(--border)">…и ещё ${rest}</div>`
    : "";

  const body = has
    ? `<div style="max-height:190px;overflow:auto;padding-right:2px">${rows}${restRow}</div>`
    : `<div class="em" style="padding:14px 0;font-size:12px;color:var(--green)">✓ Остатков хватает (более ${LIMIT} дней)</div>`;

  return `<div class="sec" style="margin-bottom:0;border-top:3px solid ${has ? "var(--red)" : "var(--green)"}">
    <div class="sh" style="margin-bottom:8px">
      <span class="st">${has ? "🔔 Остатки заканчиваются" : "🔔 Остатки"}
        <span style="color:var(--ink3);font-weight:400;font-size:11px">· менее ${LIMIT} дней${has ? " · " + alerts.length : ""}</span></span>
    </div>
    ${body}
  </div>`;
}
