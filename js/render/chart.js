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

  /* Только текущий период — сравнение теперь живёт в верхних карточках */
  let labels = [], cur = [];

  if (mode === "day") {
    const tH = Array(24).fill(0);
    (vm.todayO || []).forEach((o) => { tH[hourOf(o)] += val(o); });
    for (let i = 0; i < 24; i++) {
      labels.push(i % 3 === 0 ? i + ":00" : "");
      cur.push(tH[i]);
    }
  } else {
    const span = mode === "week" ? 7 : 30;
    const curDays = [];
    for (let i = span - 1; i >= 0; i--) curDays.push(iso(Date.now() - i * 864e5));

    const curSet = new Set(curDays);
    const cA = {};
    (vm.allOrders || []).forEach((o) => {
      const d = dateOf(o);
      if (d && curSet.has(d)) cA[d] = (cA[d] || 0) + val(o);
    });

    const every = mode === "month" ? 3 : 1;
    for (let i = 0; i < span; i++) {
      labels.push(i % every === 0
        ? new Date(curDays[i] + "T12:00:00").toLocaleDateString("ru", { day: "numeric", month: "short" }).replace(".", "")
        : "");
      cur.push(cA[curDays[i]] || 0);
    }
  }

  const N = labels.length;
  const max = Math.max(...cur, 1);
  const W = 700, H = 155, L = 38, R = 10, T = 13, B = 20;
  const cW = W - L - R, cH = H - T - B;
  const gW = cW / N;
  const bW = Math.max(2, Math.floor(gW * 0.55));
  const fv = (v) => (isRev ? (v >= 1000 ? Math.round(v / 1000) + "к" : Math.round(v)) : v);
  const lblFs = mode === "month" ? 6 : 7;

  /* Один нейтральный столбик на интервал */
  const BAR = "#6B6357", FUT = "#E8E4DC";
  let bars = "";
  for (let i = 0; i < N; i++) {
    const gx = L + i * gW;
    const tv = cur[i], bH = (tv / max) * cH;
    const bx = gx + (gW - bW) / 2, by = T + cH - bH;
    const future = mode === "day" && i > nowH;
    const showLbl = mode === "month" ? i % 3 === 0 : true;

    bars += `<rect x="${bx}" y="${by}" width="${bW}" height="${bH}" rx="2" fill="${future ? FUT : BAR}" opacity=".9"/>`;
    if (tv > 0 && !future && showLbl)
      bars += `<text x="${bx + bW / 2}" y="${by - 3}" text-anchor="middle" font-size="${lblFs}" fill="var(--ink)" font-weight="600">${fv(tv)}</text>`;
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
