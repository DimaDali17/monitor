import { WORKER, WB_BASE, WB_GAP, WB_BACKOFF, WB_TIMEOUT, ORDERS_DAYS } from "../config.js";
import { D } from "../state.js";
import { authHeader, expired } from "./auth.js";
import { td, yd, wd, daysAgo } from "../utils.js";
import { cacheGet, cacheSet } from "./cache.js";

/* ══════════════════════════════════════════════════════════
   Почему раньше сыпался 429 — см. v4. Здесь только новое:

   v5: Стоки теперь через Analytics API
   GET /api/v1/supplier/stocks — отключён WB 14 июля 2026.
   Новый: POST /api/analytics/v1/stocks-report/wb-warehouses
   Домен: seller-analytics-api.wildberries.ru
   Токен: категория «Аналитика» (WB_ANAL_KEY_1/2 в секретах воркера)
   Лимит: 1 запрос / 20 секунд

   Поля ответа нового API:
     nmId, chrtId, warehouseId, warehouseName,
     regionName, quantity, inWayToClient, inWayFromClient

   Нет supplierArticle и techSize — берём из карточек товаров:
   POST /content/v2/get/cards/list (content-api.wildberries.ru)
   Строим кэш nmId_chrtId → { supplierArticle, techSize, subject }
   ══════════════════════════════════════════════════════════ */

/* Очередь запросов (один за раз, пауза WB_GAP между ними) */
let chain = Promise.resolve();
let lastAt = 0;

