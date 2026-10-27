/* ══════════════════════════════════════════════════════════
   Бот-оповещения в Telegram на тех же расчётах, что монитор.
   Запускается по расписанию в GitHub Actions (.github/workflows/bot.yml).

   node scripts/bot.mjs morning  — «срочно на ВБ» (дефицит) + нарушения правил FBS
   node scripts/bot.mjs drop     — резкое падение заказов сегодня к этому часу

   Секреты (GitHub → Settings → Secrets and variables → Actions):
     DASH_PASSWORD  пароль от монитора (бот входит через воркер, как человек)
     TG_BOT_TOKEN   токен Telegram-бота
     TG_CHAT_ID     куда слать (id группы; несколько — через запятую)
   ══════════════════════════════════════════════════════════ */

/* Окружение браузера, которого нет в Node: память вместо localStorage */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
globalThis.location = { reload() { throw new Error("Сессия истекла — проверьте DASH_PASSWORD"); } };

const MODE = process.argv[2] || "morning";
const { DASH_PASSWORD, TG_BOT_TOKEN, TG_CHAT_ID } = process.env;
if (!DASH_PASSWORD || !TG_BOT_TOKEN || !TG_CHAT_ID) {
  console.error("Нужны секреты DASH_PASSWORD, TG_BOT_TOKEN, TG_CHAT_ID");
  process.exit(1);
}

const { login } = await import("../js/api/auth.js");
const { loadExternal, setRawScope, getStocksForArt } = await import("../js/api/sheets.js");
const { loadWB } = await import("../js/api/wb.js");
const { loadOZ } = await import("../js/api/ozon.js");
const { D, VM, cabName } = await import("../js/state.js");
const { buildVM } = await import("../js/vm.js");
const { defTbl, statusKey } = await import("../js/render/deficit.js");
const { fbsRows } = await import("../js/render/stocks.js");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MAX_LINES = 15;   /* в одном блоке; остальное — «и ещё N» */
const cap = (arr) => arr.length > MAX_LINES ? [...arr.slice(0, MAX_LINES), `…и ещё ${arr.length - MAX_LINES}`] : arr;

async function send(text) {
  for (const chat of TG_CHAT_ID.split(",").map((s) => s.trim()).filter(Boolean)) {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) console.error("Telegram:", r.status, await r.text());
  }
}

/* Кабинет: загрузить, применить «кабинетный» пул сырья (как в мониторе), построить вьюмодель */
function prepare(n) {
  const d = D[n];
  if (!d) return null;
  if (d.isOz) setRawScope(null);
  else {
    const s = new Set();
    for (const r of d.stocks || []) s.add(r.supplierArticle);
    for (const o of d.allOrders || []) s.add(o.supplierArticle);
    for (const k of Object.keys(d.fbs || {})) s.add(k.split(" · ")[0]);
    setRawScope(s);
  }
  VM[n] = buildVM(n);
  return VM[n];
}

const problems = [];
if (process.env.BOT_FAKE) {
  /* только для проверки: подставные данные вместо загрузки (node scripts/bot.mjs … с BOT_FAKE=путь) */
  await (await import(process.env.BOT_FAKE)).default({ D });
} else {
  await login(DASH_PASSWORD);
  await loadExternal();
  for (const n of [1, 2]) {
    try { await loadWB(n, {}); } catch (e) { problems.push(`⚠️ ${cabName(n)}: не загрузился — ${esc(e.message)}`); }
  }
  if (MODE === "morning") {
    try { await loadOZ({}); } catch (e) { problems.push(`⚠️ Ozon: не загрузился — ${esc(e.message)}`); }
  }
}

const parts = [];

