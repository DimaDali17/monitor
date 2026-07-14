import { EXP, CM, FA } from "../state.js";
import { LIM } from "../config.js";
import { fmt, esc, q, wbPrice, ozRev, sitePrice } from "../utils.js";

export function ordersHTML(n, vm, type) {
  const weekMode = CM[n] === "week" || CM[n] === "month";
  const orders = weekMode ? vm.orders7 || [] : vm.todayO || [];

  const timeOf = (o) => (type === "wb" ? o.date : o.in_process_at || o.created_at);
  const sorted = [...orders].sort((a, b) => new Date(timeOf(b)) - new Date(timeOf(a)));
  const shown = EXP[n] ? sorted : sorted.slice(0, LIM);

  const rows = shown.map((o) => {
    const t = timeOf(o) ? new Date(timeOf(o)).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }) : "—";
    let art, sz, name, qty, price, wh;

    if (type === "wb") {
      art = o.supplierArticle || "—";
      sz = o.techSize || "—";
      name = o.subject || o.category || "—";
      qty = o.quantity || 1;
      price = wbPrice(o);
      wh = o.warehouseName || "—";
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
    }

    /* Артикул кликабелен — добавляет себя в фильтр. Составные (Ozon, несколько товаров) — нет. */
    const artCell = art.includes(",")
      ? esc(art)
      : `<a href="#" onclick="event.preventDefault();App.addFA(${n},'${q(art)}')"
            style="color:var(--ink2);text-decoration:underline;text-decoration-style:dotted">${esc(art)}</a>`;

    const p = sitePrice(price);
    return `<tr>
      <td><span class="tp">${t}</span></td>
      <td><span class="art">${artCell}</span></td>
      <td>${esc(sz)}</td>
      <td>${esc(name)}</td>
      <td>${qty}</td>
      <td><span class="pr">${p ? fmt(p) : "—"}</span></td>
      <td style="font-size:11px;color:var(--ink3)">${esc(wh)}</td>
    </tr>`;
  }).join("");

  const more = sorted.length > LIM
    ? `<tr class="er"><td colspan="7"><button class="eb" onclick="App.togExp(${n})">${EXP[n] ? "▲ Свернуть" : "▼ Все " + sorted.length}</button></td></tr>`
    : "";

  return `<div class="sec">
    <div class="sh">
      <span class="st">${weekMode ? "Заказы за период" : "Заказы сегодня"}</span>
      <span class="sm2">${orders.length} заказов</span>
    </div>
    <div class="tw"><table>
      <thead><tr>
        <th>Время</th><th>Артикул</th><th>Размер</th><th>Товар</th><th>Кол-во</th>
        <th data-tip="finishedPrice × 0.80 — приблизительная цена на витрине с учётом среднего СПП ~20%">Цена на сайте</th>
        <th>Склад</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="em">Нет заказов</td></tr>'}${more}</tbody>
    </table></div>
  </div>`;
}
