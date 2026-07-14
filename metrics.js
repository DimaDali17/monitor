import { CM } from "../state.js";
import { fmt, dlt, dltW, wbPrice, ozRev, yestToHour, iso } from "../utils.js";

/* Сравнение периода с предыдущим: неделя к неделе, месяц к месяцу */
function periodData(d, type, days) {
  const getD = (o) => (type === "wb" ? o.date || "" : o.created_at || o.in_process_at || "").slice(0, 10);
  const price = type === "wb" ? wbPrice : ozRev;

  const cur = new Set(), prev = new Set();
  for (let i = 0; i < days; i++) cur.add(iso(Date.now() - i * 864e5));
  for (let i = days; i < days * 2; i++) prev.add(iso(Date.now() - i * 864e5));

  const all = d.allOrders || [];
  const tw = all.filter((o) => cur.has(getD(o)));
  const pw = all.filter((o) => prev.has(getD(o)));
  const twR = tw.reduce((s, o) => s + price(o), 0);
  const pwR = pw.reduce((s, o) => s + price(o), 0);

  return {
    twC: tw.length, pwC: pw.length, twR, pwR,
    dO: pw.length ? Math.round(((tw.length - pw.length) / pw.length) * 100) : null,
    dR: pwR ? Math.round(((twR - pwR) / pwR) * 100) : null,
  };
}

export const weekData = (d, type) => periodData(d, type, 7);
export const monthData = (d, type) => periodData(d, type, 30);

export function metricsHTML(n, vm, type) {
  const accent = type === "oz" ? " oz" : " g";
  const mode = CM[n];

  if (mode === "week" || mode === "month") {
    const k = mode === "week" ? weekData(vm, type) : monthData(vm, type);
    const word = mode === "week" ? "неделю" : "месяц";
    const prevWord = mode === "week" ? "неделя" : "месяц";
    return `<div class="mg">
      <div class="mc"><div class="ml">Заказы за ${word}</div><div class="mv${type === "oz" ? " oz" : ""}">${k.twC}</div><div class="md">${dltW(k.dO)}</div></div>
      <div class="mc"><div class="ml">Прошлый${mode === "week" ? "ая" : ""} ${prevWord}</div><div class="mv">${k.pwC}</div></div>
      <div class="mc"><div class="ml">Сумма за ${word}</div><div class="mv sm${accent}">${fmt(k.twR)}</div><div class="md">${dltW(k.dR)}</div></div>
      <div class="mc"><div class="ml">Сумма пр. ${prevWord}</div><div class="mv sm">${fmt(k.pwR)}</div></div>
    </div>`;
  }

  const price = type === "wb" ? wbPrice : ozRev;
  const { todayO = [], yestO = [] } = vm;
  const yH = yestToHour(yestO, type);
  const tC = todayO.length, yC = yestO.length, yhC = yH.length;
  const tR = todayO.reduce((s, o) => s + price(o), 0);
  const yR = yestO.reduce((s, o) => s + price(o), 0);
  const yhR = yH.reduce((s, o) => s + price(o), 0);
  const dO = yhC ? Math.round(((tC - yhC) / yhC) * 100) : null;
  const dR = yhR ? Math.round(((tR - yhR) / yhR) * 100) : null;

  return `<div class="mg">
    <div class="mc"><div class="ml">Заказы сегодня</div><div class="mv${type === "oz" ? " oz" : ""}">${tC}</div><div class="md">${dlt(dO)}</div></div>
    <div class="mc"><div class="ml">Вчера (всего / к ${new Date().getHours()}:00)</div><div class="mv">${yC} <span style="font-size:14px;color:var(--ink3)">/ ${yhC}</span></div></div>
    <div class="mc"><div class="ml">Сумма сегодня</div><div class="mv sm${accent}">${fmt(tR)}</div><div class="md">${dlt(dR)}</div></div>
    <div class="mc"><div class="ml">Сумма вчера</div><div class="mv sm">${fmt(yR)}</div></div>
  </div>`;
}
