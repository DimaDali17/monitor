import { VM, DS, OAD, EXD, FA } from "../state.js";
import { LIM } from "../config.js";
import { esc, q, szCmp, fmtDays, pct } from "../utils.js";
import { sheets, getBuyrate, getStocksForArt, getStocksForSz, rawSharedWith, rawPrimaryFor, dedupRawTotal, artDisp, artSeason } from "../api/sheets.js";

/* Бейдж на ГЛАВНОМ артикуле пула: сырьё показано здесь целиком. */
function rawPoolBadge(art, sibs) {
  const members = [art, ...sibs.map(artDisp)].join(", ");
  const tip = "Весь остаток общего пула сырья показан здесь. Пул делят артикулы: " + esc(members) + ".";
  return `<span style="font-size:9px;color:var(--raw);border:1px solid var(--raw);border-radius:3px;padding:0 3px;margin-left:4px;vertical-align:middle;cursor:help" data-tip="${tip}">пул</span>`;
}
/* «—» у СПУТНИКА: сырьё пула у главного артикула. */
function rawPoolDash(primaryLower) {
  const tip = "Сырьё общего пула показано у артикула " + esc(artDisp(primaryLower)) + " (первый по номеру).";
  return `<span style="cursor:help;border-bottom:1px dotted var(--ink3)" data-tip="${tip}">—</span>`;
}

/* ── Сводные карточки над таблицей ── */
export function deficitSummary(n) {
  const vm = VM[n];
  if (!vm) return null;

  let wb = 0, sgp = 0, o7 = 0;
  const seen = new Set();
  const artList = [];

  for (const [key, v] of Object.entries(vm.arts)) {
    wb += v.total;
    o7 += vm.orderMap[key] || 0;
    if (!seen.has(v.art)) {
      seen.add(v.art);
      artList.push(v.art);
      sgp += getStocksForArt(v.art).sgp;
    }
  }
  /* Сырьё — каждый физический пул один раз (общий пул не задваиваем) */
  const raw = dedupRawTotal(artList);

  const total = wb + sgp + raw;
  const drDay = o7 / 7;
  const need30 = Math.round(drDay * 30);

  return { wb, sgp, raw, total, drDay: Math.round(drDay), need30, balance: total - need30 };
}

export function deficitHTML(n) {
  const s = deficitSummary(n);
  const cards = s ? `<div class="mg" style="grid-template-columns:repeat(4,1fr);margin-bottom:10px">
    <div class="mc" style="border-top:3px solid var(--ink)">
      <div class="ml">Общий сток</div><div class="mv">${s.total.toLocaleString("ru")}</div>
      <div class="md" style="font-size:10px;color:var(--ink3)">FBW ${s.wb} · СГП ${s.sgp} · Сырьё ${s.raw}</div>
    </div>
    <div class="mc" style="border-top:3px solid var(--green)">
      <div class="ml">Заказов в день (7д)</div><div class="mv g">${s.drDay}</div>
    </div>
    <div class="mc" style="border-top:3px solid var(--amber)">
      <div class="ml">Потребность 30 дней</div><div class="mv a">${s.need30.toLocaleString("ru")}</div>
    </div>
    <div class="mc" style="border-top:3px solid var(--red)">
      <div class="ml">Баланс</div>
      <div class="mv" style="color:${s.balance < 0 ? "var(--red)" : "var(--green)"}">${
        s.balance < 0 ? "−" + Math.abs(s.balance).toLocaleString("ru") : "✓ +" + s.balance.toLocaleString("ru")}</div>
    </div>
  </div>` : "";

  return `<div class="sec">${cards}
    <div class="sh">
      <span class="st">📦 Дефицит · запас · стоки</span>
      <span class="sm2" style="display:flex;gap:4px;flex-wrap:wrap">
        ${statusLegend("urgent", "Меньше 14 дней запаса на ВБ — срочно отгружать")}
        ${statusLegend("soon", "14–21 день — скоро дефицит")}
        ${statusLegend("ok", "21–45 дней — норма")}
        ${statusLegend("enough", "45–90 дней — достаточно")}
        ${statusLegend("over", "Больше 90 дней — залежался")}
        <button class="b" style="padding:3px 9px;font-size:10px" onclick="App.togAllSizesD(${n})" data-tip="Раскрыть все артикулы до размеров или свернуть обратно">${allSizesOpen(n) ? "▲ Свернуть размеры" : "▼ Все размеры"}</button>
        <button class="b" style="padding:3px 9px;font-size:10px" onclick="App.exportXlsx(this,'Дефицит','deficit')" data-tip="Скачать в Excel — как на экране">⤓ Excel</button>
      </span>
    </div>
    <div style="font-size:10px;color:var(--ink3);margin-bottom:8px;display:flex;gap:14px;flex-wrap:wrap">
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#A06820;margin-right:3px;vertical-align:middle"></span>FBW — остаток на складах WB (маркетплейс)</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#5B3FA0;margin-right:3px;vertical-align:middle"></span>СГП — готовая продукция</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#8B4513;margin-right:3px;vertical-align:middle"></span>Сырьё — полуфабрикаты</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#6A1B9A;border:1px dashed #CE93D8;margin-right:3px;vertical-align:middle"></span>FBS — остаток на складе продавца, справочно (в общий сток не входит)</span>
      <span><b>пул</b> — общее сырьё на несколько артикулов, показано у первого (остальным «—»)</span>
      <span><b>×</b> — с учётом выкупаемости</span>
    </div>
    <div class="sw" id="dtbl${n}">${defTbl(n)}</div>
  </div>`;
}

