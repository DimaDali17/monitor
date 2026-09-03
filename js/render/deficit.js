import { VM, DS, OAD, EXD, FA } from "../state.js";
import { LIM } from "../config.js";
import { esc, q, szCmp, fmtDays, pct } from "../utils.js";
import { sheets, getBuyrate, getStocksForArt, getStocksForSz } from "../api/sheets.js";

/* ── Сводные карточки над таблицей ── */
export function deficitSummary(n) {
  const vm = VM[n];
  if (!vm) return null;

  let wb = 0, sgp = 0, raw = 0, o7 = 0;
  const seen = new Set();

  for (const [key, v] of Object.entries(vm.arts)) {
    wb += v.total;
    o7 += vm.orderMap[key] || 0;
    if (!seen.has(v.art)) {
      seen.add(v.art);
      const s = getStocksForArt(v.art);
      sgp += s.sgp; raw += s.raw;
    }
  }

  const total = wb + sgp + raw;
  const drDay = o7 / 7;
  const need30 = Math.round(drDay * 30);

  return { wb, sgp, raw, total, drDay: Math.round(drDay), need30, balance: total - need30 };
}

export function deficitHTML(n) {
  const s = deficitSummary(n);
  const cards = s ? `<div class="mg" style="grid-template-columns:repeat(4,1fr);margin-bottom:10px">
    <div class="mc" style="border-top:3px solid var(--ink)">
      <div class="ml">Общий сток</div><div class="mv">${s.total.toLocaleString("ru")}</div>
      <div class="md" style="font-size:10px;color:var(--ink3)">ВБ ${s.wb} · СГП ${s.sgp} · Сырьё ${s.raw}</div>
    </div>
    <div class="mc" style="border-top:3px solid var(--green)">
      <div class="ml">Заказов в день (7д)</div><div class="mv g">${s.drDay}</div>
    </div>
    <div class="mc" style="border-top:3px solid var(--amber)">
      <div class="ml">Потребность 30 дней</div><div class="mv a">${s.need30.toLocaleString("ru")}</div>
    </div>
    <div class="mc" style="border-top:3px solid var(--red)">
      <div class="ml">Баланс</div>
      <div class="mv" style="color:${s.balance < 0 ? "var(--red)" : "var(--green)"}">${
        s.balance < 0 ? "−" + Math.abs(s.balance).toLocaleString("ru") : "✓ +" + s.balance.toLocaleString("ru")}</div>
    </div>
  </div>` : "";

  return `<div class="sec">${cards}
    <div class="sh">
      <span class="st">📦 Дефицит · запас · стоки</span>
      <span class="sm2" style="display:flex;gap:4px;flex-wrap:wrap">
        <span class="fl2 ff" data-tip="Запаса меньше 14 дней">🔥 горит</span>
        <span class="fl2 fw" data-tip="14–30 дней">⚠️ скоро</span>
        <span class="fl2 fk" data-tip="30–90 дней">✅ норма</span>
        <span class="fl2 fd" data-tip="Больше 90 дней">💀 избыток</span>
        <button class="b" style="padding:3px 9px;font-size:10px" onclick="App.togAllSizesD(${n})" data-tip="Раскрыть все артикулы до размеров или свернуть обратно">${allSizesOpen(n) ? "▲ Свернуть размеры" : "▼ Все размеры"}</button>
        <button class="b" style="padding:3px 9px;font-size:10px" onclick="App.exportXlsx(this,'Дефицит','deficit')" data-tip="Скачать в Excel — как на экране">⤓ Excel</button>
      </span>
    </div>
    <div style="font-size:10px;color:var(--ink3);margin-bottom:8px;display:flex;gap:14px;flex-wrap:wrap">
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#A06820;margin-right:3px;vertical-align:middle"></span>ВБ — остаток на маркетплейсе</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#5B3FA0;margin-right:3px;vertical-align:middle"></span>СГП — готовая продукция</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#8B4513;margin-right:3px;vertical-align:middle"></span>Сырьё — полуфабрикаты</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#6A1B9A;border:1px dashed #CE93D8;margin-right:3px;vertical-align:middle"></span>МСК — справочно, в общий сток не входит</span>
      <span><b>×</b> — с учётом выкупаемости</span>
    </div>
    <div class="sw" id="dtbl${n}">${defTbl(n)}</div>
  </div>`;
}

