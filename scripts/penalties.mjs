/* ══════════════════════════════════════════════════════════
   Удержания и замеры WB → Telegram (раз в день, в утренней рассылке бота).
   Разделы seller.wildberries.ru/analytics-reports/dimensions-penalties:
     Габариты упаковки  GET /api/analytics/v1/measurement-penalties
     Замеры склада      GET /api/analytics/v1/warehouse-measurements
     Подмены            GET /api/analytics/v1/deductions
     Самовыкупы         GET /api/v1/analytics/antifraud-details   (отчёт раз в неделю, по средам)
     Маркировка товара  GET /api/v1/analytics/goods-labeling
   Всё — seller-analytics-api, токен «Аналитика» (WB_ANAL_KEY_n в воркере), через воркер.

   Каждый день смотрим последние 7 дней (WB выкладывает события задним числом) и пишем только
   НОВЫЕ строки — которых не было в прошлых проверках (память — файл в .bot-state).
   События раньше PEN_START не берём: отсчёт — с даты запуска функции.
   ══════════════════════════════════════════════════════════ */

export const PEN_START = "2026-11-02";
const HOST = "https://seller-analytics-api.wildberries.ru";
const DAYS = 7;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const mskToday = () => isoDay(Date.now() + 3 * 3600e3);
const addDays = (d, k) => isoDay(Date.parse(d + "T00:00:00Z") + k * 864e5);
const dShort = (s) => { const d = String(s || "").slice(0, 10); return d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : "—"; };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n1 = (x) => (x == null ? "—" : (+x).toLocaleString("ru-RU", { maximumFractionDigits: 2 }));   /* 1,5 */
const rub = (x) => Math.round(+x || 0).toLocaleString("ru-RU").replace(/ /g, " ") + " ₽";

