import { WORKER, OZ_BASE, ORDERS_DAYS } from "../config.js";
import { D } from "../state.js";
import { authHeader, expired } from "./auth.js";
import { td, yd, wd, daysAgo } from "../utils.js";
import { cacheGet, cacheSet } from "./cache.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0;
let inflight = null;

async function ozPost(url, body) {
  const gap = Math.max(0, lastAt + 1200 - Date.now());
  if (gap > 0) await sleep(gap);
  lastAt = Date.now();

  /* Client-Id и Api-Key подставит воркер — здесь их нет */
  const purl = `${WORKER}/?cab=3&url=${encodeURIComponent(url)}`;
  const opts = {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };

  let res = await fetch(purl, opts);
  if (res.status === 401) {
    expired();
    throw new Error("Сессия истекла");
  }
  if (res.status === 429) {
    await sleep(8000);
    lastAt = Date.now();
    res = await fetch(purl, opts);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    /* В тексте — какой метод упал: Ozon периодически отключает старые версии */
    const path = String(url).replace(OZ_BASE, "");
    throw new Error(`Ozon ${res.status} (${path}): ${t.slice(0, 300)}`);
  }

  const txt = await res.text().catch(() => "");
  if (!txt.trim()) return {};
  try { return JSON.parse(txt); }
  catch { throw new Error("Ozon вернул не JSON: " + txt.slice(0, 160)); }
}

export function loadOZ({ force = false } = {}) {
  if (inflight) return inflight;
  inflight = fetchOzon(force).finally(() => { inflight = null; });
  return inflight;
}

