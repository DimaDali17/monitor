import { CSV_BUYRATE, CSV_RAW, CSV_MAP, DEFAULT_BUYRATE } from "../config.js";
import { normSz } from "../utils.js";

/* ══════════════════════════════════════════════════════════
   Справочники: выкупаемость, сырьё + СГП, маппинг. Индексы строятся
   один раз, читаются за O(1).

   СГП — не отдельный лист. Готовая продукция лежит в «Остатки сводная»
   вместе с сырьём и определяется по префиксу артикула «СГП » (СГП +
   пробел): «СГП TS21num1» → остаток по артикулу ВБ «TS21num1».

   ОБЩИЙ ПУЛ СЫРЬЯ (вариант B). Один произв-артикул сырья (напр. A1905)
   может быть связан с несколькими артикулами ВБ (TS21num1/num3/num4) —
   физически это ОДИН остаток на всех. Пропорции раздела неизвестны,
   поэтому весь пул относим на ОДИН «главный» артикул, остальные видят 0.
   Главный = артикул с наименьшим номером в конце имени (num1 < num3;
   сравнение числовое, поэтому num2 < num10). Так сырьё не задваивается,
   а суммарный остаток совпадает с суммой строк.
   ══════════════════════════════════════════════════════════ */

const SGP_RE = /^СГП\s+/i;

/* Число в конце артикула (…num1 → 1). Нет числа → в конец очереди. */
function trailingNum(s) {
  const m = (s || "").match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : Infinity;
}
/* Главный артикул пула: наименьший номер, при равенстве — по алфавиту. */
function primaryOf(users) {
  return [...users].sort((a, b) => {
    const na = trailingNum(a), nb = trailingNum(b);
    return na !== nb ? na - nb : a.localeCompare(b);
  })[0];
}

export const sheets = {
  loaded: false,
  buyrate: {},      /* artLower → 0..1 */
  sgp: {},          /* "wbArt;wbSz(norm)" → шт */
  raw: {},          /* "artPr;szPr(norm)" → шт */
  map: {},          /* "wbArt;wbSz" → [{artPr, szPr}] */
  revMap: {},       /* "baseArt;szPr(norm)" → wbSz — разбор Ozon-артикулов */
  artDisplay: {},   /* wbArtLower → как записан в справочнике (для подсказок) */
  /* индексы */
  sgpByArt: {},     /* wbArt → шт (все размеры) */
  rawByArt: {},     /* wbArt → шт (только пулы, где он главный) */
  rawKeysByArt: {}, /* wbArt → Set(ключ сырья) — какие пулы связаны с артикулом */
  rawUsers: {},     /* ключ сырья → Set(wbArt) — кто связан с пулом (size>1 ⇒ общий) */
  rawPrimary: {},   /* ключ сырья → wbArt-главный, кому отнесён остаток пула */
  setByRawKey: {},  /* ключ сырья → «В наборе штук»: сырьё(штук) / set = наборы */
};

let inflight = null;
const buyrateCache = new Map();

/* ── CSV с учётом кавычек ── */
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

      sheets.buyrate = {}; sheets.sgp = {}; sheets.raw = {}; sheets.map = {}; sheets.artDisplay = {}; sheets.setByRawKey = {};
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
        /* Сколько штук сырья в одном наборе (готовом артикуле ВБ). Пусто/1 — не делим. */
        const setN = parseInt(row["В наборе штук"] || row["В набор штук"] || "1", 10) || 1;
        if (artPr && setN > 1) {
          const rkSet = artPr.toLowerCase() + ";" + normSz(szPr).toLowerCase();
          sheets.setByRawKey[rkSet] = setN;
        }
        [row["Арт ВБ"], row["Арт ВБ2"]].forEach((wb) => {
          const wbArt = (wb || "").trim();
          if (!wbArt || !artPr) return;
          const k = wbArt.toLowerCase() + ";" + szWB.toLowerCase();
          (sheets.map[k] ||= []).push({ artPr, szPr });
          sheets.artDisplay[wbArt.toLowerCase()] = wbArt;
        });
      });

      /* Остатки сводная: сырьё + СГП в одном листе.
         «СГП …» → готовая продукция; остальное → сырьё (nobrand дублируем). */
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

/* Остаток пула в НАБОРАХ: штуки сырья / «В наборе штук» (целое число наборов). */
function rawSets(rk) {
  return Math.floor((sheets.raw[rk] || 0) / (sheets.setByRawKey[rk] || 1));
}

