import { DEFAULT_PX } from "./config.js";

/* Ключи и прокси */
export const K = { 1: "", 2: "", oid: "", okey: "" };
export const PX = { main: DEFAULT_PX, second: "" };

/* Сырые данные кабинетов: 1=Easyform, 2=EZFR, 3=Ozon */
export const D = { 1: null, 2: null, 3: null };

/* Вьюмодель = отфильтрованные данные + всё, что посчитано один раз на рендер.
   Раньше renderWB подменял D[n] на время отрисовки и возвращал обратно —
   отсюда «утёкшие» arts и сломанные фильтры. Теперь D неприкосновенен. */
export const VM = { 1: null, 2: null, 3: null };

/* Раскрытые списки */
export const EXP = { 1: false, 2: false, 3: false }; /* заказы */
export const EXS = { 1: false, 2: false, 3: false }; /* остатки */
export const EXD = { 1: false, 2: false, 3: false }; /* дефицит */

/* Открытые артикулы (аккордеон по размерам) */
export const OA = { 1: new Set(), 2: new Set(), 3: new Set() };  /* остатки */
export const OAD = { 1: new Set(), 2: new Set(), 3: new Set() }; /* дефицит */
export const OAC = new Set();                                    /* консолидация */

/* Сортировки */
export const SS = { 1: { c: "total", d: -1 }, 2: { c: "total", d: -1 }, 3: { c: "total", d: -1 } };
export const DS = { 1: { c: "stk", d: -1 }, 2: { c: "stk", d: -1 }, 3: { c: "stk", d: -1 } };

/* Фильтры */
export const FA = { 1: [], 2: [], 3: [] }; /* артикулы */
export const FP = { 1: [], 2: [], 3: [] }; /* предметы */
export const FS = { 1: "", 2: "", 3: "" };  /* поиск в таблице остатков */
export const FSZ = { 1: "", 2: "", 3: "" }; /* поиск по размеру */

/* Режим графика */
export const CM = { 1: "day", 2: "day", 3: "day" };  /* day | week | month */
export const CV = { 1: "ord", 2: "ord", 3: "ord" };  /* ord | rev */

/* Консолидация */
export const CONSO = { expandOrders: false, log: [] };

export const cabName = (n) => (n === 1 ? "Easyform" : n === 2 ? "EZFR" : n === 3 ? "Ozon" : "Консолидация");
export const cabShort = (n) => (n === 1 ? "EF" : n === 2 ? "EZFR" : "Ozon");

export function saveCreds() {
  try {
    localStorage.setItem("ef_d", JSON.stringify({
      k1: K[1], k2: K[2], oid: K.oid, okey: K.okey, px: PX.main, px2: PX.second,
    }));
  } catch { /* приватный режим — просто не сохраняем */ }
}

export function loadCreds() {
  try {
    const s = JSON.parse(localStorage.getItem("ef_d") || "{}");
    if (s.k1) K[1] = s.k1;
    if (s.k2) K[2] = s.k2;
    if (s.oid) K.oid = s.oid;
    if (s.okey) K.okey = s.okey;
    if (s.px) PX.main = s.px;
    if (s.px2) PX.second = s.px2;
  } catch { /* битый JSON — стартуем с пустыми */ }
}
