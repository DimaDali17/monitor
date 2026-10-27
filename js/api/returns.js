import { WORKER } from "../config.js";
import { authHeader } from "./auth.js";

/* ══════════════════════════════════════════════════════════
   Возвраты к выдаче на ПВЗ (WB «Возвраты и перемещения товаров»,
   seller.wildberries.ru/return-transfer-reports).
   Метод: GET seller-analytics-api /api/analytics/v1/item-returns
   (старый /api/v1/analytics/goods-return WB отключил 26.10.2026).
   Ключ — категория «Аналитика» (WB_ANAL_KEY_n в воркере).
   Лимит WB — 1 запрос в минуту; воркер кэширует GET на 10 минут.
   Период — до 31 дня, берём последние 30. Пусто — WB отвечает 204.
   ══════════════════════════════════════════════════════════ */

const URL_RET = "https://seller-analytics-api.wildberries.ru/api/analytics/v1/item-returns";
const iso = (d) => d.toISOString().slice(0, 10);

/* Свежие данные по кабинету: { items, at, error } */
export const RETURNS = { 1: null, 2: null };

export async function loadReturns(cab) {
  const to = new Date(), from = new Date(Date.now() - 30 * 864e5);
  const url = `${URL_RET}?dateFrom=${iso(from)}&dateTo=${iso(to)}&status=active&limit=1000&offset=0`;
  try {
    const res = await fetch(`${WORKER}/?cab=${cab}&url=${encodeURIComponent(url)}`, { headers: authHeader() });
    if (res.status === 204) { RETURNS[cab] = { items: [], at: Date.now() }; return RETURNS[cab]; }
    const txt = await res.text();
    if (!res.ok) throw new Error(`WB ${res.status}: ${txt.slice(0, 160)}`);
    const d = txt.trim() ? JSON.parse(txt) : {};
    const items = Array.isArray(d.report) ? d.report : Array.isArray(d) ? d : [];
    RETURNS[cab] = { items, at: Date.now() };
  } catch (e) {
    /* не роняем кабинет: оставляем прошлые данные и запоминаем ошибку */
    RETURNS[cab] = { ...(RETURNS[cab] || { items: [] }), error: e.message };
  }
  return RETURNS[cab];
}

/* «Готов к выдаче» — именно их нужно забрать; «в пути» — скоро будут */
export const isReady = (r) => /готов.*выдач/i.test(r.returnStatus || r.status || "");
export const isOnWay = (r) => /пути|погружен|передан/i.test(r.returnStatus || r.status || "") && !isReady(r);
