import { EXP, CM, FA, OFM } from "../state.js";
import { LIM } from "../config.js";
import { fmt, esc, q, wbPrice, ozRev, sitePrice, iso } from "../utils.js";

/* Модель продажи WB по полю warehouseType из Statistics API.
   "Склад WB" → FBW (товар на складе WB), иначе "Склад продавца" → FBS.
   Незнакомое значение показываем как есть — так ничего не соврём.
   Сверьте реальные строки в консоли, если бейдж где-то пустой:
     console.table([...new Set(App.D[1].allOrders.map(o=>o.warehouseType))]) */
function wbModel(wtype) {
  const s = (wtype || "").toLowerCase();
  if (s.includes("склад wb") || s === "wb") return { tag: "FBW", bg: "#2f7d55", fg: "#fff" };
  if (s.includes("продавц") || s.includes("маркетплейс") || s.includes("fbs"))
    return { tag: "FBS", bg: "#c26a2b", fg: "#fff" };
  return wtype ? { tag: esc(wtype), bg: "#8a8577", fg: "#fff" } : null;
}

export function ordersHTML(n, vm, type) {
  const mode = CM[n] || "day";
  const weekMode = mode === "week" || mode === "month";
  const timeOf = (o) => (type === "wb" ? o.date : o.in_process_at || o.created_at);

  let orders;
  if (mode === "month") {
    const wk = iso(Date.now() - 30 * 864e5);
    orders = (vm.allOrders || []).filter((o) => (timeOf(o) || "").slice(0, 10) >= wk);
  } else if (mode === "week") orders = vm.orders7 || [];
  else orders = vm.todayO || [];
  const fm = OFM[n] || "all";
  const sortedAll = [...orders].sort((a, b) => new Date(timeOf(b)) - new Date(timeOf(a)));
  const sorted = type === "wb" && fm !== "all"
    ? sortedAll.filter((o) => {
        const m = wbModel(o.warehouseType);
        const tag = m ? m.tag : "";
        return fm === "fbw" ? tag === "FBW" : tag === "FBS";
      })
    : sortedAll;
  const shown = EXP[n] ? sorted : sorted.slice(0, LIM);

  const rows = shown.map((o) => {
    const t = timeOf(o) ? new Date(timeOf(o)).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }) : "—";
    const dt = timeOf(o) ? new Date(timeOf(o)).toLocaleDateString("ru", { day: "2-digit", month: "2-digit" }) : "—";
    let art, sz, name, qty, price, wh, model;

    if (type === "wb") {
      art = o.supplierArticle || "—";
      sz = o.techSize || "—";
      name = o.subject || o.category || "—";
      qty = o.quantity || 1;
      price = wbPrice(o);
      model = wbModel(o.warehouseType);
      wh = o.warehouseName || "—";
      if (model && model.tag === "FBS") wh = o.fbsWarehouse || "склад продавца";
    } else {
      const items = o.products || [];
      art = items.map((p) => p.offer_id || "").join(", ");
      sz = items.map((p) => {
        const parts = (p.offer_id || "").split("_");
        return parts.length > 1 ? parts[parts.length - 1] : "—";
      }).join(", ");
      name = items.map((p) => p.name || "").join(", ");
      qty = items.reduce((s, p) => s + (p.quantity || 1), 0);
      price = ozRev(o);
      wh = o.analytics_data?.warehouse_name || "—";
      model = null;
    }

    /* Артикул кликабелен — добавляет себя в фильтр. Составные (Ozon, несколько товаров) — нет. */
    const artCell = art.includes(",")
      ? esc(art)
      : `<a href="#" onclick="event.preventDefault();App.addFA(${n},'${q(art)}')"
            style="color:var(--ink2);text-decoration:underline;text-decoration-style:dotted">${esc(art)}</a>`;

    /* Бейдж модели продажи перед названием склада */
    const badge = model
      ? `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-right:6px;background:${model.bg};color:${model.fg}" data-tip="Модель продажи (warehouseType)">${model.tag}</span>`
      : "";

    const p = sitePrice(price);
    return `<tr>
      <td><span class="tp">${dt}</span></td>
      <td><span class="tp">${t}</span></td>
      <td><span class="art">${artCell}</span></td>
      <td>${esc(sz)}</td>
      <td>${esc(name)}</td>
      <td>${qty}</td>
      <td><span class="pr">${p ? fmt(p) : "—"}</span></td>
      <td style="font-size:11px;color:var(--ink3)">${badge}${esc(wh)}</td>
    </tr>`;
  }).join("");

  const more = sorted.length > LIM
    ? `<tr class="er"><td colspan="8"><button class="eb" onclick="App.togExp(${n})">${EXP[n] ? "▲ Свернуть" : "▼ Все " + sorted.length}</button></td></tr>`
    : "";

  return `<div class="sec">
    <div class="sh">
      <span class="st">${weekMode ? "Заказы за период" : "Заказы сегодня"}</span>
      <span style="display:flex;align-items:center;gap:8px">
        ${type === "wb" ? `<span class="ctog">
          <button class="${fm === "all" ? "on" : ""}" onclick="App.setOrdFilter(${n},'all')">Все</button>
          <button class="${fm === "fbw" ? "on" : ""}" onclick="App.setOrdFilter(${n},'fbw')">FBW</button>
          <button class="${fm === "fbs" ? "on" : ""}" onclick="App.setOrdFilter(${n},'fbs')">FBS</button>
        </span>` : ""}
        <span class="sm2">${sorted.length} заказов</span>
        <button class="b" style="padding:3px 9px;font-size:10px" onclick="App.exportXlsx(this,'Заказы','zakazy')" data-tip="Скачать в Excel">⤓ Excel</button>
      </span>
    </div>
    <div class="tw"><table>
      <thead><tr>
        <th>Дата</th><th>Время</th><th>Артикул</th><th>Размер</th><th>Товар</th><th>Кол-во</th>
        <th data-tip="finishedPrice × 0.80 — приблизительная цена на витрине с учётом среднего СПП ~20%">Цена на сайте</th>
        <th>Склад</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="em">Нет заказов</td></tr>'}${more}</tbody>
    </table></div>
  </div>`;
}
