/* ══════════════════════════════════════════════════════════
   Поставки FBW → Telegram (ежечасно, вместе с проверкой FBS).
   supplies-api.wildberries.ru, токен «Поставки» (WB_SUP_KEY_n в воркере):
     POST /api/v1/supplies          — список (фильтр по датам и статусам)
     GET  /api/v1/supplies/{ID}     — детали: склад, количество, принято, причина отказа

   1) ⏰ Предупреждение: до 00:00 (МСК) дня, на который запланирована поставка, осталось 96 часов
      или меньше — пишем один раз по каждой поставке (статусы «Запланировано», «Отгрузка разрешена»).
   2) 🔄 Смена статуса поставки — пишем при каждом изменении. Первая проверка только запоминает статусы.
   Память — .bot-state/sup.json.
   ══════════════════════════════════════════════════════════ */

export const SUPPLY_CABS = [1, 2];       /* ИП1 (Easyform) и ИП2 (EZFR) */
export const WARN_HOURS = 96;
const HOST = "https://supplies-api.wildberries.ru";
const STATUS = { 1: "Не запланировано", 2: "Запланировано", 3: "Отгрузка разрешена", 4: "Идёт приёмка", 5: "Принято", 6: "Отгружено на воротах" };
const BOX = { 0: "без коробов", 1: "короба", 2: "короба", 5: "монопаллеты", 6: "суперсейф" };

const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mskDate = (s) => { const t = Date.parse(s); if (!t) return "—"; const d = new Date(t + 3 * 3600e3); return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const nf = (x) => Math.round(+x || 0).toLocaleString("ru-RU").replace(/ /g, " ");

export async function checkSupplies({ WORKER, authHeader, cabName, statePath, fs, now = Date.now() }) {
  let state = { warned: {}, status: {} };
  try { state = { warned: {}, status: {}, ...JSON.parse(fs.readFileSync(statePath, "utf8")) }; } catch { /* первый запуск */ }
  const first = !state.ran;

  const call = async (cab, method, url, body) => {
    const r = await fetch(`${WORKER}/?cab=${cab}&url=${encodeURIComponent(url)}`, {
      method, headers: { ...authHeader(), "X-Force": "1", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 204) return null;
    const t = await r.text();
    if (!r.ok) throw new Error(`WB ${r.status}: ${t.slice(0, 150)}`);
    return t.trim() ? JSON.parse(t) : null;
  };

  const warn = [], changed = [], errors = [];
  for (const cab of SUPPLY_CABS) {
    let list = [];
    try {
      /* поставки, созданные за последние 60 дней (активные — среди них) */
      const from = isoDay(now - 60 * 864e5), till = isoDay(now + 864e5);
      list = (await call(cab, "POST", `${HOST}/api/v1/supplies?limit=1000&offset=0`, { dates: [{ from, till, type: "createDate" }] })) || [];
    } catch (e) {
      errors.push(`${cabName(cab)}: ${esc(e.message)}`);
      continue;
    }
    for (const s of list) {
      const id = s.supplyID || s.preorderID;
      if (!id) continue;
      const key = `${cab}:${s.supplyID ? "s" : "p"}${id}`;
      const st = s.statusID;
      const prev = state.status[key];
      state.status[key] = st;
      let why = null;
      /* 1) до 00:00 МСК дня поставки ≤ 96 ч (supplyDate WB отдаёт как 00:00+03:00) */
      const t0 = Date.parse(s.supplyDate || "");
      const hours = t0 ? (t0 - now) / 3600e3 : null;
      if (t0 && hours > 0 && hours <= WARN_HOURS && [2, 3].includes(st) && !state.warned[key]) { state.warned[key] = isoDay(now); why = "warn"; }
      /* 2) смена статуса (не в первую проверку) */
      const statusChanged = !first && prev != null && prev !== st;
      if (!why && !statusChanged) continue;
      let det = {};
      try { det = (await call(cab, "GET", `${HOST}/api/v1/supplies/${id}${s.supplyID ? "" : "?isPreorderID=true"}`)) || {}; } catch { /* без деталей */ }
      const no = s.supplyID ? `№${s.supplyID}` : `заказ №${s.preorderID}`;
      const wh = det.actualWarehouseName || det.warehouseName || "";
      const qty = det.quantity != null ? `${nf(det.quantity)} шт` : "";
      const base = `<b>${esc(cabName(cab))}</b> · поставка ${no}${wh ? ` → ${esc(wh)}` : ""}${qty ? `, ${qty}` : ""}${BOX[s.boxTypeID] ? `, ${BOX[s.boxTypeID]}` : ""}`;
      if (why === "warn") {
        const d = Math.floor(hours / 24), h = Math.floor(hours % 24);
        warn.push(`${base}\nплановая дата ${mskDate(s.supplyDate)} — осталось ${d ? `${d} дн. ` : ""}${h} ч · ${esc(STATUS[st] || st)}`);
      }
      if (statusChanged) {
        const extra = [
          st === 5 && det.acceptedQuantity != null ? `принято ${nf(det.acceptedQuantity)}${det.quantity != null ? ` из ${nf(det.quantity)}` : ""} шт` : "",
          det.discrepancies ? `расхождение ${nf(det.discrepancies)} шт` : "",
          det.rejectReason ? `❗ ${esc(det.rejectReason)}` : "",
          s.supplyDate ? `плановая дата ${mskDate(s.supplyDate)}` : "",
        ].filter(Boolean).join(" · ");
        changed.push(`${base}\n${esc(STATUS[prev] || prev)} → <b>${esc(STATUS[st] || st)}</b>${extra ? `\n${extra}` : ""}`);
      }
    }
  }

  /* память: предупреждения старше 30 дней забываем */
  const cut = isoDay(now - 30 * 864e5);
  for (const [k, d] of Object.entries(state.warned)) if (d < cut) delete state.warned[k];
  state.ran = isoDay(now);
  fs.mkdirSync(statePath.replace(/\/[^/]*$/, ""), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state));

  const out = [];
  if (warn.length) out.push(`⏰ <b>До поставки ${WARN_HOURS} ч или меньше</b> (считаем до 00:00 дня поставки)\n\n` + warn.join("\n\n"));
  if (changed.length) out.push(`🔄 <b>Статус поставки изменился</b>\n\n` + changed.join("\n\n"));
  /* ошибку (например, нет токена) — не чаще раза в день, чтобы не спамить каждый час */
  if (errors.length && state.errDay !== isoDay(now)) {
    out.push(`⚠️ Поставки: не удалось проверить — ${errors.join("; ")}`);
    state.errDay = isoDay(now);
    fs.writeFileSync(statePath, JSON.stringify(state));
  }
  return out;   /* каждое — отдельным сообщением; пусто — молчим */
}