/* Все ли артикулы дефицита раскрыты — от этого зависит подпись кнопки */
export function allSizesOpen(n) {
  const vm = VM[n];
  if (!vm) return false;
  const arts = new Set(Object.values(vm.arts).map((v) => v.art));
  if (!arts.size) return false;
  for (const a of arts) if (!OAD[n].has(a)) return false;
  return true;
}

/* Список всех артикулов, у которых больше одного размера — только их
   и имеет смысл раскрывать. */
export function multiSizeArts(n) {
  const vm = VM[n];
  if (!vm) return [];
  const bySz = {};
  for (const v of Object.values(vm.arts)) (bySz[v.art] ||= new Set()).add(v.sz);
  return Object.keys(bySz).filter((a) => bySz[a].size > 1);
}

/* Статус по числу дней запаса */
function statusOf(days) {
  if (days == null) return { fc: "fe", bc: "bd", bw: 0, label: "нет продаж" };
  if (days < 14) return { fc: "ff", bc: "bf", bw: Math.min(100, (days / 14) * 100), label: "🔥 " + days + "д" };
  if (days < 30) return { fc: "fw", bc: "bw", bw: Math.min(100, (days / 30) * 100), label: "⚠️ " + days + "д" };
  if (days <= 90) return { fc: "fk", bc: "bk", bw: Math.min(100, (days / 90) * 100), label: "✅ " + days + "д" };
  return { fc: "fd", bc: "bd", bw: 100, label: "💀 " + days + "д" };
}

