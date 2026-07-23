import { VERSION } from "./config.js";
import {
  D, EXP, EXS, EXD, OA, OAD, OAC, SS, DS, FA, FP,
  CM, CV, CONSO, cabName,
} from "./state.js";
import { L1, L2, L3 } from "./logos.js";
import { loadPass, login, logout as dropPass } from "./api/auth.js";
import { loadExternal } from "./api/sheets.js";
import { loadWB } from "./api/wb.js";
import { loadOZ } from "./api/ozon.js";
import { renderCabinet, repaintStocks, repaintDeficit } from "./render/cabinet.js";
import { renderConso, logConso } from "./render/conso.js";
import { fpInput, faInput } from "./render/filters.js";
import { esc } from "./utils.js";

let curTab = 1;

/* ══ Загрузка кабинета ══ */
async function reload(n, force = false) {
  const view = document.getElementById("v" + n);
  const btn = document.getElementById("rb" + n);

  btn && (btn.disabled = true);
  view.innerHTML = `<div class="lm"><span class="sp">◜</span> Загрузка «${cabName(n)}»…
    <div style="font-size:11px;margin-top:8px" id="ri${n}">запрос к API</div></div>`;

  const say = (msg) => {
    const el = document.getElementById("ri" + n);
    if (el) el.textContent = msg;
  };

  /* WB штрафует за частые ретраи, поэтому паузы длинные — честно об этом пишем */
  const onRetry = (reason, sec, attempt) => {
    say(`${reason} · ждём ${sec} с перед попыткой ${attempt + 1}`);
    if (curTab === 4) logConso(`${cabName(n)}: ${reason}, пауза ${sec} с`);
  };

  try {
    await loadExternal();
    say("справочники загружены, запрашиваем маркетплейс");
    if (n === 3) await loadOZ({ force });
    else await loadWB(n, { force, onRetry });

    document.getElementById("upd").textContent =
      "обновлено " + new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });

    if (curTab === 4) renderConso();
    else renderCabinet(n);
  } catch (e) {
    view.innerHTML = `<div class="sb"><span class="sde"></span>
      <div><b>«${cabName(n)}» не загрузился</b><br>${esc(e.message)}</div></div>
      <button class="loadbtn" onclick="App.reload(${n},true)">↻ Попробовать снова</button>`;
    if (curTab === 4) logConso(`${cabName(n)}: ошибка — ${e.message}`);
  } finally {
    btn && (btn.disabled = false);
  }
}

async function reloadForConso(n) {
  logConso(`${cabName(n)}: запрос отправлен`);
  await reload(n);
  if (D[n]) logConso(`${cabName(n)}: готово`);
  renderConso();
}

/* ══ Вкладки ══ */
function go(n) {
  curTab = n;
  document.querySelectorAll(".tab").forEach((t, i) => t.classList.toggle("on", i === n - 1));
  document.querySelectorAll(".view").forEach((v, i) => (v.style.display = i === n - 1 ? "" : "none"));

  if (n === 4) { renderConso(); return; }

  /* Сами не грузим: WB считает лимит по ключу, и лишний поход за
     кабинетом, который никто не открывал, — это чужой бан. */
  if (D[n]) renderCabinet(n);
  else document.getElementById("v" + n).innerHTML =
    `<div class="lm">Кабинет «${cabName(n)}» ещё не загружен
       <div style="margin-top:14px">
         <button class="loadbtn" onclick="App.reload(${n})">↓ Загрузить данные</button>
       </div>
     </div>`;
}

/* ══ Вход и выход ══
   Ключей в браузере нет — вводить нечего, кроме пароля. Проверяет его
   воркер: подобрать пропуск правкой этого файла не выйдет. */
async function doLogin() {
  const pw = document.getElementById("pw");
  const msg = document.getElementById("gmsg");
  const btn = document.getElementById("gobtn");

  if (!pw.value) { msg.className = "smsg err"; msg.textContent = "Введите пароль"; return; }

  btn.disabled = true;
  msg.className = "smsg";
  msg.textContent = "Проверяем…";

  try {
    await login(pw.value);
    document.getElementById("gate").classList.remove("show");
    go(1);
  } catch (e) {
    msg.className = "smsg err";
    msg.textContent = e.message;
    pw.select();
  } finally {
    btn.disabled = false;
  }
}

const logout = dropPass;

