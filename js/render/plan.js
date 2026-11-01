import { D, FA, FP, FG } from "../state.js";
import { artGroup } from "../api/sheets.js";
import { esc, wbPrice } from "../utils.js";
import { PLAN } from "../api/plan.js";

/* ══════════════════════════════════════════════════════════
   План / факт и сравнение с прошлым годом (кабинет Easyform; план общий на оба кабинета WB).

   Сверху — короткая сводка (planHTML): месяц и сезон к плану + одной строкой к прошлому году.
   Внизу — подробный блок (seasonHTML): база «План | Пр. год», период «Неделя | Месяц |
   Пр. месяц | Сезон», график по неделям сезона, таблица по месяцам, строки «Группы | Артикулы».

   Факт = отчёт WB по дням (оба кабинета) + живые заказы монитора за дни, которых в отчёте ещё нет.
   Штуки — «Заказано, шт.»; ₽ — «Сумма заказов минус комиссия WB». План в ₽ = план в шт ×
   средняя цена штуки группы за сезон. Живые заказы в ₽ — по той же средней цене.
   План по дням = план месяца / дней в месяце. «Темп» = факт / план к сегодня (сегодня — долей дня).
   «План»: артикулы плана + доп. (planMap.js), группы плана. «Пр. год»: все артикулы, группы «Кратко».
   Фильтры кабинета (артикул / предмет / группа) работают везде.
   ══════════════════════════════════════════════════════════ */

const MONTH = ["", "январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MSHORT = ["", "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const pc = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
const tone = (p) => (p == null ? "var(--ink3)" : p >= 95 ? "var(--green)" : p >= 80 ? "#B7791F" : "var(--red)");
const dp = (a, b) => (b > 0 ? Math.round((a / b - 1) * 100) : null);
const dTone = (p) => (p == null ? "var(--ink3)" : p >= 0 ? "var(--green)" : p >= -10 ? "#B7791F" : "var(--red)");
const dTxt = (p) => (p == null ? "—" : (p > 0 ? "+" : p < 0 ? "−" : "±") + Math.abs(p) + "%");

/* ── Состояние переключателей (запоминаем в браузере) ── */
const LS = (k, ok, def) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : def; } catch { return def; } };
const SV = (k, v) => { try { localStorage.setItem(k, v); } catch { /* не страшно */ } };
let UNIT = LS("planUnit", ["q", "r"], "q");
let BASE = LS("planBase", ["plan", "ly"], "plan");
let PER = LS("planPer", ["w", "m", "pm", "s"], "m");
let SMODE = LS("seasMode", ["w", "c"], "w");
let ROWS = LS("planRows", ["g", "a"], "g");
export function setPlanUnit(u) { UNIT = u === "r" ? "r" : "q"; SV("planUnit", UNIT); }
export function setPlanBase(b) { BASE = b === "ly" ? "ly" : "plan"; SV("planBase", BASE); }
export function setPlanPer(p) { PER = ["w", "m", "pm", "s"].includes(p) ? p : "m"; SV("planPer", PER); }
export function setSeasMode(x) { SMODE = x === "c" ? "c" : "w"; SV("seasMode", SMODE); }
export function setPlanRows(x) { ROWS = x === "a" ? "a" : "g"; SV("planRows", ROWS); }

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


