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
    throw new Error(`Ozon ${res.status}: ${t.slice(0, 300)}`);
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

  const postings = await cached("oz:orders", force, async () => {
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

  const stocks = await cached("oz:stocks", force, async () => {
    const out = [];
    for (let p = 0, offset = 0; p < 6; p++, offset += 500) {
      const d = await ozPost(`${OZ_BASE}/v2/analytics/stock_on_warehouses`, {
        warehouse_type: "FBO",
        limit: 500,
        offset,
      });
      const rows = d.result?.rows || [];
      out.push(...rows);
      if (rows.length < 500) break;
    }
    return out;
  });

  const dayOf = (o) => (o.created_at || o.in_process_at || "").slice(0, 10);

  D[3] = {
    isOz: true,
    allOrders: postings,
    todayO: postings.filter((o) => dayOf(o) === t),
    yestO: postings.filter((o) => dayOf(o) === y),
    orders7: postings.filter((o) => dayOf(o) >= w),
    stocks,
  };
  return D[3];
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
