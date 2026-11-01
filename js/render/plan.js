import { D, FA, FP, FG } from "../state.js";
import { artGroup } from "../api/sheets.js";
import { esc, wbPrice } from "../utils.js";
import { PLAN } from "../api/plan.js";

/* ══════════════════════════════════════════════════════════
   Блок «План / факт» вверху кабинета Easyform. План общий на оба кабинета WB.
   Считаем по группам плана («Кратко»): артикулы плана + доп. артикулы (planMap.js).
   Факт = отчёт WB по дням (оба кабинета) + живые заказы монитора за дни,
   которых в отчёте ещё нет.
   Штуки — «Заказано, шт.». Рубли — «Сумма заказов минус комиссия WB»; план в рублях =
   план в штуках × средняя цена штуки группы за сезон (по тому же отчёту); живые
   заказы — по той же средней цене, чтобы не смешивать цены до и после комиссии.
   Прогноз месяца = факт / прошедшие дни × дней в месяце (сегодня — частью дня).
   ══════════════════════════════════════════════════════════ */

const MONTH = ["", "январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MSHORT = ["", "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const pc = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
/* цвет по проценту к плану (с учётом темпа) */
const tone = (p) => (p == null ? "var(--ink3)" : p >= 95 ? "var(--green)" : p >= 80 ? "#B7791F" : "var(--red)");

/* Единицы: шт или ₽ — переключатель в шапке блока */
let UNIT = "q";
try { UNIT = localStorage.getItem("planUnit") === "r" ? "r" : "q"; } catch { /* нет хранилища — по умолчанию шт */ }
export function setPlanUnit(u) {
  UNIT = u === "r" ? "r" : "q";
  try { localStorage.setItem("planUnit", UNIT); } catch { /* не страшно */ }
}

/* База сравнения: план или прошлый год; период для прошлого года: неделя / месяц / сезон */
let BASE = "plan", PER = "m";
try {
  BASE = localStorage.getItem("planBase") === "ly" ? "ly" : "plan";
  PER = ["w", "m", "s"].includes(localStorage.getItem("planPer")) ? localStorage.getItem("planPer") : "m";
} catch { /* по умолчанию */ }
export function setPlanBase(b) { BASE = b === "ly" ? "ly" : "plan"; try { localStorage.setItem("planBase", BASE); } catch { /* */ } }
export function setPlanPer(p) { PER = ["w", "m", "s"].includes(p) ? p : "m"; try { localStorage.setItem("planPer", PER); } catch { /* */ } }

/* Маленький переключатель-«пилюля» */
const pill = (opts, cur, fn) => `<span style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;font-size:10px">
    ${opts.map(([k, t]) => `<span onclick="App.${fn}('${k}')" style="padding:1px 7px;cursor:pointer;white-space:nowrap;${cur === k ? "background:var(--ink);color:var(--bg3)" : "color:var(--ink2)"}">${t}</span>`).join("")}
  </span>`;

const nfQ = (x) => Math.round(x).toLocaleString("ru-RU");
const nfR = (x) => {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: a >= 1e7 ? 1 : 2 }) + " млн";
  if (a >= 1e3) return Math.round(x / 1e3).toLocaleString("ru-RU") + " тыс";
  return Math.round(x).toLocaleString("ru-RU");
};

/* Коротко для строк групп: 1,06 м · 747 т */
const nfRs = (x) => {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " м";
  if (a >= 1e3) return Math.round(x / 1e3).toLocaleString("ru-RU") + " т";
  return Math.round(x).toLocaleString("ru-RU");
};

/* Факт по артикулу: { арт → { "YYYY-MM-DD": {q, r} } } — отчёт + живые заказы после последнего дня отчёта.
   price[группа] — средняя цена штуки группы за сезон (по отчёту, без фильтров) — для плана в ₽ и живых заказов. */