/* ── Время, сезон, периоды ── */
function clock() {
  const now = new Date(Date.now() + 3 * 3600e3);                  /* Москва */
  const today = now.toISOString().slice(0, 10);
  const frac = (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
  const sStart = PLAN.seasonStart, lStart = PLAN.lyStart;
  const last = PLAN.months[PLAN.months.length - 1] || 1;
  const sY = +sStart.slice(0, 4);
  const endOf = (y0) => { const ey = last < 9 ? y0 + 1 : y0; return `${ey}-${String(last).padStart(2, "0")}-${String(new Date(Date.UTC(ey, last, 0)).getUTCDate()).padStart(2, "0")}`; };
  return { now, today, frac, sStart, lStart, sY, sEnd: endOf(sY), lEnd: endOf(sY - 1), m: now.getUTCMonth() + 1 };
}
const dayIdx = (d, st) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(st + "T00:00:00Z")) / 864e5);
const lastDay = (y, m) => `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

/* Период: [from, to] этого года (to — сегодня или конец прошлого месяца), end — конец периода
   (для плана целиком); ly* — те же дни год назад (неделя — −364 дня). running — идёт ли сейчас. */
function period(per, C) {
  const { today, m, now } = C;
  if (per === "w") {
    const from = addDays(today, -((now.getUTCDay() + 6) % 7));
    return { from, to: today, end: addDays(from, 6), lyFrom: addDays(from, -364), lyTo: addDays(today, -364), lyEnd: addDays(from, -358), running: true, label: "неделя" };
  }
  if (per === "pm") {
    const y = m === 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear(), mm = m === 1 ? 12 : m - 1;
    const from = `${y}-${String(mm).padStart(2, "0")}-01`, to = lastDay(y, mm);
    return { from, to, end: to, lyFrom: minusYear(from), lyTo: lastDay(y - 1, mm), lyEnd: lastDay(y - 1, mm), running: false, label: MONTH[mm] };
  }
  if (per === "s") {
    return { from: C.sStart, to: today, end: C.sEnd, lyFrom: C.lStart, lyTo: minusYear(today), lyEnd: C.lEnd, running: true, label: "сезон" };
  }
  const from = today.slice(0, 8) + "01";
  return { from, to: today, end: lastDay(+today.slice(0, 4), m), lyFrom: minusYear(from), lyTo: minusYear(today), lyEnd: lastDay(+today.slice(0, 4) - 1, m), running: true, label: MONTH[m] };
}

/* План артикула на день (шт), только в днях сезона */
function dayPlan(a, d, C) {
  if (d < C.sStart || d > C.sEnd) return 0;
  const y = +d.slice(0, 4), mm = +d.slice(5, 7);
  const pm = PLAN.plan[a];
  if (!pm || !pm[mm]) return 0;
  return pm[mm] / new Date(Date.UTC(y, mm, 0)).getUTCDate();
}
/* Сумма плана артикула за [from, to]; если partial — день to берём долей frac */
function planRange(a, from, to, C, partial) {
  if (!PLAN.plan[a]) return 0;
  let s = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) s += dayPlan(a, d, C) * (partial && d === to ? C.frac : 1);
  return s;
}
/* Сумма факта по дням: [from, to]; partial — «сегодня» долей дня (для прошлого года) */
function sumDays(days, from, to, frac) {
  let q = 0, r = 0;
  for (const [d, c] of Object.entries(days || {})) {
    if (d < from || d > to) continue;
    const k = frac != null && d === to ? frac : 1;
    q += c.q * k; r += c.r * k;
  }
  return { q, r };
}

/* ── Расчёт для режима «План» за период: итог + строки по группам/артикулам ── */
function calcPlan(P, C, ok) {
  const { fact, price } = factByArt();
  const R = UNIT === "r";
  const toV = (g, x) => (R ? x * (price[g] || 0) : x);
  const out = { f: 0, pTo: 0, pAll: 0, groups: {}, arts: {} };
  for (const a of Object.keys(PLAN.group)) {
    if (ok && !ok(a)) continue;
    const g = PLAN.group[a];
    const fs = sumDays(fact[a], P.from, P.to);
    const f = R ? fs.r : fs.q;
    const pTo = toV(g, planRange(a, P.from, P.to, C, P.running));
    const pAll = toV(g, planRange(a, P.from, P.end, C, false));
    if (!f && !pAll) continue;
    out.f += f; out.pTo += pTo; out.pAll += pAll;
    const G = (out.groups[g] ||= { f: 0, pTo: 0, pAll: 0 });
    G.f += f; G.pTo += pTo; G.pAll += pAll;
    out.arts[a] = { f, pTo, pAll, g };
  }
  return out;
}

/* ── Расчёт для режима «Пр. год» за период ── */
function calcLY(P, C, ok, data) {
  const R = UNIT === "r";
  const out = { t: 0, l: 0, lAll: 0, groups: {}, arts: {} };
  for (const [a, days] of Object.entries(data)) {
    if (ok && !ok(a)) continue;
    const ts = sumDays(days, P.from, P.to);
    const ls = sumDays(days, P.lyFrom, P.lyTo, P.running ? C.frac : null);
    const la = sumDays(days, P.lyFrom, P.lyEnd);
    const t = R ? ts.r : ts.q, l = R ? ls.r : ls.q, lAll = R ? la.r : la.q;
    if (!t && !lAll) continue;
    const g = (artGroup(a) && artGroup(a).kratko) || "Прочее";
    out.t += t; out.l += l; out.lAll += lAll;
    const G = (out.groups[g] ||= { t: 0, l: 0 });
    G.t += t; G.l += l;
    out.arts[a] = { t, l, g };
  }
  return out;
}

const moreLink = `<a href="#seas1" onclick="document.getElementById('seas1')?.scrollIntoView({behavior:'smooth'});return false" style="font-size:11px;color:var(--ink2);text-decoration:none;border-bottom:1px dotted var(--ink3);white-space:nowrap">Подробнее ↓</a>`;
const byFilter = (ok) => (ok ? ` <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--ink3)">· по фильтру</span>` : "");
const bar = (fillP, markP, color, h) => `<div style="position:relative;height:${h}px;background:var(--bg2);border-radius:${h / 2}px;margin:5px 0 4px;overflow:hidden">
    <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100, Math.max(0, fillP || 0))}%;background:${color};border-radius:${h / 2}px"></div>
    ${markP != null ? `<div title="где должны быть сегодня по плану" style="position:absolute;top:-2px;bottom:-2px;left:${Math.min(100, markP)}%;width:2px;background:var(--ink)"></div>` : ""}
  </div>`;