export async function checkPenalties({ WORKER, authHeader, cabName, artOf, statePath, fs, cabs = [1, 2] }) {
  const today = mskToday();
  const from = [addDays(today, -DAYS), PEN_START].sort().pop();          /* не раньше даты старта */
  const fromT = encodeURIComponent(`${from}T00:00:00+03:00`), toT = encodeURIComponent(`${today}T23:59:59+03:00`);

  let state = { seen: {} };
  try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { /* первый запуск */ }
  const firstRun = !Object.keys(state.seen || {}).length && !state.ran;

  /* GET через воркер; 204 — пусто; 429 — подождать и повторить один раз */
  const get = async (cab, url) => {
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${WORKER}/?cab=${cab}&url=${encodeURIComponent(url)}`, { headers: { ...authHeader(), "X-Force": "1" } });
      if (r.status === 204) return null;
      const t = await r.text();
      if (r.ok) return t.trim() ? JSON.parse(t) : null;
      if (r.status === 429 && i === 0) { await sleep(65000); continue; }
      throw new Error(`WB ${r.status}: ${t.slice(0, 150)}`);
    }
  };

  const art = (cab, nm) => artOf(cab, nm) || `nm ${nm}`;
  const SECTIONS = [
    {
      name: "Габариты упаковки", url: `${HOST}/api/analytics/v1/measurement-penalties?dateFrom=${fromT}&dateTo=${toT}&limit=1000`,
      rows: (d) => (d && d.data && d.data.reports) || [],
      key: (x) => `mp:${x.dimId}:${x.dtBonus}`, date: (x) => x.dtBonus,
      text: (cab, x) => `${esc(art(cab, x.nmId))} — замер ${x.length}×${x.width}×${x.height} см (${n1(x.volume)} л), в карточке ${x.lengthSup}×${x.widthSup}×${x.heightSup} (${n1(x.volumeSup)} л), +${n1(x.prcOver)}%` +
        (x.penaltyAmount ? `; штраф ${rub(x.penaltyAmount)}` : "") + (x.isValid === false ? " · обмер отменён" : ""),
    },
    {
      name: "Замеры склада", url: `${HOST}/api/analytics/v1/warehouse-measurements?dateFrom=${fromT}&dateTo=${toT}&limit=1000`,
      rows: (d) => (d && d.data && d.data.reports) || [],
      key: (x) => `wm:${x.dimId}`, date: (x) => x.dt,
      text: (cab, x) => `${esc(art(cab, x.nmId))} — ${x.length}×${x.width}×${x.height} см, ${n1(x.volume)} л`,
    },
    {
      name: "Подмены", url: `${HOST}/api/analytics/v1/deductions?dateFrom=${fromT}&dateTo=${toT}&limit=1000&sort=dtBonus&order=desc`,
      rows: (d) => (d && d.data && d.data.reports) || [],
      key: (x) => `dd:${x.nmId}:${x.dtBonus}:${x.newShkId || x.oldShkId}`, date: (x) => x.dtBonus,
      text: (cab, x) => `${esc(x.oldVendorCode || art(cab, x.nmId))}${x.newVendorCode && x.newVendorCode !== x.oldVendorCode ? ` → ${esc(x.newVendorCode)}` : ""}` +
        ` (${esc([x.oldColor, x.oldSize].filter(Boolean).join(" "))}${x.newColor || x.newSize ? ` → ${esc([x.newColor, x.newSize].filter(Boolean).join(" "))}` : ""}) — ${esc(x.bonusType || "удержание")}` +
        (x.bonusSumm ? `, ${rub(x.bonusSumm)}` : ""),
    },
    {
      name: "Самовыкупы", urls: [`${HOST}/api/v1/analytics/antifraud-details?date=${today}`, `${HOST}/api/v1/analytics/antifraud-details?date=${addDays(today, -7)}`],
      rows: (d) => (d && d.details) || [],
      key: (x) => `af:${x.nmID}:${x.dateFrom}:${x.sum}`, date: (x) => x.dateTo || x.dateFrom,
      text: (cab, x) => `${esc(art(cab, x.nmID))} — заказ на ${rub(x.sum)}, неделя ${dShort(x.dateFrom)}–${dShort(x.dateTo)}`,
    },
    {
      name: "Маркировка товара", url: `${HOST}/api/v1/analytics/goods-labeling?dateFrom=${from}&dateTo=${today}`,
      rows: (d) => (d && d.report) || [],
      key: (x) => `gl:${x.shkID}:${x.date}`, date: (x) => x.date,
      text: (cab, x) => `${esc(art(cab, x.nmID))} — поставка ${x.incomeId}, баркод ${esc(x.sku)}` + (x.amount ? `, штраф ${rub(x.amount)}` : ""),
    },
  ];

  const blocks = [], errors = [];
  let newCount = 0;
  for (const S of SECTIONS) {
    const lines = [];
    for (const cab of cabs) {
      let rows = [];
      try {
        for (const u of S.urls || [S.url]) {
          rows.push(...S.rows(await get(cab, u)));
          await sleep(process.env.PEN_FAST ? 0 : 3000);
        }
      } catch (e) {
        errors.push(`${S.name} (${cabName(cab)}): ${esc(e.message)}`);
        continue;
      }
      const fresh = [];
      for (const x of rows) {
        const k = `${cab}:${S.key(x)}`;
        const d = String(S.date(x) || "").slice(0, 10);
        if (d && d < PEN_START) continue;              /* до даты старта не сообщаем */
        if (state.seen[k]) continue;
        state.seen[k] = today;
        fresh.push(x);
      }
      fresh.sort((a, b) => String(S.date(a)).localeCompare(String(S.date(b))));
      newCount += fresh.length;
      if (fresh.length) lines.push(`<i>${esc(cabName(cab))}</i>\n` + fresh.slice(0, 15).map((x) => `• ${dShort(S.date(x))} ${S.text(cab, x)}`).join("\n") +
        (fresh.length > 15 ? `\n…и ещё ${fresh.length - 15}` : ""));
    }
    blocks.push(lines.length ? `<b>${S.name}</b> — новые события:\n${lines.join("\n")}` : `${S.name} — новых нет`);
  }

  /* память: храним ключи за 30 дней, чтобы файл не рос бесконечно */
  const cut = addDays(today, -30);
  for (const [k, d] of Object.entries(state.seen)) if (d < cut) delete state.seen[k];
  state.ran = today;
  fs.mkdirSync(statePath.replace(/\/[^/]*$/, ""), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state));

  const period = `${dShort(from)}–${dShort(today)}`;
  const head = `🧾 <b>Удержания и замеры WB</b> · проверка за ${period}`;
  const errTxt = errors.length ? `\n\n⚠️ Не удалось проверить:\n${errors.join("\n")}` : "";
  if (!newCount) return `${head}\nЗа прошедшие 7 дней новых событий нет ✅\n<i>Габариты упаковки, замеры склада, подмены, самовыкупы, маркировка — оба кабинета.</i>${firstRun ? `\n<i>Отсчёт с ${dShort(PEN_START)}.</i>` : ""}` + errTxt;
  return `${head}\n\n${blocks.join("\n\n")}\n\n<a href="https://seller.wildberries.ru/analytics-reports/dimensions-penalties">Открыть в кабинете WB</a>` + errTxt;
}
