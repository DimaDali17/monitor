import { CSV_BUYRATE, CSV_RAW, CSV_MAP, DEFAULT_BUYRATE } from "../config.js";
import { normSz } from "../utils.js";

/* ══════════════════════════════════════════════════════════
   Справочники из Google Sheets: выкупаемость, сырьё + СГП, маппинг.
   Ключевое отличие от старой версии — индексы строятся один раз
   после загрузки. Раньше getStocksForArt на каждый артикул
   сканировал весь gSgp и весь gMap: 300 артикулов × 2000 строк
   маппинга = сотни тысяч итераций на каждую перерисовку таблицы.

   СГП больше НЕ отдельный лист. Готовая продукция лежит в «Остатки
   сводная» вместе с сырьём и определяется по префиксу артикула «СГП »
   (СГП + пробел). Пример: строка «СГП TS 21 Num 1» → это остаток
   готовой продукции по артикулу ВБ «TS 21 Num 1».
   ══════════════════════════════════════════════════════════ */

/* Префикс готовой продукции в колонке «Арт производ». Регистр/пробелы
   допускаем любые, но по брифу это ровно «СГП » (СГП + один пробел). */
const SGP_RE = /^СГП\s+/i;

export const sheets = {
  loaded: false,
  buyrate: {},   /* artLower → 0..1 */
  sgp: {},       /* "wbArt;wbSz(norm)" → шт */
  raw: {},       /* "artPr;szPr(norm)" → шт */
  map: {},       /* "wbArt;wbSz" → [{artPr, szPr}] */
  revMap: {},    /* "baseArt;szPr(norm)" → wbSz — для разбора Ozon-артикулов */
  /* индексы */
  sgpByArt: {},  /* wbArt → шт (все размеры) */
  rawByArt: {},  /* wbArt → шт (через маппинг, без двойного счёта) */
};

let inflight = null;
const buyrateCache = new Map();

