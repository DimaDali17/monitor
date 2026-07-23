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
   Домен: analytics-api.wildberries.ru
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

    if (res && res.status === 401) { expired(); throw new Error("Сессия истекла"); }

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
   Загружается один раз за сессию. Нужен потому что Analytics API
   возвращает только числовые nmId и chrtId, без человекочитаемых полей. */

let cardsCache = null; /* null = ещё не грузили */

async function ensureCardsCache(cab, onRetry) {
  if (cardsCache) return;
  cardsCache = {};

  const CONTENT_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";
  let cursor = {};
  let total = 0;

  for (let page = 0; page < 100; page++) {
    const body = {
      settings: {
        cursor: { limit: 100, ...cursor },
        filter: { withPhoto: -1 },
      },
    };

    let data;
    try {
      data = await wbPost(CONTENT_URL, body, cab, onRetry);
    } catch (e) {
      console.warn("cardsCache: ошибка загрузки карточек:", e.message);
      break;
    }

    const cards = data?.cards || [];
    cards.forEach((card) => {
      const art  = card.vendorCode || "";
      const nm   = card.nmID;
      const subj = card.subjectName || card.object || "";
      (card.sizes || []).forEach((sz) => {
        const chrt   = sz.chrtID;
        const techSz = sz.techSize || sz.sizeName || "";
        if (nm && chrt) {
          cardsCache[`${nm}_${chrt}`] = { supplierArticle: art, techSize: techSz, subject: subj };
        }
      });
      total++;
    });

    const cur = data?.cursor || {};
    /* Пагинация: если карточек меньше лимита или нет курсора — конец */
    if (cards.length < 100 || !cur.updatedAt) break;
    cursor = { updatedAt: cur.updatedAt, nmID: cur.nmID };
    await sleep(300); /* небольшая пауза между страницами */
  }

  console.log(`cardsCache: загружено ${total} карточек, ${Object.keys(cardsCache).length} размеров`);
}

/* ══════════ Загрузка остатков через новый Analytics API ══════════ */

const ANAL_URL = "https://analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses";
const ANAL_PAUSE = 21_000; /* лимит 1/20 сек → ждём 21 сек между запросами */

async function loadStocksNew(cab, onRetry) {
  await ensureCardsCache(cab, onRetry);

  let all = [], offset = 0;

  for (let page = 0; page < 50; page++) {
    let data;
    try {
      data = await wbPost(ANAL_URL, { limit: 1000, offset }, cab, onRetry);
    } catch (e) {
      throw new Error("Остатки (Analytics API): " + e.message);
    }

    const rows = Array.isArray(data) ? data
               : (data?.data || data?.result || data?.items || []);
    all = all.concat(rows);
    if (rows.length < 1000) break;
    offset += 1000;
    await sleep(ANAL_PAUSE); /* строго соблюдаем лимит */
  }

  /* Маппим числовые ID в человекочитаемые поля */
  return all.map((r) => {
    const nm   = r.nmId   || r.nmID   || 0;
    const chrt = r.chrtId || r.chrtID || 0;
    const card = cardsCache?.[`${nm}_${chrt}`] || {};
    return {
      supplierArticle: card.supplierArticle || String(nm), /* fallback: nmId как строка */
      techSize:        card.techSize        || String(chrt),
      warehouseName:   r.warehouseName      || "",
      quantity:        r.quantity           ?? 0,
      subject:         card.subject         || "",
      category:        card.subject         || "",
      /* Дополнительные поля — могут пригодиться */
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

  /* Остатки — новый Analytics API (кэшируем на 10 мин как раньше) */
  const stk = await cached(`wb${n}:stocks`, force,
    () => loadStocksNew(n, onRetry));

  const all = Array.isArray(orders) ? orders : [];
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