function factByArt() {
  const out = {};
  const add = (a, day, q, r) => { const f = (out[a] ||= {}); const c = (f[day] ||= { q: 0, r: 0 }); c.q += q; c.r += r; };
  const gq = {}, gr = {};
  for (const cab of [1, 2]) {
    for (const [a, days] of Object.entries(PLAN.fact[cab] || {})) {
      const g = PLAN.group[a];
      if (!g) continue;
      for (const [d, c] of Object.entries(days)) { add(a, d, c.q, c.r); gq[g] = (gq[g] || 0) + c.q; gr[g] = (gr[g] || 0) + c.r; }
    }
  }
  const price = {};
  for (const g of Object.keys(gq)) price[g] = gq[g] > 0 ? gr[g] / gq[g] : 0;
  for (const cab of [1, 2]) {
    const after = PLAN.factMax[cab] || "";
    for (const o of (D[cab] && D[cab].allOrders) || []) {
      const day = (o.date || "").slice(0, 10);
      if (!day || day <= after || day < PLAN.seasonStart) continue;
      const a = (o.supplierArticle || "").toLowerCase();
      const g = PLAN.group[a];
      if (!g) continue;
      const q = o.quantity || 1;
      add(a, day, q, q * (price[g] || 0));
    }
  }
  return { fact: out, price };
}

/* Фильтры кабинета Easyform (артикул / предмет / группа) — те же, что для остальных блоков.
   Предмет артикула — как у WB в заказах/остатках (любой кабинет), иначе из номенклатуры. */
function planFilter() {
  const arts = FA[1].map((x) => String(x).trim().toLowerCase());
  const subs = FP[1].map((x) => String(x).trim().toLowerCase());
  const grps = FG[1].map((x) => String(x).trim().toLowerCase());
  if (!arts.length && !subs.length && !grps.length) return null;
  const subj = {};
  for (const cab of [1, 2]) {
    const d = D[cab];
    if (!d) continue;
    for (const o of [...(d.allOrders || []), ...(d.stocks || [])]) {
      const a = (o.supplierArticle || "").toLowerCase();
      if (a && !subj[a] && (o.subject || o.category)) subj[a] = String(o.subject || o.category).trim().toLowerCase();
    }
  }
  return (a) => {
    const nm = artGroup(a);
    if (arts.length && !arts.includes(a)) return false;
    if (subs.length && !subs.includes(subj[a] || String((nm && nm.predmet) || "").trim().toLowerCase())) return false;
    if (grps.length && !grps.includes(String((nm && nm.kratko) || "").trim().toLowerCase())) return false;
    return true;
  };
}