/* Все ли артикулы дефицита раскрыты */
export function allSizesOpen(n) {
  const vm = VM[n];
  if (!vm) return false;
  const arts = new Set(Object.values(vm.arts).map((v) => v.art));
  if (!arts.size) return false;
  for (const a of arts) if (!OAD[n].has(a)) return false;
  return true;
}

/* Артикулы с более чем одним размером */
export function multiSizeArts(n) {
  const vm = VM[n];
  if (!vm) return [];
  const bySz = {};
  for (const v of Object.values(vm.arts)) (bySz[v.art] ||= new Set()).add(v.sz);
  return Object.keys(bySz).filter((a) => bySz[a].size > 1);
}

/* Статус по числу дней запаса */
/* Короткие алерты по запасу дней на ВБ (dWb — с учётом выкупаемости).
   <14 срочно · <21 скоро дефицит · <45 норма · 45–90 достаточно · >90 залежался. */
const STATUS = {
  none:   { label: "нет продаж",    bg: "var(--bg3)", fg: "var(--ink3)", icon: "" },
  urgent: { label: "срочно на ВБ!", bg: "#F7DDD9",    fg: "#B3261E",     icon: "🔥" },
  soon:   { label: "скоро дефицит", bg: "#FBEBCF",    fg: "#8A5A00",     icon: "❗" },
  ok:     { label: "норма",         bg: "#E1EFE4",    fg: "#2F7D55",     icon: "✅" },
  enough: { label: "достаточно",    bg: "#E7EDF3",    fg: "#48657E",     icon: "👍" },
  over:   { label: "залежался",     bg: "#ECE9E4",    fg: "#6B6357",     icon: "💀" },
};
const RANK = { urgent: 0, soon: 1, ok: 2, enough: 3, over: 4, none: 5 };
/* Статус по ВБ× + доп. флаг «/ ❗», если с учётом сезона (ВБ сезон) запас требует внимания раньше */
function statusCell(dWb, dSeason) {
  const main = statusChip(dWb);
  if (typeof dSeason !== "number" || !isFinite(dSeason)) return main;
  const sk = statusKey(dSeason);
  if (RANK[sk] >= RANK[statusKey(dWb)]) return main;   /* сезон не срочнее — не дублируем */
  const s = STATUS[sk];
  return `${main}<span style="color:var(--ink3);margin:0 3px">/</span>` +
    `<span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:600;background:${s.bg};color:${s.fg};cursor:help" data-tip="С учётом сезона запас ~${dSeason} дн — «${s.label}»">${s.icon || "❗"}</span>`;
}
const DAY = 864e5;
function mondayMs(ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
function isoWeekNum(ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);       /* четверг этой недели */
  const ft = new Date(d.getFullYear(), 0, 4);
  ft.setDate(ft.getDate() - ((ft.getDay() + 6) % 7) + 3);
  return 1 + Math.round((d - ft) / (7 * DAY));
}
/* «ВБ сезон»: за сколько дней кончится сток ВБ с учётом сезонной кривой.
   Динамика по ТЗ: сглаженный спрос-на-коэффициент по 3 закрытым неделям
   (веса 50/30/20), затем списание будущих недель, масштабированных кривой.
   Только факт текущего сезона, без прогнозов. */
