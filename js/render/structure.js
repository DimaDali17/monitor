import { VM, CM, GB, FP, FG, FA } from "../state.js";
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

  /* Уровень среза выбирается переключателем Предмет/Группа/Артикул (GB), а не выводится
     из фильтров. Фильтры FP/FG/FA — это ОБЛАСТЬ (scope): клик по строке добавляет фильтр
     и опускает уровень на шаг (drill), а весь дашборд следует за фильтрами. */
  const lvl = GB[n] || "sub";
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
  const shown = rows;                                  /* показываем всё — без «Прочее» */
  const max = shown.length ? shown[0][1] : 1;

  /* Ряд: имя | дорожка с полосой | число | % — клик добавляет общий фильтр */
  const row = (name, v) => {
    const w = Math.max(2, Math.round((v / max) * 100));
    const pct = total ? Math.round((v / total) * 100) : 0;
    const clickable = canDrill && name !== "— без группы —";
    const act = clickable ? `onclick="App.structDrill(${n},'${q(name)}')"` : "";
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

  /* Переключатель периода — над структурой, т.к. он влияет на неё (и на график) */
  const onp = (k) => (mode === k ? "on" : "");
  const periodTog = `<span class="ctog">
      <button class="${onp("day")}" onclick="App.setChartMode(${n},'day')">День</button>
      <button class="${onp("yesterday")}" onclick="App.setChartMode(${n},'yesterday')">Вчера</button>
      <button class="${onp("week")}" onclick="App.setChartMode(${n},'week')">Неделя</button>
      <button class="${onp("month")}" onclick="App.setChartMode(${n},'month')">Месяц</button>
    </span>`;

  /* Срез Предмет/Группа/Артикул — прямой выбор уровня (влияет и на график) */
  const onl = (k) => (lvl === k ? "on" : "");
  const levelTog = `<span class="ctog">
      <button class="${onl("sub")}" onclick="App.setGroupBy(${n},'sub')">Предмет</button>
      <button class="${onl("grp")}" onclick="App.setGroupBy(${n},'grp')">Группа</button>
      <button class="${onl("art")}" onclick="App.setGroupBy(${n},'art')">Артикул</button>
    </span>`;

  /* Крошки навигации по общим фильтрам (клик — подняться на уровень) */
  const anyFilter = FP[n].length || FG[n].length || FA[n].length;
  const crumbLink = (label, upto) => `<span onclick="App.structUp(${n},'${upto}')" style="cursor:pointer;color:var(--blue)">${esc(label)}</span>`;
  const parts = [anyFilter ? crumbLink("Все", "root") : `<span style="font-weight:600">Все</span>`];
  if (FP[n].length) parts.push(FG[n].length || FA[n].length ? crumbLink(FP[n].join(", "), "sub") : `<span style="font-weight:600">${esc(FP[n].join(", "))}</span>`);
  if (FG[n].length) parts.push(FA[n].length ? crumbLink(FG[n].join(", "), "grp") : `<span style="font-weight:600">${esc(FG[n].join(", "))}</span>`);
  if (FA[n].length) parts.push(`<span style="font-weight:600">${esc(FA[n].join(", "))}</span>`);
  const crumbs = parts.join(' <span style="color:var(--ink3)">▸</span> ');

  return `<div class="filter-bar" style="margin-bottom:0">
    <div class="sh" style="margin-bottom:6px;flex-wrap:wrap;gap:6px">
      <span class="st">Структура спроса
        <span style="color:var(--ink3);font-weight:400;font-size:11px">· по ${lvlName} · ${total} шт</span></span>
      ${periodTog}
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      ${levelTog}
      <span style="font-size:10px;min-width:0">${crumbs}${canDrill && shown.length ? `<span style="color:var(--ink3);margin-left:6px">клик — глубже</span>` : ""}</span>
    </div>
    <div style="max-height:230px;overflow:auto;padding-right:2px">
      ${bars || '<div class="em">Нет заказов за период</div>'}
    </div>
  </div>`;
}
