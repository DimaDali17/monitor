import { VM, CM, FP, FG, FA } from "../state.js";
import { esc, iso, q } from "../utils.js";
import { artGroup } from "../api/sheets.js";

/* Структура спроса = навигатор по заказам за период (вчера/день/неделя/месяц).
   Уровень выводится из ОБЩИХ фильтров: нет предмета → показываем предметы,
   выбран предмет → группы внутри, выбраны предмет+группа → артикулы.
   Клик по строке добавляет соответствующий общий фильтр (FP/FG/FA) — за ним
   следует весь дашборд, включая график. Ключи группировки согласованы с
   applyFilters: предмет = o.subject (WB) / первое слово name (Ozon),
   группа = artGroup.kratko, артикул = supplierArticle (WB) / offer_id (Ozon). */
export function structureHTML(n) {
  const vm = VM[n];
  if (!vm) return "";
  const mode = CM[n] || "day";
  const type = vm.isOz ? "oz" : "wb";
  const modeName = mode === "day" ? "сегодня" : mode === "yesterday" ? "вчера" : mode === "week" ? "неделя" : "месяц";

  /* Заказы за диапазон — тот же принцип, что и в графике */
  let orders;
  if (mode === "week") orders = vm.orders7 || [];
  else if (mode === "month") {
    const w = iso(Date.now() - 30 * 864e5);
    const dOf = (o) => ((type === "wb" ? o.date : o.in_process_at || o.created_at) || "").slice(0, 10);
    orders = (vm.allOrders || []).filter((o) => dOf(o) >= w);
  } else if (mode === "yesterday") orders = vm.yestO || [];
  else orders = vm.todayO || [];

  const baseOz = (oid) => { const s = oid || ""; const i = s.lastIndexOf("_"); return i > 0 ? s.slice(0, i) : s; };

  /* Текущий уровень навигации из общих фильтров */
  const lvl = FP[n].length && FG[n].length ? "art" : FP[n].length ? "grp" : "sub";
  const nextAdd = lvl === "sub" ? "addFP" : lvl === "grp" ? "addFG" : "addFA";
  const lvlName = lvl === "sub" ? "предметам" : lvl === "grp" ? "группам" : "артикулам";
  /* Ozon-артикул фильтром не изолируем (FA ждёт полный offer_id) — на этом уровне только показываем */
  const canDrill = !(lvl === "art" && type === "oz");

  /* Ключ группировки на текущем уровне (совместим с applyFilters) */
  const keyOf = (art, subj, pname) =>
    lvl === "sub" ? (type === "wb" ? (subj || "—") : ((pname || "").split(" ")[0] || "—"))
      : lvl === "grp" ? ((artGroup(art) && artGroup(art).kratko) || "— без группы —")
        : (art || "—");

  const grp = {};
  let total = 0;
  const bump = (k, qty) => { grp[k] = (grp[k] || 0) + qty; total += qty; };
  for (const o of orders) {
    if (type === "wb") bump(keyOf(o.supplierArticle || "", o.subject || o.category, null), o.quantity || 1);
    else for (const p of o.products || []) bump(keyOf(baseOz(p.offer_id), null, p.name), p.quantity || 1);
  }

  const rows = Object.entries(grp).sort((a, b) => b[1] - a[1]);
  const TOPN = 8;
  const shown = rows.length > TOPN ? rows.slice(0, TOPN) : rows;
  const rest = rows.length > TOPN ? rows.slice(TOPN).reduce((s, r) => s + r[1], 0) : 0;
  const max = shown.length ? shown[0][1] : 1;

  /* Ряд: имя | дорожка с полосой | число | % — клик добавляет общий фильтр */
  const row = (name, v) => {
    const w = Math.max(2, Math.round((v / max) * 100));
    const pct = total ? Math.round((v / total) * 100) : 0;
    const clickable = canDrill && name !== "— без группы —";
    const act = clickable ? `onclick="App.${nextAdd}(${n},'${q(name)}')"` : "";
    return `<div ${act} title="${esc(name)}${clickable ? " — раскрыть" : ""}" style="display:grid;grid-template-columns:40% 1fr 34px 30px;align-items:center;gap:10px;height:19px;font-size:11px;${clickable ? "cursor:pointer" : ""}">
      <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink2)">${esc(name)}</div>
      <div style="background:var(--bg3);border-radius:4px;height:12px">
        <div style="width:${w}%;height:100%;background:#8A8275;border-radius:4px"></div>
      </div>
      <div style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${v}</div>
      <div style="text-align:right;color:var(--ink3);font-size:10px;font-variant-numeric:tabular-nums">${pct}%</div>
    </div>`;
  };

  const bars = shown.map(([name, v]) => row(name, v)).join("");

  const restRow = rest
    ? `<div style="display:grid;grid-template-columns:40% 1fr 34px 30px;gap:10px;align-items:center;height:22px;margin-top:2px;padding-top:4px;border-top:1px solid var(--border);font-size:11px;color:var(--ink3)">
        <div>Прочее · ${rows.length - TOPN}</div><div></div>
        <div style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${rest}</div>
        <div style="text-align:right;font-variant-numeric:tabular-nums">${total ? Math.round((rest / total) * 100) : 0}%</div>
      </div>`
    : "";

  /* Крошки навигации по общим фильтрам (клик — подняться на уровень) */
  const anyFilter = FP[n].length || FG[n].length || FA[n].length;
  const crumbLink = (label, upto) => `<span onclick="App.structUp(${n},'${upto}')" style="cursor:pointer;color:var(--blue)">${esc(label)}</span>`;
  const parts = [anyFilter ? crumbLink("Все", "root") : `<span style="font-weight:600">Все</span>`];
  if (FP[n].length) parts.push(FG[n].length || FA[n].length ? crumbLink(FP[n].join(", "), "sub") : `<span style="font-weight:600">${esc(FP[n].join(", "))}</span>`);
  if (FG[n].length) parts.push(FA[n].length ? crumbLink(FG[n].join(", "), "grp") : `<span style="font-weight:600">${esc(FG[n].join(", "))}</span>`);
  if (FA[n].length) parts.push(`<span style="font-weight:600">${esc(FA[n].join(", "))}</span>`);
  const crumbs = parts.join(' <span style="color:var(--ink3)">▸</span> ');

  return `<div class="filter-bar" style="margin-bottom:0">
    <div class="sh" style="margin-bottom:6px">
      <span class="st">Структура спроса
        <span style="color:var(--ink3);font-weight:400;font-size:11px">· ${modeName} · по ${lvlName} · ${total} шт</span></span>
    </div>
    <div style="font-size:10px;margin-bottom:6px">${crumbs}${canDrill && shown.length ? `<span style="color:var(--ink3);margin-left:8px">клик по строке — глубже</span>` : ""}</div>
    <div style="max-height:230px;overflow:auto;padding-right:2px">
      ${bars || '<div class="em">Нет заказов за период</div>'}${restRow}
    </div>
  </div>`;
}
