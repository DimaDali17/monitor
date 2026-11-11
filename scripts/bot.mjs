/* ══════════════════════════════════════════════════════════
   Бот-оповещения в Telegram на тех же расчётах, что монитор.
   Запускается по расписанию в GitHub Actions (.github/workflows/bot.yml).

   node scripts/bot.mjs morning  — сводка за вчера + «срочно на ВБ» (дефицит) + «закончилось на FBS»
   node scripts/bot.mjs fbs      — только «закончилось на FBS» (каждый час 4:00–0:00 МСК)
   node scripts/bot.mjs drop     — резкое падение заказов сегодня к этому часу
   node scripts/bot.mjs urgent    — только «Срочно на ВБ» (в morning входит)
   node scripts/bot.mjs supplies  — только поставки (в fbs/morning/drop входит — каждый час)
   node scripts/bot.mjs penalties — только «Удержания и замеры WB» (в morning входит)

   «Закончилось на FBS»: бот помнит остатки прошлой проверки (файл BOT_STATE,
   между запусками его хранит кэш GitHub) и пишет, только если на обязательном
   складе было > 0, а стало 0. Первая проверка — молча запоминает остатки.

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
const { loadWB, cardByNm } = await import("../js/api/wb.js");
const { WORKER } = await import("../js/config.js");
const { authHeader } = await import("../js/api/auth.js");
const { checkPenalties } = await import("./penalties.mjs");
const { checkSupplies } = await import("./supplies.mjs");
const { loadOZ } = await import("../js/api/ozon.js");
const { D, VM, cabName } = await import("../js/state.js");
const { buildVM } = await import("../js/vm.js");
const { defTbl, statusKey } = await import("../js/render/deficit.js");
const { fbsRows } = await import("../js/render/stocks.js");
const { whRequired, ozBase } = await import("../js/fbsRules.js");
const { wbPrice, ozRev } = await import("../js/utils.js");
const fs = await import("node:fs");
const STATE = process.env.BOT_STATE || ".bot-state/fbs.json";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MAX_LINES = 15;   /* в одном блоке; остальное — «и ещё N» */
const cap = (arr) => arr.length > MAX_LINES ? [...arr.slice(0, MAX_LINES), `…и ещё ${arr.length - MAX_LINES}`] : arr;

async function send(text) {
  const post = (chat, body) => fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, disable_web_page_preview: true, ...body }),
  });
  for (const chat of TG_CHAT_ID.split(",").map((s) => s.trim()).filter(Boolean)) {
    let r = await post(chat, { text: text.slice(0, 4000), parse_mode: "HTML" });
    if (!r.ok) {
      const err = await r.text();
      console.error("Telegram не принял HTML:", r.status, err);
      /* запасной путь: тот же текст без разметки — лучше некрасиво, чем ничего */
      const plain = text.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      r = await post(chat, { text: plain.slice(0, 4000) });
      if (!r.ok) { console.error("Telegram не принял и простой текст:", r.status, await r.text()); process.exitCode = 1; }
    }
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
  /* Загрузка кабинета: сбой сети («fetch failed») — ещё 2 попытки через 15 и 45 с.
     Не загрузился и так — пишем, только если не загружается 3 запуска подряд (≈3 часа), не чаще раза в день.
     Память — .bot-state/load.json */
  const LOAD_STATE = (process.env.BOT_STATE || ".bot-state/fbs.json").replace(/[^/]*$/, "load.json");
  let ls = { fails: {}, errDay: {} };
  try { ls = { fails: {}, errDay: {}, ...JSON.parse(fs.readFileSync(LOAD_STATE, "utf8")) }; } catch { /* первый запуск */ }
  const mskDay = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const tryLoad = async (key, name, fn) => {
    const waits = [15000, 45000];
    for (let i = 0; ; i++) {
      try { await fn(); ls.fails[key] = 0; return; }
      catch (e) {
        if (i < waits.length) { await new Promise((ok) => setTimeout(ok, waits[i])); continue; }
        ls.fails[key] = (ls.fails[key] || 0) + 1;
        console.log(`${name}: не загрузился (${ls.fails[key]} подряд) — ${e.message}`);
        if (ls.fails[key] >= 3 && ls.errDay[key] !== mskDay) {
          problems.push(`⚠️ ${name}: не загружается уже ${ls.fails[key]} проверки подряд — ${esc(e.message)}`);
          ls.errDay[key] = mskDay;
        }
        return;
      }
    }
  };
  for (const n of [1, 2]) await tryLoad(`wb${n}`, cabName(n), () => loadWB(n, {}));
  if (!["drop", "penalties", "urgent", "supplies"].includes(MODE)) await tryLoad("oz", "Ozon", () => loadOZ({}));
  try { fs.mkdirSync(LOAD_STATE.replace(/\/[^/]*$/, ""), { recursive: true }); fs.writeFileSync(LOAD_STATE, JSON.stringify(ls)); } catch { /* не страшно */ }
}

