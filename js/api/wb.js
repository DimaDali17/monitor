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

function enqueue(fn, minGap = WB_GAP) {
  const run = chain.then(async () => {
    const gap = Math.max(0, lastAt + minGap - Date.now());
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

function wbPost(url, body, cab, onRetry, minGap) {
  /* POST не дедуплицируем — каждый вызов уникален (разный offset) */
  return enqueue(() => attempt("POST", url, body, cab, false, onRetry), minGap);
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

/* ══════════ Справочник карточек ══════════
   Новый Analytics API отдаёт только nmId + chrtId. Артикул поставщика
   и размер живут в карточках товара.

   Из заказов их взять нельзя: Statistics API возвращает nmId, techSize
   и barcode, но НЕ chrtId — сопоставлять размер не по чему. Поэтому
   тянем справочник из Content API: он даёт chrtID → размер напрямую
   и покрывает товары, которых ни разу не заказывали.

   Нужен токен категории «Контент» (WB_CONTENT_KEY_1/2 в секретах воркера).
   Если его нет — откатываемся на nmId из заказов: артикул будет верным,
   размер покажется как chrtId. */

const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

/* Отдельно на кабинет: у EF и EZFR свои каталоги, общий словарь
   подставлял бы чужие артикулы при переключении вкладок. */
const CARDS = { 1: null, 2: null };
const blank = () => ({ byChrt: {}, byNm: {}, byBarcode: {}, ready: false, degraded: false });
const cardsOf = (cab) => (CARDS[cab] ||= blank());

/* Content API разрешает 100 запросов в минуту — на два порядка мягче
   Statistics. Гнать каталог через общую 20-секундную очередь значило бы
   ждать минутами на ровном месте. */
const CARDS_GAP = 700;

async function loadCards(cab, onRetry) {
  const cards = blank();
  CARDS[cab] = cards;
  let cursor = { limit: 100 };

  for (let page = 0; page < 200; page++) {
    const body = { settings: { cursor, filter: { withPhoto: -1 } } };
    const d = await wbPost(CARDS_URL, body, cab, onRetry, CARDS_GAP);
    const list = d?.cards || d?.data?.cards || [];

    for (const c of list) {
      const art  = c.vendorCode || "";
      const subj = c.subjectName || "";
      const nm   = c.nmID || c.nmId;
      if (nm) cards.byNm[String(nm)] = { supplierArticle: art, subject: subj };

      for (const sz of c.sizes || []) {
        const chrt = sz.chrtID || sz.chrtId;
        if (!chrt) continue;
        cards.byChrt[String(chrt)] = {
          supplierArticle: art,
          techSize: sz.techSize || "—",
          subject: subj,
        };
        /* Баркоды нужны для запроса остатков FBS (marketplace v3/stocks) */
        for (const bc of sz.skus || []) {
          if (bc) cards.byBarcode[String(bc)] = {
            supplierArticle: art, techSize: sz.techSize || "—", subject: subj,
          };
        }
      }
    }

    const cur = d?.cursor || d?.data?.cursor || {};
    /* WB отдаёт страницы курсором: пока вернулось ровно limit — есть ещё */
    if ((cur.total ?? list.length) < (cursor.limit || 100)) break;
    cursor = { limit: 100, updatedAt: cur.updatedAt, nmID: cur.nmID };
    if (!cur.updatedAt && !cur.nmID) break;
  }

  cards.ready = true;
  console.log(`Кабинет ${cab}: каталог ${Object.keys(cards.byChrt).length} размеров, ${Object.keys(cards.byNm).length} товаров`);
  return cards;
}

/* Запасной справочник: артикул по nmId из заказов. Размера в нём нет. */
function buildFallbackFromOrders(cab, orders) {
  const cards = cardsOf(cab);
  let n = 0;
  (orders || []).forEach((o) => {
    const nm = o.nmId || o.nmID;
    if (!nm || cards.byNm[String(nm)]) return;
    cards.byNm[String(nm)] = {
      supplierArticle: o.supplierArticle || "",
      subject: o.subject || o.category || "",
    };
    n++;
  });
  if (n) console.log(`Кабинет ${cab}: из заказов добрано ${n} артикулов`);
}

/* ══════════ Загрузка остатков через новый Analytics API ══════════ */

const ANAL_URL = "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses";
/* Паузу между страницами отдельно НЕ ставим: enqueue уже держит WB_GAP
   между любыми двумя запросами. Свой sleep поверх неё удваивал ожидание. */

async function loadStocksNew(cab, onRetry) {
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

  const cards = cardsOf(cab);
  let unknown = 0;

  const mapped = all.map((r) => {
    const nm   = String(r.nmId   || r.nmID   || 0);
    const chrt = String(r.chrtId || r.chrtID || 0);
    /* chrtId точнее: он про конкретный размер. nmId — только про товар. */
    const byChrt = cards.byChrt[chrt];
    const byNm   = cards.byNm[nm];
    const art    = byChrt?.supplierArticle || byNm?.supplierArticle || nm;
    const subj   = byChrt?.subject || byNm?.subject || "";
    if (!byChrt?.supplierArticle && !byNm?.supplierArticle) unknown++;

    return {
      supplierArticle: art,
      techSize:        byChrt?.techSize || "—",
      warehouseName:   r.warehouseName  || "",
      quantity:        r.quantity       ?? 0,
      subject:         subj,
      category:        subj,
      inWayToClient:   r.inWayToClient  ?? 0,
      inWayFromClient: r.inWayFromClient ?? 0,
      regionName:      r.regionName     || "",
    };
  });

  if (unknown) console.warn(`Кабинет ${cab}: ${unknown} позиций без карточки — показаны как nmId`);
  return mapped;
}

/* ══════════ Остатки FBS (склад продавца) ══════════
   Источник — Marketplace API, ДРУГОЙ домен и ДРУГАЯ область ключа:
     GET  /api/v3/warehouses            — список складов продавца (id)
     POST /api/v3/stocks/{warehouseId}  — { skus:[баркоды] } → { stocks:[{sku,amount}] }
   ВАЖНО: воркер должен пропускать домен marketplace-api.wildberries.ru
   и подставлять для него ключ с областью «Маркетплейс». Если этого нет —
   запросы вернут ошибку, FBS-остаток будет пустым, колонка покажет «—».
   Справочно: в «Общий сток» FBS НЕ входит. */

const MP_BASE = "https://marketplace-api.wildberries.ru";
const FBS_GAP = 700; /* marketplace-api мягче Statistics, свой лимит */

async function loadFBS(cab, onRetry) {
  const empty = { fbs: {}, fbsWh: {} };

  /* 1. Склады FBS продавца (id → название) */
  let whs = [];
  try {
    const w = await wbGet(`${MP_BASE}/api/v3/warehouses`, cab, false, onRetry);
    whs = Array.isArray(w) ? w : (w?.warehouses || w?.data || []);
  } catch (e) {
    console.warn(`Кабинет ${cab}: FBS-склады не загрузились — ${e.message}`);
    return empty;
  }
  const whName = {};
  (Array.isArray(whs) ? whs : []).forEach((x) => {
    const id = x.id ?? x.warehouseId ?? x.officeId;
    if (id != null) whName[id] = x.name || x.officeName || ("Склад " + id);
  });
  const whIds = Object.keys(whName);
  if (!whIds.length) { console.warn(`Кабинет ${cab}: нет складов FBS`); return empty; }

  /* 2. Баркоды товаров из карточек */
  const cards = cardsOf(cab);
  const barcodes = Object.keys(cards.byBarcode || {});
  if (!barcodes.length) { console.warn(`Кабинет ${cab}: нет баркодов (нужны карточки) — FBS пропущен`); return empty; }

  /* 3. Остатки по каждому складу, батчами по 1000 баркодов.
     fbs    — "арт · размер" → шт (сумма по складам, для дефицита);
     fbsWh  — название склада → шт (сумма по товарам, для «Остатки по складам»). */
  const fbs = {}, fbsWh = {};
  for (const wid of whIds) {
    const nm = whName[wid];
    for (let i = 0; i < barcodes.length; i += 1000) {
      const skus = barcodes.slice(i, i + 1000);
      let data;
      try {
        data = await wbPost(`${MP_BASE}/api/v3/stocks/${wid}`, { skus }, cab, onRetry, FBS_GAP);
      } catch (e) {
        console.warn(`Кабинет ${cab}: FBS-остатки склад ${wid} — ${e.message}`);
        continue;
      }
      const rows = data?.stocks || data?.data?.stocks || [];
      for (const r of rows) {
        const bc = String(r.sku || r.barcode || "");
        const amt = r.amount ?? r.quantity ?? 0;
        if (!bc || !amt) continue;
        const meta = cards.byBarcode[bc];
        if (!meta) continue; /* баркод не из нашего каталога */
        const key = meta.supplierArticle + " · " + (meta.techSize || "—");
        fbs[key] = (fbs[key] || 0) + amt;
        fbsWh[nm] = (fbsWh[nm] || 0) + amt;
      }
    }
  }
  console.log(`Кабинет ${cab}: FBS-остатки по ${Object.keys(fbs).length} позициям, складов ${whIds.length}`);
  return { fbs, fbsWh };
}

/* ══════════ Основная загрузка кабинета ══════════ */

export async function loadWB(n, { force = false, onRetry } = {}) {
  const ordFrom  = daysAgo(ORDERS_DAYS) + "T00:00:00Z";
  const urlOrders = `${WB_BASE}/orders?dateFrom=${ordFrom}&flag=0`;

  /* Заказы — старый Statistics API (не менялся) */
  const orders = await cached(`wb${n}:orders`, force,
    () => wbGet(urlOrders, n, force, onRetry));

  const all = Array.isArray(orders) ? orders : [];

  /* Справочник карточек. Меняется редко — кэшируем наравне с данными.
     Если токена «Контент» нет, воркер вернёт понятную 500: тогда
     работаем на артикулах из заказов, без размеров. */
  try {
    const hit = force ? null : cacheGet(`wb${n}:cards`);
    if (hit) {
      CARDS[n] = { byChrt: hit.byChrt, byNm: hit.byNm, ready: true, degraded: false };
      console.log(`Кабинет ${n}: каталог из кэша, ${Object.keys(hit.byChrt).length} размеров`);
    } else {
      onRetry?.("загружаю справочник артикулов", 0, 0);
      const c = await loadCards(n, onRetry);
      cacheSet(`wb${n}:cards`, { byChrt: c.byChrt, byNm: c.byNm });
    }
  } catch (e) {
    cardsOf(n).degraded = true;
    console.warn(`Кабинет ${n}: справочник не загрузился — ${e.message}`);
    onRetry?.("справочник недоступен, беру артикулы из заказов", 0, 0);
  }
  buildFallbackFromOrders(n, all);

  /* Остатки — новый Analytics API */
  const stk = await cached(`wb${n}:stocks`, force,
    () => loadStocksNew(n, onRetry));

  /* Остатки FBS (склад продавца) — best-effort, справочно.
     Если воркер/ключ не готов — вернётся {}, колонка покажет «—». */
  let fbsRes = { fbs: {}, fbsWh: {} };
  try {
    fbsRes = await cached(`wb${n}:fbs2`, force, () => loadFBS(n, onRetry));
  } catch (e) {
    console.warn(`Кабинет ${n}: FBS не загрузился — ${e.message}`);
  }

  const t = td(), y = yd(), w = wd();

  D[n] = {
    isOz: false,
    allOrders: all,
    todayO:  all.filter((o) => (o.date || "").startsWith(t)),
    yestO:   all.filter((o) => (o.date || "").startsWith(y)),
    orders7: all.filter((o) => (o.date || "") >= w),
    stocks:  Array.isArray(stk) ? stk : [],
    fbs:     fbsRes.fbs || {},
    fbsWh:   fbsRes.fbsWh || {},
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
