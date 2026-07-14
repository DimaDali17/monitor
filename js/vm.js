import { D, VM, FA, FP } from "./state.js";
import { MSK_RE } from "./config.js";
import { wbQty } from "./utils.js";

/* ══════════════════════════════════════════════════════════
   Вьюмодель кабинета: фильтры применены, агрегаты посчитаны.
   Строится один раз на рендер. Все таблицы читают VM[n],
   и никто больше не подменяет D[n] на лету.
   ══════════════════════════════════════════════════════════ */

export function buildVM(n) {
  const d = D[n];
  if (!d) { VM[n] = null; return null; }

  const src = hasFilters(n) ? applyFilters(n, d) : d;
  const { arts, whList, mskWhs } = aggregateStocks(src);

  VM[n] = {
    ...src,
    arts,          /* "арт · размер" → {art, sz, name, total, wh:{склад→шт}} */
    whList,        /* склады, отсортированы по суммарному остатку */
    mskWhs,        /* московские склады */
    orderMap: buildOrderMap(src),  /* "арт · размер" → заказов за 7 дней */
  };
  return VM[n];
}

export const hasFilters = (n) => FA[n].length > 0 || FP[n].length > 0;

function applyFilters(n, d) {
  const arts = FA[n], subs = FP[n], isOz = d.isOz;

  const orderOk = (o) => {
    const artOk = !arts.length || (isOz
      ? (o.products || []).some((p) => arts.includes(p.offer_id))
      : arts.includes(o.supplierArticle));
    const subOk = !subs.length || (isOz
      ? (o.products || []).some((p) => subs.some((s) => (p.name || "").startsWith(s)))
      : subs.includes(o.subject || o.category || ""));
    return artOk && subOk;
  };

  const stockOk = (s) => {
    const artOk = !arts.length || (isOz
      ? arts.includes(s.item_code || s.offer_id)
      : arts.includes(s.supplierArticle));
    const subOk = isOz || !subs.length || subs.includes(s.subject || s.category || "");
    return artOk && subOk;
  };

  return {
    ...d,
    todayO: (d.todayO || []).filter(orderOk),
    yestO: (d.yestO || []).filter(orderOk),
    orders7: (d.orders7 || []).filter(orderOk),
    allOrders: (d.allOrders || []).filter(orderOk),
    stocks: (d.stocks || []).filter(stockOk),
  };
}

function aggregateStocks(d) {
  const isOz = d.isOz;
  const arts = {}, whTotals = {};

  (d.stocks || []).forEach((s) => {
    const art = (isOz ? s.item_code || s.offer_id : s.supplierArticle) || "—";
    const sz = isOz ? "—" : s.techSize || "—";
    const wh = (isOz ? s.warehouse_name : s.warehouseName) || "—";
    const q = isOz ? s.free_to_sell_amount || s.quantity || 0 : wbQty(s);
    const name = (isOz ? s.item_name : s.subject || s.category) || "";

    const key = art + " · " + sz;
    (arts[key] ||= { art, sz, name, total: 0, wh: {} });
    arts[key].wh[wh] = (arts[key].wh[wh] || 0) + q;
    arts[key].total += q;
    whTotals[wh] = (whTotals[wh] || 0) + q;
  });

  const whList = Object.keys(whTotals).sort((a, b) => whTotals[b] - whTotals[a]);
  const mskWhs = isOz ? [] : whList.filter((w) => MSK_RE.test(w));
  return { arts, whList, mskWhs };
}

function buildOrderMap(d) {
  const m = {};
  (d.orders7 || []).forEach((o) => {
    if (d.isOz) {
      (o.products || []).forEach((p) => {
        const k = (p.offer_id || "—") + " · —";
        m[k] = (m[k] || 0) + (p.quantity || 1);
      });
    } else {
      const k = (o.supplierArticle || "—") + " · " + (o.techSize || "—");
      m[k] = (m[k] || 0) + (o.quantity || 1);
    }
  });
  return m;
}

/* Списки для выпадашек фильтров — из НЕотфильтрованных данных */
export function getSubjects(n) {
  const d = D[n];
  if (!d) return [];
  const s = new Set();
  const orders = [...(d.todayO || []), ...(d.yestO || []), ...(d.orders7 || [])];
  if (d.isOz) {
    orders.forEach((o) => (o.products || []).forEach((p) => {
      if (p.name) s.add(p.name.split(" ")[0] || p.name);
    }));
  } else {
    orders.forEach((o) => s.add(o.subject || o.category || ""));
    (d.stocks || []).forEach((r) => s.add(r.subject || r.category || ""));
  }
  s.delete("");
  return [...s].sort();
}

export function getArts(n) {
  const d = D[n];
  if (!d) return [];
  const s = new Set();
  const orders = [...(d.todayO || []), ...(d.yestO || []), ...(d.orders7 || [])];
  if (d.isOz) {
    orders.forEach((o) => (o.products || []).forEach((p) => s.add(p.offer_id || "")));
    (d.stocks || []).forEach((r) => s.add(r.item_code || r.offer_id || ""));
  } else {
    orders.forEach((o) => s.add(o.supplierArticle || ""));
    (d.stocks || []).forEach((r) => s.add(r.supplierArticle || ""));
  }
  s.delete(""); s.delete("—");
  return [...s].sort();
}
