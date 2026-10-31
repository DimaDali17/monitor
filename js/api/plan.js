import { CSV_PLAN, CSV_FACT_1, CSV_FACT_2 } from "../config.js";
import { parseCSV } from "./sheets.js";

/* ══════════════════════════════════════════════════════════
   План / факт по сезону (сен–янв).
   PLAN.plan[арт][месяц 1..12] — штук по плану (размеры сложены)
   PLAN.group[арт]             — «Кратко» из плана
   PLAN.fact[cab][арт][YYYY-MM-DD] — «Заказано, шт.» из отчёта
   PLAN.factMax[cab]           — последний день в отчёте (дальше берём живые заказы)
   Артикулы — в нижнем регистре.
   ══════════════════════════════════════════════════════════ */
export const PLAN = { ready: false, error: null, plan: {}, group: {}, months: [], fact: { 1: {}, 2: {} }, factMax: { 1: "", 2: "" }, seasonStart: "" };

let inflight = null;
const num = (s) => parseFloat(String(s || "0").replace(/\s/g, "").replace(",", ".")) || 0;

/* Начало сезона: 1 сентября текущего года (если сейчас янв–авг — прошлого) */
export function seasonStart(now = new Date()) {
  const y = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-09-01`;
}

export function loadPlan() {
  if (PLAN.ready) return Promise.resolve(PLAN);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      PLAN.seasonStart = seasonStart();
      const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error("таблица " + r.status); return r.text(); });
      const [tp, t1, t2] = await Promise.all([get(CSV_PLAN), get(CSV_FACT_1), get(CSV_FACT_2)]);

      /* План: колонки-месяцы вида «9/1/2025» — берём номер месяца (год в шапке не важен) */
      const rows = parseCSV(tp);
      const hdr = rows.length ? Object.keys(rows[0]) : [];
      const mCols = hdr.map((h) => [h, /^(\d{1,2})\/1\/\d{4}$/.exec(h)]).filter(([, m]) => m).map(([h, m]) => [h, +m[1]]);
      PLAN.months = mCols.map(([, m]) => m);
      for (const r of rows) {
        const a = (r["Артикул поставщика"] || "").trim().toLowerCase();
        if (!a) continue;
        PLAN.group[a] ||= (r["Кратко"] || "").trim() || a;
        const p = (PLAN.plan[a] ||= {});
        for (const [h, m] of mCols) p[m] = (p[m] || 0) + num(r[h]);
      }

      /* Факт: только этот сезон и только артикулы из плана — остальное не нужно */
      const from = PLAN.seasonStart;
      for (const [cab, txt] of [[1, t1], [2, t2]]) {
        for (const r of parseCSV(txt)) {
          const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(r["День"] || "");
          if (!m) continue;
          const day = `${m[3]}-${m[2]}-${m[1]}`;
          if (day > PLAN.factMax[cab]) PLAN.factMax[cab] = day;
          if (day < from) continue;
          const a = (r["Артикул поставщика"] || "").trim().toLowerCase();
          if (!PLAN.plan[a]) continue;
          const q = num(r["Заказано, шт."]);
          if (!q) continue;
          const f = (PLAN.fact[cab][a] ||= {});
          f[day] = (f[day] || 0) + q;
        }
      }
      PLAN.ready = true;
      PLAN.error = null;
    } catch (e) {
      PLAN.error = e.message;
      inflight = null;   /* можно попробовать снова */
    }
    return PLAN;
  })();
  return inflight;
}
