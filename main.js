import { VERSION } from "./config.js";
import {
  K, PX, D, VM, EXP, EXS, EXD, OA, OAD, OAC, SS, DS, FA, FP, FS, FSZ,
  CM, CV, CONSO, cabName, saveCreds, loadCreds,
} from "./state.js";
import { L1, L2, L3 } from "./logos.js";
import { loadExternal } from "./api/sheets.js";
import { loadWB } from "./api/wb.js";
import { loadOZ } from "./api/ozon.js";
import { cacheClear } from "./api/cache.js";
import { buildVM } from "./vm.js";
import { renderCabinet, repaintStocks, repaintDeficit } from "./render/cabinet.js";
import { renderConso, logConso } from "./render/conso.js";
import { fpInput, faInput } from "./render/filters.js";
import { esc } from "./utils.js";

let curTab = 1;

/* ══ Загрузка кабинета ══ */
async function reload(n, force = false) {
  const view = document.getElementById("v" + n);
  const btn = document.getElementById("rb" + n);
  const has = n === 3 ? K.oid && K.okey : K[n];

  if (!has) {
    view.innerHTML = `<div class="lm">Нет ключей для «${cabName(n)}» — откройте ⚙ Настройки</div>`;
    return;
  }

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
  if (D[n]) renderCabinet(n);
  else reload(n);
}

/* ══ Настройки ══ */
function openSetup() {
  loadCreds();
  const set = (id, v) => (document.getElementById(id).value = v || "");
  set("sk1", K[1]); set("sk2", K[2]);
  set("soid", K.oid); set("sokey", K.okey);
  set("sprx", PX.main); set("sprx2", PX.second);
  document.getElementById("setup").classList.add("show");
}

function doSave() {
  const val = (id) => document.getElementById(id).value.trim();
  K[1] = val("sk1"); K[2] = val("sk2");
  K.oid = val("soid"); K.okey = val("sokey");
  PX.main = val("sprx"); PX.second = val("sprx2");

  if (!K[1] && !K[2] && !K.oid) {
    const m = document.getElementById("smsg");
    m.className = "smsg err";
    m.textContent = "Заполните хотя бы один кабинет";
    return;
  }

  saveCreds();
  cacheClear();                       /* сменились ключи — старый кэш не наш */
  document.getElementById("setup").classList.remove("show");
  D[1] = D[2] = D[3] = null;
  go(curTab);
}

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
  reload, reloadForConso, go, openSetup, doSave, checkVersion,
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
  loadCreds();

  document.getElementById("hlogo").src = L1;
  document.getElementById("logo1").src = L1;
  document.getElementById("logo2").src = L2;
  document.getElementById("logo3").src = L3;
  document.getElementById("slogoimg").src = L1;

  const clock = () => {
    document.getElementById("clk").textContent =
      new Date().toLocaleString("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  clock();
  setInterval(clock, 30000);

  document.getElementById("verBtn").textContent = VERSION;
  checkVersion();

  if (!K[1] && !K[2] && !K.oid) openSetup();
  else go(1);
}

init();
