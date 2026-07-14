import { WB_BASE, WB_GAP, WB_BACKOFF, WB_TIMEOUT, ORDERS_DAYS } from "../config.js";
import { K, PX, D } from "../state.js";
import { td, yd, wd, daysAgo } from "../utils.js";
import { cacheGet, cacheSet } from "./cache.js";

/* ══════════════════════════════════════════════════════════
   Почему раньше сыпался 429

   1. Ретрай через 3 секунды. WB считает лимит Statistics API
      по ключу и продлевает окно блокировки на каждой попытке
      внутри него — 4 попытки за 25 секунд гарантировали залип.
   2. Retry-After читался, но через CORS браузер его не отдаёт,
      если воркер не проставил Access-Control-Expose-Headers.
      Возвращался null → падали обратно на те же 3 секунды.
   3. Пустой ответ (воркер отвалился по таймауту на тяжёлом
      запросе EF — 62 дня заказов) считался ошибкой и запускал
      ретрай. У EZFR заказов меньше, запрос легче — оттого и
      казалось, что «падает именно EF».
   4. reload() и reloadForConso() могли стартовать параллельно:
      два одинаковых запроса к одному методу.

   Что сделано: пауза 20 с между запросами, бэкофф от минуты,
   кэш на 10 минут, guard по ключу запроса.
   ══════════════════════════════════════════════════════════ */

const pxFor = (cab) => (cab === 2 && PX.second ? PX.second : PX.main);

/* Последовательная очередь: ни один запрос не уходит раньше,
   чем через WB_GAP после предыдущего — независимо от кабинета. */
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

/* Дедупликация: пока запрос летит, повторный вызов получает ту же промис */
const inflight = new Map();

async function wbGet(url, token, cab, onRetry) {
  const key = cab + "|" + url;
  if (inflight.has(key)) return inflight.get(key);

  const p = enqueue(() => attempt(url, token, cab, onRetry)).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function attempt(url, token, cab, onRetry) {
  const purl = pxFor(cab) + "?url=" + encodeURIComponent(url);
  let reason = "";

  for (let i = 0; i <= WB_BACKOFF.length; i++) {
    let res = null, txt = "";
    try {
      res = await fetchWithTimeout(purl, { headers: { "X-WB-Token": token } }, WB_TIMEOUT);
      txt = await res.text();
    } catch (e) {
      reason = e.name === "AbortError" ? "таймаут прокси" : "сеть: " + e.message;
    }

    const empty = res && res.ok && (!txt || !txt.trim());
    const rateLimited = res && res.status === 429;
    const serverErr = res && res.status >= 500;

    if (res && res.ok && !empty) {
      try { return JSON.parse(txt); }
      catch { throw new Error("WB вернул не JSON: " + txt.slice(0, 160)); }
    }

    if (res && !res.ok && !rateLimited && !serverErr) {
      throw new Error(`WB ${res.status}: ${txt.slice(0, 200)}`);
    }

    if (rateLimited) reason = "429 — превышен лимит запросов";
    else if (serverErr) reason = "WB " + res.status;
    else if (empty) reason = "прокси вернул пустой ответ";

    if (i === WB_BACKOFF.length) {
      throw new Error(
        `${reason}. Сделано ${WB_BACKOFF.length + 1} попытки за ~${Math.round(WB_BACKOFF.reduce((a, b) => a + b, 0) / 1000)} с. ` +
        `Подождите пару минут — данные отдадутся из кэша, если он ещё свежий.`
      );
    }

    /* Retry-After в секундах, если воркер его прокинул наружу.
       Чтобы заголовок дошёл, воркер должен отдавать:
       Access-Control-Expose-Headers: Retry-After */
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

/* ── Загрузка кабинета ── */
export async function loadWB(n, { force = false, onRetry } = {}) {
  const key = K[n];
  if (!key) throw new Error("Не задан API-ключ кабинета");

  const ordFrom = daysAgo(ORDERS_DAYS) + "T00:00:00Z";
  const stkFrom = new Date().getFullYear() + "-01-01T00:00:00Z";
  const urlOrders = `${WB_BASE}/orders?dateFrom=${ordFrom}&flag=0`;
  const urlStocks = `${WB_BASE}/stocks?dateFrom=${stkFrom}&flag=0`;

  /* Заказы и стоки кэшируются раздельно: если один метод упёрся в лимит,
     второй всё равно отдастся из кэша, а не утянет весь рендер в ошибку. */
  const [orders, stocks] = await Promise.all([
    cached(`wb${n}:orders`, force, () => wbGet(urlOrders, key, n, onRetry)),
    cached(`wb${n}:stocks`, force, () => wbGet(urlStocks, key, n, onRetry)),
  ]);

  const all = Array.isArray(orders) ? orders : [];
  const stk = Array.isArray(stocks) ? stocks : [];
  const t = td(), y = yd(), w = wd();

  D[n] = {
    isOz: false,
    allOrders: all,
    todayO: all.filter((o) => (o.date || "").startsWith(t)),
    yestO: all.filter((o) => (o.date || "").startsWith(y)),
    orders7: all.filter((o) => (o.date || "") >= w),
    stocks: stk,
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
