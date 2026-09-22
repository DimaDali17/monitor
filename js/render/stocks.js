import { VM, SS, FSS, FS, FSZ, OA, EXS, EXFS, FA } from "../state.js";
import { LIM } from "../config.js";
import { esc, q, szCmp } from "../utils.js";
import { getStocksForArt } from "../api/sheets.js";

/* Каркас секции. Тело таблицы рисуется отдельно — сортировка
   и раскрытие артикула перерисовывают только #stbl, а не весь экран. */
export function stocksHTML(n) {
  const vm = VM[n];
  if (!vm) return "";
  const count = Object.keys(vm.arts).length;
  const fbsWhCount = Object.keys(vm.fbsWh || {}).length;
  const whCount = vm.whList.length + fbsWhCount;
  const msk = vm.mskWhs.length
    ? `<span class="sm2" style="color:var(--sgp)">МСК: ${vm.mskWhs.join(", ")}</span>`
    : "";
  const fbsNote = fbsWhCount
    ? `<span class="sm2" style="color:#8B4513">FBS: ${fbsWhCount} скл.</span>`
    : "";

  return `<div class="sec">
    <div class="sh">
      <span class="st">Остатки по складам</span>
      <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="sm2">${count} позиций · ${whCount} складов</span>${fbsNote}${msk}
        <button class="b" style="padding:3px 9px;font-size:10px" onclick="App.exportXlsx(this,'Остатки','ostatki')" data-tip="Скачать в Excel — как на экране">⤓ Excel</button>
      </span>
    </div>
    <div class="sw" id="stbl${n}">${stocksTbl(n)}</div>
  </div>`;
}

