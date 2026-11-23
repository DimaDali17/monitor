/* ══════════════════════════════════════════════════════════
   Погода в Москве для графика заказов: максимальная температура за сутки (обычно — день).
   Источник — Open-Meteo (бесплатно, без ключа, прямо из браузера; воркер не нужен).
   WX.max["2026-11-23"] = -0.2 (°C). Прошедшие дни кэшируем в localStorage — они не меняются.
   ══════════════════════════════════════════════════════════ */
const URL_BASE = "https://api.open-meteo.com/v1/forecast?latitude=55.7558&longitude=37.6173&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FMoscow";
const LS = "wxMaxMinMsk";
export const WX = { max: {}, min: {}, status: null };
try {
  const saved = JSON.parse(localStorage.getItem(LS) || "{}");
  Object.assign(WX.max, saved.max || {});
  Object.assign(WX.min, saved.min || {});
} catch (_) {}

let pending = null;
/* Догружает недостающие дни [from..to] (ISO-даты). Готово — событие «wx-ready» (монитор перерисует график). */
export function loadWeather(from, to, today) {
  const need = [];
  for (let d = new Date(from + "T12:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    if (!(k in WX.max) || k >= today) need.push(k);              /* сегодня — прогноз, перепроверяем */
  }
  if (!need.length || pending || WX.status === "error") return;
  pending = fetch(`${URL_BASE}&start_date=${need[0]}&end_date=${need[need.length - 1]}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((j) => {
      const t = (j.daily && j.daily.time) || [];
      const vmax = (j.daily && j.daily.temperature_2m_max) || [];
      const vmin = (j.daily && j.daily.temperature_2m_min) || [];
      t.forEach((k, i) => {
        if (vmax[i] != null) WX.max[k] = vmax[i];
        if (vmin[i] != null) WX.min[k] = vmin[i];
      });
      WX.status = "ok";
      const past = { max: {}, min: {} };
      for (const k in WX.max) if (k < today) past.max[k] = WX.max[k];
      for (const k in WX.min) if (k < today) past.min[k] = WX.min[k];
      try { localStorage.setItem(LS, JSON.stringify(past)); } catch (_) {}
      if (typeof window !== "undefined") window.dispatchEvent(new Event("wx-ready"));
    })
    .catch((e) => { WX.status = "error"; console.warn("Погода не загрузилась:", e.message); })
    .finally(() => { pending = null; });
}
