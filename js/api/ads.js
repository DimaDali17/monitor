import { wbGet, wbPost } from "./wb.js";

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

/* ══════════════════════════════════════════════════════════
   Поисковые запросы (кластеры WB) — для раскрытия групп в блоке рекламы.
   1) GET /adv/v1/promotion/count — единые кампании (type 9): идут, пауза, завершённые в периоде
   2) GET /api/advert/v2/adverts?ids=… — какие товары (nm_id) в каждой кампании (до 50 id за запрос)
   3) POST /adv/v0/normquery/stats {from,to,items:[{advert_id,nm_id}]} — по каждому запросу за период:
      показы, клики, корзины, заказы (атрибуция WB), расход, средняя позиция. Один запрос на кабинет.
   Результат: ADQ[key].nm[nmId][запрос] = { views, clicks, atbs, orders, spend, posW } (posW = позиция × показы)
   ══════════════════════════════════════════════════════════ */
export const ADQ = {};
export const adqKey = (cab, from, to) => `${cab}|${from}|${to}`;

export function loadQueries(cab, from, to) {
  const key = adqKey(cab, from, to);
  if (ADQ[key] && ADQ[key].status !== "error") return ADQ[key].p || Promise.resolve(ADQ[key]);
  const res = (ADQ[key] = { status: "loading", nm: {}, error: null });
  res.p = (async () => {
    try {
      const cnt = await wbGet(`${BASE}/adv/v1/promotion/count`, cab, false);
      const ids = [];
      for (const g of cnt.adverts || []) {
        if (g.type !== 9 || ![7, 9, 11].includes(g.status)) continue;
        for (const a of g.advert_list || []) {
          if (g.status === 7 && (a.changeTime || "").slice(0, 10) < from) continue;
          ids.push(a.advertId);
        }
      }
      const items = [];
      for (let i = 0; i < ids.length; i += 50) {
        const ad = await wbGet(`${BASE}/api/advert/v2/adverts?ids=${ids.slice(i, i + 50).join(",")}`, cab, false);
        for (const a of ad.adverts || []) for (const x of a.nm_settings || []) if (x.nm_id) items.push({ advert_id: a.id, nm_id: x.nm_id });
      }
      for (let i = 0; i < items.length; i += 100) {
        const d = await wbPost(`${BASE}/adv/v0/normquery/stats`, { from, to, items: items.slice(i, i + 100) }, cab);
        for (const g of (d && d.stats) || []) {
          const byQ = (res.nm[g.nm_id] ||= {});
          for (const x of g.stats || []) {
            const q = String(x.norm_query || "").trim();
            if (!q) continue;
            const t = (byQ[q] ||= { views: 0, clicks: 0, atbs: 0, orders: 0, spend: 0, posW: 0 });
            t.views += x.views || 0; t.clicks += x.clicks || 0; t.atbs += x.atbs || 0;
            t.orders += x.orders || 0; t.spend += x.spend || 0; t.posW += (x.avg_pos || 0) * (x.views || 0);
          }
        }
      }
      res.status = "ok";
    } catch (e) {
      res.status = "error"; res.error = e.message;
    }
    delete res.p;
    return res;
  })();
  return res.p;
}
