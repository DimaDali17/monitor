import { RETURNS, isReady, isOnWay } from "../api/returns.js";
import { cabName, D } from "../state.js";
import { esc } from "../utils.js";

/* Плашка «Возвраты к выдаче» вверху кабинета WB.
   Жёлтая — есть что забрать, нет плашки — забирать нечего. Клик — список.
   «Хранится до» WB в отчёте не заполняет — не показываем; видно, с какого числа лежит на ПВЗ. */

const DAY = 864e5;
const fmtD = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d) ? "—" : d.toLocaleDateString("ru", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
};

export function returnsHTML(n, compact) {
  const R = RETURNS[n];
  if (!R) return `<div id="ret${n}"></div>`;
  const ready = (R.items || []).filter(isReady);
  const onWay = (R.items || []).filter(isOnWay);
  if (!ready.length) {
    /* забирать нечего — коротко, без плашки; если ошибка — тихая подпись */
    return `<div id="ret${n}">${R.error ? `<div class="sm2" style="margin-bottom:10px" data-tip="${esc(R.error)}">📦 Возвраты: не удалось загрузить (наведите — причина)</div>` : ""}</div>`;
  }

  const now = Date.now();
  const since = (r) => (r.readyToReturnDt ? new Date(r.readyToReturnDt).getTime() : Infinity);
  ready.sort((a, b) => since(a) - since(b));   /* дольше всех ждут — сверху */
  const oldest = ready[0];
  const waitDays = isFinite(since(oldest)) ? Math.floor((now - since(oldest)) / DAY) : null;
  const bg = "#FFF6E0", bd = "#E9C77B", acc = "#8A5A00";
  const addrs = [...new Set(ready.map((r) => r.dstOfficeAddress).filter(Boolean))];

  /* В отчёте нет артикула продавца — берём по nmId из заказов кабинета */
  const artByNm = {};
  for (const o of (D[n] && D[n].allOrders) || []) if (o.nmId && o.supplierArticle) artByNm[o.nmId] = o.supplierArticle;

  const rows = ready.map((r) => {
    const w = isFinite(since(r)) ? Math.floor((now - since(r)) / DAY) : null;
    return `<tr>
      <td style="white-space:nowrap"><span class="art">${esc(artByNm[r.nmId] || "")}</span> <span style="color:var(--ink3)">${esc(String(r.nmId || ""))}</span></td>
      <td>${esc(r.techSize || "—")}</td>
      <td>${esc(r.subjectName || "")}</td>
      <td>${esc(r.returnType || "")}</td>
      <td style="white-space:nowrap">${fmtD(r.readyToReturnDt)}${w != null ? ` <span style="color:var(--ink3)">(${w} дн.)</span>` : ""}</td>
      <td>${esc(r.dstOfficeAddress || "")}</td>
    </tr>`;
  }).join("");

  const title = `📦 ${compact ? esc(cabName(n)) + ": " : ""}Возвратов к выдаче: <b>${ready.length}</b>`;
  const sub = [
    waitDays != null ? `дольше всех лежит ${waitDays} дн. (с ${fmtD(oldest.readyToReturnDt)})` : "",
    onWay.length ? `ещё ${onWay.length} в пути на ПВЗ` : "",
    addrs.length === 1 ? `ПВЗ: ${esc(addrs[0])}` : addrs.length > 1 ? `ПВЗ: ${addrs.length}` : "",
  ].filter(Boolean).join(" · ");

  return `<div id="ret${n}">
    <details style="background:${bg};border:1px solid ${bd};border-left:4px solid ${acc};border-radius:10px;padding:9px 14px;margin-bottom:14px;font-size:12px">
      <summary style="cursor:pointer;list-style:none;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
        <span style="font-size:13px;color:${acc}">${title}</span>
        <span style="color:var(--ink2)">${sub}</span>
        <span style="margin-left:auto;color:var(--ink3);font-size:11px">▼ список</span>
      </summary>
      <div class="sw" style="margin-top:8px">
        <table>
          <thead><tr><th>Артикул WB</th><th>Размер</th><th>Предмет</th><th>Тип</th><th>На ПВЗ с</th><th>ПВЗ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:6px;font-size:10px;color:var(--ink3)">Из отчёта WB «Возвраты и перемещения товаров» · обновлено ${new Date(R.at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}${R.error ? " · последнее обновление не удалось: " + esc(R.error) : ""} · <a href="https://seller.wildberries.ru/return-transfer-reports/active" target="_blank" rel="noopener">открыть в кабинете WB</a></div>
    </details>
  </div>`;
}

/* Перерисовать только плашку (данные возвратов пришли позже кабинета) */
export function repaintReturns(n) {
  const el = document.getElementById("ret" + n);
  if (el) el.outerHTML = returnsHTML(n);
}