function seasonalDays(season, stk, buyrate, weeks, nowMon, curWeekly) {
  if (!season || stk <= 0) return null;
  const curve = sheets.seasonWk[season];
  if (!curve || !Object.keys(curve).length) return null;
  const Wt = [0.5, 0.3, 0.2];
  let dpu = 0, wsum = 0;
  for (let i = 0; i < 3; i++) {
    const H = curve[isoWeekNum(nowMon - (i + 1) * 7 * DAY)] || 0;
    if (H > 0) { dpu += Wt[i] * ((weeks[i] || 0) / H); wsum += Wt[i]; }
  }
  let sdpu;
  if (wsum > 0) {
    sdpu = dpu / wsum;                            /* сглаженный спрос-на-коэффициент */
  } else {
    /* Начало сезона: закрытые недели ещё вне сезона — опираемся на текущую неделю */
    const Hnow = curve[isoWeekNum(nowMon)] || 0;
    if (Hnow > 0 && curWeekly > 0) sdpu = curWeekly / Hnow;
    else return "off";                           /* реально вне сезона / нет спроса */
  }
  if (sdpu <= 0) return null;
  let rem = stk, days = 0;
  for (let k = 0; k < 156; k++) {
    const H = curve[isoWeekNum(nowMon + k * 7 * DAY)] || 0;
    const sales = sdpu * H * buyrate;            /* заказы → продажи через выкупаемость */
    if (sales <= 0) { days += 7; continue; }
    if (sales >= rem) { days += Math.round((rem / sales) * 7); rem = 0; break; }
    rem -= sales; days += 7;
  }
  return rem > 0 ? Infinity : days;
}
function fbsOverMark(fbs, base) {
  return `<span style="color:#B3261E;font-weight:700;cursor:help" data-tip="FBS-остаток (${fbs}) больше, чем СГП+Сырьё (${base}) — возможно, остаток FBS на WB завышен">❗</span>`;
}
function fmtSeason(d) {
  if (d == null) return "—";
  if (d === "off") return `<span style="color:var(--ink3);cursor:help" data-tip="Сейчас вне сезона — оценить нельзя">—</span>`;
  if (d === Infinity) return "∞";
  return fmtDays(d);
}

function statusKey(days) {
  if (days == null) return "none";
  if (days < 14) return "urgent";
  if (days < 21) return "soon";
  if (days < 45) return "ok";
  if (days <= 90) return "enough";
  return "over";
}
function statusChip(days, small) {
  const s = STATUS[statusKey(days)];
  const fs = small ? 10 : 11;
  return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:${fs}px;font-weight:600;white-space:nowrap;background:${s.bg};color:${s.fg}">${s.icon ? s.icon + " " : ""}${s.label}</span>`;
}
function statusLegend(key, tip) {
  const s = STATUS[key];
  return `<span data-tip="${tip}" style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${s.bg};color:${s.fg}">${s.icon ? s.icon + " " : ""}${s.label}</span>`;
}