export function stocksTbl(n) {
  const vm = VM[n];
  if (!vm) return '<div class="em">Нет данных</div>';

  const { arts, whList } = vm;
  const fbsCells = vm.fbsCells || {};
  /* FBS-склады продавца — отдельные колонки справа, справочно, но в «Итого» входят */
  const fbsWhList = Object.keys(vm.fbsWh || {}).sort((a, b) => (vm.fbsWh[b] || 0) - (vm.fbsWh[a] || 0));

  const { c, d: dir } = SS[n];
  const fa = (FS[n] || "").trim().toLowerCase();
  const fz = (FSZ[n] || "").trim().toLowerCase();

  /* Группировка по артикулу */
  const byArt = {};
  for (const v of Object.values(arts)) {
    if (fa && !v.art.toLowerCase().includes(fa) && !(v.name || "").toLowerCase().includes(fa)) continue;
    if (fz && !v.sz.toLowerCase().includes(fz)) continue;
    const g = (byArt[v.art] ||= { name: v.name, total: 0, wh: {}, fbsWh: {}, sizes: [] });
    g.total += v.total;
    g.sizes.push(v);
    for (const [w, qy] of Object.entries(v.wh)) g.wh[w] = (g.wh[w] || 0) + qy;
    /* FBS для этого артикул·размера */
    const fc = fbsCells[v.art + " · " + v.sz] || {};
    for (const [w, qy] of Object.entries(fc)) { g.fbsWh[w] = (g.fbsWh[w] || 0) + qy; g.total += qy; }
  }

  const getSort = (o) => (c === "total" ? o.total : (o.wh[c] ?? o.fbsWh[c] ?? 0));
  const keys = Object.keys(byArt).sort((a, b) =>
    c === "art" ? a.localeCompare(b) * dir : (getSort(byArt[a]) - getSort(byArt[b])) * dir);

  const arrow = (k) => (SS[n].c === k ? (SS[n].d < 0 ? " ↓" : " ↑") : " ↕");
  const cls = (k) => (SS[n].c === k ? " sa" : "");
  const qc = (v, lo) => (v === 0 ? "qx" : v < lo ? "ql" : "qo");

  const whHead = whList.map((w) =>
    `<th class="${cls(w)}" data-sort style="background:var(--bg2);color:var(--ink2)" onclick="App.sortS(${n},'${q(w)}')">` +
    `<span style="font-size:8px">${esc(w.slice(0, 14))}</span>${arrow(w)}</th>`
  ).join("");

  const fbsHead = fbsWhList.map((w) =>
    `<th class="${cls(w)}" data-sort style="background:#FBE9E7;color:#8B4513" onclick="App.sortS(${n},'${q(w)}')" data-tip="FBS-склад продавца: ${esc(w)}">` +
    `<span style="font-size:8px">FBS·${esc(w)}</span>${arrow(w)}</th>`
  ).join("");

  const shown = EXS[n] ? keys : keys.slice(0, LIM);
  let rows = "";

  for (const a of shown) {
    const g = byArt[a];
    const open = OA[n].has(a);
    const hasSizes = g.sizes.length > 1;
    const tog = hasSizes ? `<span class="tog">${open ? "▼" : "▶"}</span>` : '<span class="tog"> </span>';

    const cells = whList.map((w) => {
      const qy = g.wh[w] || 0;
      return `<td class="${qc(qy, 10)}" style="text-align:center">${qy || "—"}</td>`;
    }).join("");
    const cellsF = fbsWhList.map((w) => {
      const qy = g.fbsWh[w] || 0;
      return `<td class="${qy === 0 ? "qx" : ""}" style="text-align:center;color:#8B4513">${qy || "—"}</td>`;
    }).join("");

    rows += `<tr class="ar-row"${hasSizes ? ` onclick="App.togArt(${n},'${q(a)}')"` : ""}>
      <td style="white-space:nowrap">${tog}<span class="art">${esc(a)}</span><span style="font-size:10px;color:var(--ink3);margin-left:6px">${esc(g.name.slice(0, 22))}</span></td>
      <td class="tc ${qc(g.total, 10)}">${g.total}</td>${cells}${cellsF}
    </tr>`;

    if (open) {
      for (const sv of [...g.sizes].sort((x, y) => szCmp(x.sz, y.sz))) {
        const fc = fbsCells[a + " · " + sv.sz] || {};
        const szFbs = Object.values(fc).reduce((s, x) => s + x, 0);
        const sc = whList.map((w) => {
          const qy = sv.wh[w] || 0;
          return `<td class="${qy === 0 ? "qx" : qy < 10 ? "ql" : ""}" style="text-align:center;font-size:11px">${qy || "—"}</td>`;
        }).join("");
        const scF = fbsWhList.map((w) => {
          const qy = fc[w] || 0;
          return `<td class="${qy === 0 ? "qx" : ""}" style="text-align:center;font-size:11px;color:#8B4513">${qy || "—"}</td>`;
        }).join("");
        rows += `<tr class="sz-row">
          <td style="padding-left:28px">${esc(sv.sz)}</td>
          <td class="${qc(sv.total + szFbs, 10)}" style="text-align:center;font-weight:600">${sv.total + szFbs}</td>${sc}${scF}
        </tr>`;
      }
    }
  }

  const span = whList.length + fbsWhList.length + 2;
  const more = keys.length > LIM
    ? `<tr class="er"><td class="stick" colspan="${span}"><button class="eb" onclick="App.togExS(${n})">${EXS[n] ? "▲ Свернуть" : "▼ Все " + keys.length}</button></td></tr>`
    : "";

  return `<table>
    <thead><tr>
      <th class="${cls('art')}" data-sort style="text-align:left" onclick="App.sortS(${n},'art')">Артикул${arrow('art')}</th>
      <th class="${cls("total")}" data-sort style="background:var(--bg3)" onclick="App.sortS(${n},'total')">Итого${arrow("total")}</th>
      ${whHead}${fbsHead}
    </tr></thead>
    <tbody>${rows || '<tr><td class="em" colspan="99">Ничего не найдено</td></tr>'}${more}</tbody>
  </table>`;
}

/* ══════════ Остатки по FBS (отдельный блок) ══════════
   Артикул · Сырьё+СГП · FBS общий · FBS по складам (колонки).
   Каркас + тело: сортировка перерисовывает только #fbstbl, как и в остальных таблицах. */
export function fbsStocksHTML(n) {
  const vm = VM[n];
  if (!vm) return "";
  const fbsMap = vm.fbs || {};
  if (!Object.keys(fbsMap).length) return "";          /* нет FBS-данных — блок не показываем */

  const whCount = Object.keys(vm.fbsWh || {}).length;
  const posCount = new Set(Object.keys(fbsMap).map((k) => k.split(" · ")[0].toLowerCase())).size;

  return `<div class="sec">
    <div class="sh">
      <span class="st">Остатки по FBS</span>
      <span style="display:flex;align-items:center;gap:8px">
        <span class="sm2">${posCount} позиций · ${whCount} складов</span>
        <button class="b" style="padding:3px 9px;font-size:10px" onclick="App.exportXlsx(this,'FBS','fbs')" data-tip="Скачать в Excel — как на экране">⤓ Excel</button>
      </span>
    </div>
    <div class="sw" id="fbstbl${n}">${fbsStocksTbl(n)}</div>
  </div>`;
}

