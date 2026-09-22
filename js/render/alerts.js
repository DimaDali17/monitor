import { VM, EXA } from "../state.js";
import { esc } from "../utils.js";
import { getBuyrate, getStocksForArt } from "../api/sheets.js";

/* Внимание по остаткам:
   1) FBS завышен — остаток FBS на WB больше, чем Сырьё+СГП (реальное наличие). ВВЕРХУ.
   2) Остаток кончается — на канале (FBW или FBS) < LIMIT дней или 0 при текущем темпе.
      Если ВТОРОЙ склад прикрывает (есть остаток и хватает ≥ LIMIT дней) — значок жёлтый,
      а рядом через запятую показываем запас второго склада. Если оба пусты/мало — красный. */
const LIMIT = 5;

export function alertsHTML(n) {
  const vm = VM[n];
  if (!vm) return "";
  const { arts, orderMap } = vm;
  const fbsMap = vm.fbs || {};
  const stkLabel = vm.isOz ? "OZ" : "FBW";

  const byArt = {};
  const add = (art) => (byArt[(art || "").toLowerCase()] ||= { art, stk: 0, o7: 0, fbs: 0 });
  for (const [, v] of Object.entries(arts)) {
    const g = add(v.art); g.art = v.art; g.stk += v.total;
  }
  for (const [k, val] of Object.entries(fbsMap)) add(k.split(" · ")[0]).fbs += val;
  /* Заказы — единственный источник спроса o7 (суммируем по всем размерам артикула).
     Заодно они ДОБАВЛЯЮТ в перебор артикулы, которые полностью вышли из остатков
     (их нет ни в стоках WB, ни в FBS), но спрос по ним ещё идёт — иначе
     «закончился» вообще не попадёт в блок «Внимание по остаткам». */
  for (const [k, val] of Object.entries(orderMap)) add(k.split(" · ")[0]).o7 += val;

  const over = [], low = [];
  for (const g of Object.values(byArt)) {
    if (!vm.isOz && g.fbs > 0) {
      const { sgp, raw } = getStocksForArt(g.art);
      if (g.fbs > sgp + raw) over.push({ art: g.art, fbs: g.fbs, base: sgp + raw });
    }
    const eff = (g.o7 / 7) * getBuyrate(g.art).val;
    if (eff <= 0) continue;

    const fbw = g.stk, fbs = g.fbs;
    const dFbw = fbw > 0 ? Math.round(fbw / eff) : 0;
    const dFbs = fbs > 0 ? Math.round(fbs / eff) : 0;

    /* Полностью закончился на обоих каналах, а спрос есть — самый срочный сигнал. */
    if (fbw <= 0 && fbs <= 0) {
      low.push({ art: g.art, lead: "OUT", leadOut: true, leadDays: 0, other: null, sev: "red" });
      continue;
    }

    /* Проблемный канал:
       FBW — основной канал WB, тревожим при 0 или < LIMIT дней;
       FBS — свой склад (опциональный): тревожим только если он в ходу (>0) и < LIMIT дней,
       иначе засыплем алертами товары, которые по FBS вообще не продаются. */
    const probFbw = fbw <= 0 || dFbw < LIMIT;
    const probFbs = fbs > 0 && dFbs < LIMIT;
    if (!probFbw && !probFbs) continue;

    /* Ведущий канал = проблемный с меньшим запасом дней (при обоих проблемных — FBW). */
    const leadFbw = probFbw && (!probFbs || dFbw <= dFbs);
    const lead = leadFbw ? stkLabel : "FBS";
    const leadOut = leadFbw ? fbw <= 0 : fbs <= 0;
    const leadDays = leadFbw ? dFbw : dFbs;

    const otherStk = leadFbw ? fbs : fbw;
    const otherDays = leadFbw ? dFbs : dFbw;
    const otherCh = leadFbw ? "FBS" : stkLabel;
    /* Второй склад «прикрывает», если на нём есть остаток и хватает ≥ LIMIT дней →
       не критично, значок жёлтый; иначе (второй тоже пуст/мало) — красный. */
    const covered = otherStk > 0 && otherDays >= LIMIT;

    low.push({
      art: g.art, lead, leadOut, leadDays,
      other: otherStk > 0 ? { ch: otherCh, days: otherDays } : null,
      sev: covered ? "yellow" : "red",
    });
  }
  over.sort((a, b) => (b.fbs - b.base) - (a.fbs - a.base));
  /* Красные (без прикрытия) выше жёлтых; внутри — по возрастанию запаса дней. */
  low.sort((a, b) =>
    (a.sev === "red" ? 0 : 1) - (b.sev === "red" ? 0 : 1)
    || a.leadDays - b.leadDays
    || a.lead.localeCompare(b.lead));

  const has = over.length || low.length;
  const ex = EXA[n];
  const overShown = ex ? over : over.slice(0, 4);
  const lowCap = ex ? low.length : Math.max(0, 6 - Math.min(over.length, 4));
  const lowShown = ex ? low : low.slice(0, lowCap);
  const rest = (over.length - overShown.length) + (low.length - lowShown.length);

  const overRows = overShown.map((o) =>
    `<div style="display:flex;align-items:center;gap:6px;font-size:11px;line-height:18px">
      <span style="flex:0 0 auto;padding:0 5px;border-radius:7px;font-size:9px;font-weight:700;background:#F3D9E8;color:#7B2233" data-tip="FBS на WB больше, чем Сырьё+СГП — возможно завышен">FBS↑</span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(o.art)}">${esc(o.art)}</span>
      <span style="font-weight:700;color:#7B2233;font-variant-numeric:tabular-nums" data-tip="FBS ${o.fbs} больше склада ${o.base}">${o.fbs}&nbsp;&gt;&nbsp;${o.base}</span>
    </div>`).join("");

  const chip = (a) => {
    const red = a.sev === "red";
    const label = a.lead === "OUT" ? "нет" : a.lead;
    const tip = a.lead === "OUT" ? ' data-tip="Закончился на всех каналах, а спрос есть"' : "";
    return `<span${tip} style="flex:0 0 auto;padding:0 5px;border-radius:7px;font-size:9px;font-weight:700;background:${red ? "#F7DDD9" : "#FBEBCF"};color:${red ? "#B3261E" : "#8A5A00"}">${label}</span>`;
  };
  const lowRows = lowShown.map((a) => {
    const daysFg = a.sev === "red" ? "#B3261E" : "#8A5A00";
    const leadTxt = a.leadOut ? "закончился" : `${a.leadDays}д`;
    const otherTxt = a.other
      ? `<span style="color:var(--ink3);font-weight:600">, ${a.other.ch}&nbsp;${a.other.days}д</span>`
      : "";
    return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;line-height:18px">
      ${chip(a)}
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(a.art)}">${esc(a.art)}</span>
      <span style="font-weight:700;font-variant-numeric:tabular-nums;color:${daysFg};white-space:nowrap">${leadTxt}${otherTxt}</span>
    </div>`;
  }).join("");

  const sep = overRows && lowRows ? `<div style="height:6px"></div>` : "";
  const moreRow = rest > 0
    ? `<div onclick="App.togAlerts(${n})" style="cursor:pointer;font-size:10px;color:var(--ink2);margin-top:5px;text-decoration:underline;text-decoration-style:dotted">▾ показать ещё ${rest}</div>`
    : (ex && (over.length + low.length) > 6
        ? `<div onclick="App.togAlerts(${n})" style="cursor:pointer;font-size:10px;color:var(--ink3);margin-top:5px">▴ свернуть</div>` : "");

  const body = has
    ? `<div style="max-height:${ex ? 420 : 160}px;overflow:auto">${overRows}${sep}${lowRows}${moreRow}</div>`
    : `<div style="font-size:11px;color:var(--green);padding:6px 0">✓ Всё в норме</div>`;

  return `<div class="filter-bar" style="border-top:3px solid ${has ? "var(--red)" : "var(--green)"}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
      <span class="st">🔔 Внимание по остаткам</span>
      <span style="font-size:11px;color:var(--ink3)">${has ? (over.length ? over.length + " завыш · " : "") + low.length + " мало" : "&lt; " + LIMIT + " дн"}</span>
    </div>
    ${body}
  </div>`;
}
