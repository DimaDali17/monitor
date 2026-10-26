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

  /* Списки отправлений. 31.08.2026 Ozon отключил /v2/posting/fbo/list и /v3/posting/fbs/list.
     Новые /v3/posting/fbo/list и /v4/posting/fbs/list: не больше 100 за запрос,
     дальше — по cursor, пока has_next; postings лежат в корне ответа (не в result);
     price приходит объектом { amount, currency }. Приводим к прежнему виду ниже (normPosting). */
  const since = from + "T00:00:00.000Z", to = t + "T23:59:59.999Z";
  const fetchPostings = async (path) => {
    const out = [];
    let cursor = "";
    const seen = new Set();
    for (let p = 0; p < 400; p++) {              /* до 40 000 отправлений за период */
      const d = await ozPost(`${OZ_BASE}${path}`, {
        cursor,
        filter: { since, to },
        limit: 100,
        sort_dir: "DESC",
        with: { analytics_data: true },
      });
      const arr = d.postings || d.result?.postings || (Array.isArray(d.result) ? d.result : []);
      out.push(...arr);
      const hasNext = d.has_next ?? d.result?.has_next;
      const next = d.cursor ?? d.result?.cursor ?? "";
      if (!hasNext || !next || !arr.length || seen.has(next)) break;
      seen.add(next);
      cursor = next;
    }
    return out;
  };

  /* FBO-заказы — без них кабинет не имеет смысла, поэтому ошибка здесь роняет загрузку */
  const postingsFbo = await cached("oz:orders_v3", force, () => fetchPostings("/v3/posting/fbo/list"));

  /* FBS-заказы (свой склад). try/catch: сбой FBS не рушит FBO. */
  const issues = [];   /* что не загрузилось — для плашки */
  let fbsOrdErr = null;
  const postingsFbs = await cached("oz:orders_fbs_v4", force, async () => {
    fbsOrdErr = null;
    try {
      return (await fetchPostings("/v4/posting/fbs/list")).map((o) => ({ ...o, _fbs: true }));
    } catch (e) {
      console.warn("Ozon FBS-заказы недоступны:", e.message);
      fbsOrdErr = e.message;
      return [];
    }
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

  /* Приводим отправления новых версий к прежнему виду, которым пользуется дашборд:
     price { amount } → число; если в товаре нет offer_id — берём по sku из остатков v4. */
  const offerBySku = {};
  for (const it of fbsItems) for (const st of (it.stocks || [])) if (st.sku && it.offer_id) offerBySku[String(st.sku)] = it.offer_id;
  const money = (v) => (v && typeof v === "object" ? (v.amount ?? v.value ?? 0) : v);
  for (const o of [...postingsFbo, ...postingsFbs]) {
    for (const pr of (o.products || [])) {
      pr.price = money(pr.price);
      if (pr.offer_price != null) pr.offer_price = money(pr.offer_price);
      if (!pr.offer_id && pr.sku != null && offerBySku[String(pr.sku)]) pr.offer_id = offerBySku[String(pr.sku)];
    }
  }

  /* FBS-остатки по складам продавца — /v2/product/info/stocks-by-warehouse/fbs
     (v1 Ozon объявил устаревшим). На вход — SKU (до 1000), выдача постранично по cursor.
     Не получилось — откатываемся на общий FBS без разбивки (одна колонка «FBS») и
     говорим об этом в плашке. */
  const fbsSkus = [...new Set(fbsItems.flatMap((it) => (it.stocks || [])
    .filter((s) => String(s.type || "").toLowerCase() === "fbs" && s.sku).map((s) => String(s.sku))))];
  const offerBySku0 = {};
  for (const it of fbsItems) for (const s of (it.stocks || [])) if (s.sku && it.offer_id) offerBySku0[String(s.sku)] = it.offer_id;
  let whErr = null;
  const whRows = await cached("oz:fbs_wh2", force, async () => {
    whErr = null;
    const out = [];
    if (!fbsSkus.length) return out;
    try {
      for (let i = 0; i < fbsSkus.length; i += 1000) {
        const sku = fbsSkus.slice(i, i + 1000);
        let cursor = "";
        for (let p = 0; p < 50; p++) {
          const d = await ozPost(`${OZ_BASE}/v2/product/info/stocks-by-warehouse/fbs`, { sku, limit: 1000, ...(cursor ? { cursor } : {}) });
          const arr = d.stocks || d.items || d.result?.stocks || d.result?.items || (Array.isArray(d.result) ? d.result : []);
          out.push(...arr);
          const next = d.cursor ?? d.result?.cursor ?? "";
          const more = d.has_next ?? d.result?.has_next ?? false;
          if (!more || !next || next === cursor || !arr.length) break;
          cursor = next;
        }
      }
    } catch (e) {
      console.warn("Ozon FBS по складам недоступно:", e.message);
      whErr = e.message;
    }
    return out;
  }, (rows) => !whErr && rows.length > 0);

  const fbs = {}, fbsCells = {}, fbsWh = {};
  const FBS_WH = "FBS";
  if (whRows.length) {
    for (const r of whRows) {
      const qy = Number(r.present ?? r.amount ?? 0) || 0;
      if (!qy) continue;
      const art = r.offer_id || offerBySku0[String(r.sku)] || String(r.sku || "—");
      const wh = r.warehouse_name || r.warehouse?.name || ("Склад " + (r.warehouse_id ?? "?"));
      const key = art + " · —";
      fbs[key] = (fbs[key] || 0) + qy;
      fbsWh[wh] = (fbsWh[wh] || 0) + qy;
      (fbsCells[key] ||= {})[wh] = (fbsCells[key][wh] || 0) + qy;
    }
  } else for (const it of fbsItems) {
    const art = it.offer_id || it.item_code || "—";
    const st = (it.stocks || []).find((s) => String(s.type || "").toLowerCase() === "fbs");
    const qy = st ? (st.present ?? st.amount ?? 0) : 0;
    if (!qy) continue;
    const key = art + " · —";
    fbs[key] = (fbs[key] || 0) + qy;
    fbsWh[FBS_WH] = (fbsWh[FBS_WH] || 0) + qy;
    (fbsCells[key] ||= {})[FBS_WH] = (fbsCells[key][FBS_WH] || 0) + qy;
  }
  if (!whRows.length && Object.keys(fbs).length) {
    issues.push({ what: "FBS Ozon по складам", why: whErr || "метод вернул пусто",
      effect: "FBS-остаток показан одной цифрой, без разбивки по складам — правила по складам не проверить" });
  }
  console.log(`Ozon FBS: позиций ${Object.keys(fbs).length}, складов ${Object.keys(fbsWh).length}${whRows.length ? "" : " (без разбивки)"}`);

  /* Склад продавца у FBS-отправления — для темпа «на сколько дней хватит» по складу */
  for (const o of postingsFbs) {
    const w = o.delivery_method?.warehouse || o.delivery_method?.warehouse_name || o.analytics_data?.warehouse_name;
    if (w) o.fbsWarehouse = w;
  }

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