export function defTbl(n) {
  const vm = VM[n];
  if (!vm) return '<div class="em">Нет данных</div>';

  const { arts, orderMap, mskWhs } = vm;
  const totalO7 = Object.values(orderMap).reduce((a, b) => a + b, 0);

  /* Группировка по артикулу */
  const byArt = {};
  for (const [key, v] of Object.entries(arts)) {
    const o7 = orderMap[key] || 0;
    const g = (byArt[v.art] ||= { name: v.name, stk: 0, o7: 0, msk: 0, sizes: [] });
    const msk = mskWhs.reduce((s, w) => s + (v.wh[w] || 0), 0);
    g.stk += v.total; g.o7 += o7; g.msk += msk;
    g.sizes.push({ ...v, o7, msk });
  }

  /* Размеры, которых нет в стоках WB, но есть в СГП/сырье.
     Например «42-44» живёт в маппинге, а WB отдаёт только «42» и «44». */
  for (const [mapKey] of Object.entries(sheets.map)) {
    const [wbArt, wbSz] = mapKey.split(";");
    const artName = Object.keys(byArt).find((a) => a.toLowerCase() === wbArt);
    if (!artName) continue;
    const g = byArt[artName];
    if (g.sizes.some((s) => (s.sz || "").toLowerCase() === wbSz)) continue;
    const { sgp, raw } = getStocksForSz(artName, wbSz);
    if (sgp > 0 || raw > 0) {
      g.sizes.push({ art: artName, sz: wbSz, name: g.name, total: 0, wh: {}, o7: 0, msk: 0 });
    }
  }

  /* Расчёт по артикулам */
  const rows = Object.entries(byArt).map(([art, g]) => {
    const br = getBuyrate(art);
    const { sgp, raw } = getStocksForArt(art);
    const total = g.stk + sgp + raw;
    const dr = g.o7 / 7;
    const need = Math.round(dr * 30);
    const effDr = dr * br.val;
    const dWb = effDr > 0 ? Math.round(g.stk / effDr) : null;
    return {
      art, name: g.name, sizes: g.sizes, br, sgp, raw, total, need, dr,
      msk: g.msk, stk: g.stk, o7: g.o7,
      def: Math.max(0, need - total),
      dWb,
      dAll: effDr > 0 ? Math.round(total / effDr) : null,
      dNoRaw: effDr > 0 ? Math.round((g.stk + sgp) / effDr) : null,
      dMsk: effDr > 0 ? Math.round(g.msk / effDr) : null,
      sev: dWb == null ? 99999 : dWb,
    };
  });

  const { c, d: dir } = DS[n];
  rows.sort((a, b) => {
    if (c === "art") return dir * a.art.localeCompare(b.art);
    const get = (r) => ({ stk: r.stk, o7: r.o7, need: r.need, def: r.def, days: r.sev }[c] ?? 0);
    return dir * (get(a) - get(b));
  });

  const arrow = (k) => (DS[n].c === k ? (DS[n].d > 0 ? " ↑" : " ↓") : " ↕");
  const cls = (k) => (DS[n].c === k ? " sa" : "");
  const TH = (k, label, tip, klass) =>
    `<th class="${cls(k)} ${klass}" data-sort onclick="App.sortD(${n},'${k}')" style="text-align:center" data-tip="${tip}">${label}${arrow(k)}</th>`;
  const THF = (label, tip, klass) =>
    `<th class="${klass}" style="text-align:center" data-tip="${tip}">${label}</th>`;
  const qc = (v, lo) => (v === 0 ? "qx" : v < lo ? "ql" : "qo");

  const head = `<tr>
    <th rowspan="2" data-sort style="text-align:left;vertical-align:middle;background:var(--bg3)"
        onclick="App.sortD(${n},'art')" data-tip="Артикул WB. Клик — сортировка">Артикул${arrow("art")}</th>
    <th class="th-group thg-wb">📦 Склад ВБ</th>
    <th class="th-group thg-sgp">🏭 СГП</th>
    <th class="th-group thg-raw">🧵 Сырьё</th>
    <th class="th-group thg-ref" style="border-style:dashed">* МСК</th>
    <th class="th-group thg-total">📊 Общий</th>
    <th colspan="3" class="th-group thg-need">📈 Потребность</th>
    <th colspan="2" class="th-group thg-need">⚡ Дефицит</th>
    <th colspan="4" class="th-group thg-days">⏱ Запас дней (×выкуп)</th>
  </tr>
  <tr>
    ${TH("stk", "ВБ", "Остаток на складах маркетплейса на сегодня", "th-wb")}
    ${THF("СГП", "Готовая продукция — лист Остатки сводная, артикулы с префиксом «СГП »", "th-sgp")}
    ${THF("Сырьё", "Полуфабрикаты — лист Остатки сводная. Nobrand суммируется с основным артикулом", "th-raw")}
    ${THF("МСК*", "Коледино, Тула, Электросталь, Подольск, Рязань — справочно, в общий сток не входит", "th-msk")}
    ${THF("Общий", "ВБ + СГП + Сырьё", "th-total")}
    ${TH("o7", "Зак/день", "Среднее число заказов в день за 7 дней", "th-need")}
    ${THF("Мес. потр.", "Потребность на 30 дней при текущем темпе заказов", "th-need")}
    ${THF("Доля", "Доля размера в заказах артикула / доля артикула в общих заказах", "th-need")}
    ${TH("def", "Дефицит", "Потребность 30 дней минус общий сток. ✓ — запаса хватает", "th-need")}
    ${THF("Статус", "Запас дней на ВБ с учётом выкупаемости", "th-need")}
    ${TH("days", "ВБ×", "На сколько дней хватит остатка ВБ с учётом выкупаемости", "th-days")}
    ${THF("Всё×", "На сколько дней хватит ВБ + СГП + Сырьё", "th-days")}
    ${THF("Без сырья×", "На сколько дней хватит ВБ + СГП", "th-days")}
    ${THF("МСК×", "На сколько дней хватит московского стока", "th-days")}
  </tr>`;

  const shown = EXD[n] ? rows : rows.slice(0, LIM);
  let trs = "";

  for (const r of shown) {
    const open = OAD[n].has(r.art) || FA[n].length > 0;
    const hasSizes = r.sizes.length > 1;
    const tog = hasSizes ? `<span class="tog">${open ? "▼" : "▶"}</span>` : '<span class="tog"> </span>';
    const st = statusOf(r.dWb);
    const brBadge = r.br.est
      ? `<span class="buyrate buyrate-est" data-tip="Выкупаемость не найдена — берём 70% по умолчанию">~70%</span>`
      : `<span class="buyrate buyrate-ok" data-tip="Выкупаемость из таблицы">${Math.round(r.br.val * 100)}%</span>`;

    trs += `<tr class="ar-row"${hasSizes ? ` onclick="App.togArtD(${n},'${q(r.art)}')"` : ""}>
      <td style="white-space:nowrap">${tog}<span class="art">${esc(r.art)}</span>${brBadge}<span style="font-size:10px;color:var(--ink3);margin-left:5px">${esc(r.name.slice(0, 20))}</span></td>
      <td class="${qc(r.stk, 20)}" style="text-align:center;font-size:14px">${r.stk}</td>
      <td class="${qc(r.sgp, 20)}" style="text-align:center">${r.sgp || "—"}</td>
      <td class="${qc(r.raw, 20)}" style="text-align:center">${r.raw || "—"}</td>
      <td class="td-ref" style="text-align:center">${r.msk || "—"}</td>
      <td class="${qc(r.total, 30)}" style="text-align:center;font-size:14px;font-weight:700">${r.total}</td>
      <td style="text-align:center;font-weight:600">${Math.round(r.dr)}</td>
      <td style="text-align:center;color:var(--ink2)">${r.need || "—"}</td>
      <td style="text-align:center;font-size:11px;color:var(--blue)">${pct(r.o7, totalO7)}</td>
      <td style="text-align:center;color:${r.def > 0 ? "var(--red)" : "var(--green)"};font-weight:700">${r.def > 0 ? "−" + r.def : "✓"}</td>
      <td><span class="fl2 ${st.fc}">${st.label}</span><span class="dbw"><span class="db ${st.bc}" style="width:${st.bw}%"></span></span></td>
      <td style="text-align:center">${fmtDays(r.dWb)}</td>
      <td style="text-align:center">${fmtDays(r.dAll)}</td>
      <td style="text-align:center">${fmtDays(r.dNoRaw)}</td>
      <td style="text-align:center">${fmtDays(r.dMsk)}</td>
    </tr>`;

    if (!open) continue;

    for (const s of [...r.sizes].sort((x, y) => szCmp(x.sz, y.sz))) {
      const { sgp, raw } = getStocksForSz(r.art, s.sz);
      const total = s.total + sgp + raw;
      const dr = s.o7 / 7;
      const need = Math.round(dr * 30);
      const def = Math.max(0, need - total);
      const eff = dr * r.br.val;
      const dWb = eff > 0 ? Math.round(s.total / eff) : null;
      const sst = statusOf(dWb);

      trs += `<tr class="sz-row">
        <td style="padding-left:28px;font-weight:600">${esc(s.sz)}</td>
        <td class="${qc(s.total, 10)}" style="text-align:center;font-weight:600">${s.total}</td>
        <td class="${qc(sgp, 10)}" style="text-align:center;font-size:11px;color:var(--sgp)">${sgp || "—"}</td>
        <td class="${qc(raw, 10)}" style="text-align:center;font-size:11px;color:var(--raw)">${raw || "—"}</td>
        <td class="td-ref" style="text-align:center;font-size:11px">${s.msk || "—"}</td>
        <td class="${qc(total, 15)}" style="text-align:center;font-weight:600">${total}</td>
        <td style="text-align:center;font-size:11px">${Math.round(dr)}</td>
        <td style="text-align:center;font-size:11px">${need || "—"}</td>
        <td style="text-align:center;font-size:11px;color:var(--blue)">${pct(s.o7, r.o7)}</td>
        <td style="text-align:center;font-size:11px;color:${def > 0 ? "var(--red)" : "var(--green)"}">${def > 0 ? "−" + def : "✓"}</td>
        <td><span class="fl2 ${sst.fc}" style="font-size:10px">${sst.label}</span></td>
        <td style="text-align:center;font-size:11px">${fmtDays(dWb)}</td>
        <td style="text-align:center;font-size:11px">${fmtDays(eff > 0 ? Math.round(total / eff) : null)}</td>
        <td style="text-align:center;font-size:11px">${fmtDays(eff > 0 ? Math.round((s.total + sgp) / eff) : null)}</td>
        <td style="text-align:center;font-size:11px">${fmtDays(eff > 0 ? Math.round(s.msk / eff) : null)}</td>
      </tr>`;
    }
  }

  const more = rows.length > LIM
    ? `<tr class="er"><td class="stick" colspan="16"><button class="eb" onclick="App.togExD(${n})">${EXD[n] ? "▲ Свернуть" : "▼ Все " + rows.length + " артикулов"}</button></td></tr>`
    : "";

  return `<table><thead>${head}</thead><tbody>${trs || '<tr><td class="em" colspan="16">Нет данных</td></tr>'}${more}</tbody></table>`;
}