export function planHTML(n) {
  if (n !== 1) return "";
  const wrap = (inner, color = "var(--ink3)") =>
    `<div id="plan${n}" class="filter-bar" style="border-top:3px solid ${color}">${inner}</div>`;
  if (PLAN.error) return wrap(`<span class="st">🎯 План / факт</span><div style="font-size:11px;color:var(--ink3);margin-top:6px">План не загрузился: ${esc(PLAN.error)}</div>`);
  if (!PLAN.ready) return wrap(`<span class="st">🎯 План / факт</span><div style="font-size:11px;color:var(--ink3);margin-top:6px">загружаем план…</div>`);
  if (BASE === "ly") return lyHTML(n, wrap);

  const R = UNIT === "r";
  const nf = R ? nfR : nfQ;
  const nfG = R ? nfRs : nfQ;   /* в строках групп — короче */
  const unitWord = R ? "₽" : "шт";

  const now = new Date(Date.now() + 3 * 3600e3);              /* московское время */
  const today = now.toISOString().slice(0, 10);
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const ym = `${y}-${String(m).padStart(2, "0")}`;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const elapsed = now.getUTCDate() - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
  const inSeason = PLAN.months.includes(m);
  const seasonMonths = PLAN.months.slice(0, PLAN.months.indexOf(m) + 1);   /* сен…текущий */

  const { fact, price } = factByArt();
  const ok = planFilter();
  const filtered = !!ok;

  const val = (q, r) => (R ? r : q);
  const planVal = (g, qty) => (R ? qty * (price[g] || 0) : qty);

  const groups = {}, byArt = {};
  let pM = 0, fM = 0, pS = 0, fS = 0, pAll = 0;
  for (const a of Object.keys(PLAN.group)) {
    if (ok && !ok(a)) continue;
    const g = PLAN.group[a];
    const pm = PLAN.plan[a] || {};
    let factM = 0, factS = 0;
    for (const [d, c] of Object.entries(fact[a] || {})) {
      if (d > today) continue;
      const v = val(c.q, c.r);
      if (d.startsWith(ym)) factM += v;
      factS += v;
    }
    const planM = planVal(g, pm[m] || 0);
    const G = (groups[g] ||= { p: 0, f: 0 });
    G.p += planM; G.f += factM;
    if (planM > 0 || factM > 0) byArt[a] = { p: planM, f: factM };
    pM += planM; fM += factM; fS += factS;
    for (const mm of PLAN.months) pAll += planVal(g, pm[mm] || 0);
    if (inSeason) for (const mm of seasonMonths) pS += planVal(g, (pm[mm] || 0) * (mm === m ? elapsed / dim : 1));   /* план к сегодня */
  }

  const unitTog = `<span style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;font-size:10px">
      ${["q", "r"].map((u) => `<span onclick="App.setPlanUnit('${u}')" style="padding:1px 7px;cursor:pointer;${UNIT === u ? "background:var(--ink);color:var(--bg3)" : "color:var(--ink2)"}">${u === "q" ? "шт" : "₽"}</span>`).join("")}
    </span>`;
  const tip = `Заказы по группам плана, оба кабинета WB. Факт — отчёт WB по дням + живые заказы монитора за дни, которых в отчёте ещё нет. ` +
    `₽ — «сумма заказов минус комиссия WB»; план в ₽ = план в шт × средняя цена штуки группы за сезон. Прогноз = темп с начала месяца × дней в месяце.`;
  const head = (title) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <span class="st">${title}${filtered ? ` <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--ink3)">· по фильтру</span>` : ""}</span>
      <span style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;color:var(--ink3);cursor:help" data-tip="${esc(tip)}">ⓘ</span>${pill([["plan", "План"], ["ly", "Пр. год"]], BASE, "setPlanBase")}${unitTog}</span>
    </div>`;

  if (!inSeason) {
    return wrap(head("🎯 План / факт") +
      `<div style="font-size:12px;margin-top:6px">Сезон ${MSHORT[PLAN.months[0]]}–${MSHORT[PLAN.months[PLAN.months.length - 1]]}: план ${nf(pAll)} ${unitWord} · сейчас вне сезона</div>`);
  }

  const fc = elapsed > 0.5 ? (fM / elapsed) * dim : null;      /* прогноз месяца */
  const fcP = fc != null ? pc(fc, pM) : null;
  const doneP = pc(fM, pM);
  const paceP = Math.min(100, (elapsed / dim) * 100);           /* где «должны быть» сегодня */
  const col = tone(fcP);

  const bar = (fillP, markP, color, h) => `<div style="position:relative;height:${h}px;background:var(--bg2);border-radius:${h / 2}px;margin:6px 0 5px;overflow:hidden">
      <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100, fillP || 0)}%;background:${color};border-radius:${h / 2}px"></div>
      <div title="где должны быть сегодня по плану" style="position:absolute;top:-2px;bottom:-2px;left:${markP}%;width:2px;background:var(--ink)"></div>
    </div>`;

  /* Сезон: YTD против плана к сегодня, весь план, сколько осталось и сколько нужно в день */
  const last = PLAN.months[PLAN.months.length - 1];
  const sY = PLAN.months[0] <= m ? y : y - 1;                       /* год начала сезона */
  const endY = last < PLAN.months[0] ? sY + 1 : sY;
  const end = new Date(Date.UTC(endY, last, 0));                     /* последний день сезона */
  const daysLeft = Math.max(0, (end - Date.UTC(y, m - 1, now.getUTCDate())) / 864e5 + 1 - (elapsed - Math.floor(elapsed)));
  const left = Math.max(0, pAll - fS);
  const ytdP = pc(fS, pS), allP = pc(fS, pAll);
  const sCol = tone(ytdP);
  const sPace = pAll > 0 ? Math.min(100, (pS / pAll) * 100) : 0;
  const seasonBlock = `<div style="border-top:1px dashed var(--border);margin:2px 0 6px;padding-top:6px">
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <span style="font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--ink3);text-transform:uppercase">Сезон ${MSHORT[PLAN.months[0]]} ${String(sY).slice(2)} – ${MSHORT[last]} ${String(endY).slice(2)}</span>
        <span style="font-size:11px;color:var(--ink2)">весь план <b>${nf(pAll)}</b> ${unitWord}</span>
      </div>
      ${bar(allP, sPace, sCol, 6)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;font-size:11px">
        <span>YTD: <b>${nf(fS)}</b> · ${allP ?? "—"}% плана</span>
        <span style="text-align:right" data-tip="План с 1 сентября по сегодня (текущий месяц — пропорционально прошедшим дням)">к сегодня ${nf(pS)} · <b style="color:${sCol}">${ytdP ?? "—"}%</b></span>
        <span>Осталось: <b>${nf(left)}</b></span>
        <span style="text-align:right">${daysLeft >= 1 ? `≈ ${nf(left / daysLeft)} в день до ${String(end.getUTCDate()).padStart(2, "0")}.${String(last).padStart(2, "0")}` : ""}</span>
      </div>
    </div>`;

  /* Строки: по группам; если после фильтра осталась одна группа — по артикулам */
  const liveGroups = Object.entries(groups).filter(([, g]) => g.p > 0 || g.f > 0);
  const perArt = liveGroups.length === 1;
  const rowsSrc = perArt ? Object.entries(byArt).map(([a, v]) => [PLAN.disp[a] || a, v]) : liveGroups;
  const gRows = rowsSrc
    .sort((a, b) => b[1].p - a[1].p)
    .map(([name, g]) => {
      const gf = elapsed > 0.5 ? (g.f / elapsed) * dim : null;
      const gp = g.p > 0 && gf != null ? pc(gf, g.p) : null;
      return `<div style="display:flex;gap:6px;font-size:11px;padding:2px 0;border-bottom:1px solid var(--border);min-width:0">
        <span style="flex:1;min-width:58px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(name)}">${esc(name.replace(/^ТН_/, ""))}</span>
        <span style="color:var(--ink2);white-space:nowrap">${nfG(g.f)} / ${g.p ? nfG(g.p) : "—"}</span>
        <span style="width:36px;text-align:right;font-weight:700;color:${tone(gp)}">${gp != null ? gp + "%" : "—"}</span>
      </div>`;
    }).join("");

  return wrap(`
    ${head(`🎯 План / факт · ${MONTH[m]}`)}
    <div style="display:flex;align-items:baseline;gap:10px;margin-top:6px;flex-wrap:wrap">
      <span style="font-size:20px;font-weight:700">${nf(fM)}${R ? " ₽" : ""}</span>
      <span style="font-size:12px;color:var(--ink2)">из ${nf(pM)} · ${doneP ?? "—"}%</span>
      ${fc != null ? `<span style="margin-left:auto;font-size:12px">прогноз <b style="color:${col}">${nf(fc)} · ${fcP}%</b></span>` : ""}
    </div>
    ${bar(doneP, paceP, col, 8)}
    ${seasonBlock}
    ${gRows ? `<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--ink3);margin-bottom:2px"><span>${perArt ? `${esc(liveGroups[0][0].replace(/^ТН_/, ""))} по артикулам` : "группы"} · ${MONTH[m]}</span><span>факт / план · прогноз</span></div>
    <div style="display:grid;grid-template-columns:${perArt ? "1fr" : "repeat(auto-fit,minmax(195px,1fr))"};column-gap:14px">${gRows}</div>` : `<div style="font-size:11px;color:var(--ink3)">${filtered ? "По этому фильтру товаров из плана нет" : ""}</div>`}`, col);
}


/* ══════════════════════════════════════════════════════════
   Режим «Прошлый год»: этот период (до сегодня) против того же периода год назад.
   Неделя — с понедельника по сегодня против тех же дней недели год назад (−364 дня);
   месяц и сезон (с 1 сентября) — те же даты год назад. Сегодня — частью дня:
   у прошлого года берём такую же долю «сегодняшнего» дня.
   Все артикулы обоих кабинетов (не только плановые); группы — «Кратко» из номенклатуры.
   ══════════════════════════════════════════════════════════ */
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const minusYear = (iso) => {
  const y = +iso.slice(0, 4) - 1, m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, dim)).padStart(2, "0")}`;
};
const dShort = (iso) => `${+iso.slice(8, 10)} ${MSHORT[+iso.slice(5, 7)]} ${iso.slice(2, 4)}`;