const msgs = [];   /* каждое — отдельным сообщением в Telegram */

if (MODE === "morning") {
  /* ── Сводка за вчера: заказы и сумма по кабинетам (как «Вчера» в мониторе),
     сравнение со средним за 7 полных дней, три лидера по штукам ── */
  const rub = (x) => Math.round(x).toLocaleString("ru-RU").replace(/\u00a0/g, " ") + " ₽";
  const lines = [], top = {};
  let totC = 0, totR = 0;
  for (const n of [1, 2, 3]) {
    const d = D[n];
    if (!d) continue;
    const price = d.isOz ? ozRev : wbPrice;
    const y = d.yestO || [];
    const yC = y.length, yR = y.reduce((a, o) => a + price(o), 0);
    totC += yC; totR += yR;
    lines.push(`${esc(cabName(n))}: ${yC} зак. · ${rub(yR)}`);
    for (const o of y) {
      if (d.isOz) for (const p of o.products || []) { const a = ozBase(p.offer_id); top[a] = (top[a] || 0) + (p.quantity || 1); }
      else top[o.supplierArticle] = (top[o.supplierArticle] || 0) + (o.quantity || 1);
    }
  }
  if (lines.length) {
    const yDate = new Date(Date.now() + 3 * 3600e3 - 864e5).toISOString().slice(5, 10).split("-").reverse().join(".");
    const lead = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, q]) => `${esc(a)} — ${q}`);
    msgs.push({ link: false, text: `📊 <b>Заказы за ${yDate}</b>\n\n` + lines.join("\n") +
      `\n<b>Всего: ${totC} зак. · ${rub(totR)}</b>` +
      (lead.length ? `\n\nТоп: ` + lead.join(", ") : "") });
  }

}

if (MODE === "morning" || MODE === "urgent") {
  /* ── 2. Срочно на ВБ: запаса FBW+FBS меньше URGENT_DAYS дней. Только то, что есть чем пополнить
     (СГП или сырьё) — остальное в сообщение не идёт. Коротко: артикул и дни. ── */
  const URGENT_DAYS = 7;
  const urgent = [];
  for (const n of [1, 2]) {
    if (!prepare(n)) continue;
    const rows = defTbl(n, { rowsOnly: true })
      .filter((r) => r.o7 > 0 && Math.round(r.dr) >= 1 && r.dStock != null && r.dStock < URGENT_DAYS && (r.sgp || 0) + (r.raw || 0) > 0)
      .sort((a, b) => (a.dStock ?? 0) - (b.dStock ?? 0));
    if (!rows.length) continue;
    const lines = rows.map((r) => `• <code>${esc(r.art)}</code> — ${r.dStock} дн.`);
    urgent.push(`\n<b>${cabName(n)}</b>\n` + cap(lines).join("\n"));
  }
  if (urgent.length) msgs.push(`🔥 <b>Срочно на ВБ</b> (запаса меньше ${URGENT_DAYS} дн.)\n` + urgent.join("\n"));
}