/* ── CSV с учётом кавычек ──
   Старый парсер делал split(',') и разъезжался на любом
   «Брюки, чёрные» — маппинг тихо бился. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];

  const hdr = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => {
      const o = {};
      hdr.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
      return o;
    });
}

export function loadExternal() {
  if (sheets.loaded) return Promise.resolve();
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [rB, rR, rM] = await Promise.all(
        [CSV_BUYRATE, CSV_RAW, CSV_MAP].map((u) => fetch(u).then((r) => r.text()))
      );

      sheets.buyrate = {}; sheets.sgp = {}; sheets.raw = {}; sheets.map = {};
      buyrateCache.clear();

      /* Выкупаемость */
      parseCSV(rB).forEach((row) => {
        const art = (row["supplierArticle"] || "").toLowerCase();
        const p = (row["Выкупаемость"] || "").replace("%", "").trim();
        if (art && p) sheets.buyrate[art] = parseFloat(p) / 100;
      });

      /* Маппинг: WB-арт + WB-размер → произв-арт + произв-размер */
      parseCSV(rM).forEach((row) => {
        const artPr = row["Артикул произв"] || "";
        const szPr = row["Размер произв"] || "";
        const szWB = row["Размер ВБ"] || "";
        [row["Арт ВБ"], row["Арт ВБ2"]].forEach((wb) => {
          const wbArt = (wb || "").trim();
          if (!wbArt || !artPr) return;
          const k = wbArt.toLowerCase() + ";" + szWB.toLowerCase();
          (sheets.map[k] ||= []).push({ artPr, szPr });
        });
      });

      /* Остатки сводная: сырьё + СГП в одном листе.
         Строки с префиксом «СГП » → готовая продукция (ключ по артикулу ВБ).
         Остальные → сырьё; nobrand-артикулы дублируем под «чистым» именем. */
      parseCSV(rR).forEach((row) => {
        const art = row["Арт производ"] || "";
        const sz = row["Размер"] || "";
        const qty = parseInt(row["SUM из Штук"] || "0", 10) || 0;
        if (!art) return;

        if (SGP_RE.test(art)) {
          const wbArt = art.replace(SGP_RE, "").trim();
          if (!wbArt || !qty) return;
          const k = wbArt.toLowerCase() + ";" + normSz(sz).toLowerCase();
          sheets.sgp[k] = (sheets.sgp[k] || 0) + qty;
          return;
        }

        const kSz = normSz(sz).toLowerCase();
        const k = art.toLowerCase() + ";" + kSz;
        sheets.raw[k] = (sheets.raw[k] || 0) + qty;
        if (art.toLowerCase().includes(" nobrand")) {
          const k2 = art.toLowerCase().replace(" nobrand", "").trim() + ";" + kSz;
          sheets.raw[k2] = (sheets.raw[k2] || 0) + qty;
        }
      });

      buildIndexes();
      sheets.loaded = true;
      console.log(
        `Справочники: выкупаемость=${Object.keys(sheets.buyrate).length} ` +
        `СГП=${Object.keys(sheets.sgp).length} сырьё=${Object.keys(sheets.raw).length} ` +
        `маппинг=${Object.keys(sheets.map).length}`
      );
    } catch (e) {
      console.warn("Справочники не загрузились:", e);
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/* Индексы: артикул → сумма. Строятся один раз, читаются за O(1). */
function buildIndexes() {
  sheets.sgpByArt = {};
  sheets.rawByArt = {};
  sheets.revMap = {};

  for (const [k, v] of Object.entries(sheets.sgp)) {
    const art = k.split(";")[0];
    sheets.sgpByArt[art] = (sheets.sgpByArt[art] || 0) + v;
  }

  /* Сырьё по артикулу — через маппинг, каждый произв-ключ считаем один раз */
  const seenPerArt = {};
  for (const [k, mappings] of Object.entries(sheets.map)) {
    const wbArt = k.split(";")[0];
    (seenPerArt[wbArt] ||= new Set());
    for (const { artPr, szPr } of mappings) {
      const kp = artPr.toLowerCase() + ";" + normSz(szPr).toLowerCase();
      if (seenPerArt[wbArt].has(kp)) continue;
      seenPerArt[wbArt].add(kp);
      sheets.rawByArt[wbArt] = (sheets.rawByArt[wbArt] || 0) + (sheets.raw[kp] || 0);

      /* обратный маппинг для разбора Ozon offer_id */
      const rk = wbArt + ";" + normSz(szPr).toLowerCase();
      if (!sheets.revMap[rk]) sheets.revMap[rk] = k.split(";")[1] || "";
    }
  }

  /* Фолбэк: артикулы, которых нет в маппинге, но есть в сырье напрямую */
  for (const [k, v] of Object.entries(sheets.raw)) {
    const art = k.split(";")[0];
    if (sheets.rawByArt[art] == null && !seenPerArt[art]) {
      sheets.rawByArt[art] = (sheets.rawByArt[art] || 0) + v;
    }
  }
}

/* ── Выкупаемость (мемоизирована: вызывается на каждую строку каждого рендера) ── */
export function getBuyrate(art) {
  if (!art) return { val: DEFAULT_BUYRATE, est: true };
  const k = art.toLowerCase();
  if (buyrateCache.has(k)) return buyrateCache.get(k);

  let res = { val: DEFAULT_BUYRATE, est: true };
  if (sheets.buyrate[k] != null) {
    res = { val: sheets.buyrate[k], est: false };
  } else {
    for (const [ka, v] of Object.entries(sheets.buyrate)) {
      if (k.includes(ka) || ka.includes(k)) { res = { val: v, est: false }; break; }
    }
  }
  buyrateCache.set(k, res);
  return res;
}

/* ── Остатки СГП/Сырьё ── */
export function getStocksForSz(wbArt, wbSz) {
  const ka = (wbArt || "").toLowerCase();
  const kzRaw = (wbSz || "").toLowerCase();            /* маппинг хранит сырой размер ВБ */
  const kzNorm = normSz(wbSz || "").toLowerCase();     /* СГП хранится нормализованным */
  const sgp = sheets.sgp[ka + ";" + kzNorm] || 0;
  let raw = 0;
  for (const { artPr, szPr } of sheets.map[ka + ";" + kzRaw] || []) {
    raw += sheets.raw[artPr.toLowerCase() + ";" + normSz(szPr).toLowerCase()] || 0;
  }
  return { sgp, raw };
}

export function getStocksForArt(wbArt) {
  const ka = (wbArt || "").toLowerCase();
  return { sgp: sheets.sgpByArt[ka] || 0, raw: sheets.rawByArt[ka] || 0 };
}

/* ── Ozon: "Pantal.SK.bejnew.02_XL" → базовый артикул + размер в терминах WB ── */
export function parseOzonArt(offerId) {
  const s = offerId || "";
  const i = s.lastIndexOf("_");
  if (i < 0) return { baseArt: s, ozSz: "", wbSz: "" };
  const baseArt = s.slice(0, i);
  const ozSz = s.slice(i + 1);
  const rk = baseArt.toLowerCase() + ";" + normSz(ozSz).toLowerCase();
  return { baseArt, ozSz, wbSz: sheets.revMap[rk] || ozSz };
}
