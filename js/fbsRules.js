/* ══════════════════════════════════════════════════════════
   Правила наличия на FBS-складах (свои склады продавца).
   Блок «Остатки по FBS» подсвечивает обязательные склады, где пусто или мало,
   и показывает, есть ли из чего пополнить (сырьё + СГП).

   rule:  "all"   — на всех складах
          "exMsk" — на всех, кроме Москвы (МСК не обязателен)
          "pyat"  — только Пятигорск
   cab:   если задан — правило действует только в этом кабинете
          (1 = Easyform, 2 = EZFR). Термобельё и леггинсы — только EZFR.
   ══════════════════════════════════════════════════════════ */

export const FBS_LOW = 3;   /* «мало» — 3 шт и меньше на обязательном складе */

export const FBS_RULES = [
  { name: "Нум1,3",      rule: "exMsk", arts: ["TS21num1", "TS26num3new"] },
  { name: "Нум4",        rule: "exMsk", arts: ["TS21num4"] },
  { name: "rab1, rab4",  rule: "exMsk", arts: ["TermSocks.EF.Rab.01", "TermSocks.EF.Rab.04"] },
  { name: "rab2, rab3",  rule: "all",   arts: ["TermSocks.EF.Rab.02", "TermSocks.EF.Rab.03"] },
  { name: "Каш01",       rule: "all",   arts: ["TermSocks.Kash.Assor.01"] },
  { name: "Каш02",       rule: "all",   arts: ["TermSocks.Kash.Assor.02"] },
  { name: "Каш04",       rule: "all",   arts: ["TermSocks.Kash.Assor.04"] },
  { name: "Аляска",      rule: "exMsk", arts: ["TermSocks.Al-ESS.black.01", "TermSocks.Al-ESS.grey.01", "TermSocks.Al-ESS.purp.01"] },
  { name: "Муж т/ш",     rule: "all",   arts: ["Termshort.men.EF.black"] },
  { name: "Т/ш беж",     rule: "all",   arts: ["TermShort.new.SK.beige.01"] },
  { name: "Т/ш черн",    rule: "all",   arts: ["TermShort.new.SK.black.01"] },
  { name: "Верблюды",    rule: "exMsk", arts: ["Trus.EF.Verb.beige.01"] },
  { name: "02 беж пант", rule: "pyat",  arts: ["Pantal.SK.bejnew.02"] },
  /* Майку Brown больше не продаём — в правила не включена */
  { name: "Термомайки",  rule: "all",   arts: ["TermoMai.EF.Beige1", "TermoMai.EF.Black1", "TermoMai.EF.Grey1", "TermoMai.ESS.Black.01", "TermoMai.ESS.Grey.01"] },
  { name: "ТБ",          rule: "all",   arts: ["TB.EF.black.01", "TB.EF.black.02"], cab: 2 },
  { name: "Легги",       rule: "all",   arts: ["LegW.EF.black.01"], cab: 2 },
];

/* Артикулы, которые шьются из одного сырья (общий пул), даже если в «Арт производ»
   это видно не целиком. Для «есть ли из чего пополнить» берём сырьё всего пула. */
export const RAW_POOLS = [
  ["TS21num1", "TS26num3new", "TS21num4"],
];

const RULE_TEXT = { all: "все склады", exMsk: "кроме МСК", pyat: "только Пятигорск" };
export const ruleText = (r) => RULE_TEXT[r] || r;

export const isMsk = (wh) => /мск|москв/i.test(wh || "");
export const isPyat = (wh) => /пятигорск/i.test(wh || "");

/* Правило для артикула в кабинете n (или null) */
export function ruleFor(art, n) {
  const a = String(art || "").trim().toLowerCase();
  for (const r of FBS_RULES) {
    if (r.cab && r.cab !== n) continue;
    if (r.arts.some((x) => x.toLowerCase() === a)) return r;
  }
  return null;
}

/* Обязателен ли склад по правилу */
export function whRequired(rule, wh) {
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