if (MODE === "morning" || MODE === "fbs") {
  /* ── 3. Закончилось на FBS: на обязательном складе было > 0 — стало 0 ── */
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { /* первый запуск */ }
  const next = { at: new Date().toISOString(), cabs: { ...(prev?.cabs || {}) }, zero: { ...(prev?.zero || {}) } };
  const gone = [], again = [];
  const REPEAT_H = 23.5;   /* «сутки» — с запасом на то, что запуски идут в начале часа с разбросом */
  for (const n of [1, 2, 3]) {
    if (!D[n] || !prepare(n)) continue;           /* кабинет не загрузился — помним прошлое */
    const { rows, whList } = fbsRows(n);
    const snap = {};
    for (const r of rows) {
      if (!r.rule || r.rule.rule === "none") continue;
      if (n === 3) { snap[`${r.art}||всего`] = r.fbs || 0; continue; }
      const units = r.sizes ? r.sizes.filter((x) => x.st !== "nodem") : [{ sz: "", wh: r.wh }];
      for (const u of units) for (const w of whList) if (whRequired(r.rule.rule, w, n)) snap[`${r.art}|${u.sz}|${w}`] = u.wh[w] || 0;
    }
    const old = prev?.cabs?.[n];
    const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
    if (old && sum(old) > 0 && sum(snap) === 0) {   /* всё разом в ноль — скорее сбой загрузки FBS */
      problems.push(`⚠️ ${cabName(n)}: остатки FBS не загрузились — проверка пропущена`);
      continue;
    }
    next.cabs[n] = snap;
    if (!old) continue;
    /* Память о нулях: ключ → { since: когда стал 0, last: когда последний раз писали }.
       Стал 0 — пишем сразу. Через сутки после сообщения всё ещё 0 — повтор (и так раз в сутки),
       пока не пополнят. Пополнили (>0) или правило/спрос пропали — забываем. */
    const zm = (next.zero[n] ||= {});
    const nowMs = Date.now(), nowIso = new Date(nowMs).toISOString();
    const byArt = {}, rep = {};
    for (const [k, q] of Object.entries(snap)) {
      if (q > 0) { delete zm[k]; continue; }
      const [art, sz, w] = k.split("|");
      if (old[k] > 0) {                                   /* только что закончилось */
        zm[k] = { since: nowIso, last: nowIso };
        ((byArt[art] ||= {})[w] ||= []).push(sz);
      } else if (!zm[k]) {
        zm[k] = { since: null, last: nowIso };           /* был 0 ещё до этой функции: с какого дня — не знаем; сутки считаем с сейчас */
      } else if (nowMs - Date.parse(zm[k].last) >= REPEAT_H * 3600e3) {
        zm[k].last = nowIso;
        ((rep[art] ||= {})[w] ||= []).push({ sz, days: zm[k].since ? Math.floor((nowMs - Date.parse(zm[k].since)) / 864e5) : null });
      }
    }
    for (const k of Object.keys(zm)) if (!(k in snap)) delete zm[k];
    const lines = Object.entries(byArt).map(([art, ws]) => {
      if (n === 3) return `• <code>${esc(art)}</code> — FBS 0`;
      const where = Object.entries(ws).map(([w, szs]) => szs.filter(Boolean).length ? `${w} (${szs.map(esc).join(", ")})` : w).join(", ");
      return `• <code>${esc(art)}</code> — ${where}`;
    });
    if (lines.length) gone.push(`\n<b>${cabName(n)}</b>\n` + cap(lines).join("\n"));
    const rlines = Object.entries(rep).map(([art, ws]) => {
      const dmax = Math.max(0, ...Object.values(ws).flat().map((x) => x.days || 0));
      const ago = dmax >= 1 ? ` · 0 уже ${dmax} дн.` : "";
      if (n === 3) return `• <code>${esc(art)}</code> — FBS 0${ago}`;
      const where = Object.entries(ws).map(([w, xs]) => xs.some((x) => x.sz) ? `${w} (${xs.map((x) => esc(x.sz)).join(", ")})` : w).join(", ");
      return `• <code>${esc(art)}</code> — ${where}${ago}`;
    });
    if (rlines.length) again.push(`\n<b>${cabName(n)}</b>\n` + cap(rlines).join("\n"));
  }
  fs.mkdirSync(STATE.replace(/\/[^/]*$/, ""), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(next));
  if (gone.length) msgs.push(`🔴 <b>Закончилось на FBS</b>\n` + gone.join("\n"));
  if (again.length) msgs.push(`🔁 <b>Повтор: всё ещё 0 на FBS</b> (прошли сутки с сообщения, не пополнили)\n` + again.join("\n"));
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
  if (drops.length) msgs.push(`📉 <b>Заказы упали — сегодня к ${hhmm}</b>\nСравнение со средним за 7 дней к тому же часу. Проверьте карточку, цену, остатки по размерам.\n\n` + drops.join("\n\n"));
}

/* ── Удержания и замеры WB (габариты, замеры склада, подмены, самовыкупы, маркировка) — раз в день ── */
if ((MODE === "morning" || MODE === "penalties") && !process.env.BOT_FAKE) {
  const artOf = (cab, nm) => {
    const c = cardByNm(cab, nm);
    if (c && c.supplierArticle) return c.supplierArticle;
    const o = ((D[cab] && D[cab].allOrders) || []).find((x) => String(x.nmId) === String(nm));
    return o ? o.supplierArticle : null;
  };
  try {
    const text = await checkPenalties({ WORKER, authHeader, cabName, artOf, fs, statePath: (process.env.BOT_STATE || ".bot-state/fbs.json").replace(/[^/]*$/, "pen.json") });
    msgs.push({ link: false, text });
  } catch (e) {
    problems.push(`⚠️ Удержания и замеры: проверка не удалась — ${esc(e.message)}`);
  }
}

/* ── Поставки FBW: за 96 ч до дня поставки + смена статуса (каждый час) ── */
if (["morning", "fbs", "drop", "supplies"].includes(MODE) && !process.env.BOT_FAKE) {
  try {
    const out = await checkSupplies({ WORKER, authHeader, cabName, fs, statePath: (process.env.BOT_STATE || ".bot-state/fbs.json").replace(/[^/]*$/, "sup.json"), daily: MODE === "morning" || MODE === "supplies" });
    for (const text of out) msgs.push({ link: false, text });
  } catch (e) {
    problems.push(`⚠️ Поставки: проверка не удалась — ${esc(e.message)}`);
  }
}

if (problems.length) msgs.push(problems.join("\n"));

if (!msgs.length) {
  console.log("Нечего сообщать — молчим");
} else {
  for (const m of msgs) {
    const { text, link = true } = typeof m === "string" ? { text: m } : m;
    const full = text + (link ? `\n\n<a href="https://dimadali17.github.io/monitor/">Открыть монитор</a>` : "");
    console.log(full + "\n---");
    await send(full);
  }
}
