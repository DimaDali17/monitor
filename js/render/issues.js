import { D, cabName } from "../state.js";
import { sheets } from "../api/sheets.js";
import { esc } from "../utils.js";

/* Что не загрузилось у кабинета: проблемы самого кабинета + справочники Google. */
export function issuesOf(n) {
  const list = [...((D[n] && D[n].issues) || [])];
  if (sheets.error) list.unshift({
    what: "Справочники Google (СГП, сырьё, выкупаемость, сезон)",
    why: sheets.error,
    effect: "СГП/сырьё/сезон пустые, выкупаемость ~70%",
  });
  return list;
}

/* Плашка «Загрузилось не всё» + кнопка повторной загрузки (в обход кэша). */
export function issuesHTML(n, compact) {
  const list = issuesOf(n);
  if (!list.length) return "";
  const items = list.map((i) =>
    `<li style="margin:2px 0"><b>${esc(i.what)}</b>${i.effect ? ` — ${esc(i.effect)}` : ""}` +
    `<span style="color:var(--ink3);font-size:11px"> (${esc(String(i.why || "").slice(0, 160))})</span></li>`).join("");
  return `<div role="alert" style="background:#FDECEA;border:1px solid #E8A39B;border-left:4px solid #B3261E;border-radius:10px;
      padding:10px 14px;margin-bottom:14px;font-size:12px;color:#5A1D17;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:1 1 320px;min-width:0">
      <div style="font-weight:700;font-size:13px;margin-bottom:4px">⚠ ${compact ? esc(cabName(n)) + ": з" : "З"}агрузилось не всё — часть цифр может быть неполной</div>
      <ul style="margin:0;padding-left:18px">${items}</ul>
    </div>
    <button class="loadbtn" style="margin:0;padding:7px 16px;font-size:11px;background:#B3261E;white-space:nowrap"
      onclick="App.reload(${n})" data-tip="Перезагрузить кабинет. Удачные части берутся из кэша (без лишних запросов к WB), то, что не загрузилось, запрашивается заново">↻ Обновить ещё раз</button>
  </div>`;
}
