import { wbGet } from "./wb.js";

/* ══════════════════════════════════════════════════════════
   Реклама WB (кабинеты 1 и 2) — через воркер, ключ «Продвижение» (WB_ADV_KEY_n).
   1) GET /adv/v1/promotion/count — все кампании (id, статус, время изменения)
   2) GET /adv/v3/fullstats?ids=…&beginDate=…&endDate=… — до 50 кампаний и 31 дня за запрос,
      лимит WB 3 запроса в минуту (очередь монитора и так держит паузу 20 с).
   Берём статусы 7 (завершена), 9 (идёт), 11 (пауза); завершённые раньше периода пропускаем.
   Результат: ADS[cab].nm[nmId][YYYY-MM-DD] = { views, clicks, atbs, sum, orders, sum_price }
   (по товару внутри кампаний; кампании и площадки сложены).
   ══════════════════════════════════════════════════════════ */

const BASE = "https://advert-api.wildberries.ru";
export const ADS_DAYS = 30;                 /* грузим 30 полных дней, переключатель режет 7 / 14 / 30 */
export const ADS = { 1: null, 2: null };
const inflight = {};

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const mskDay = (shift) => iso(Date.now() + 3 * 3600e3 + shift * 864e5);

export function loadAds(cab, { force = false } = {}) {
  if (ADS[cab] && !ADS[cab].error && !force) return Promise.resolve(ADS[cab]);
  if (inflight[cab]) return inflight[cab];
  inflight[cab] = (async () => {
    const to = mskDay(-1), from = mskDay(-ADS_DAYS);         /* без сегодня — день ещё идёт */
    const res = { from, to, nm: {}, names: {}, campaigns: 0, at: Date.now(), error: null };
    try {
      const cnt = await wbGet(`${BASE}/adv/v1/promotion/count`, cab, force);
      const ids = [];
      for (const g of cnt.adverts || []) {
        if (![7, 9, 11].includes(g.status)) continue;
        for (const a of g.advert_list || []) {
          if (g.status === 7 && (a.changeTime || "").slice(0, 10) < from) continue;   /* закончилась до периода */
          ids.push(a.advertId);
        }
      }
      res.campaigns = ids.length;
      for (let i = 0; i < ids.length; i += 50) {
        const part = ids.slice(i, i + 50).join(",");
        const data = await wbGet(`${BASE}/adv/v3/fullstats?ids=${part}&beginDate=${from}&endDate=${to}`, cab, force);
        for (const c of Array.isArray(data) ? data : []) {
          for (const d of c.days || []) {
            const day = String(d.date || "").slice(0, 10);
            for (const app of d.apps || []) {
              for (const x of app.nms || []) {
                if (!x.nmId) continue;
                res.names[x.nmId] ||= x.name || "";
                const t = ((res.nm[x.nmId] ||= {})[day] ||= { views: 0, clicks: 0, atbs: 0, sum: 0, orders: 0, sum_price: 0 });
                t.views += x.views || 0; t.clicks += x.clicks || 0; t.atbs += x.atbs || 0;
                t.sum += x.sum || 0; t.orders += x.orders || 0; t.sum_price += x.sum_price || 0;
              }
            }
          }
        }
      }
    } catch (e) {
      res.error = e.message;
    }
    ADS[cab] = res;
    delete inflight[cab];
    return res;
  })();
  return inflight[cab];
}