/* ══ Проверка версии ══ */
async function checkVersion() {
  const b = document.getElementById("verBtn");
  b.className = "ver-badge ver-check";
  b.textContent = "проверяю…";
  try {
    const r = await fetch(location.pathname + "?_=" + Date.now(), { cache: "no-store" });
    const t = await r.text();
    const m = t.match(/VERSION\s*=\s*"([^"]+)"/);
    const live = m ? m[1] : null;
    if (live && live !== VERSION) {
      b.className = "ver-badge ver-old";
      b.textContent = "⚠ есть новая версия — обновите (Ctrl+F5)";
    } else {
      b.className = "ver-badge ver-ok";
      b.textContent = "✓ " + VERSION;
    }
  } catch {
    b.className = "ver-badge ver-check";
    b.textContent = VERSION;
  }
}

/* ══ Обработчики, на которые ссылается разметка ══ */
const App = {
  reload, reloadForConso, go, doLogin, logout, checkVersion,
  fpInput, faInput,

  /* график */
  setChartMode(n, m) { CM[n] = m; renderCabinet(n); },
  setChartVal(n, v) { CV[n] = v; renderCabinet(n); },

  /* фильтры */
  addFA(n, a) {
    if (!FA[n].includes(a)) FA[n].push(a);
    const i = document.getElementById("fai" + n);
    if (i) i.value = "";
    renderCabinet(n);
  },
  rmFA(n, i) { FA[n].splice(i, 1); renderCabinet(n); },
  addFP(n, s) {
    if (!FP[n].includes(s)) FP[n].push(s);
    const i = document.getElementById("fpi" + n);
    if (i) i.value = "";
    renderCabinet(n);
  },
  rmFP(n, i) { FP[n].splice(i, 1); renderCabinet(n); },
  clearFilters(n) { FA[n] = []; FP[n] = []; renderCabinet(n); },

  /* заказы */
  togExp(n) { EXP[n] = !EXP[n]; renderCabinet(n); },

  /* остатки — точечная перерисовка */
  sortS(n, c) {
    SS[n] = SS[n].c === c ? { c, d: -SS[n].d } : { c, d: -1 };
    repaintStocks(n);
  },
  togArt(n, a) {
    OA[n].has(a) ? OA[n].delete(a) : OA[n].add(a);
    repaintStocks(n);
  },
  togExS(n) { EXS[n] = !EXS[n]; repaintStocks(n); },

  /* дефицит — точечная перерисовка */
  sortD(n, c) {
    DS[n] = DS[n].c === c ? { c, d: -DS[n].d } : { c, d: -1 };
    repaintDeficit(n);
  },
  togArtD(n, a) {
    OAD[n].has(a) ? OAD[n].delete(a) : OAD[n].add(a);
    repaintDeficit(n);
  },
  togExD(n) { EXD[n] = !EXD[n]; repaintDeficit(n); },

  /* консолидация */
  togExpC() { CONSO.expandOrders = !CONSO.expandOrders; renderConso(); },
  togConsoArt(a) {
    OAC.has(a) ? OAC.delete(a) : OAC.add(a);
    renderConso();
  },
};

window.App = App;

/* ══ Тултипы ══ */
const tip = document.createElement("div");
tip.id = "tip-box";
document.body.appendChild(tip);

document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-tip]");
  if (!el) return;
  tip.textContent = el.dataset.tip;
  tip.style.display = "block";
  const r = el.getBoundingClientRect();
  let left = r.left + r.width / 2 - 120;
  left = Math.max(8, Math.min(left, window.innerWidth - 248));
  const above = r.top > 90;
  tip.style.left = left + "px";
  tip.style.top = (above ? r.top - tip.offsetHeight - 8 : r.bottom + 8) + "px";
});
document.addEventListener("mouseout", (e) => {
  if (e.target.closest("[data-tip]")) tip.style.display = "none";
});

/* ══ Старт ══ */
function init() {
  document.getElementById("hlogo").src = L1;
  document.getElementById("glogo").src = L1;
  document.getElementById("logo1").src = L1;
  document.getElementById("logo2").src = L2;
  document.getElementById("logo3").src = L3;

  const clock = () => {
    document.getElementById("clk").textContent =
      new Date().toLocaleString("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  clock();
  setInterval(clock, 30000);

  document.getElementById("verBtn").textContent = VERSION;
  checkVersion();

  /* Пропуск ещё действует — пускаем сразу, иначе показываем окно входа */
  if (loadPass()) {
    go(1);
  } else {
    document.getElementById("gate").classList.add("show");
    const pw = document.getElementById("pw");
    pw.focus();
    pw.onkeydown = (e) => { if (e.key === "Enter") doLogin(); };
  }
}

init();
