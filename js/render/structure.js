import { VM, CM, GB } from "../state.js";
import { esc, iso } from "../utils.js";
import { artGroup } from "../api/sheets.js";

/* Структура спроса за выбранный диапазон (день/неделя/месяц — как у графика),
   заказы (штуки) сгруппированы по Предмету или по Кратко-группе.
   Переключатель Предмет/Группа — GB[n]. */
export function structureHTML(n) {
  const vm = VM[n];
  if (!vm) return "";
  const mode = CM[n] || "day";
  const level = GB[n] || "predmet";
  const type = vm.isOz ? "oz" : "wb";
  const modeName = mode === "day" ? "сегодня" : mode === "week" ? "неделя" : "месяц";

  /* Заказы за диапазон — тот же принцип, что и в графике */
  let orders;
  if (mode === "week") orders = vm.orders7 || [];
  else if (mode === "month") {
    const w = iso(Date.now() - 30 * 864e5);
    const dOf = (o) => ((type === "wb" ? o.date : o.in_process_at || o.created_at) || "").slice(0, 10);
    orders = (vm.allOrders || []).filter((o) => dOf(o) >= w);
  } else orders = vm.todayO || [];

  /* Артикул поставщика: WB — supplierArticle; Ozon — база offer_id до последнего "_" */
  const baseOz = (oid) => {
    const s = oid || "";
    const i = s.lastIndexOf("_");
    return i > 0 ? s.slice(0, i) : s;
  };

  const grp = {};
  let total = 0;
  const add = (art, qty) => {
    const g = artGroup(art);
    const key = (level === "kratko" ? (g && g.kratko) : (g && g.predmet)) || "— без группы —";
    grp[key] = (grp[key] || 0) + qty;
    total += qty;
  };
  for (const o of orders) {
    if (type === "wb") add(o.supplierArticle || "", o.quantity || 1);
    else for (const p of o.products || []) add(baseOz(p.offer_id), p.quantity || 1);
  }

  const rows = Object.entries(grp).sort((a, b) => b[1] - a[1]);
  const TOPN = 12;
  const shown = rows.length > TOPN ? rows.slice(0, TOPN) : rows;
  const rest = rows.length > TOPN ? rows.slice(TOPN).reduce((s, r) => s + r[1], 0) : 0;
  const max = shown.length ? shown[0][1] : 1;

  /* Ряд: имя | дорожка с полосой | число | % — четыре выровненные колонки */
  const row = (name, v) => {
    const w = Math.max(2, Math.round((v / max) * 100));
    const pct = total ? Math.round((v / total) * 100) : 0;
    return `<div style="display:grid;grid-template-columns:38% 1fr 40px 32px;align-items:center;gap:10px;height:22px;font-size:12px">
      <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink2)" title="${esc(name)}">${esc(name)}</div>
      <div style="background:var(--bg3);border-radius:4px;height:12px">
        <div style="width:${w}%;height:100%;background:#8A8275;border-radius:4px"></div>
      </div>
      <div style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${v}</div>
      <div style="text-align:right;color:var(--ink3);font-size:10px;font-variant-numeric:tabular-nums">${pct}%</div>
    </div>`;
  };

  const bars = shown.map(([name, v]) => row(name, v)).join("");

  const restRow = rest
    ? `<div style="display:grid;grid-template-columns:38% 1fr 40px 32px;gap:10px;align-items:center;height:22px;margin-top:2px;padding-top:4px;border-top:1px solid var(--border);font-size:11px;color:var(--ink3)">
        <div>Прочее · ${rows.length - TOPN} групп</div><div></div>
        <div style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${rest}</div>
        <div style="text-align:right;font-variant-numeric:tabular-nums">${total ? Math.round((rest / total) * 100) : 0}%</div>
      </div>`
    : "";

  const seg = (val, label) =>
    `<button class="${GB[n] === val ? "on" : ""}" onclick="App.setGroupBy(${n},'${val}')">${label}</button>`;

  return `<div class="sec" style="margin-bottom:0">
    <div class="sh" style="margin-bottom:8px">
      <span class="st">Структура спроса
        <span style="color:var(--ink3);font-weight:400;font-size:11px">· ${modeName} · ${total} шт</span></span>
      <span class="ctog">${seg("predmet", "Предмет")}${seg("kratko", "Группа")}</span>
    </div>
    <div style="max-height:296px;overflow:auto;padding-right:2px">
      ${bars || '<div class="em">Нет заказов за период</div>'}${restRow}
    </div>
  </div>`;
}