function enqueue(fn) {
  const run = chain.then(async () => {
    const gap = Math.max(0, lastAt + WB_GAP - Date.now());
    if (gap > 0) await sleep(gap);
    try { return await fn(); } finally { lastAt = Date.now(); }
  });
  chain = run.catch(() => {});
  return run;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Дедупликация в полёте */
const inflight = new Map();

function wbGet(url, cab, force, onRetry) {
  const key = cab + "|" + url;
  if (inflight.has(key)) return inflight.get(key);
  const p = enqueue(() => attempt("GET", url, null, cab, force, onRetry))
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function wbPost(url, body, cab, onRetry) {
  /* POST не дедуплицируем — каждый вызов уникален (разный offset) */
  return enqueue(() => attempt("POST", url, body, cab, false, onRetry));
}

async function attempt(method, url, body, cab, force, onRetry) {
  const purl = `${WORKER}/?cab=${cab}&url=${encodeURIComponent(url)}`;
  const headers = { ...authHeader(), ...(force ? { "X-Force": "1" } : {}) };
  let reason = "";

  for (let i = 0; i <= WB_BACKOFF.length; i++) {
    let res = null, txt = "";
    try {
      res = await fetchWithTimeout(purl, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      }, WB_TIMEOUT);
      txt = await res.text();
    } catch (e) {
      reason = e.name === "AbortError" ? "таймаут прокси" : "сеть: " + e.message;
    }

    if (res && res.status === 401) {
      /* 401 от Analytics/Content API означает неверный токен Аналитика,
         а не истёкшую сессию — не выкидываем пользователя на логин */
      const isAnalDomain = url.includes("analytics-api") || url.includes("content-api");
      if (!isAnalDomain) expired();
      throw new Error(isAnalDomain
        ? `401 — проверьте токен Аналитика WB_ANAL_KEY_${cab} в секретах воркера`
        : "Сессия истекла");
    }

    const empty = res && res.ok && (!txt || !txt.trim());
    const rateLimited = res && res.status === 429;
    const serverErr = res && res.status >= 500;

    if (res && res.ok && !empty) {
      try { return JSON.parse(txt); }
      catch { throw new Error("WB вернул не JSON: " + txt.slice(0, 160)); }
    }

    if (res && !res.ok && !rateLimited && !serverErr)
      throw new Error(`WB ${res.status}: ${txt.slice(0, 200)}`);

    if (rateLimited) reason = "429 — превышен лимит запросов";
    else if (serverErr) reason = "WB " + res.status;
    else if (empty) reason = "прокси вернул пустой ответ";

    if (i === WB_BACKOFF.length) {
      throw new Error(
        `${reason}. Сделано ${WB_BACKOFF.length + 1} попытки за ~${Math.round(WB_BACKOFF.reduce((a, b) => a + b, 0) / 1000)} с.`
      );
    }

    const ra = res ? parseInt(res.headers.get("retry-after") || "0", 10) : 0;
    const waitMs = Math.max(ra * 1000, WB_BACKOFF[i]);
    onRetry?.(reason, Math.round(waitMs / 1000), i + 1);
    await sleep(waitMs);
  }
}

function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

/* ══════════ Кэш карточек: nmId_chrtId → {supplierArticle, techSize, subject} ══════════
   Строим из заказов — там уже есть supplierArticle, techSize и nmId.
   Content API требует отдельный токен «Контент» которого у нас нет,
   поэтому используем данные которые уже загружены бесплатно. */

let cardsCache = null;

function buildCardsCacheFromOrders(orders) {
  if (cardsCache) return; /* уже построен */
  cardsCache = {};
  let count = 0;
  (orders || []).forEach((o) => {
    const nm   = o.nmId || o.nmID;
    const chrt = o.chrtId || o.chrtID;
    const art  = o.supplierArticle || "";
    const sz   = o.techSize || "";
    const subj = o.subject || o.category || "";
    if (nm && chrt && art) {
      cardsCache[`${nm}_${chrt}`] = { supplierArticle: art, techSize: sz, subject: subj };
      count++;
    }
  });
  console.log(`cardsCache: построен из заказов — ${count} записей`);
}

/* Fallback: если заказов мало и nmId не нашёлся — используем chrtId как ключ.
   Стоки по одному артикулу/размеру приходят с одинаковым chrtId,
   поэтому можно сгруппировать по chrtId и взять supplierArticle из заказов. */
let chrtCache = null;

function buildChrtCache(orders) {
  if (chrtCache) return;
  chrtCache = {};
  (orders || []).forEach((o) => {
    const chrt = o.chrtId || o.chrtID;
    const art  = o.supplierArticle || "";
    const sz   = o.techSize || "";
    const subj = o.subject || o.category || "";
    if (chrt && art) chrtCache[String(chrt)] = { supplierArticle: art, techSize: sz, subject: subj };
  });
  console.log(`chrtCache: ${Object.keys(chrtCache).length} записей`);
}

/* ══════════ Загрузка остатков через новый Analytics API ══════════ */

const ANAL_URL = "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses";
/* Паузу между страницами отдельно НЕ ставим: enqueue уже держит WB_GAP
   между любыми двумя запросами. Свой sleep поверх неё удваивал ожидание. */

async function loadStocksNew(cab, onRetry) {
  /* Кэш строится из заказов в loadWB — к этому моменту он уже есть */
  let all = [], offset = 0;

  for (let page = 0; page < 50; page++) {
    let data;
    try {
      data = await wbPost(ANAL_URL, { limit: 1000, offset }, cab, onRetry);
    } catch (e) {
      throw new Error("Остатки (Analytics API): " + e.message);
    }

    /* Реальная структура ответа: { data: { items: [...] } } */
    const rows = Array.isArray(data) ? data
               : (data?.data?.items || data?.data?.stocks || data?.items
               || data?.stocks || data?.report || data?.data || data?.result || []);
    if (!Array.isArray(rows)) {
      throw new Error("не разобрал ответ Analytics API: " + JSON.stringify(data).slice(0, 200));
    }
    all = all.concat(rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }

  return all.map((r) => {
    const nm   = r.nmId   || r.nmID   || 0;
    const chrt = r.chrtId || r.chrtID || 0;
    /* Ищем сначала по nm+chrt, потом только по chrt */
    const card = cardsCache?.[`${nm}_${chrt}`]
              || chrtCache?.[String(chrt)]
              || {};
    return {
      supplierArticle: card.supplierArticle || String(nm),
      techSize:        card.techSize        || String(chrt),
      warehouseName:   r.warehouseName      || "",
      quantity:        r.quantity           ?? 0,
      subject:         card.subject         || "",
      category:        card.subject         || "",
      inWayToClient:   r.inWayToClient      ?? 0,
      inWayFromClient: r.inWayFromClient    ?? 0,
      regionName:      r.regionName         || "",
    };
  });
}

/* ══════════ Основная загрузка кабинета ══════════ */

export async function loadWB(n, { force = false, onRetry } = {}) {
  const ordFrom  = daysAgo(ORDERS_DAYS) + "T00:00:00Z";
  const urlOrders = `${WB_BASE}/orders?dateFrom=${ordFrom}&flag=0`;

  /* Заказы — старый Statistics API (не менялся) */
  const orders = await cached(`wb${n}:orders`, force,
    () => wbGet(urlOrders, n, force, onRetry));

  /* Строим кэш маппинга из заказов ДО загрузки стоков.
     Заказы содержат nmId+chrtId+supplierArticle+techSize — всё что нужно. */
  const all = Array.isArray(orders) ? orders : [];
  buildCardsCacheFromOrders(all);
  buildChrtCache(all);

  /* Остатки — новый Analytics API */
  const stk = await cached(`wb${n}:stocks`, force,
    () => loadStocksNew(n, onRetry));
  const t = td(), y = yd(), w = wd();

  D[n] = {
    isOz: false,
    allOrders: all,
    todayO:  all.filter((o) => (o.date || "").startsWith(t)),
    yestO:   all.filter((o) => (o.date || "").startsWith(y)),
    orders7: all.filter((o) => (o.date || "") >= w),
    stocks:  Array.isArray(stk) ? stk : [],
  };
  return D[n];
}

async function cached(key, force, fn) {
  if (!force) {
    const hit = cacheGet(key);
    if (hit) return hit;
  }
  const data = await fn();
  cacheSet(key, data);
  return data;
}