export function defTbl(n) {
  const vm = VM[n];
  if (!vm) return '<div class="em">Нет данных</div>';

  const { arts, orderMap, mskWhs } = vm;
  const totalO7 = Object.values(orderMap).reduce((a, b) => a + b, 0);

  /* FBS-остатки (склад продавца) — справочно. Ключ как в arts: "арт · размер". */
  const fbsMap = vm.fbs || {};
  const fbsByArt = {};
  for (const [k, v] of Object.entries(fbsMap)) {
    const a = (k.split(" · ")[0] || "").toLowerCase();
    fbsByArt[a] = (fbsByArt[a] || 0) + v;
  }
  /* FBS в разрезе складов — для тултипа «распределение по складам» */
  const fbsCells = vm.fbsCells || {};
  const fbsWhByArt = {};
  for (const [k, whmap] of Object.entries(fbsCells)) {
    const a = (k.split(" · ")[0] || "").toLowerCase();
    const dst = (fbsWhByArt[a] ||= {});
    for (const [w, qy] of Object.entries(whmap)) dst[w] = (dst[w] || 0) + qy;
  }
  const fbsWhTip = (whmap) => {
    if (!whmap) return "FBS — справочно";
    const parts = Object.entries(whmap).sort((a, b) => b[1] - a[1]).map(([w, q]) => esc(w) + ": " + q);
    return parts.length ? "FBS по складам — " + parts.join(", ") : "FBS — справочно";
  };

  /* Группировка по артикулу */
  const byArt = {};
  for (const [key, v] of Object.entries(arts)) {
    const o7 = orderMap[key] || 0;
    const g = (byArt[v.art] ||= { name: v.name, stk: 0, o7: 0, msk: 0, sizes: [] });
    const msk = mskWhs.reduce((s, w) => s + (v.wh[w] || 0), 0);
    g.stk += v.total; g.o7 += o7; g.msk += msk;
    g.sizes.push({ ...v, o7, msk });
  }

  /* Ozon часто целиком на FBS: таких артикулов нет в стоках FBO (arts) → строк в
     дефиците нет. Досеиваем их из FBS-остатков и из заказов, иначе таблица пуста.
     Только для Ozon, чтобы не менять поведение дефицита WB. */
  if (vm.isOz) {
    const ensure = (art, name) => (byArt[art] ||= { name: name || art, stk: 0, o7: 0, msk: 0, sizes: [] });
    const seedSz = (art, sz, o7) => {
      if (!art || art === "—") return;
      const g = ensure(art);
      sz = sz || "—";
      if (g.sizes.some((s) => (s.sz || "—") === sz)) return;   /* размер уже есть — не дублируем */
      g.sizes.push({ art, sz, name: g.name, total: 0, wh: {}, o7, msk: 0 });
      g.o7 += o7;
    };
    for (const key of Object.keys(fbsMap)) { const [a, s] = key.split(" · "); seedSz(a, s, orderMap[key] || 0); }
    for (const [key, o7] of Object.entries(orderMap)) { const [a, s] = key.split(" · "); seedSz(a, s, o7); }
  }

  /* Размеры, которых нет в стоках WB, но есть в СГП/сырье */
  for (const [mapKey] of Object.entries(sheets.map)) {
    const [wbArt, wbSz] = mapKey.split(";");
    const artName = Object.keys(byArt).find((a) => a.toLowerCase() === wbArt);
    if (!artName) continue;
    const g = byArt[artName];
    if (g.sizes.some((s) => (s.sz || "").toLowerCase() === wbSz)) continue;
    const { sgp, raw } = getStocksForSz(artName, wbSz);
    if (sgp > 0 || raw > 0) {
      g.sizes.push({ art: artName, sz: wbSz, name: g.name, total: 0, wh: {}, o7: 0, msk: 0 });
    }
  }

  /* Недельный факт по артикулам (последние 3 закрытые недели) — для «ВБ сезон» */
  const nowMon = mondayMs(Date.now());
  const wk3 = {};
  for (const o of (vm.allOrders || [])) {
    const art = (o.supplierArticle || "").toLowerCase();
    if (!art || !o.date) continue;
    const t = Date.parse(o.date);
    if (isNaN(t)) continue;
    const ago = Math.round((nowMon - mondayMs(t)) / (7 * DAY));
    if (ago >= 1 && ago <= 3) (wk3[art] ||= [0, 0, 0])[ago - 1] += (o.quantity || 1);
  }

  /* Расчёт по артикулам */
  const rows = Object.entries(byArt).map(([art, g]) => {
    const br = getBuyrate(art);
    const { sgp, raw } = getStocksForArt(art);
    const total = g.stk + sgp + raw;
    const dr = g.o7 / 7;
    const need = Math.round(dr * 30);
    const effDr = dr * br.val;
    const fbsArt = fbsByArt[art.toLowerCase()] || 0;
    const dWb = effDr > 0 ? Math.round(g.stk / effDr) : null;
    const dFbs = effDr > 0 ? Math.round(fbsArt / effDr) : null;
    const dStock = effDr > 0 ? Math.round((g.stk + fbsArt) / effDr) : null;   /* ВБ + FBS вместе */
    const fbsOver = !vm.isOz && fbsArt > sgp + raw;   /* FBS завышен относительно СГП+Сырьё (только WB — у Ozon нет справочника) */
    const dSeason = seasonalDays(artSeason(art), g.stk + fbsArt, br.val, wk3[art.toLowerCase()] || [0, 0, 0], nowMon, g.o7);
    return {
      art, name: g.name, sizes: g.sizes, br, sgp, raw, total, need, dr,
      msk: g.msk, stk: g.stk, o7: g.o7,
      def: Math.max(0, need - total),
      dWb, dFbs, dStock, dSeason, fbsArt, fbsOver,
      dAll: effDr > 0 ? Math.round(total / effDr) : null,
      dNoRaw: effDr > 0 ? Math.round((g.stk + sgp) / effDr) : null,
      dMsk: effDr > 0 ? Math.round(g.msk / effDr) : null,
      sev: dWb == null ? 99999 : dWb,
    };
  });

  const { c, d: dir } = DS[n];
  rows.sort((a, b) => {
    if (c === "art") return dir * a.art.localeCompare(b.art);
    const get = (r) => ({ stk: r.stk, o7: r.o7, need: r.need, def: r.def, days: r.sev }[c] ?? 0);
    return dir * (get(a) - get(b));
  });

  const arrow = (k) => (DS[n].c === k ? (DS[n].d > 0 ? " ↑" : " ↓") : " ↕");
  const cls = (k) => (DS[n].c === k ? " sa" : "");
  const TH = (k, label, tip, klass) =>
    `<th class="${cls(k)} ${klass}" data-sort onclick="App.sortD(${n},'${k}')" style="text-align:center" data-tip="${tip}">${label}${arrow(k)}</th>`;
  const THF = (label, tip, klass) =>
    `<th class="${klass}" style="text-align:center" data-tip="${tip}">${label}</th>`;
  const qc = (v, lo) => (v === 0 ? "qx" : v < lo ? "ql" : "qo");

  const head = `<tr>
    <th rowspan="2" data-sort style="text-align:left;vertical-align:middle;background:var(--bg3)"
        onclick="App.sortD(${n},'art')" data-tip="Артикул WB. Клик — сортировка">Артикул${arrow("art")}</th>
    <th colspan="2" class="th-group thg-wb">📦 Склад FBW · FBS</th>
    <th class="th-group thg-sgp">🏭 СГП</th>
    <th class="th-group thg-raw">🧵 Сырьё</th>
    <th class="th-group thg-total" style="border-right:2px solid #C7BFB0">📊 Общий</th>
    <th colspan="3" class="th-group thg-need">📈 Потребность</th>
    <th colspan="2" class="th-group thg-need" style="border-right:2px solid #C7BFB0">⚡ Дефицит</th>
    <th colspan="5" class="th-group thg-days">⏱ Запас дней (×выкуп)</th>
  </tr>
  <tr>
    ${TH("stk", "FBW", "Остаток на складах Wildberries (FBW)", "th-wb")}
    ${THF("FBS", "Остатки на вашем FBS-складе (marketplace-api /api/v3/stocks). Справочно, в общий сток не входит", "th-wb")}
    ${THF("СГП", "Готовая продукция — лист Остатки сводная new, артикулы с префиксом «СГП »", "th-sgp")}
    ${THF("Сырьё", "Полуфабрикаты — лист Остатки сводная new. Общий пул сырья на несколько артикулов ВБ показан у первого (наименьший номер), остальным «—». Nobrand суммируется", "th-raw")}
    <th class="th-total" style="text-align:center;border-right:2px solid #C7BFB0" data-tip="ВБ + СГП + Сырьё">Общий</th>
    ${TH("o7", "Зак/день", "Среднее число заказов в день за 7 дней", "th-need")}
    ${THF("Мес. потр.", "Потребность на 30 дней при текущем темпе заказов", "th-need")}
    ${THF("Доля", "Доля размера в заказах артикула / доля артикула в общих заказах", "th-need")}
    ${TH("def", "Дефицит", "Потребность 30 дней минус общий сток. ✓ — запаса хватает", "th-need")}
    <th class="th-need" style="text-align:center;border-right:2px solid #C7BFB0" data-tip="Алерт по запасу дней (ВБ + FBS вместе). Через «/» — доп. флаг, если с учётом сезона запас требует внимания раньше">Статус</th>
    ${TH("days", "FBW×", "Хватит дней: остаток FBW ÷ дневной темп заказов, с учётом выкупаемости", "th-days")}
    ${THF("FBS×", "Хватит дней: остаток на вашем FBS-складе ÷ тот же дневной темп", "th-days")}
    ${THF("ВБ сезон", "Хватит дней с учётом сезонности: остаток ВБ + FBS списывается по будущим неделям сезонной кривой (динамика от факта, только продажи). «—» — сезон не задан или сейчас вне сезона", "th-days")}
    ${THF("Без сырья×", "Хватит дней: ВБ + СГП ÷ дневной темп", "th-days")}
    ${THF("Общий×", "Хватит дней: ВБ + СГП + Сырьё ÷ дневной темп", "th-days")}
  </tr>`;

  const shown = EXD[n] ? rows : rows.slice(0, LIM);
  let trs = "";

  for (const r of shown) {
    const open = OAD[n].has(r.art);
    const hasSizes = r.sizes.length > 1;
    const tog = hasSizes ? `<span class="tog">${open ? "▼" : "▶"}</span>` : '<span class="tog"> </span>';
    const rawSibs = rawSharedWith(r.art);
    const amPrimary = rawSibs.length > 0 && rawPrimaryFor(r.art) === r.art.toLowerCase();
    const amSibling = rawSibs.length > 0 && !amPrimary;
    const rawCell = r.raw
      ? `${r.raw}${amPrimary ? rawPoolBadge(r.art, rawSibs) : ""}`
      : (amSibling ? rawPoolDash(rawPrimaryFor(r.art)) : "—");
    const brBadge = r.br.est
      ? `<span class="buyrate buyrate-est" data-tip="Выкупаемость не найдена — берём 70% по умолчанию">~70%</span>`
      : `<span class="buyrate buyrate-ok" data-tip="Выкупаемость из таблицы">${Math.round(r.br.val * 100)}%</span>`;

    trs += `<tr class="ar-row"${hasSizes ? ` onclick="App.togArtD(${n},'${q(r.art)}')"` : ""}>
      <td style="white-space:nowrap">${tog}<span class="art">${esc(r.art)}</span>${brBadge}<span style="font-size:10px;color:var(--ink3);margin-left:5px">${esc(r.name.slice(0, 20))}</span></td>
      <td class="${qc(r.stk, 20)}" style="text-align:center;font-size:14px">${r.stk}</td>
      <td class="td-ref" style="text-align:center" data-tip="${fbsWhTip(fbsWhByArt[r.art.toLowerCase()])}">${r.fbsArt || "—"}${r.fbsOver ? fbsOverMark(r.fbsArt, r.sgp + r.raw) : ""}</td>
      <td class="${qc(r.sgp, 20)}" style="text-align:center">${r.sgp || "—"}</td>
      <td class="${qc(r.raw, 20)}" style="text-align:center">${rawCell}</td>
      <td class="${qc(r.total, 30)}" style="text-align:center;font-size:14px;font-weight:700;border-right:2px solid #C7BFB0">${r.total}</td>
      <td style="text-align:center;font-weight:600">${Math.round(r.dr)}</td>
      <td style="text-align:center;color:var(--ink2)">${r.need || "—"}</td>
      <td style="text-align:center;font-size:11px;color:var(--blue)">${pct(r.o7, totalO7)}</td>
      <td style="text-align:center;color:${r.def > 0 ? "var(--red)" : "var(--green)"};font-weight:700">${r.def > 0 ? "−" + r.def : "✓"}</td>
      <td style="border-right:2px solid #C7BFB0">${statusCell(r.dStock, r.dSeason)}</td>
      <td style="text-align:center">${fmtDays(r.dWb)}</td>
      <td class="td-ref" style="text-align:center">${fmtDays(r.dFbs)}</td>
      <td style="text-align:center;font-weight:600">${fmtSeason(r.dSeason)}</td>
      <td style="text-align:center">${fmtDays(r.dNoRaw)}</td>
      <td style="text-align:center">${fmtDays(r.dAll)}</td>
    </tr>`;

    if (!open) continue;

    for (const s of [...r.sizes].sort((x, y) => szCmp(x.sz, y.sz))) {
      const { sgp, raw } = getStocksForSz(r.art, s.sz);
      const total = s.total + sgp + raw;
      const dr = s.o7 / 7;
      const need = Math.round(dr * 30);
      const def = Math.max(0, need - total);
      const eff = dr * r.br.val;
      const dWb = eff > 0 ? Math.round(s.total / eff) : null;
      const fbsSz = fbsMap[r.art + " · " + s.sz] || 0;
      const dStockSz = eff > 0 ? Math.round((s.total + fbsSz) / eff) : null;
      const rawCellSz = raw
        ? `${raw}${amPrimary ? rawPoolBadge(r.art, rawSibs) : ""}`
        : (amSibling ? rawPoolDash(rawPrimaryFor(r.art)) : "—");

      trs += `<tr class="sz-row">
        <td style="padding-left:28px;font-weight:600">${esc(s.sz)}</td>
        <td class="${qc(s.total, 10)}" style="text-align:center;font-weight:600">${s.total}</td>
        <td class="td-ref" style="text-align:center;font-size:11px" data-tip="${fbsWhTip(fbsCells[r.art + " · " + s.sz])}">${(fbsMap[r.art + " · " + s.sz] || 0) ? (fbsMap[r.art + " · " + s.sz] + (!vm.isOz && (fbsMap[r.art + " · " + s.sz] || 0) > sgp + raw ? fbsOverMark(fbsMap[r.art + " · " + s.sz], sgp + raw) : "")) : "—"}</td>
        <td class="${qc(sgp, 10)}" style="text-align:center;font-size:11px;color:var(--sgp)">${sgp || "—"}</td>
        <td class="${qc(raw, 10)}" style="text-align:center;font-size:11px;color:var(--raw)">${rawCellSz}</td>
        <td class="${qc(total, 15)}" style="text-align:center;font-weight:600;border-right:2px solid #C7BFB0">${total}</td>
        <td style="text-align:center;font-size:11px">${Math.round(dr)}</td>
        <td style="text-align:center;font-size:11px">${need || "—"}</td>
        <td style="text-align:center;font-size:11px;color:var(--blue)">${pct(s.o7, r.o7)}</td>
        <td style="text-align:center;font-size:11px;color:${def > 0 ? "var(--red)" : "var(--green)"}">${def > 0 ? "−" + def : "✓"}</td>
        <td style="border-right:2px solid #C7BFB0">${statusChip(dStockSz, true)}</td>
        <td style="text-align:center;font-size:11px">${fmtDays(dWb)}</td>
        <td class="td-ref" style="text-align:center;font-size:11px">${fmtDays(eff > 0 ? Math.round((fbsMap[r.art + " · " + s.sz] || 0) / eff) : null)}</td>
        <td style="text-align:center;font-size:11px;color:var(--ink3)">—</td>
        <td style="text-align:center;font-size:11px">${fmtDays(eff > 0 ? Math.round((s.total + sgp) / eff) : null)}</td>
        <td style="text-align:center;font-size:11px">${fmtDays(eff > 0 ? Math.round(total / eff) : null)}</td>
      </tr>`;
    }
  }

  const more = rows.length > LIM
    ? `<tr class="er"><td class="stick" colspan="16"><button class="eb" onclick="App.togExD(${n})">${EXD[n] ? "▲ Свернуть" : "▼ Все " + rows.length + " артикулов"}</button></td></tr>`
    : "";

  return `<table><thead>${head}</thead><tbody>${trs || '<tr><td class="em" colspan="16">Нет данных</td></tr>'}${more}</tbody></table>`;
}
