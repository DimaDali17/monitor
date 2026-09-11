import { CM, CV, CD } from "../state.js";
import { wbPrice, ozRev, iso, esc, q } from "../utils.js";
import { artGroup } from "../api/sheets.js";

/* Контрастная палитра под топ-5 категорий + серый для «Прочее» */
const PAL = ["#C0504D", "#4F81BD", "#9BBB59", "#8064A2", "#E0A030"];
const OTHER = "#B8B2A7";
const BAR = "#6B6357", FUT = "#E8E4DC";

export function chartHTML(n, vm, type) {
  if (!vm) return "";
  const mode = CM[n] || "day";
  const isRev = (CV[n] || "ord") === "rev";
  const nowH = new Date().getHours();
  const cd = CD[n] || { deep: false };

  const dateOf = (o) => {
    const dt = type === "wb" ? o.date : o.in_process_at || o.created_at;
    return dt ? dt.slice(0, 10) : "";
  };
  const hourOf = (o) => {
    const dt = type === "wb" ? o.date : o.in_process_at || o.created_at;
    return dt ? new Date(dt).getHours() : 0;
  };
  const price = type === "wb" ? wbPrice : ozRev;
  const fv = (v) => (isRev ? (v >= 1000 ? Math.round(v / 1000) + "к" : Math.round(v)) : Math.round(v));

  /* ── Шкала интервалов: дни/часы + функция «дата заказа → индекс» ── */
  let labels = [], idxOf, N;
  if (mode === "day") {
    for (let i = 0; i < 24; i++) labels.push(i % 3 === 0 ? i + ":00" : "");
    N = 24;
    idxOf = (o) => hourOf(o);
  } else {
    const span = mode === "week" ? 7 : 30;
    const days = [];
    for (let i = span - 1; i >= 0; i--) days.push(iso(Date.now() - i * 864e5));
    const pos = {};
    days.forEach((d, i) => (pos[d] = i));
    const every = mode === "month" ? 3 : 1;
    labels = days.map((d, i) => i % every === 0
      ? new Date(d + "T12:00:00").toLocaleDateString("ru", { day: "numeric", month: "short" }).replace(".", "")
      : "");
    N = span;
    idxOf = (o) => { const d = dateOf(o); return d in pos ? pos[d] : -1; };
  }

  const ordersFor = () => (mode === "day" ? (vm.todayO || []) : (vm.allOrders || []));

  const W = 700, H = 155, L = 38, R = 10, T = 13, B = 20;
  const cW = W - L - R, cH = H - T - B;
  const gW = cW / N;

  /* Оси Y + сетка (общее для обоих режимов) */
  const axis = (max) => {
    let out = "";
    [0, Math.round(max / 2), max].forEach((v) => {
      const y = T + cH - (v / max) * cH;
      out += `<text x="${L - 3}" y="${y + 3}" text-anchor="end" font-size="7" fill="var(--ink3)">${fv(v)}</text>` +
        `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
    });
    return out;
  };
  const xLabels = () => {
    let out = "";
    const step = mode === "day" ? 3 : 1;
    for (let i = 0; i < N; i += step) {
      if (!labels[i]) continue;
      const fs = mode === "day" ? 8 : mode === "month" ? 7 : 9;
      out += `<text x="${L + i * gW + gW / 2}" y="${H - 4}" text-anchor="middle" font-size="${fs}" fill="var(--ink3)">${labels[i]}</text>`;
    }
    return out;
  };

  const on = (v, k) => (v === k ? "on" : "");
  const modeName = mode === "day" ? "день" : mode === "week" ? "неделя" : "месяц";
  const controls = `<span style="display:flex;align-items:center;gap:8px">
      <span class="ctog">
        <button class="${cd.deep ? "" : "on"}" onclick="App.chartDeep(${n},false)">Обычный</button>
        <button class="${cd.deep ? "on" : ""}" onclick="App.chartDeep(${n},true)">Глубже</button>
      </span>
      <span class="ctog">
        <button class="${on(CV[n], "ord")}" onclick="App.setChartVal(${n},'ord')">Шт</button>
        <button class="${on(CV[n], "rev")}" onclick="App.setChartVal(${n},'rev')">₽</button>
      </span>
      <span class="ctog">
        <button class="${on(mode, "day")}" onclick="App.setChartMode(${n},'day')">День</button>
        <button class="${on(mode, "week")}" onclick="App.setChartMode(${n},'week')">Неделя</button>
        <button class="${on(mode, "month")}" onclick="App.setChartMode(${n},'month')">Месяц</button>
      </span>
    </span>`;

  /* ══════════ ОБЫЧНЫЙ режим — один нейтральный столбик ══════════ */
  if (!cd.deep) {
    const cur = Array(N).fill(0);
    ordersFor().forEach((o) => {
      const i = idxOf(o);
      if (i >= 0) cur[i] += isRev ? price(o) : (type === "wb" ? (o.quantity || 1) : (o.products || []).reduce((s, p) => s + (p.quantity || 1), 0));
    });
    const max = Math.max(...cur, 1);
    const bW = Math.max(2, Math.floor(gW * 0.55));
    const lblFs = mode === "month" ? 6 : 7;
    let bars = "";
    for (let i = 0; i < N; i++) {
      const bH = (cur[i] / max) * cH, bx = L + i * gW + (gW - bW) / 2, by = T + cH - bH;
      const future = mode === "day" && i > nowH;
      bars += `<rect x="${bx}" y="${by}" width="${bW}" height="${bH}" rx="2" fill="${future ? FUT : BAR}" opacity=".9"/>`;
      if (cur[i] > 0) bars += `<text x="${bx + bW / 2}" y="${by - 3}" text-anchor="middle" font-size="${lblFs}" fill="var(--ink)" font-weight="600">${fv(cur[i])}</text>`;
    }
    return `<div class="sec" style="margin-bottom:14px">
      <div class="sh"><span class="st">${isRev ? "Выручка" : "Заказы"} · ${modeName}</span>${controls}</div>
      <div class="tw" style="padding:8px">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${axis(max)}${bars}${xLabels()}</svg>
      </div>
    </div>`;
  }

  /* ══════════ ГЛУБЖЕ — стек по уровням ══════════ */
  const level = cd.group ? 3 : cd.predmet ? 2 : 1;

  /* Классификация заказа: {predmet, group, art} + значение (шт/₽) */
  const baseOz = (oid) => { const s = oid || ""; const i = s.lastIndexOf("_"); return i > 0 ? s.slice(0, i) : s; };
  const classify = [];
  ordersFor().forEach((o) => {
    const i = idxOf(o);
    if (i < 0) return;
    if (type === "wb") {
      const art = o.supplierArticle || "—";
      const g = artGroup(art);
      classify.push({ i, predmet: (g && g.predmet) || o.subject || o.category || "—", group: (g && g.kratko) || "— без группы —", art, val: isRev ? price(o) : (o.quantity || 1) });
    } else {
      const items = o.products || [];
      const tot = items.reduce((s, p) => s + (p.quantity || 1), 0) || 1;
      const orev = price(o);
      for (const p of items) {
        const art = baseOz(p.offer_id);
        const g = artGroup(art);
        const qy = p.quantity || 1;
        classify.push({ i, predmet: (g && g.predmet) || (p.name || "").split(" ")[0] || "—", group: (g && g.kratko) || "— без группы —", art: art || "—", val: isRev ? orev * (qy / tot) : qy });
      }
    }
  });

  /* Фокус текущего drill + выбор поля категории */
  const ev = classify.filter((e) =>
    (!cd.predmet || e.predmet === cd.predmet) && (!cd.group || e.group === cd.group));
  const catOf = (e) => (level === 1 ? e.predmet : level === 2 ? e.group : e.art);

  /* Тотал по категориям → топ-5, остальное в «Прочее» */
  const catTotal = {};
  ev.forEach((e) => { catTotal[catOf(e)] = (catTotal[catOf(e)] || 0) + e.val; });
  const ranked = Object.keys(catTotal).sort((a, b) => catTotal[b] - catTotal[a]);
  const top = ranked.slice(0, 5);
  const topSet = new Set(top);
  const hasOther = ranked.length > 5;

  /* per-категория по интервалам */
  const per = {}; [...top, ...(hasOther ? ["Прочее"] : [])].forEach((k) => (per[k] = Array(N).fill(0)));
  ev.forEach((e) => { const k = topSet.has(catOf(e)) ? catOf(e) : "Прочее"; per[k][e.i] += e.val; });

  const segOrder = [...top, ...(hasOther ? ["Прочее"] : [])];
  const colorOf = (seg) => (seg === "Прочее" ? OTHER : PAL[top.indexOf(seg) % PAL.length]);
  const dim = (seg) => (cd.hi && seg !== cd.hi ? 0.28 : 0.95);

  /* Максимум высоты столбца = макс сумма по интервалу */
  let max = 1;
  for (let i = 0; i < N; i++) { let s = 0; segOrder.forEach((k) => (s += per[k][i])); if (s > max) max = s; }

  let bars = "";
  for (let i = 0; i < N; i++) {
    const gx = L + i * gW, bW = Math.max(2, Math.floor(gW * 0.6)), bx = gx + (gW - bW) / 2;
    let yAcc = T + cH, colTot = 0;
    segOrder.forEach((seg) => {
      const v = per[seg][i]; if (v <= 0) return;
      const h = (v / max) * cH; yAcc -= h; colTot += v;
      bars += `<rect x="${bx}" y="${yAcc}" width="${bW}" height="${h}" fill="${colorOf(seg)}" opacity="${dim(seg)}"><title>${esc(seg)}: ${fv(v)}</title></rect>`;
    });
    if (colTot > 0) bars += `<text x="${bx + bW / 2}" y="${T + cH - (colTot / max) * cH - 3}" text-anchor="middle" font-size="${mode === "month" ? 6 : 7}" fill="var(--ink)" font-weight="600">${fv(colTot)}</text>`;
  }

  /* Легенда слева: клик — глубже (или подсветка на листе) */
  const drillable = level < 3;
  const otherTotal = ev.reduce((s, e) => s + (topSet.has(catOf(e)) ? 0 : e.val), 0);
  const legend = segOrder.map((seg) => {
    const clickable = seg !== "Прочее";
    const act = clickable ? `onclick="App.chartDrill(${n},'${q(seg)}')"` : "";
    const cur = cd.hi === seg ? "font-weight:700;" : "";
    const segVal = seg === "Прочее" ? otherTotal : (catTotal[seg] || 0);
    return `<div ${act} style="display:flex;align-items:center;gap:6px;font-size:11px;margin:2px 0;${clickable ? "cursor:pointer;" : "color:var(--ink3);"}${cur}" title="${esc(seg)}${clickable && drillable ? " — раскрыть" : ""}">
      <span style="flex:0 0 10px;width:10px;height:10px;border-radius:2px;background:${colorOf(seg)}"></span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(seg)}</span>
      <span style="font-variant-numeric:tabular-nums;color:var(--ink3)">${fv(segVal)}</span>
    </div>`;
  }).join("");

  /* Хлебные крошки уровней */
  const crumb = (label, act, cur) =>
    `<span ${act ? `onclick="${act}" style="cursor:pointer;color:var(--ink2);text-decoration:underline;text-decoration-style:dotted"` : `style="font-weight:700"`}>${esc(label)}</span>`;
  let crumbs = crumb("Все предметы", cd.predmet ? `App.chartCrumb(${n},'root')` : "", !cd.predmet);
  if (cd.predmet) crumbs += ` <span style="color:var(--ink3)">▸</span> ` + crumb(cd.predmet, cd.group ? `App.chartCrumb(${n},'predmet')` : "", !cd.group);
  if (cd.group) crumbs += ` <span style="color:var(--ink3)">▸</span> ` + crumb(cd.group, "", true);
  const levelName = level === 1 ? "по предметам" : level === 2 ? "по группам" : "по артикулам";

  return `<div class="sec" style="margin-bottom:14px">
    <div class="sh"><span class="st">${isRev ? "Выручка" : "Заказы"} · ${modeName} <span style="color:var(--ink3);font-weight:400;font-size:11px">· ${levelName}</span></span>${controls}</div>
    <div style="font-size:11px;margin:2px 2px 8px">${crumbs}
      <span style="color:var(--ink3);font-size:10px;margin-left:8px">${drillable ? "клик по легенде — глубже" : "клик по легенде — подсветка"}</span></div>
    <div class="tw" style="padding:8px;display:flex;gap:10px;align-items:stretch">
      <div style="flex:0 0 140px;max-height:150px;overflow:auto;padding-right:2px">
        ${legend}
      </div>
      <div style="flex:1;min-width:0">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${axis(max)}${bars}${xLabels()}</svg>
      </div>
    </div>
  </div>`;
}
