import { FA, FP, FG } from "../state.js";
import { getSubjects, getArts, getGroups } from "../vm.js";
import { esc, q } from "../utils.js";

export function filterHTML(n) {
  const subjChips = FP[n].map((s, i) =>
    `<span class="chip" style="background:var(--blue)">${esc(s)}<span class="cx" onclick="App.rmFP(${n},${i})">×</span></span>`
  ).join("");

  const artChips = FA[n].map((a, i) =>
    `<span class="chip">${esc(a)}<span class="cx" onclick="App.rmFA(${n},${i})">×</span></span>`
  ).join("");

  const groupChips = FG[n].map((g, i) =>
    `<span class="chip" style="background:#8064A2">${esc(g)}<span class="cx" onclick="App.rmFG(${n},${i})">×</span></span>`
  ).join("");

  const clear = (FA[n].length || FP[n].length || FG[n].length)
    ? `<button class="eb" style="margin-top:4px" onclick="App.clearFilters(${n})">✕ Очистить фильтры</button>`
    : "";

  return `<div class="filter-bar">
    <div class="filter-row">
      <span class="filter-label">📁 Предмет</span>
      <div class="fb" style="flex:1">
        ${subjChips}
        <input id="fpi${n}" placeholder="${FP[n].length ? "+ ещё предмет…" : "все предметы…"}"
               oninput="App.fpInput(${n})" onfocus="App.fpInput(${n})" autocomplete="off">
        <div class="ddrop" id="fpdd${n}"></div>
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">🏷️ Группа</span>
      <div class="fb" style="flex:1">
        ${groupChips}
        <input id="fgi${n}" placeholder="${FG[n].length ? "+ ещё группа…" : "все группы…"}"
               oninput="App.fgInput(${n})" onfocus="App.fgInput(${n})" autocomplete="off">
        <div class="ddrop" id="fgdd${n}"></div>
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">🔖 Артикул</span>
      <div class="fb" style="flex:1">
        ${artChips}
        <input id="fai${n}" placeholder="${FA[n].length ? "+ ещё артикул…" : "все артикулы…"}"
               oninput="App.faInput(${n})" onfocus="App.faInput(${n})" autocomplete="off">
        <div class="ddrop" id="fdd${n}"></div>
      </div>
    </div>
    ${clear}
  </div>`;
}

function suggest(n, inputId, dropId, all, chosen, addFn) {
  const inp = document.getElementById(inputId);
  const dd = document.getElementById(dropId);
  if (!inp || !dd) return;

  const query = (inp.value || "").toLowerCase().trim();
  if (!query) { dd.classList.remove("show"); dd.innerHTML = ""; return; }

  const hits = all.filter((a) => a.toLowerCase().includes(query) && !chosen.includes(a)).slice(0, 12);
  if (!hits.length) { dd.classList.remove("show"); return; }

  dd.innerHTML = hits.map((a) => `<div onclick="App.${addFn}(${n},'${q(a)}')">${esc(a)}</div>`).join("");
  dd.classList.add("show");
}

export const fpInput = (n) => suggest(n, "fpi" + n, "fpdd" + n, getSubjects(n), FP[n], "addFP");
export const faInput = (n) => suggest(n, "fai" + n, "fdd" + n, getArts(n), FA[n], "addFA");
export const fgInput = (n) => suggest(n, "fgi" + n, "fgdd" + n, getGroups(n), FG[n], "addFG");

/* Клик вне выпадашки — закрыть */
document.addEventListener("click", (e) => {
  if (!e.target.closest(".fb")) {
    document.querySelectorAll(".ddrop").forEach((d) => d.classList.remove("show"));
  }
});