if (MODE === "morning") {
  /* ── 2. Срочно на ВБ: запаса FBW+FBS меньше 14 дней (тот же статус, что в дефиците) ── */
  const urgent = [];
  for (const n of [1, 2]) {
    if (!prepare(n)) continue;
    const rows = defTbl(n, { rowsOnly: true })
      .filter((r) => r.o7 > 0 && statusKey(r.dStock) === "urgent")
      .sort((a, b) => (a.dStock ?? 0) - (b.dStock ?? 0));
    if (!rows.length) continue;
    const lines = rows.map((r) => {
      const src = r.sgp + r.raw;
      return `• <code>${esc(r.art)}</code> — FBW ${r.stk}${r.fbsArt ? ` + FBS ${r.fbsArt}` : ""}, хватит ~${r.dStock} дн. (${Math.round(r.dr)} зак/день)` +
        (src > 0 ? ` · есть из чего: ${r.sgp ? "СГП " + r.sgp : ""}${r.sgp && r.raw ? ", " : ""}${r.raw ? "сырьё " + r.raw : ""}` : " · ❗ нечем пополнить");
    });
    urgent.push(`<b>${cabName(n)} (${rows.length})</b>\n` + cap(lines).join("\n"));
  }
  if (urgent.length) parts.push(`🔥 <b>Срочно на ВБ — запаса меньше 14 дней</b>\n\n` + urgent.join("\n\n"));

  /* ── 3. Правила FBS: пусто / мало на обязательных складах (как в «Остатки по FBS») ── */
  const fbs = [];
  for (const n of [1, 2, 3]) {
    if (!prepare(n)) continue;
    const { rows } = fbsRows(n);
    const bad = rows.filter((r) => r.rule && (r.st === "red" || r.st === "amber")).sort((a, b) => a.rank - b.rank);
    if (!bad.length) continue;
    const lines = bad.map((r) => {
      const mark = r.st === "red" ? "🔴" : "🟠";
      if (r.rule.rule === "none") return `${mark} <code>${esc(r.art)}</code> — должно быть 0 на FBS, а есть ${r.fbs} шт`;
      if (r.sizes) {
        const sz = r.sizes.filter((x) => x.st === "red" || x.st === "amber")
          .map((x) => `${esc(x.sz)} (${[x.empty.length ? "нет: " + x.empty.join(", ") : "", x.low.length ? "мало: " + x.low.join(", ") : ""].filter(Boolean).join("; ")})`);
        return `${mark} <code>${esc(r.art)}</code> — размеры: ${sz.join("; ")}`;
      }
      if (n === 3) return `${mark} <code>${esc(r.art)}</code> — ${r.st === "red" ? "на FBS 0" : `на FBS ${r.fbs} шт, хватит ≤2 дн.`}`;
      const what = [r.empty.length ? "пусто: " + r.empty.join(", ") : "", r.low.length ? "мало: " + r.low.join(", ") : ""].filter(Boolean).join("; ");
      return `${mark} <code>${esc(r.art)}</code> — ${what}${!(r.base > 0) ? " · ❗ нечем пополнить" : ""}`;
    });
    fbs.push(`<b>${cabName(n)} (${bad.length})</b>\n` + cap(lines).join("\n"));
  }
  if (fbs.length) parts.push(`🏬 <b>FBS: не по правилам</b>\n\n` + fbs.join("\n\n"));
}

if (MODE === "drop") {
  /* ── 5. Падение заказов: сегодня к этому часу против среднего за 7 прошлых дней к тому же часу.
     Даты заказов WB — московское время без пояса, сравниваем строками. ── */
  const msk = new Date(Date.now() + 3 * 3600e3).toISOString();       /* «сейчас» по Москве */
  const today = msk.slice(0, 10), hhmm = msk.slice(11, 16);
  const days = [...Array(7)].map((_, i) => new Date(Date.now() + 3 * 3600e3 - (i + 1) * 864e5).toISOString().slice(0, 10));
  const MIN_EXPECTED = 6;    /* артикул обычно продаёт к этому часу хотя бы столько */
  const DROP = 0.4;          /* сегодня ≤ 40% от обычного — тревога */

  const drops = [];
  for (const n of [1, 2]) {
    const d = D[n];
    if (!d) continue;
    const cnt = {};   /* арт → { day → шт к этому часу } */
    let totToday = 0, totPast = 0;
    for (const o of d.allOrders || []) {
      const day = (o.date || "").slice(0, 10), t = (o.date || "").slice(11, 16);
      if (t > hhmm) continue;
      if (day !== today && !days.includes(day)) continue;
      const q = o.quantity || 1;
      ((cnt[o.supplierArticle] ||= {})[day] = (cnt[o.supplierArticle][day] || 0) + q);
      if (day === today) totToday += q; else totPast += q;
    }
    const lines = [];
    for (const [art, byDay] of Object.entries(cnt)) {
      const expected = days.reduce((s, dd) => s + (byDay[dd] || 0), 0) / 7;
      const now = byDay[today] || 0;
      if (expected >= MIN_EXPECTED && now <= expected * DROP) lines.push({ art, now, expected });
    }
    lines.sort((a, b) => b.expected - a.expected);
    const avgTot = totPast / 7;
    const cabDrop = avgTot >= 20 && totToday <= avgTot * (1 - 0.3);   /* весь кабинет −30% и больше */
    if (!lines.length && !cabDrop) continue;
    drops.push(`<b>${cabName(n)}</b>` +
      (cabDrop ? ` — всего ${totToday} заказов против обычных ~${Math.round(avgTot)} (${Math.round((totToday / avgTot - 1) * 100)}%)` : "") +
      (lines.length ? "\n" + cap(lines.map((x) => `• <code>${esc(x.art)}</code> — ${x.now} вместо обычных ~${Math.round(x.expected)}`)).join("\n") : ""));
  }
  if (drops.length) parts.push(`📉 <b>Заказы упали — сегодня к ${hhmm}</b>\nСравнение со средним за 7 дней к тому же часу. Проверьте карточку, цену, остатки по размерам.\n\n` + drops.join("\n\n"));
}

if (problems.length) parts.push(problems.join("\n"));

if (!parts.length) {
  console.log("Нечего сообщать — молчим");
} else {
  const text = parts.join("\n\n") + `\n\n<a href="https://dimadali17.github.io/monitor/">Открыть монитор</a>`;
  console.log(text);
  await send(text);
}
