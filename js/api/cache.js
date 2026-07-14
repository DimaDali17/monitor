import { CACHE_TTL, CACHE_MAX_BYTES } from "../config.js";

/* Кэш ответов API.
   Память — всегда: переключение вкладок и перерисовки не бьют по WB.
   localStorage — если помещается: переживает F5, а F5 после 429 был
   самым надёжным способом продлить себе бан.
   62 дня заказов легко весят несколько мегабайт, поэтому есть потолок. */

const mem = new Map();
const PREFIX = "ef_cache:";

export function cacheGet(key) {
  const m = mem.get(key);
  if (m && Date.now() - m.at < CACHE_TTL) return m.data;

  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.at >= CACHE_TTL) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    mem.set(key, parsed);
    return parsed.data;
  } catch {
    return null;
  }
}

export function cacheSet(key, data) {
  const entry = { at: Date.now(), data };
  mem.set(key, entry);
  try {
    const s = JSON.stringify(entry);
    if (s.length * 2 > CACHE_MAX_BYTES) return; /* слишком жирно — живёт только в памяти */
    localStorage.setItem(PREFIX + key, s);
  } catch {
    /* квота кончилась — чистим свой префикс и живём на памяти */
    cacheClear();
  }
}

export function cacheClear() {
  mem.clear();
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/* Возраст кэша в минутах — для подписи «данные от HH:MM» */
export function cacheAge(key) {
  const m = mem.get(key);
  if (!m) return null;
  return Math.round((Date.now() - m.at) / 60000);
}
