/* ── Даты ── */
export const iso = (d) => new Date(d).toISOString().slice(0, 10);
export const td = () => iso(Date.now());
export const yd = () => iso(Date.now() - 864e5);
export const wd = () => iso(Date.now() - 7 * 864e5);
export const daysAgo = (n) => iso(Date.now() - n * 864e5);

/* ── Форматирование ── */
export const fmt = (v) => Math.round(v).toLocaleString("ru") + " ₽";
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* для подстановки в onclick="fn('...')" */
export const q = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function dlt(pct) {
  const h = new Date().getHours();
  if (pct == null) return "";
  return pct >= 0
    ? `<span class="du">▲ +${pct}% vs вчера к ${h}:00</span>`
    : `<span class="dd">▼ ${pct}% vs вчера</span>`;
}
export const dltW = (pct) =>
  pct == null ? "" : pct >= 0 ? `<span class="du">▲ +${pct}%</span>` : `<span class="dd">▼ ${pct}%</span>`;

export function fmtDays(d, msk = false) {
  if (d == null) return '<span class="days-na">∞</span>';
  const cls = d < 14 ? "days-crit" : d < 30 ? "days-warn" : d <= 90 ? "days-ok" : "days-na";
  return `<span class="${cls}">${d}д${msk ? " 🏙" : ""}</span>`;
}

/* ── Цены и количества ── */
export const wbPrice = (o) =>
  o.finishedPrice || o.priceWithDisc || o.totalPrice * (1 - (o.discountPercent || 0) / 100) || o.totalPrice || 0;
export const wbQty = (s) => s.quantity || 0;
export const ozRev = (o) =>
  (o.products || []).reduce((s, p) => s + parseFloat(p.price || p.offer_price || 0) * (p.quantity || 1), 0);
/* Цена на витрине = финиш-прайс как есть (без коэффициента) */
export const sitePrice = (p) => (p > 0 ? Math.round(p) : 0);

/* ── Размеры ── */
const SZ_ORDER = {
  XXS: 101, XS: 102, S: 103, M: 104, L: 105, XL: 106,
  XXL: 107, "2XL": 107, XXXL: 108, "3XL": 108,
  "4XL": 109, "5XL": 110, "6XL": 111, "7XL": 112, "8XL": 113,
};
export function sizeOrd(sz) {
  const u = (sz || "").toUpperCase().trim();
  if (SZ_ORDER[u]) return SZ_ORDER[u];
  const n = parseFloat(u);
  return isNaN(n) ? 150 : n;
}
export const szCmp = (a, b) => sizeOrd(a) - sizeOrd(b);

/* 2XL ≡ XXL, 3XL ≡ XXXL — сводим к одному виду перед сравнением ключей */
export function normSz(sz) {
  const s = (sz || "").toUpperCase().trim();
  const m = s.match(/^(\d+)XL$/);
  return m ? "X".repeat(parseInt(m[1], 10)) + "L" : s;
}

/* ── Ключи для сопоставления между таблицами ──
   Русские буквы, похожие на латинские (А/A, В/B, С/C, Е/E, К/K, М/M, Н/H, О/O, Р/P, Т/T, У/Y, Х/X),
   в ключах считаем одной буквой: «А1905» с русской и с английской «А» — один и тот же код.
   Использование: строка.toLowerCase().replace(LAT_RE, latCh). Только для ключей, не для текста на экране. */
const LAT_MAP = { "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x" };
export const LAT_RE = /[авеёкмнорстух]/g;
export const latCh = (c) => LAT_MAP[c];
export const nk = (s) => String(s ?? "").toLowerCase().replace(LAT_RE, latCh);

/* ── Прочее ── */
export function yestToHour(orders, type) {
  const now = new Date(), h = now.getHours(), m = now.getMinutes();
  return orders.filter((o) => {
    const dt = type === "oz" ? o.in_process_at || o.created_at : o.date;
    if (!dt) return false;
    const d = new Date(dt);
    return d.getHours() < h || (d.getHours() === h && d.getMinutes() <= m);
  });
}

export function debounce(fn, ms = 150) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const pct = (part, whole) => (whole > 0 && part > 0 ? Math.round((part / whole) * 100) + "%" : "—");
