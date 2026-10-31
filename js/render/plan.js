import { D } from "../state.js";
import { esc } from "../utils.js";
import { PLAN } from "../api/plan.js";

/* ══════════════════════════════════════════════════════════
   Блок «План / факт» вверху кабинета Easyform.
   Факт = «Заказано, шт.» по артикулам из плана (оба кабинета WB):
   из отчёта по дням + живые заказы монитора за дни, которых в отчёте ещё нет.
   Прогноз месяца = факт / прошедшие дни × дней в месяце (сегодня — частью дня).
   ══════════════════════════════════════════════════════════ */

const MONTH = ["", "январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MSHORT = ["", "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const nf = (x) => Math.round(x).toLocaleString("ru-RU");
const pc = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
/* цвет по прогнозу к плану */
const tone = (p) => (p == null ? "var(--ink3)" : p >= 95 ? "var(--green)" : p >= 80 ? "#B7791F" : "var(--red)");

/* Факт по артикулу: { "YYYY-MM-DD": шт } — отчёт + живые заказы после последнего дня отчёта */
function factByArt() {
  const out = {};
  const add = (a, day, q) => { const f = (out[a] ||= {}); f[day] = (f[day] || 0) + q; };
  for (const cab of [1, 2]) {
    for (const [a, days] of Object.entries(PLAN.fact[cab] || {})) for (const [d, q] of Object.entries(days)) add(a, d, q);
    const after = PLAN.factMax[cab] || "";
    for (const o of (D[cab] && D[cab].allOrders) || []) {
      const day = (o.date || "").slice(0, 10);
      if (!day || day <= after || day < PLAN.seasonStart) continue;
      const a = (o.supplierArticle || "").toLowerCase();
      if (!PLAN.plan[a]) continue;
      add(a, day, o.quantity || 1);
    }
  }
  return out;
}

export function planHTML(n) {
  if (n !== 1) return "";
  const wrap = (inner, color = "var(--ink3)") =>
    `<div id="plan${n}" class="filter-bar" style="border-top:3px solid ${color}">${inner}</div>`;
  if (PLAN.error) return wrap(`<span class="st">🎯 План / факт</span><div style="font-size:11px;color:var(--ink3);margin-top:6px">План не загрузился: ${esc(PLAN.error)}</div>`);
  if (!PLAN.ready) return wrap(`<span class="st">🎯 План / факт</span><div style="font-size:11px;color:var(--ink3);margin-top:6px">загружаем план…</div>`);

  const now = new Date(Date.now() + 3 * 3600e3);              /* московское время */
  const today = now.toISOString().slice(0, 10);
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const ym = `${y}-${String(m).padStart(2, "0")}`;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const elapsed = now.getUTCDate() - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
  const inSeason = PLAN.months.includes(m);

  const fact = factByArt();
  const groups = {};
  let pM = 0, fM = 0, pS = 0, fS = 0;
  const seasonMonths = PLAN.months.slice(0, PLAN.months.indexOf(m) + 1);   /* сен…текущий */
  for (const [a, pm] of Object.entries(PLAN.plan)) {
    const g = (groups[PLAN.group[a]] ||= { p: 0, f: 0 });
    const planM = pm[m] || 0;
    let factM = 0, factS = 0;
    for (const [d, q] of Object.entries(fact[a] || {})) {
      if (d > today) continue;
      if (d.startsWith(ym)) factM += q;
      factS += q;
    }
    g.p += planM; g.f += factM;
    pM += planM; fM += factM; fS += factS;
    if (inSeason) for (const mm of seasonMonths) pS += pm[mm] || 0;
  }
  const pSeasonAll = Object.values(PLAN.plan).reduce((s, pm) => s + PLAN.months.reduce((t, mm) => t + (pm[mm] || 0), 0), 0);

  if (!inSeason) {
    return wrap(`<span class="st">🎯 План / факт</span>
      <div style="font-size:12px;margin-top:6px">Сезон ${MSHORT[PLAN.months[0]]}–${MSHORT[PLAN.months[PLAN.months.length - 1]]}: план ${nf(pSeasonAll)} шт · сейчас вне сезона</div>`);
  }

  const fc = elapsed > 0.5 ? (fM / elapsed) * dim : null;      /* прогноз месяца */
  const fcP = fc != null ? pc(fc, pM) : null;
  const doneP = pc(fM, pM);
  const paceP = Math.min(100, (elapsed / dim) * 100);           /* где «должны быть» сегодня */
  const col = tone(fcP);

  const bar = `<div style="position:relative;height:8px;background:var(--bg2);border-radius:4px;margin:7px 0 6px;overflow:hidden">
      <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100, doneP || 0)}%;background:${col};border-radius:4px"></div>
      <div title="где должны быть сегодня по плану" style="position:absolute;top:-2px;bottom:-2px;left:${paceP}%;width:2px;background:var(--ink)"></div>
    </div>`;

  const gRows = Object.entries(groups).filter(([, g]) => g.p > 0 || g.f > 0)
    .sort((a, b) => b[1].p - a[1].p)
    .map(([name, g]) => {
      const gf = elapsed > 0.5 ? (g.f / elapsed) * dim : null;
      const gp = g.p > 0 && gf != null ? pc(gf, g.p) : null;
      return `<div style="display:flex;gap:8px;font-size:11px;padding:2px 0;border-bottom:1px solid var(--border)">
        <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name.replace(/^ТН_/, ""))}</span>
        <span style="color:var(--ink2);white-space:nowrap">${nf(g.f)} / ${g.p ? nf(g.p) : "—"}</span>
        <span style="width:44px;text-align:right;font-weight:700;color:${tone(gp)}">${gp != null ? gp + "%" : "—"}</span>
      </div>`;
    }).join("");

  return wrap(`
    <div style="display:flex;align-items:baseline;justify-content:space-between">
      <span class="st">🎯 План / факт · ${MONTH[m]}</span>
      <span style="font-size:10px;color:var(--ink3)" data-tip="Заказано штук по артикулам из плана (оба кабинета WB). Факт — отчёт по дням + живые заказы монитора за дни, которых в отчёте ещё нет. Прогноз = темп с начала месяца × дней в месяце.">заказы, шт ⓘ</span>
    </div>
    <div style="display:flex;align-items:baseline;gap:10px;margin-top:6px;flex-wrap:wrap">
      <span style="font-size:20px;font-weight:700">${nf(fM)}</span>
      <span style="font-size:12px;color:var(--ink2)">из ${nf(pM)} · ${doneP ?? "—"}%</span>
      ${fc != null ? `<span style="margin-left:auto;font-size:12px">прогноз <b style="color:${col}">${nf(fc)} · ${fcP}%</b></span>` : ""}
    </div>
    ${bar}
    <div style="font-size:11px;color:var(--ink2);margin-bottom:6px">Сезон с 1 ${MSHORT[PLAN.months[0]]}: <b>${nf(fS)}</b> из ${nf(pS)} (${pc(fS, pS) ?? "—"}%) · весь план ${nf(pSeasonAll)}</div>
    <div style="max-height:118px;overflow:auto">${gRows}</div>`, col);
}

export function repaintPlan(n) {
  const el = document.getElementById("plan" + n);
  if (el) el.outerHTML = planHTML(n);
}