/* ══════════════ Сверху: короткая сводка ══════════════ */
export function planHTML(n) {
  if (n !== 1) return "";
  const wrap = (inner, color = "var(--ink3)") => `<div id="plan${n}" class="filter-bar" style="border-top:3px solid ${color}">${inner}</div>`;
  const t0 = `<span class="st">🎯 План / факт</span>`;
  if (PLAN.error) return wrap(`${t0}<div style="font-size:11px;color:var(--ink3);margin-top:6px">План не загрузился: ${esc(PLAN.error)}</div>`);
  if (!PLAN.ready) return wrap(`${t0}<div style="font-size:11px;color:var(--ink3);margin-top:6px">загружаем план…</div>`);

  const C = clock(), ok = planFilter(), R = UNIT === "r", nf = R ? nfR : nfQ;
  const inSeason = C.today >= C.sStart && C.today <= C.sEnd;
  const Pm = period("m", C), Ps = period("s", C);
  const pmc = calcPlan(Pm, C, ok), psc = calcPlan(Ps, C, ok);
  const data = allByArt();
  const lm = calcLY(Pm, C, ok, data), ls = calcLY(Ps, C, ok, data);

  const paceM = pc(pmc.f, pmc.pTo), paceS = pc(psc.f, psc.pTo);
  const col = tone(paceM);
  const dm = dp(lm.t, lm.l), ds = dp(ls.t, ls.l);

  const line = (name, f, pAll, pTo, pace, h) => `
    <div style="display:flex;align-items:baseline;gap:8px;margin-top:7px">
      <span style="font-size:11px;color:var(--ink3);width:62px">${name}</span>
      <span style="font-size:${h}px;font-weight:700">${nf(f)}${R && h > 14 ? " ₽" : ""}</span>
      <span style="font-size:11px;color:var(--ink2)">из ${nf(pAll)} · ${pc(f, pAll) ?? "—"}%</span>
      <span style="margin-left:auto;font-size:11px;white-space:nowrap" data-tip="Факт против плана к сегодняшнему дню (план месяца поровну по дням, сегодня — долей дня)">темп <b style="color:${tone(pace)}">${pace ?? "—"}%</b></span>
    </div>
    ${bar(pc(f, pAll), pAll > 0 ? (pTo / pAll) * 100 : null, tone(pace), h > 14 ? 7 : 5)}`;

  return wrap(`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <span class="st">🎯 План / факт${byFilter(ok)}</span>
      ${pill([["q", "шт"], ["r", "₽"]], UNIT, "setPlanUnit")}
    </div>
    ${inSeason ? line(MONTH[C.m], pmc.f, pmc.pAll, pmc.pTo, paceM, 20) : `<div style="font-size:12px;margin-top:6px">Сейчас вне сезона плана</div>`}
    ${line("сезон", psc.f, psc.pAll, psc.pTo, paceS, 15)}
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;font-size:11px;border-top:1px dashed var(--border);padding-top:6px">
      <span style="color:var(--ink2)" data-tip="Все артикулы обоих кабинетов, те же дни год назад">к прошлому году: ${MONTH[C.m]} <b style="color:${dTone(dm)}">${dTxt(dm)}</b> · сезон <b style="color:${dTone(ds)}">${dTxt(ds)}</b></span>
      ${moreLink}
    </div>`, col);
}

