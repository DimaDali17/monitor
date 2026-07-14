import { CM, CV } from "../state.js";
import { wbPrice, ozRev, iso } from "../utils.js";

export function chartHTML(n, vm, type) {
  if (!vm) return "";
  const mode = CM[n] || "day";
  const isRev = (CV[n] || "ord") === "rev";
  const nowH = new Date().getHours();

  const dateOf = (o) => {
    const dt = type === "wb" ? o.date : o.in_process_at || o.created_at;
    return dt ? dt.slice(0, 10) : "";
  };
  const hourOf = (o) => {
    const dt = type === "wb" ? o.date : o.in_process_at || o.created_at;
    return dt ? new Date(dt).getHours() : 0;
  };
  const price = type === "wb" ? wbPrice : ozRev;
  const val = (o) => (isRev ? price(o) : 1);

  let labels = [], cur = [], prev = [];

  if (mode === "day") {
    const tH = Array(24).fill(0), yH = Array(24).fill(0);
    (vm.todayO || []).forEach((o) => { tH[hourOf(o)] += val(o); });
    (vm.yestO || []).forEach((o) => { yH[hourOf(o)] += val(o); });
    for (let i = 0; i < 24; i++) {
      labels.push(i % 3 === 0 ? i + ":00" : "");
      cur.push(tH[i]); prev.push(yH[i]);
    }
  } else {
    const span = mode === "week" ? 7 : 30;
    const curDays = [], prevDays = [];
    for (let i = span - 1; i >= 0; i--) curDays.push(iso(Date.now() - i * 864e5));
    for (let i = span * 2 - 1; i >= span; i--) prevDays.push(iso(Date.now() - i * 864e5));

    const curSet = new Set(curDays), prevSet = new Set(prevDays);
    const cA = {}, pA = {};
    (vm.allOrders || []).forEach((o) => {
      const d = dateOf(o);
      if (!d) return;
      if (curSet.has(d)) cA[d] = (cA[d] || 0) + val(o);
      if (prevSet.has(d)) pA[d] = (pA[d] || 0) + val(o);
    });

    const every = mode === "month" ? 3 : 1;
    for (let i = 0; i < span; i++) {
      const show = i % every === 0;
      labels.push(show
        ? new Date(curDays[i] + "T12:00:00").toLocaleDateString("ru", { day: "numeric", month: "short" }).replace(".", "")
        : "");
      cur.push(cA[curDays[i]] || 0);
      prev.push(pA[prevDays[i]] || 0);
    }
  }

  const N = labels.length;
  const max = Math.max(...cur, ...prev, 1);
  const W = 700, H = 155, L = 38, R = 10, T = 13, B = 20;
  const cW = W - L - R, cH = H - T - B;
  const gW = cW / N, bW = Math.floor(gW * 0.35), gap = Math.max(1, Math.floor(gW * 0.04));
  const fv = (v) => (isRev ? (v >= 1000 ? Math.round(v / 1000) + "к" : Math.round(v)) : v);
  const lblFs = mode === "month" ? 6 : 7;

  let bars = "";
  for (let i = 0; i < N; i++) {
    const gx = L + i * gW;
    const pv = prev[i], pH = (pv / max) * cH;
    const showLbl = mode === "month" ? i % 3 === 0 : true;

    bars += `<rect x="${gx + gap}" y="${T + cH - pH}" width="${bW}" height="${pH}" rx="2" fill="#D5D0C8" opacity=".55"/>`;
    if (pv > 0 && showLbl)
      bars += `<text x="${gx + gap + bW / 2}" y="${T + cH - pH - 3}" text-anchor="middle" font-size="${lblFs}" fill="var(--ink3)">${fv(pv)}</text>`;

    const tv = cur[i], tH2 = (tv / max) * cH;
    const future = mode === "day" && i > nowH;
    const fill = future ? "#E8E4DC" : colorFor(tv, pv);
    const tx = gx + gap + bW + gap, ty = T + cH - tH2;

    bars += `<rect x="${tx}" y="${ty}" width="${bW}" height="${tH2}" rx="2" fill="${fill}" opacity=".9"/>`;
    if (tv > 0 && !future && showLbl)
      bars += `<text x="${tx + bW / 2}" y="${ty - 3}" text-anchor="middle" font-size="${lblFs}" fill="var(--ink)" font-weight="600">${fv(tv)}</text>`;
  }

  let xLab = "";
  const step = mode === "day" ? 3 : 1;
  for (let i = 0; i < N; i += step) {
    if (!labels[i]) continue;
    const fs = mode === "day" ? 8 : mode === "month" ? 7 : 9;
    xLab += `<text x="${L + i * gW + gW / 2}" y="${H - 4}" text-anchor="middle" font-size="${fs}" fill="var(--ink3)">${labels[i]}</text>`;
  }

  let yLab = "";
  [0, Math.round(max / 2), max].forEach((v) => {
    const y = T + cH - (v / max) * cH;
    yLab += `<text x="${L - 3}" y="${y + 3}" text-anchor="end" font-size="7" fill="var(--ink3)">${fv(v)}</text>` +
      `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
  });

  const on = (v, k) => (v === k ? "on" : "");
  const modeName = mode === "day" ? "день" : mode === "week" ? "неделя" : "месяц";

  return `<div class="sec" style="margin-bottom:14px">
    <div class="sh">
      <span class="st">${isRev ? "Выручка" : "Заказы"} · ${modeName}</span>
      <span style="display:flex;align-items:center;gap:8px">
        <span class="sm2"><span style="color:var(--green);font-weight:700">■</span>&gt; <span style="color:var(--red);font-weight:700">■</span>&lt; <span style="color:#D5D0C8;font-weight:700">■</span>${mode === "day" ? "вчера" : "пред. период"}</span>
        <span class="ctog">
          <button class="${on(CV[n], "ord")}" onclick="App.setChartVal(${n},'ord')">Шт</button>
          <button class="${on(CV[n], "rev")}" onclick="App.setChartVal(${n},'rev')">₽</button>
        </span>
        <span class="ctog">
          <button class="${on(mode, "day")}" onclick="App.setChartMode(${n},'day')">День</button>
          <button class="${on(mode, "week")}" onclick="App.setChartMode(${n},'week')">Неделя</button>
          <button class="${on(mode, "month")}" onclick="App.setChartMode(${n},'month')">Месяц</button>
        </span>
      </span>
    </div>
    <div class="tw" style="padding:8px">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${yLab}${bars}${xLab}</svg>
    </div>
  </div>`;
}

/* Цвет столбца — по отклонению от того же интервала прошлого периода */
function colorFor(cur, prev) {
  if (!prev) return "#6B6357";
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) <= 10) return "#6B6357";
  if (p > 25) return "#2D7A4F";
  if (p > 10) return "#7DB896";
  if (p >= -25) return "#D4827A";
  return "#B84040";
}
