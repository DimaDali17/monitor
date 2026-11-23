/* ══════════════════════════════════════════════════════════
   Погода в Москве для графика заказов: максимальная температура за сутки (обычно — день).
   Источник — Open-Meteo (бесплатно, без ключа, прямо из браузера; воркер не нужен).
   WX.max["2026-11-23"] = -0.2 (°C). Прошедшие дни кэшируем в localStorage — они не меняются.
   ══════════════════════════════════════════════════════════ */
const URL_BASE = "https://api.open-meteo.com/v1/forecast?latitude=55.7558&longitude=37.6173&daily=temperature_2m_max&timezone=Europe%2FMoscow";
const LS = "wxMaxMsk";
export const WX = { max: {}, status: null };
try { Object.assign(WX.max, JSON.parse(localStorage.getItem(LS) || "{}")); } catch (_) {}

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
      const t = (j.daily && j.daily.time) || [], v = (j.daily && j.daily.temperature_2m_max) || [];
      t.forEach((k, i) => { if (v[i] != null) WX.max[k] = v[i]; });
      WX.status = "ok";
      const past = {}; for (const k in WX.max) if (k < today) past[k] = WX.max[k];
      try { localStorage.setItem(LS, JSON.stringify(past)); } catch (_) {}
      if (typeof window !== "undefined") window.dispatchEvent(new Event("wx-ready"));
    })
    .catch((e) => { WX.status = "error"; console.warn("Погода не загрузилась:", e.message); })
    .finally(() => { pending = null; });
}