/* Все заказы по артикулу и дню: отчёт + живые заказы монитора после последнего дня отчёта */
function allByArt() {
  const out = {};
  for (const [a, days] of Object.entries(PLAN.all)) out[a] = { ...days };
  /* цена штуки артикула (₽ в отчёте — после комиссии) — для живых заказов */
  const price = {};
  for (const [a, days] of Object.entries(PLAN.all)) {
    let q = 0, r = 0;
    for (const [d, c] of Object.entries(days)) if (d >= PLAN.seasonStart) { q += c.q; r += c.r; }
    if (q > 0) price[a] = r / q;
  }
  for (const cab of [1, 2]) {
    const after = PLAN.factMax[cab] || "";
    for (const o of (D[cab] && D[cab].allOrders) || []) {
      const day = (o.date || "").slice(0, 10);
      if (!day || day <= after) continue;
      const a = (o.supplierArticle || "").toLowerCase();
      if (!a) continue;
      const q = o.quantity || 1;
      const c = ((out[a] ||= {})[day] = { ...((out[a] || {})[day] || { q: 0, r: 0 }) });
      c.q += q;
      c.r += q * (price[a] || wbPrice(o));
      PLAN.disp[a] ||= o.supplierArticle;
    }
  }
  return out;
}

function lyHTML(n, wrap) {
  const R = UNIT === "r";
  const nf = R ? nfR : nfQ, nfG = R ? nfRs : nfQ;
  const now = new Date(Date.now() + 3 * 3600e3);
  const today = now.toISOString().slice(0, 10);
  const frac = (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
  const m = now.getUTCMonth() + 1;

  /* Границы периода: [from, today] сейчас и [lyFrom, lyToday] год назад; lyEnd — конец периода год назад */
  let from, lyFrom, lyToday, lyEnd, label;
  if (PER === "w") {
    const dow = (now.getUTCDay() + 6) % 7;                 /* пн = 0 */
    from = addDays(today, -dow);
    lyFrom = addDays(from, -364); lyToday = addDays(today, -364); lyEnd = addDays(lyFrom, 6);
    label = "неделя";
  } else if (PER === "m") {
    from = today.slice(0, 8) + "01";
    lyFrom = minusYear(from); lyToday = minusYear(today);
    lyEnd = lyFrom.slice(0, 8) + String(new Date(Date.UTC(+lyFrom.slice(0, 4), m, 0)).getUTCDate()).padStart(2, "0");
    label = MONTH[m];
  } else {
    from = PLAN.seasonStart;
    lyFrom = PLAN.lyStart; lyToday = minusYear(today);
    const last = PLAN.months[PLAN.months.length - 1] || 1;
    const endY = last < 9 ? +lyFrom.slice(0, 4) + 1 : +lyFrom.slice(0, 4);
    lyEnd = `${endY}-${String(last).padStart(2, "0")}-${String(new Date(Date.UTC(endY, last, 0)).getUTCDate()).padStart(2, "0")}`;
    label = "сезон";
  }

  const data = allByArt();
  const ok = planFilter();
  const grpOf = (a) => { const g = artGroup(a); return (g && g.kratko) || "Прочее"; };
  const v = (c) => (R ? c.r : c.q);

  const groups = {}, byArt = {};
  let ty = 0, ly = 0, lyAll = 0;
  for (const [a, days] of Object.entries(data)) {
    if (ok && !ok(a)) continue;
    let t = 0, l = 0, la = 0;
    for (const [d, c] of Object.entries(days)) {
      if (d >= from && d <= today) t += v(c);
      if (d >= lyFrom && d < lyToday) l += v(c);
      else if (d === lyToday) l += v(c) * frac;           /* «сегодня» год назад — той же долей дня */
      if (d >= lyFrom && d <= lyEnd) la += v(c);
    }
    if (!t && !la) continue;
    const g = grpOf(a);
    const G = (groups[g] ||= { t: 0, l: 0 });
    G.t += t; G.l += l;
    byArt[a] = { t, l, g };
    ty += t; ly += l; lyAll += la;
  }

  const dp = (a, b) => (b > 0 ? Math.round((a / b - 1) * 100) : null);
  const dTone = (p) => (p == null ? "var(--ink3)" : p >= 0 ? "var(--green)" : p >= -10 ? "#B7791F" : "var(--red)");
  const dTxt = (p) => (p == null ? "—" : (p > 0 ? "+" : p < 0 ? "−" : "±") + Math.abs(p) + "%");
  const d = dp(ty, ly), col = dTone(d);
  const filtered = !!ok;

  const liveGroups = Object.entries(groups).filter(([, g]) => g.t > 0 || g.l > 0);
  const perArt = liveGroups.length === 1;
  const rowsSrc = perArt ? Object.entries(byArt).map(([a, x]) => [PLAN.disp[a] || a, x]) : liveGroups;
  const rows = rowsSrc.filter(([, x]) => x.t > 0 || x.l > 0)
    .sort((a, b) => (b[1].t + b[1].l) - (a[1].t + a[1].l))
    .slice(0, perArt ? 12 : 10)
    .map(([name, x]) => {
      const p = dp(x.t, x.l);
      return `<div style="display:flex;gap:6px;font-size:11px;padding:2px 0;border-bottom:1px solid var(--border);min-width:0">
        <span style="flex:1;min-width:58px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(name)}">${esc(name)}</span>
        <span style="color:var(--ink2);white-space:nowrap">${nfG(x.t)} / ${nfG(x.l)}</span>
        <span style="width:42px;text-align:right;font-weight:700;color:${dTone(p)}">${dTxt(p)}</span>
      </div>`;
    }).join("");

  const tip = `Заказы этого периода до сегодня против тех же дней год назад (неделя — те же дни недели, −364 дня). ` +
    `Сегодня — частью дня. Все артикулы обоих кабинетов WB, фильтры кабинета применяются. Отчёт WB по дням + живые заказы монитора. ` +
    `₽ — «сумма заказов минус комиссия WB».`;
  const unitTog = pill([["q", "шт"], ["r", "₽"]], UNIT, "setPlanUnit");

  return wrap(`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <span class="st">📈 К прошлому году · ${label}${filtered ? ` <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--ink3)">· по фильтру</span>` : ""}</span>
      <span style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;color:var(--ink3);cursor:help" data-tip="${esc(tip)}">ⓘ</span>${pill([["plan", "План"], ["ly", "Пр. год"]], BASE, "setPlanBase")}${unitTog}</span>
    </div>
    <div style="margin-top:6px">${pill([["w", "Неделя"], ["m", "Месяц"], ["s", "Сезон"]], PER, "setPlanPer")}</div>
    <div style="display:flex;align-items:baseline;gap:10px;margin-top:6px;flex-wrap:wrap">
      <span style="font-size:20px;font-weight:700">${nf(ty)}${R ? " ₽" : ""}</span>
      <span style="font-size:12px;color:var(--ink2)">год назад ${nf(ly)}</span>
      <span style="margin-left:auto;font-size:16px;font-weight:700;color:${col}">${dTxt(d)}</span>
    </div>
    <div style="font-size:11px;color:var(--ink3);margin:3px 0 6px">${dShort(from)} – ${dShort(today)} против ${dShort(lyFrom)} – ${dShort(lyToday)} · весь период год назад: <b style="color:var(--ink2)">${nf(lyAll)}</b>${lyAll > 0 ? ` (сейчас ${Math.round((ty / lyAll) * 100)}% от него)` : ""}</div>
    ${rows ? `<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--ink3);margin-bottom:2px"><span>${perArt ? `${esc(liveGroups[0][0])} по артикулам` : "группы"}</span><span>сейчас / год назад</span></div>
    <div style="display:grid;grid-template-columns:${perArt ? "1fr" : "repeat(auto-fit,minmax(195px,1fr))"};column-gap:14px">${rows}</div>` : `<div style="font-size:11px;color:var(--ink3)">Нет заказов за этот период</div>`}`, col);
}

export function repaintPlan(n) {
  const el = document.getElementById("plan" + n);
  if (el) el.outerHTML = planHTML(n);
}
