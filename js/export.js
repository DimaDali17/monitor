/* ══════════════════════════════════════════════════════════
   Выгрузка таблицы в .xlsx.

   Читаем не исходные данные, а саму таблицу на экране — что
   человек видит, то и уедет в файл: с фильтрами, сортировкой,
   раскрытыми размерами. Это развязывает экспорт с рендер-
   модулями: их правки выгрузку не ломают.

   SheetJS подтягивается с CDN один раз при первом клике —
   в репозиторий класть ничего не нужно.
   ══════════════════════════════════════════════════════════ */

const CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
let XLSX = null;

async function lib() {
  if (!XLSX) XLSX = await import(CDN);
  return XLSX;
}

/* Достаём строки из <table>. Служебная строка с кнопкой «Все N»
   в файл не идёт; треугольники ▶/▼ и стрелки сортировки срезаем. */
function readTable(table) {
  const rows = [];
  for (const tr of table.querySelectorAll("tr")) {
    if (tr.querySelector("button")) continue;
    const cells = [...tr.querySelectorAll("th,td")].map((c) => {
      let t = (c.innerText || "").replace(/\s+/g, " ").trim();
      t = t.replace(/^[▶▼]\s*/, "").replace(/\s*[↕↑↓]$/, "");
      /* «1 234 ₽», «12д», проценты оставляем текстом — иначе Excel
         потеряет единицы; голые целые приводим к числу для сумм */
      const num = t.replace(/\u00a0/g, "").replace(/\s/g, "");
      if (/^-?\d+$/.test(num)) return Number(num);
      return t;
    });
    if (cells.some((c) => c !== "")) rows.push(cells);
  }
  return rows;
}

/* Находит ближайшую к кнопке таблицу и выгружает её */
export async function exportBlock(btn, sheetName, fileBase) {
  const sec = btn.closest(".sec");
  const table = sec ? sec.querySelector("table") : null;
  if (!table) { alert("Таблица не найдена"); return; }

  const label = btn.innerHTML;
  btn.innerHTML = "…";
  btn.disabled = true;

  try {
    const x = await lib();
    const rows = readTable(table);
    if (!rows.length) { alert("В таблице нет строк"); return; }

    const ws = x.utils.aoa_to_sheet(rows);

    const widths = [];
    rows.forEach((r) => r.forEach((c, i) => {
      const len = String(c == null ? "" : c).length;
      if (!widths[i] || widths[i] < len) widths[i] = len;
    }));
    ws["!cols"] = widths.map((w) => ({ wch: Math.min(Math.max(w + 1, 6), 40) }));

    const wb = x.utils.book_new();
    x.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

    const stamp = new Date().toISOString().slice(0, 10);
    x.writeFile(wb, `${fileBase}_${stamp}.xlsx`);
  } catch (e) {
    console.error(e);
    alert("Не удалось выгрузить: " + e.message);
  } finally {
    btn.innerHTML = label;
    btn.disabled = false;
  }
}

/* Готовая кнопка для шапки блока (.sh) */
export function xlsxBtn(sheetName, fileBase) {
  return `<button class="b" style="padding:3px 9px;font-size:10px"
    onclick="App.exportXlsx(this,'${sheetName}','${fileBase}')"
    data-tip="Скачать таблицу в Excel — как на экране, с учётом фильтров">⤓ Excel</button>`;
}