async function fetchOzon(force) {
  const t = td(), y = yd(), w = wd(), from = daysAgo(ORDERS_DAYS);

  const postingsFbo = await cached("oz:orders", force, async () => {
    const out = [];
    for (let p = 0, offset = 0; p < 10; p++, offset += 1000) {
      const d = await ozPost(`${OZ_BASE}/v2/posting/fbo/list`, {
        dir: "DESC",
        filter: { since: from + "T00:00:00.000Z", to: t + "T23:59:59.999Z" },
        limit: 1000,
        offset,
      });
      const arr = Array.isArray(d.result) ? d.result : d.result?.postings || [];
      out.push(...arr);
      if (arr.length < 1000) break;
    }
    return out;
  });

  /* FBS-заказы (свой склад) — отдельная ручка posting/fbs/list, раньше не грузились.
     Формат postings тот же (products, in_process_at/created_at), поэтому просто
     объединяем с FBO в общий список. try/catch: сбой FBS не рушит FBO. */
  const issues = [];   /* что не загрузилось — для плашки */
  let fbsOrdErr = null;
  const postingsFbs = await cached("oz:orders_fbs", force, async () => {
    const out = [];
    fbsOrdErr = null;
    try {
      for (let p = 0, offset = 0; p < 10; p++, offset += 1000) {
        const d = await ozPost(`${OZ_BASE}/v3/posting/fbs/list`, {
          dir: "DESC",
          filter: { since: from + "T00:00:00.000Z", to: t + "T23:59:59.999Z" },
          limit: 1000,
          offset,
        });
        const arr = d.result?.postings || (Array.isArray(d.result) ? d.result : []);
        out.push(...arr.map((o) => ({ ...o, _fbs: true })));
        if (arr.length < 1000) break;
      }
    } catch (e) {
      console.warn("Ozon FBS-заказы недоступны:", e.message);
      fbsOrdErr = e.message;
    }
    return out;
  }, () => !fbsOrdErr);
  if (fbsOrdErr) issues.push({ what: "FBS-заказы Ozon", why: fbsOrdErr, effect: "заказы только FBO — продажи занижены" });

  const postings = [...postingsFbo, ...postingsFbs];
  console.log(`Ozon заказы: FBO ${postingsFbo.length} + FBS ${postingsFbs.length} = ${postings.length}`);

  /* Остатки по товарам — канонический product/info/stocks (v4): по каждому offer_id
     записи type:"fbo" и type:"fbs" с present/reserved и sku. Нужен и для FBS-остатков,
     и как список SKU для аналитики FBO по складам. Сбой не роняет кабинет. */
  let fbsStkErr = null;
  const fbsItems = await cached("oz:fbs", force, async () => {
    const out = [];
    fbsStkErr = null;
    try {
      let cursor = "";
      for (let p = 0; p < 40; p++) {
        const d = await ozPost(`${OZ_BASE}/v4/product/info/stocks`, {
          cursor,
          filter: { visibility: "ALL" },
          limit: 1000,
        });
        const items = d.items || d.result?.items || [];
        out.push(...items);
        cursor = d.cursor ?? d.result?.last_id ?? "";
        if (!items.length || !cursor) break;
      }
    } catch (e) {
      console.warn("Ozon product/info/stocks недоступен:", e.message);
      fbsStkErr = e.message;
    }
    return out;
  }, () => !fbsStkErr);
  if (fbsStkErr) issues.push({ what: "Остатки Ozon (product/info/stocks)", why: fbsStkErr, effect: "остатки FBS и FBO могут быть пустыми" });

  /* FBO-остатки по складам Ozon. Старый /v2/analytics/stock_on_warehouses Ozon отключил
     («obsolete method cannot be used»). Новый — /v1/analytics/stocks: по списку SKU
     (до 100 за запрос) отдаёт строки «SKU × склад» с available_stock_count.
     Приводим к прежнему формату строк (item_code / warehouse_name / free_to_sell_amount),
     чтобы остальной дашборд не менять. */
  const typeOf = (s) => String(s.type || "").toLowerCase();
  const fboSkus = [...new Set(fbsItems.flatMap((it) =>
    (it.stocks || []).filter((s) => typeOf(s) === "fbo" && s.sku).map((s) => String(s.sku))))];
  /* все SKU товара тоже: у части товаров FBO-запись может прийти без sku */
  const allSkus = [...new Set(fbsItems.flatMap((it) => (it.stocks || []).map((s) => s.sku).filter(Boolean).map(String)))];
  const skuList = fboSkus.length ? fboSkus : allSkus;

  /* Запасной вариант без разбивки по складам — из того же v4 (fbo: present − reserved) */
  const fboFromV4 = () => {
    const rows = [];
    for (const it of fbsItems) {
      const st = (it.stocks || []).find((s) => typeOf(s) === "fbo");
      const qy = st ? Math.max(0, (st.present ?? 0) - (st.reserved ?? 0)) : 0;
      if (qy > 0) rows.push({ item_code: it.offer_id, offer_id: it.offer_id, warehouse_name: "Ozon FBO", free_to_sell_amount: qy, item_name: "" });
    }
    return rows;
  };

  let stkErr = null;
  const stocks = await cached("oz:stocks2", force, async () => {
    stkErr = null;
    const out = [];
    if (!skuList.length) return out;
    try {
      for (let i = 0; i < skuList.length; i += 100) {
        const d = await ozPost(`${OZ_BASE}/v1/analytics/stocks`, { skus: skuList.slice(i, i + 100) });
        const items = d.items || d.result?.items || d.result || [];
        for (const r of (Array.isArray(items) ? items : [])) {
          const qy = r.available_stock_count ?? r.valid_stock_count ?? r.free_to_sell_amount ?? 0;
          if (!qy) continue;
          out.push({
            item_code: r.offer_id || r.item_code || String(r.sku || ""),
            offer_id: r.offer_id,
            sku: r.sku,
            warehouse_name: r.warehouse_name || r.cluster_name || "Ozon FBO",
            free_to_sell_amount: qy,
            item_name: r.name || r.item_name || "",
          });
        }
      }
    } catch (e) {
      console.warn("Ozon /v1/analytics/stocks недоступен:", e.message);
      stkErr = e.message;
    }
    return out;
  }, (rows) => !stkErr && rows.length > 0);

  /* Аналитика не ответила или пуста, а в v4 FBO-остаток есть — берём v4 (итог верный,
     но без разбивки по складам) и честно говорим об этом в плашке. */
  let stocksFinal = stocks;
  const v4rows = fboFromV4();
  if (!stocks.length && v4rows.length) {
    stocksFinal = v4rows;
    issues.push({
      what: "Остатки FBO Ozon по складам",
      why: stkErr || "аналитика остатков вернула пусто",
      effect: "итог FBO верный, но без разбивки по складам (одна колонка «Ozon FBO»)",
    });
  }
  console.log(`Ozon FBO-остатки: ${stocksFinal.length} строк (${stocks.length ? "по складам" : "из v4, без складов"})`);

  const fbs = {}, fbsCells = {}, fbsWh = {};
  const FBS_WH = "FBS";
  for (const it of fbsItems) {
    const art = it.offer_id || it.item_code || "—";
    const st = (it.stocks || []).find((s) => String(s.type || "").toLowerCase() === "fbs");
    const qy = st ? (st.present ?? st.amount ?? 0) : 0;
    if (!qy) continue;
    const key = art + " · —";
    fbs[key] = (fbs[key] || 0) + qy;
    fbsWh[FBS_WH] = (fbsWh[FBS_WH] || 0) + qy;
    (fbsCells[key] ||= {})[FBS_WH] = (fbsCells[key][FBS_WH] || 0) + qy;
  }
  console.log(`Ozon FBS: позиций ${Object.keys(fbs).length}, всего ${fbsWh[FBS_WH] || 0} шт`);

  const dayOf = (o) => (o.created_at || o.in_process_at || "").slice(0, 10);

  D[3] = {
    isOz: true,
    allOrders: postings,
    todayO: postings.filter((o) => dayOf(o) === t),
    yestO: postings.filter((o) => dayOf(o) === y),
    orders7: postings.filter((o) => { const d = dayOf(o); return d >= w && d < t; }),   /* ровно 7 полных дней, без сегодня */
    stocks: stocksFinal,
    fbs, fbsCells, fbsWh,
    issues,
  };
  return D[3];
}

/* ok() === false ⇒ результат неполный, в кэш не кладём */
async function cached(key, force, fn, ok) {
  if (!force) {
    const hit = cacheGet(key);
    if (hit) return hit;
  }
  const data = await fn();
  if (!ok || ok(data)) cacheSet(key, data);
  return data;
}
