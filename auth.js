import { WORKER } from "../config.js";

/* ══════════════════════════════════════════════════════════
   Вход. Пароль уходит на воркер, воркер сверяет его со своим
   секретом и возвращает подписанный пропуск на 12 часов.
   Здесь, в браузере, ничего не проверяется — правкой этого
   файла в консоли доступ к данным не открыть: без настоящего
   пропуска воркер просто не ответит.
   ══════════════════════════════════════════════════════════ */

const STORE = "ef_pass";
let pass = null;

export function loadPass() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "null");
    if (s && s.exp > Date.now() / 1000 + 60) { pass = s.pass; return true; }
    localStorage.removeItem(STORE);
  } catch { /* битый JSON — считаем, что не вошли */ }
  return false;
}

export const authed = () => !!pass;

/* Заголовок для каждого запроса к воркеру */
export const authHeader = () => (pass ? { Authorization: "Bearer " + pass } : {});

export async function login(password) {
  const r = await fetch(WORKER + "/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Не пускает");

  pass = d.pass;
  try { localStorage.setItem(STORE, JSON.stringify({ pass: d.pass, exp: d.exp })); }
  catch { /* приватный режим — проживём одну сессию */ }
  return true;
}

export function logout() {
  pass = null;
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  location.reload();
}

/* Пропуск протух посреди работы — просим войти заново */
export function expired() {
  pass = null;
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  location.reload();
}
