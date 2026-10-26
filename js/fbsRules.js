/* ══════════════════════════════════════════════════════════
   Правила наличия на FBS-складах (свои склады продавца).
   Блок «Остатки по FBS» подсвечивает обязательные склады, где пусто или мало,
   и показывает, есть ли из чего пополнить (сырьё + СГП).

   rule:  "none"  — НЕ держим на FBS (всё на FBO): норма — 0 на всех складах
          "all"   — на всех складах
          "exMsk" — на всех, кроме Москвы (МСК не обязателен)
          "pyat"  — только Пятигорск
   cab:   в каком кабинете действует правило (1 = Easyform / ИП1, 2 = EZFR / ИП2).
   ══════════════════════════════════════════════════════════ */

/* «Мало» — остатка на складе хватит на FBS_LOW_DAYS дней или меньше при текущем темпе
   FBS-заказов с этого склада (за последние 7 дней). Если по кабинету нет данных,
   с какого склада ушёл заказ, — запасной порог FBS_LOW штук. */
export const FBS_LOW_DAYS = 2;
export const FBS_LOW = 3;

/* arts: точный артикул или префикс со звёздочкой ("TermoMai.*" — все термомайки).
   exclude: артикулы, которые правило не трогает (сняты с продажи). */
export const FBS_RULES = [
  /* ── ИП1 · Easyform ── */
  /* Порядок важен: срабатывает первое подходящее правило, поэтому «none» — выше общих */
  { cab: 1, name: "Нум3",        rule: "none",  arts: ["TS21num3"] },
  { cab: 1, name: "Майки ESS (на FBO)", rule: "none", arts: ["TermoMai.ESS.Black.01", "TermoMai.ESS.Grey.01"] },
  { cab: 1, name: "Нум1,3",      rule: "exMsk", arts: ["TS21num1", "TS26num3new"] },
  { cab: 1, name: "Нум4",        rule: "exMsk", arts: ["TS21num4"] },
  { cab: 1, name: "rab1, rab4",  rule: "exMsk", arts: ["TermSocks.EF.Rab.01", "TermSocks.EF.Rab.04"] },
  { cab: 1, name: "rab2, rab3",  rule: "all",   arts: ["TermSocks.EF.Rab.02", "TermSocks.EF.Rab.03"] },
  { cab: 1, name: "Каш01",       rule: "all",   arts: ["TermSocks.Kash.Assor.01"] },
  { cab: 1, name: "Каш02",       rule: "all",   arts: ["TermSocks.Kash.Assor.02"] },
  { cab: 1, name: "Каш04",       rule: "all",   arts: ["TermSocks.Kash.Assor.04"] },
  { cab: 1, name: "Аляска",      rule: "exMsk", arts: ["TermSocks.Al-ESS.*"] },
  { cab: 1, name: "Муж т/ш",     rule: "all",   arts: ["Termshort.men.EF.black"] },
  { cab: 1, name: "Т/ш беж",     rule: "all",   arts: ["TermShort.new.SK.beige.01"] },
  { cab: 1, name: "Т/ш черн",    rule: "all",   arts: ["TermShort.new.SK.black.01"] },
  { cab: 1, name: "Верблюды",    rule: "exMsk", arts: ["Trus.EF.Verb.beige.01"] },
  { cab: 1, name: "Волна пант",  rule: "pyat",  arts: ["Pantal.AN.Bej.01"] },
  { cab: 1, name: "02 беж пант", rule: "pyat",  arts: ["Pantal.SK.bejnew.02"] },
  { cab: 1, name: "Термомайки",  rule: "all",   arts: ["TermoMai.*"], exclude: ["TermoMai.EF.Brown1"] },   /* Brown сняли с продажи */

  /* ── ИП2 · EZFR ── */
  { cab: 2, name: "ТБ основное", rule: "all",   arts: ["TB.EF.black.02"] },
  { cab: 2, name: "ТБ новое",    rule: "all",   arts: ["TBEssblack"] },
  { cab: 2, name: "Легги",       rule: "all",   arts: ["EFlegblack", "Leg.Dov.black.gift01"] },
];

/* Артикулы, которые шьются из одного сырья (общий пул), даже если в «Арт производ»
   это видно не целиком. Для «есть ли из чего пополнить» берём сырьё всего пула. */
export const RAW_POOLS = [
  ["TS21num1", "TS21num3", "TS26num3new", "TS21num4"],
];

const RULE_TEXT = { all: "все склады", exMsk: "кроме МСК", pyat: "только Пятигорск", none: "0 на FBS (всё на FBO)" };
export const ruleText = (r) => RULE_TEXT[r] || r;

/* Наши FBS-склады — фиксированный список. «Все склады» = эти пять, даже если в кабинете
   (например, в EZFR) сейчас заведено меньше: недостающий склад считается пустым.
   Название склада из WB сопоставляется по шаблону. */
export const FBS_WAREHOUSES = [
  { name: "Пятигорск",   re: /пятигорск/i },
  { name: "Урал",        re: /урал|екатеринбург/i },
  { name: "Казань",      re: /казан/i },
  { name: "МСК",         re: /мск|москв/i },
  { name: "Новосибирск", re: /новосиб/i },
];
/* Название склада WB → наш склад из списка (или как есть, если не узнали) */
export const canonWh = (wh) => {
  const w = FBS_WAREHOUSES.find((x) => x.re.test(wh || ""));
  return w ? w.name : wh;
};

export const isMsk = (wh) => /мск|москв/i.test(wh || "");
export const isPyat = (wh) => /пятигорск/i.test(wh || "");

/* Правило для артикула в кабинете n (или null) */
/* Ozon (кабинет 3): у Ozon свои артикулы, но товары те же — сравниваем по базовому
   артикулу (без хвоста размера «_XL») и берём правила обоих ИП. */
export const ozBase = (x) => { const s = String(x || ""); const i = s.lastIndexOf("_"); return i > 0 ? s.slice(0, i) : s; };
export function ruleFor(art, n) {
  const a = String(n === 3 ? ozBase(art) : art || "").trim().toLowerCase();
  for (const r of FBS_RULES) {
    if (r.cab && n !== 3 && r.cab !== n) continue;
    if ((r.exclude || []).some((x) => x.toLowerCase() === a)) continue;
    if (r.arts.some((x) => {
      const p = x.toLowerCase();
      return p.endsWith("*") ? a.startsWith(p.slice(0, -1)) : p === a;
    })) return r;
  }
  return null;
}

/* Обязателен ли склад по правилу */
export function whRequired(rule, wh) {
  if (rule === "none") return false;
  if (rule === "pyat") return isPyat(wh);
  if (rule === "exMsk") return !isMsk(wh);
  return true;
}

/* Артикулы того же пула сырья (включая сам артикул) */
export function poolMates(art) {
  const a = String(art || "").toLowerCase();
  const p = RAW_POOLS.find((g) => g.some((x) => x.toLowerCase() === a));
  return p ? p : [art];
}