export function fbsStocksTbl(n) {
  const vm = VM[n];
  if (!vm) return '<div class="em">Нет данных</div>';
  const fbsMap = vm.fbs || {};
  const fbsCells = vm.fbsCells || {};

  const whList = Object.keys(vm.fbsWh || {}).sort((a, b) => (vm.fbsWh[b] || 0) - (vm.fbsWh[a] || 0));

  const byArt = {};
  const add = (art) => (byArt[(art || "").toLowerCase()] ||= { art, fbs: 0, wh: {} });
  for (const [k, v] of Object.entries(fbsMap)) { const g = add(k.split(" · ")[0]); g.art = k.split(" · ")[0]; g.fbs += v; }
  for (const [k, wm] of Object.entries(fbsCells)) { const g = add(k.split(" · ")[0]); for (const [w, qy] of Object.entries(wm)) g.wh[w] = (g.wh[w] || 0) + qy; }

  const rows = Object.values(byArt).map((g) => {
    const s = getStocksForArt(g.art);
    return { art: g.art, base: s.sgp + s.raw, fbs: g.fbs, wh: g.wh };
  });

  /* Сортировка по любому заголовку: артикул (строка), Сырьё+СГП, FBS общий и любой склад (числа). */
  const { c, d: dir } = FSS[n];
  const keyOf = (r) => (c === "base" ? r.base : c === "fbs" ? r.fbs : (r.wh[c] || 0));
  rows.sort((a, b) =>
    c === "art" ? a.art.localeCompare(b.art) * dir : (keyOf(a) - keyOf(b)) * dir);

  const arrow = (k) => (FSS[n].c === k ? (FSS[n].d < 0 ? " ↓" : " ↑") : " ↕");
  const cls = (k) => (FSS[n].c === k ? " sa" : "");

  const whHead = whList.map((w) =>
    `<th class="${cls(w)}" data-sort style="text-align:center;background:#FBE9E7;color:#8B4513" onclick="App.sortFS(${n},'${q(w)}')" data-tip="FBS-склад продавца: ${esc(w)}">` +
    `<span style="font-size:9px">${esc(w)}</span>${arrow(w)}</th>`).join("");

  /* Свёрнуто до LIM строк, ниже — кнопка «Все N / Свернуть» (как в «Остатки по складам»). */
  const shown = EXFS[n] ? rows : rows.slice(0, LIM);
  const body = shown.map((r) => {
    const over = !vm.isOz && r.fbs > r.base;
    const cells = whList.map((w) => { const qy = r.wh[w] || 0; return `<td style="text-align:center;font-size:11px;color:#8B4513">${qy || "—"}</td>`; }).join("");
    return `<tr>
      <td style="white-space:nowrap"><span class="art">${esc(r.art)}</span></td>
      <td style="text-align:center">${r.base || "—"}</td>
      <td class="tc" style="text-align:center;font-weight:700;${over ? "color:#B3261E" : ""}">${r.fbs}${over ? ` <span style="cursor:help" data-tip="FBS (${r.fbs}) больше, чем Сырьё+СГП (${r.base}) — возможно завышен">❗</span>` : ""}</td>
      ${cells}
    </tr>`;
  }).join("");

  const span = whList.length + 3;
  const more = rows.length > LIM
    ? `<tr class="er"><td class="stick" colspan="${span}"><button class="eb" onclick="App.togExFS(${n})">${EXFS[n] ? "▲ Свернуть" : "▼ Все " + rows.length}</button></td></tr>`
    : "";

  return `<table>
    <thead><tr>
      <th class="${cls('art')}" data-sort style="text-align:left" onclick="App.sortFS(${n},'art')">Артикул${arrow('art')}</th>
      <th class="${cls('base')}" data-sort style="text-align:center" onclick="App.sortFS(${n},'base')" data-tip="Сырьё (в наборах) + СГП — реальное наличие">Сырьё+СГП${arrow('base')}</th>
      <th class="${cls('fbs')}" data-sort style="text-align:center" onclick="App.sortFS(${n},'fbs')" data-tip="Остаток FBS по всем вашим складам">FBS общий${arrow('fbs')}</th>
      ${whHead}
    </tr></thead>
    <tbody>${body || '<tr><td class="em" colspan="99">Нет FBS-остатков</td></tr>'}${more}</tbody>
  </table>`;
}