/* ══════════════ Внизу: подробный блок ══════════════ */
const C_TY = "#8B4513";   /* этот сезон / факт — фирменный коричневый */
const C_LY = "#A8A29A";   /* прошлый сезон — приглушённый серый */
const C_PL = "#4A6FA5";   /* план — синий, пунктир */

export function seasonHTML(n) {
  if (n !== 1) return "";
  const box = (inner) => `<div id="seas${n}" class="filter-bar" style="margin:18px 0">${inner}</div>`;
  const title = `<span class="st">📊 План / факт и прошлый год — подробно</span>`;
  if (PLAN.error) return box(title + `<div style="font-size:11px;color:var(--ink3);margin-top:6px">Не загрузилось: ${esc(PLAN.error)}</div>`);
  if (!PLAN.ready) return box(title + `<div style="font-size:11px;color:var(--ink3);margin-top:6px">загружаем…</div>`);

  const C = clock(), ok = planFilter(), R = UNIT === "r", nf = R ? nfR : nfQ, nfG = R ? nfRs : nfQ;
  const isPlan = BASE === "plan";
  const P = period(PER, C);
  const data = allByArt();
  const { fact: pfact, price } = factByArt();
  const sYs = (y) => `${String(y).slice(2)}/${String(y + 1).slice(2)}`;

  /* ── 1. Итог за период ── */
  let summary, rowsHTML;
  const rowsTog = pill([["g", "Группы"], ["a", "Артикулы"]], ROWS, "setPlanRows");
  const rowLine = (name, a, b, pTxt, pCol) => `<div style="display:flex;gap:6px;font-size:11px;padding:2px 0;border-bottom:1px solid var(--border);min-width:0">
      <span style="flex:1;min-width:58px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(name)}">${esc(name)}</span>
      <span style="color:var(--ink2);white-space:nowrap">${nfG(a)} / ${b ? nfG(b) : "—"}</span>
      <span style="width:44px;text-align:right;font-weight:700;color:${pCol}">${pTxt}</span>
    </div>`;
  const grid = (html) => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));column-gap:18px">${html}</div>`;
  const rangeTxt = `${dShort(P.from)} – ${dShort(P.to)}`;

  if (isPlan) {
    const c = calcPlan(P, C, ok);
    const pace = pc(c.f, c.pTo);
    summary = `<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-top:10px">
        <span style="font-size:24px;font-weight:700">${nf(c.f)}${R ? " ₽" : ""}</span>
        <span style="font-size:13px;color:var(--ink2)">план ${P.running ? "к сегодня " + nf(c.pTo) + " · на весь период " : ""}${nf(c.pAll)}</span>
        <span style="margin-left:auto;font-size:16px;font-weight:700;color:${tone(pace)}">${P.running ? "темп " : ""}${pace ?? "—"}%</span>
      </div>
      ${bar(pc(c.f, c.pAll), P.running && c.pAll > 0 ? (c.pTo / c.pAll) * 100 : null, tone(pace), 8)}
      <div style="font-size:11px;color:var(--ink3)">${rangeTxt} · ${P.running ? `осталось до плана периода: <b style="color:var(--ink2)">${nf(Math.max(0, c.pAll - c.f))}</b>` : `выполнено ${pc(c.f, c.pAll) ?? "—"}% плана`}</div>`;
    const src = ROWS === "a"
      ? Object.entries(c.arts).map(([a, x]) => [PLAN.disp[a] || a, x])
      : Object.entries(c.groups).map(([g, x]) => [g.replace(/^ТН_/, ""), x]);
    rowsHTML = grid(src.sort((a, b) => b[1].pAll - a[1].pAll || b[1].f - a[1].f)
      .map(([nm, x]) => { const p = pc(x.f, x.pTo); return rowLine(nm, x.f, x.pTo, p != null ? p + "%" : "—", tone(p)); }).join(""));
    rowsHTML = `<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--ink3);margin:12px 0 3px">${rowsTog}<span>факт / план ${P.running ? "к сегодня" : "периода"} · %</span></div>` + rowsHTML;
  } else {
    const c = calcLY(P, C, ok, data);
    const d = dp(c.t, c.l);
    summary = `<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-top:10px">
        <span style="font-size:24px;font-weight:700">${nf(c.t)}${R ? " ₽" : ""}</span>
        <span style="font-size:13px;color:var(--ink2)">год назад ${nf(c.l)}</span>
        <span style="margin-left:auto;font-size:16px;font-weight:700;color:${dTone(d)}">${dTxt(d)}</span>
      </div>
      <div style="font-size:11px;color:var(--ink3);margin-top:4px">${rangeTxt} против ${dShort(P.lyFrom)} – ${dShort(P.lyTo)} · весь этот период год назад: <b style="color:var(--ink2)">${nf(c.lAll)}</b>${P.running && c.lAll > 0 ? ` (сейчас ${Math.round((c.t / c.lAll) * 100)}% от него)` : ""}</div>`;
    const src = ROWS === "a"
      ? Object.entries(c.arts).map(([a, x]) => [PLAN.disp[a] || a, x])
      : Object.entries(c.groups);
    rowsHTML = grid(src.filter(([, x]) => x.t > 0 || x.l > 0).sort((a, b) => (b[1].t + b[1].l) - (a[1].t + a[1].l))
      .map(([nm, x]) => { const p = dp(x.t, x.l); return rowLine(nm, x.t, x.l, dTxt(p), dTone(p)); }).join(""));
    rowsHTML = `<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--ink3);margin:12px 0 3px">${rowsTog}<span>сейчас / год назад · Δ</span></div>` + rowsHTML;
  }

  /* ── 2. График по неделям сезона ── */
  const nDays = dayIdx(C.sEnd, C.sStart) + 1, W = Math.ceil(nDays / 7);
  const todayIdx = dayIdx(C.today, C.sStart), curW = Math.floor(todayIdx / 7);
  const A = Array(W).fill(0), B = Array(W).fill(0);         /* A — факт этого сезона, B — план или прошлый сезон */
  const months = {};                                        /* "MM" → { a, bTo, bAll } */
  const M = (k) => (months[k] ||= { a: 0, bTo: 0, bAll: 0 });
  if (isPlan) {
    for (const a of Object.keys(PLAN.group)) {
      if (ok && !ok(a)) continue;
      const g = PLAN.group[a];
      for (const [d, c] of Object.entries(pfact[a] || {})) {
        if (d < C.sStart || d > C.today || d > C.sEnd) continue;
        const x = R ? c.r : c.q;
        A[Math.floor(dayIdx(d, C.sStart) / 7)] += x; M(d.slice(5, 7)).a += x;
      }
      if (!PLAN.plan[a]) continue;
      for (let i = 0; i < nDays; i++) {
        const d = addDays(C.sStart, i);
        const x = dayPlan(a, d, C) * (R ? price[g] || 0 : 1);
        if (!x) continue;
        B[Math.floor(i / 7)] += x;
        const mm = M(d.slice(5, 7));
        mm.bAll += x;
        if (i < todayIdx) mm.bTo += x; else if (i === todayIdx) mm.bTo += x * C.frac;
      }
    }
  } else {
    for (const [a, days] of Object.entries(data)) {
      if (ok && !ok(a)) continue;
      for (const [d, c] of Object.entries(days)) {
        const x = R ? c.r : c.q;
        if (d >= C.sStart && d <= C.today && d <= C.sEnd) { A[Math.floor(dayIdx(d, C.sStart) / 7)] += x; M(d.slice(5, 7)).a += x; }
        else if (d >= C.lStart && d <= C.lEnd) {
          const i = dayIdx(d, C.lStart);
          B[Math.floor(i / 7)] += x;
          const mm = M(d.slice(5, 7));
          mm.bAll += x;
          if (i < todayIdx) mm.bTo += x; else if (i === todayIdx) mm.bTo += x * C.frac;
        }
      }
    }
  }
  const cum = (arr) => arr.reduce((acc, x, i) => (acc.push((acc[i - 1] || 0) + x), acc), []);
  const TA = SMODE === "c" ? cum(A) : A, TB = SMODE === "c" ? cum(B) : B;
  const cB = isPlan ? C_PL : C_LY;
  const nameA = isPlan ? "факт" : `этот сезон ${sYs(C.sY)}`, nameB = isPlan ? "план" : `прошлый ${sYs(C.sY - 1)}`;

  const VW = 1000, VH = 250, pl = 56, pr = 78, pt = 14, pb = 30;
  const shown = Math.min(W, curW + 1);
  const max = Math.max(1, ...TB, ...TA.slice(0, shown)) * 1.08;
  const wd = (VW - pl - pr) / W;
  const xs = (i) => pl + (i + 0.5) * wd;
  const ys = (v) => pt + (VH - pt - pb) * (1 - v / max);
  const step = (() => { const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= raw); })();
  let gridL = "";
  for (let g = 0; g <= max; g += step) gridL += `<line x1="${pl}" x2="${VW - pr}" y1="${ys(g)}" y2="${ys(g)}" stroke="var(--border)"/><text x="${pl - 6}" y="${ys(g) + 4}" text-anchor="end" font-size="11" fill="var(--ink3)">${R ? nfR(g) : nfQ(g)}</text>`;
  let mlines = "";
  PLAN.months.forEach((mm, k) => {
    const yy = mm < 9 ? C.sY + 1 : C.sY;
    const xi = pl + (dayIdx(`${yy}-${String(mm).padStart(2, "0")}-01`, C.sStart) / 7) * wd;
    mlines += `${k ? `<line x1="${xi}" x2="${xi}" y1="${pt}" y2="${VH - pb}" stroke="var(--border)" stroke-dasharray="3 3"/>` : ""}<text x="${xi + 4}" y="${VH - 10}" font-size="11" fill="var(--ink2)">${MONTH[mm]}</text>`;
  });
  const path = (arr, upto) => arr.slice(0, upto).map((y, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(y).toFixed(1)}`).join("");
  const bPath = `<path d="${path(TB, W)}" fill="none" stroke="${cB}" stroke-width="2" ${isPlan ? 'stroke-dasharray="6 4"' : ""} stroke-linejoin="round"/>`;
  const full = SMODE === "c" ? shown : curW;
  const aPath = `<path d="${path(TA, full)}" fill="none" stroke="${C_TY}" stroke-width="2.5" stroke-linejoin="round"/>` +
    (SMODE === "w" && curW < W && curW > 0 ? `<path d="M${xs(curW - 1)},${ys(TA[curW - 1])}L${xs(curW)},${ys(TA[curW])}" fill="none" stroke="${C_TY}" stroke-width="2" stroke-dasharray="4 3"/>` : "");
  const dots = TA.slice(0, shown).map((y, i) => `<circle cx="${xs(i)}" cy="${ys(y)}" r="${i === curW ? 4 : 3}" fill="${i === curW && SMODE === "w" ? "var(--card)" : C_TY}" stroke="${C_TY}" stroke-width="2"/>`).join("");
  const endLbl = (x, y, txt, c) => `<text x="${x + 8}" y="${y + 4}" font-size="11" font-weight="700" fill="var(--ink)"><tspan fill="${c}">●</tspan> ${txt}</text>`;
  const lblA = shown ? endLbl(xs(shown - 1), ys(TA[shown - 1]), isPlan ? "факт" : sYs(C.sY), C_TY) : "";
  const lblB = endLbl(xs(W - 1), ys(TB[W - 1]), isPlan ? "план" : sYs(C.sY - 1), cB);
  const hits = Array.from({ length: W }, (_, i) => {
    const d0 = addDays(C.sStart, i * 7);
    const a = i < shown ? TA[i] : null, b = TB[i];
    const rel = a != null ? (isPlan ? pc(a, b) : dp(a, b)) : null;
    const tip = `Неделя ${i + 1}: ${dShort(d0)} – ${dShort(addDays(d0, 6))}${i === curW ? " (идёт)" : ""} · ${nameA}: ${a != null ? nf(a) : "—"} · ` +
      `${nameB}${isPlan ? "" : ` (${dShort(addDays(C.lStart, i * 7))})`}: ${nf(b)}${rel != null ? ` · ${isPlan ? rel + "% плана" : dTxt(rel)}` : ""}`;
    return `<rect x="${pl + i * wd}" y="${pt}" width="${wd}" height="${VH - pt - pb}" fill="transparent" data-tip="${esc(tip)}"/>`;
  }).join("");
  const svg = `<svg viewBox="0 0 ${VW} ${VH}" style="width:100%;height:auto;display:block;margin-top:8px" role="img" aria-label="По неделям сезона: ${nameA} и ${nameB}">
    ${gridL}${mlines}${bPath}${aPath}${dots}${lblA}${lblB}${hits}</svg>`;
  const legend = `<span style="display:inline-flex;gap:14px;font-size:11px;color:var(--ink2)">
      <span><span style="display:inline-block;width:14px;height:3px;background:${C_TY};vertical-align:middle;margin-right:4px"></span>${nameA}</span>
      <span><span style="display:inline-block;width:14px;height:0;border-top:2px ${isPlan ? "dashed" : "solid"} ${cB};vertical-align:middle;margin-right:4px"></span>${nameB}</span>
    </span>`;

  /* ── 3. Таблица по месяцам ── */
  const curM = C.today.slice(5, 7);
  let sA = 0, sBto = 0, sBall = 0;
  const mRows = PLAN.months.map((mm) => {
    const k = String(mm).padStart(2, "0"), x = months[k] || { a: 0, bTo: 0, bAll: 0 };
    const yy = mm < 9 ? C.sY + 1 : C.sY;
    const future = `${yy}-${k}-01` > C.today, going = k === curM && !future;
    const bCmp = going ? x.bTo : x.bAll;
    sA += x.a; sBto += future ? 0 : bCmp; sBall += x.bAll;
    const p = future ? null : isPlan ? pc(x.a, bCmp) : dp(x.a, bCmp);
    return `<tr><td>${MONTH[mm]}${going ? ` <span style="color:var(--ink3);font-size:10px">идёт</span>` : ""}</td>
      <td style="text-align:right;font-weight:700">${future ? "—" : nf(x.a)}</td>
      <td style="text-align:right;color:var(--ink2)">${future ? "" : nf(bCmp)}</td>
      <td style="text-align:right;color:var(--ink2)">${nf(x.bAll)}</td>
      <td style="text-align:right;font-weight:700;color:${isPlan ? tone(p) : dTone(p)}">${p == null ? "—" : isPlan ? p + "%" : dTxt(p)}</td></tr>`;
  }).join("");
  const pS = isPlan ? pc(sA, sBto) : dp(sA, sBto);
  const hB = isPlan ? "План" : sYs(C.sY - 1);
  const table = `<div class="sw" style="margin-top:10px"><table style="font-size:12px">
    <thead><tr><th>Месяц</th><th style="text-align:right">Факт ${sYs(C.sY)}</th>
      <th style="text-align:right" data-tip="Идущий месяц — по сегодняшнюю дату (сегодня — долей дня)">${hB} к дате</th>
      <th style="text-align:right">${hB} весь месяц</th><th style="text-align:right">${isPlan ? "% плана" : "Δ"}</th></tr></thead>
    <tbody>${mRows}<tr style="border-top:2px solid var(--border2)"><td><b>Сезон</b></td><td style="text-align:right;font-weight:700">${nf(sA)}</td>
      <td style="text-align:right;color:var(--ink2)">${nf(sBto)}</td><td style="text-align:right;color:var(--ink2)">${nf(sBall)}</td>
      <td style="text-align:right;font-weight:700;color:${isPlan ? tone(pS) : dTone(pS)}">${pS == null ? "—" : isPlan ? pS + "%" : dTxt(pS)}</td></tr></tbody>
  </table></div>`;

  const sub = (t) => `<div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--ink3);text-transform:uppercase;margin-top:16px">${t}</div>`;
  return box(`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span>${title}${byFilter(ok)}</span>
      <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${pill([["plan", "План"], ["ly", "Прошлый год"]], BASE, "setPlanBase")}
        ${pill([["w", "Неделя"], ["m", "Месяц"], ["pm", "Пр. месяц"], ["s", "Сезон"]], PER, "setPlanPer")}
        ${pill([["q", "шт"], ["r", "₽"]], UNIT, "setPlanUnit")}
      </span>
    </div>
    <div style="font-size:11px;color:var(--ink3);margin-top:4px">${isPlan
      ? "Факт против плана: артикулы плана (оба кабинета WB). План месяца делится поровну по дням; «темп» — факт к плану на сегодня."
      : "Этот год против тех же дней год назад (неделя — те же дни недели): все артикулы обоих кабинетов WB."} Фильтры кабинета работают.</div>
    ${sub(isPlan ? `Итог · ${P.label}` : `К прошлому году · ${P.label}`)}
    ${summary}
    ${rowsHTML}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">${sub("По неделям сезона")}<span style="display:flex;gap:10px;align-items:center;margin-top:14px">${legend}${pill([["w", "По неделям"], ["c", "Накопительно"]], SMODE, "setSeasMode")}</span></div>
    <div style="font-size:11px;color:var(--ink3);margin-top:2px">Неделя 1 — с 1 сентября. Текущая неделя неполная — пустая точка. Наведите на неделю — цифры.</div>
    ${svg}
    ${sub("По месяцам")}
    ${table}`);
}

export function repaintPlan(n) {
  const el = document.getElementById("plan" + n);
  if (el) el.outerHTML = planHTML(n);
  const es = document.getElementById("seas" + n);
  if (es) es.outerHTML = seasonHTML(n);
}
