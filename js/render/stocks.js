import { VM, SS, FS, FSZ, OA, EXS, FA } from "../state.js";
import { LIM } from "../config.js";
import { esc, q, szCmp } from "../utils.js";

/* Каркас секции. Тело таблицы рисуется отдельно — сортировка
   и раскрытие артикула перерисовывают только #stbl, а не весь экран. */
export function stocksHTML(n) {
  const vm = VM[n];
  if (!vm) return "";
  const count = Object.keys(vm.arts).length;
  const msk = vm.mskWhs.length
    ? `<span class="sm2" style="color:var(--sgp)">МСК: ${vm.mskWhs.join(", ")}</span>`
    : `<span class="sm2" style="color:var(--red)">Московские склады не найдены</span>`;

  return `<div class="sec">
    <div class="sh">
      <span class="st">Остатки по складам</span>
      <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="sm2">${count} позиций · ${vm.whList.length} складов</span>${msk}
      </span>
    </div>
    <div class="sw" id="stbl${n}">${stocksTbl(n)}</div>
  </div>`;
}

export function stocksTbl(n) {
  const vm = VM[n];
  if (!vm) return '<div class="em">Нет данных</div>';

  const { arts, whList } = vm;
  const { c, d: dir } = SS[n];
  const fa = (FS[n] || "").trim().toLowerCase();
  const fz = (FSZ[n] || "").trim().toLowerCase();

  /* Группировка по артикулу */
  const byArt = {};
  for (const v of Object.values(arts)) {
    if (fa && !v.art.toLowerCase().includes(fa) && !(v.name || "").toLowerCase().includes(fa)) continue;
    if (fz && !v.sz.toLowerCase().includes(fz)) continue;
    const g = (byArt[v.art] ||= { name: v.name, total: 0, wh: {}, sizes: [] });
    g.total += v.total;
    g.sizes.push(v);
    for (const [w, qy] of Object.entries(v.wh)) g.wh[w] = (g.wh[w] || 0) + qy;
  }

  const keys = Object.keys(byArt).sort((a, b) => {
    const va = c === "total" ? byArt[a].total : byArt[a].wh[c] || 0;
    const vb = c === "total" ? byArt[b].total : byArt[b].wh[c] || 0;
    return (va - vb) * dir;
  });

  const arrow = (k) => (SS[n].c === k ? (SS[n].d < 0 ? " ↓" : " ↑") : " ↕");
  const cls = (k) => (SS[n].c === k ? " sa" : "");
  const qc = (v, lo) => (v === 0 ? "qx" : v < lo ? "ql" : "qo");

  const whHead = whList.map((w) =>
    `<th class="${cls(w)}" data-sort style="background:var(--bg2);color:var(--ink2)" onclick="App.sortS(${n},'${q(w)}')">` +
    `<span style="font-size:8px">${esc(w.slice(0, 14))}</span>${arrow(w)}</th>`
  ).join("");

  const shown = EXS[n] ? keys : keys.slice(0, LIM);
  let rows = "";

  for (const a of shown) {
    const g = byArt[a];
    const open = OA[n].has(a) || FA[n].length > 0;
    const hasSizes = g.sizes.length > 1;
    const tog = hasSizes ? `<span class="tog">${open ? "▼" : "▶"}</span>` : '<span class="tog"> </span>';
    const cells = whList.map((w) => {
      const qy = g.wh[w] || 0;
      return `<td class="${qc(qy, 10)}" style="text-align:center">${qy || "—"}</td>`;
    }).join("");

    rows += `<tr class="ar-row"${hasSizes ? ` onclick="App.togArt(${n},'${q(a)}')"` : ""}>
      <td>${tog}<span class="art">${esc(a)}</span>
        <span style="font-size:10px;color:var(--ink3);margin-left:6px">${esc(g.name.slice(0, 22))}</span></td>
      <td class="tc ${qc(g.total, 10)}">${g.total}</td>${cells}
    </tr>`;

    if (open) {
      for (const sv of [...g.sizes].sort((x, y) => szCmp(x.sz, y.sz))) {
        const sc = whList.map((w) => {
          const qy = sv.wh[w] || 0;
          return `<td class="${qy === 0 ? "qx" : qy < 10 ? "ql" : ""}" style="text-align:center;font-size:11px">${qy || "—"}</td>`;
        }).join("");
        rows += `<tr class="sz-row">
          <td style="padding-left:28px">${esc(sv.sz)}</td>
          <td class="${qc(sv.total, 10)}" style="text-align:center;font-weight:600">${sv.total}</td>${sc}
        </tr>`;
      }
    }
  }

  const span = whList.length + 2;
  const more = keys.length > LIM
    ? `<tr class="er"><td colspan="${span}"><button class="eb" onclick="App.togExS(${n})">${EXS[n] ? "▲ Свернуть" : "▼ Все " + keys.length}</button></td></tr>`
    : "";

  return `<table>
    <thead><tr>
      <th>Артикул</th>
      <th class="${cls("total")}" data-sort style="background:var(--bg3)" onclick="App.sortS(${n},'total')">Итого${arrow("total")}</th>
      ${whHead}
    </tr></thead>
    <tbody>${rows || '<tr><td class="em" colspan="99">Ничего не найдено</td></tr>'}${more}</tbody>
  </table>`;
}
