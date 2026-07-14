/* ── Версия ── */
export const VERSION = "2026-07-14 modular-1";

/* ── Воркер ──
   Единственный адрес, который нужно здесь править. Дашборд лежит на
   GitHub Pages, воркер — на Cloudflare; ключи живут в его секретах,
   браузер шлёт только номер кабинета. */
export const WORKER = "https://wb-proxy.ooo6311ooo.workers.dev";

/* ── Эндпоинты ── */
export const WB_BASE = "https://statistics-api.wildberries.ru/api/v1/supplier";
export const OZ_BASE = "https://api-seller.ozon.ru";

/* ── Google Sheets ── */
export const CSV_BUYRATE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuc_t740K_yF5Nhw3saPZcbyxchMhJ93WrS05BbLY9OqqXtj3y5xG6WaraGsI4Z7SmNTHFyBlNTcn/pub?gid=0&single=true&output=csv";
export const CSV_SGP = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQdfWL8acRSVEEy__OKcizuFMBn1QCZqvMlbsE0Zz8IZfSMr-sDj_8_MaYQiz8KIvQ3ag8T2qU2cTK0/pub?gid=1909727956&single=true&output=csv";
export const CSV_RAW = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQdfWL8acRSVEEy__OKcizuFMBn1QCZqvMlbsE0Zz8IZfSMr-sDj_8_MaYQiz8KIvQ3ag8T2qU2cTK0/pub?gid=1387615415&single=true&output=csv";
export const CSV_MAP = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQdfWL8acRSVEEy__OKcizuFMBn1QCZqvMlbsE0Zz8IZfSMr-sDj_8_MaYQiz8KIvQ3ag8T2qU2cTK0/pub?gid=1004508899&single=true&output=csv";

/* ══════════════════════════════════════════════════════════
   ЛЕЧЕНИЕ 429 — все ручки собраны здесь
   ══════════════════════════════════════════════════════════
   WB Statistics API считает лимит по API-ключу, а не по IP,
   и штрафует за попытку внутри окна блокировки: каждый новый
   429 продлевает бан. Поэтому:
     · пауза между любыми двумя запросами — не 1.2 с, а 20 с;
     · ретрай после 429 — минута, потом полторы, потом две;
     · Retry-After уважается, если воркер его прокинул.
   Если WB ослабит лимиты — уменьшайте здесь, а не в коде. */
export const WB_GAP = 20000;                       /* пауза между запросами в очереди */
export const WB_BACKOFF = [60000, 90000, 120000];  /* паузы перед 2-й, 3-й, 4-й попытками */
export const WB_TIMEOUT = 60000;                   /* сколько ждём ответ воркера */

/* Кэш ответов WB/Ozon. F5 внутри окна не бьёт по API. */
export const CACHE_TTL = 10 * 60 * 1000;           /* 10 минут */
export const CACHE_MAX_BYTES = 2 * 1024 * 1024;    /* больше — в localStorage не кладём */

/* Глубина истории заказов (дни). Нужна для режимов «неделя» и «месяц». */
export const ORDERS_DAYS = 62;

/* Сколько строк показываем до «Показать все» */
export const LIM = 10;

/* Средний СПП — коэффициент для колонки «Цена на сайте» */
export const SPP_COEF = 0.8;

/* Выкупаемость по умолчанию, если артикула нет в таблице */
export const DEFAULT_BUYRATE = 0.7;

/* Московские склады WB (справочная колонка МСК) */
export const MSK_RE = /коледино|электросталь|тула|подольск|рязань/i;
