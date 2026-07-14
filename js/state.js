/* Ключи здесь отсутствуют намеренно: они живут в секретах воркера
   и в браузер не попадают. Клиент знает только номер кабинета. */

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
