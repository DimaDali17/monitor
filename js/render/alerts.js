import { VM } from "../state.js";
import { esc } from "../utils.js";
import { getBuyrate, getStocksForArt } from "../api/sheets.js";

/* Тревоги на утро:
   1) FBS завышен — остаток FBS на WB больше, чем СГП+Сырьё (реальное наличие). ВВЕРХУ.
   2) Остаток (FBS или FBW) кончается — меньше LIMIT дней при текущем темпе. */
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

  const over = [], low = [];
  for (const g of Object.values(byArt)) {
    if (g.fbs > 0) {
      const { sgp, raw } = getStocksForArt(g.art);
      if (g.fbs > sgp + raw) over.push({ art: g.art, fbs: g.fbs, base: sgp + raw });
    }
    const eff = (g.o7 / 7) * getBuyrate(g.art).val;
    if (eff <= 0) continue;
    if (g.fbs > 0) { const d = Math.round(g.fbs / eff); if (d < LIMIT) low.push({ art: g.art, ch: "FBS", d }); }
    if (g.stk > 0) { const d = Math.round(g.stk / eff); if (d < LIMIT) low.push({ art: g.art, ch: stkLabel, d }); }
  }
  over.sort((a, b) => (b.fbs - b.base) - (a.fbs - a.base));
  low.sort((a, b) => a.d - b.d || a.ch.localeCompare(b.ch));

  const has = over.length || low.length;

  const overRows = over.slice(0, 4).map((o) =>
    `<div style="display:flex;align-items:center;gap:6px;font-size:11px;line-height:18px">
      <span style="flex:0 0 auto;padding:0 5px;border-radius:7px;font-size:9px;font-weight:700;background:#F3D9E8;color:#7B2233" data-tip="FBS на WB больше, чем СГП+Сырьё — возможно завышен">FBS↑</span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(o.art)}">${esc(o.art)}</span>
      <span style="font-weight:700;color:#7B2233;font-variant-numeric:tabular-nums" data-tip="FBS ${o.fbs} больше склада ${o.base}">${o.fbs}&nbsp;&gt;&nbsp;${o.base}</span>
    </div>`
  ).join("");

  const lowCap = Math.max(0, 6 - Math.min(over.length, 4));
  const chip = (ch) => {
    const fbs = ch === "FBS";
    return `<span style="flex:0 0 auto;padding:0 5px;border-radius:7px;font-size:9px;font-weight:700;background:${fbs ? "#FBEBCF" : "#F7DDD9"};color:${fbs ? "#8A5A00" : "#B3261E"}">${ch}</span>`;
  };
  const lowRows = low.slice(0, lowCap).map((a) =>
    `<div style="display:flex;align-items:center;gap:6px;font-size:11px;line-height:18px">
      ${chip(a.ch)}
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(a.art)}">${esc(a.art)}</span>
      <span style="font-weight:700;font-variant-numeric:tabular-nums;color:${a.d < 2 ? "#B3261E" : "#8A5A00"}">${a.d}д</span>
    </div>`
  ).join("");

  const rest = (over.length - Math.min(over.length, 4)) + (low.length - Math.min(low.length, lowCap));
  const restRow = rest > 0 ? `<div style="font-size:10px;color:var(--ink3);margin-top:3px">…и ещё ${rest}</div>` : "";
  const sep = overRows && lowRows ? `<div style="height:6px"></div>` : "";

  const body = has
    ? `<div style="max-height:160px;overflow:auto">${overRows}${sep}${lowRows}${restRow}</div>`
    : `<div style="font-size:11px;color:var(--green);padding:6px 0">✓ Всё в норме</div>`;

  return `<div class="filter-bar" style="border-top:3px solid ${has ? "var(--red)" : "var(--green)"}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
      <span class="st">🔔 Тревоги по остаткам</span>
      <span style="font-size:11px;color:var(--ink3)">${has ? (over.length ? over.length + " завыш · " : "") + low.length + " мало" : "&lt; " + LIMIT + " дн"}</span>
    </div>
    ${body}
  </div>`;
}