/* Индексы. Порядок: связи артикул↔пул → главный пула → остаток на главного. */
function buildIndexes() {
  sheets.sgpByArt = {};
  sheets.rawByArt = {};
  sheets.rawKeysByArt = {};
  sheets.rawUsers = {};
  sheets.rawPrimary = {};
  sheets.revMap = {};
  /* setByRawKey строится при разборе маппинга (в loadExternal), здесь не трогаем */

  for (const [k, v] of Object.entries(sheets.sgp)) {
    const art = k.split(";")[0];
    sheets.sgpByArt[art] = (sheets.sgpByArt[art] || 0) + v;
  }

  /* Pass 1: артикул ВБ ↔ ключи сырья (через маппинг, дедуп на артикул) */
  const seenPerArt = {};
  for (const [k, mappings] of Object.entries(sheets.map)) {
    const wbArt = k.split(";")[0];
    (seenPerArt[wbArt] ||= new Set());
    for (const { artPr, szPr } of mappings) {
      const kp = artPr.toLowerCase() + ";" + normSz(szPr).toLowerCase();
      if (seenPerArt[wbArt].has(kp)) continue;
      seenPerArt[wbArt].add(kp);
      (sheets.rawKeysByArt[wbArt] ||= new Set()).add(kp);
      (sheets.rawUsers[kp] ||= new Set()).add(wbArt);

      const rk = wbArt + ";" + normSz(szPr).toLowerCase();
      if (!sheets.revMap[rk]) sheets.revMap[rk] = k.split(";")[1] || "";
    }
  }

  /* Фолбэк: сырьё без маппинга — артикул сырья сам себе пул */
  for (const [k] of Object.entries(sheets.raw)) {
    const art = k.split(";")[0];
    if (!sheets.rawUsers[k] && !seenPerArt[art]) {
      (sheets.rawKeysByArt[art] ||= new Set()).add(k);
      (sheets.rawUsers[k] ||= new Set()).add(art);
    }
  }

  /* Pass 2: главный артикул каждого пула */
  for (const [rk, users] of Object.entries(sheets.rawUsers)) {
    sheets.rawPrimary[rk] = primaryOf(users);
  }

  /* Pass 3: остаток сырья на артикул — только пулы, где он главный */
  for (const [wbArt, keys] of Object.entries(sheets.rawKeysByArt)) {
    let sum = 0;
    for (const rk of keys) if (sheets.rawPrimary[rk] === wbArt) sum += rawSets(rk);
    sheets.rawByArt[wbArt] = sum;
  }
}

/* ── Выкупаемость (мемоизирована) ── */
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
    const rk = artPr.toLowerCase() + ";" + normSz(szPr).toLowerCase();
    if (sheets.rawPrimary[rk] && sheets.rawPrimary[rk] !== ka) continue; /* пул — у главного */
    raw += rawSets(rk); /* в наборах */
  }
  return { sgp, raw };
}

export function getStocksForArt(wbArt) {
  const ka = (wbArt || "").toLowerCase();
  return { sgp: sheets.sgpByArt[ka] || 0, raw: sheets.rawByArt[ka] || 0 };
}

/* ── Общий пул сырья ── */

/* Как артикул записан в справочнике (для подсказок). */
export function artDisp(a) {
  const ka = (a || "").toLowerCase();
  return sheets.artDisplay[ka] || a || "";
}

/* Другие артикулы ВБ, делящие пул сырья с wbArt (пусто — если сырьё эксклюзивно). */
export function rawSharedWith(wbArt) {
  const ka = (wbArt || "").toLowerCase();
  const sibs = new Set();
  for (const rk of sheets.rawKeysByArt[ka] || []) {
    const users = sheets.rawUsers[rk];
    if (users && users.size > 1) for (const u of users) if (u !== ka) sibs.add(u);
  }
  return [...sibs];
}

/* Главный артикул пула, на котором лежит сырьё для wbArt (если wbArt — спутник).
   Если wbArt сам главный или пул не общий — вернёт его же. */
export function rawPrimaryFor(wbArt) {
  const ka = (wbArt || "").toLowerCase();
  for (const rk of sheets.rawKeysByArt[ka] || []) {
    const users = sheets.rawUsers[rk];
    if (users && users.size > 1 && sheets.rawPrimary[rk] && sheets.rawPrimary[rk] !== ka) {
      return sheets.rawPrimary[rk];
    }
  }
  return ka;
}

/* Суммарное сырьё по набору артикулов ВБ — каждый физический пул один раз
   (не зависит от того, какой артикул назначен главным). */
export function dedupRawTotal(wbArts) {
  const keys = new Set();
  for (const a of wbArts) {
    for (const rk of sheets.rawKeysByArt[(a || "").toLowerCase()] || []) keys.add(rk);
  }
  let sum = 0;
  for (const rk of keys) sum += rawSets(rk); /* в наборах */
  return sum;
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
