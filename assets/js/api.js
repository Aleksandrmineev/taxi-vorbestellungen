import { API } from "./config.js?v=20260904-2"; // базовый URL

// Должен совпадать с API_SECRET в Google Apps Script.
const API_SECRET = "102030";

// ---- helpers ----
function identity() {
  let deviceId = localStorage.getItem("deviceId");
  if (!deviceId) {
    deviceId =
      self.crypto?.randomUUID?.() ||
      String(Date.now()) + Math.random().toString(16).slice(2);
    localStorage.setItem("deviceId", deviceId);
  }
  const displayName = localStorage.getItem("displayName") || "Fahrer";
  return { deviceId, displayName };
}

async function getJSON(paramsObj) {
  const params = new URLSearchParams(paramsObj);
  params.set("secret", API_SECRET);
  params.set("ts", Date.now().toString()); // cache-busting

  const url = `${API}?${params.toString()}`;
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${text}`);
  }
  return res.json();
}

// js/api.js
async function postJSON(bodyObj) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ ...bodyObj, secret: API_SECRET, ts: Date.now() }),
  });

  // 1) HTTP-уровень
  const ct = res.headers.get("content-type") || "";
  let data;

  // 2) Пытаемся прочитать корректно в любом формате
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    const text = await res.text().catch(() => "");
    // a) сервер мог вернуть "OK" — считаем это успехом
    if (res.ok && (text.trim().toUpperCase() === "OK" || text.trim() === "")) {
      data = { ok: true, raw: text };
    } else {
      // b) вдруг это JSON с неверным content-type
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: res.ok, raw: text };
      }
    }
  }

  // 3) Если HTTP не ок — кидаем осмысленную ошибку
  if (!res.ok) {
    const msg =
      (data && (data.error || data.message || data.raw)) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  // 4) Приводим форматы к единому виду
  if (data == null) data = { ok: true };
  if (data.ok === false) {
    throw new Error(data.error || "Server reported failure");
  }
  return data;
}

// ---- Redis-Kopie der Bestellungen (schnell) mit Rückfall auf GAS ----
// Lesen: bei jedem Problem wird der bisherige GAS-Weg genutzt. Ausschalten pro Gerät: localStorage mt_orders_redis = "off".
const ORDERS_URL = new URL("/api/orders", API).toString();
const ORDERS_TIMEOUT_MS = 6000;

// definite = der Server hat nichts angenommen (404/503): Schreibvorgänge dürfen dann über GAS laufen.
// Netzwerkfehler, Timeout und 5xx sind unklar: die Bestellung könnte angekommen sein.
class OrdersUnavailable extends Error {
  constructor(message, { definite = false } = {}) {
    super(message || "orders_unavailable");
    this.name = "OrdersUnavailable";
    this.definite = definite;
  }
}

function ordersRedisOff() {
  try { return localStorage.getItem("mt_orders_redis") === "off"; } catch { return false; }
}

async function ordersRequest(op, { method = "GET", params = {}, body } = {}) {
  if (ordersRedisOff()) throw new OrdersUnavailable("disabled_on_device", { definite: true });
  const url = new URL(ORDERS_URL);
  url.searchParams.set("op", op);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value ?? "")));
  url.searchParams.set("secret", API_SECRET);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORDERS_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new OrdersUnavailable("network");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  // 404/5xx: Funktion fehlt, ausgeschaltet oder Redis nicht bereit -> Rückfall auf GAS
  if (res.status === 404 || res.status === 503) throw new OrdersUnavailable(data?.error || `HTTP ${res.status}`, { definite: true });
  if (res.status >= 500) throw new OrdersUnavailable(data?.error || `HTTP ${res.status}`);
  if (!res.ok || !data || data.ok === false) {
    const error = new Error(data?.error || `HTTP ${res.status}`);
    error.orders = true;
    throw error;
  }
  return data;
}

async function ordersOrGas(fast, slow) {
  try {
    return await fast();
  } catch (error) {
    if (error instanceof OrdersUnavailable) return slow();
    throw error;
  }
}

// Ändern/Status sind wiederholbar: bei jedem Problem einfach über GAS.
const ordersWrite = ordersOrGas;

// Anlegen: nur bei „nichts angenommen“ über GAS; bei unklarem Ergebnis Fehler zeigen (Wiederholen mit derselben requestId
// legt keine zweite Bestellung an).
async function ordersCreate(fast, slow) {
  try {
    return await fast();
  } catch (error) {
    if (!(error instanceof OrdersUnavailable)) throw error;
    if (error.definite) return slow();
    throw new Error("Verbindung unklar – bitte noch einmal auf Speichern tippen (es entsteht keine doppelte Bestellung).");
  }
}

function newRequestId() {
  return self.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ---- API ----
export const Api = {
  /** История сообщений (polling) */
  async messagesList(opts) {
    const since = opts && typeof opts.since === "number" ? opts.since : 0;
    const limit = opts && typeof opts.limit === "number" ? opts.limit : 300;
    return getJSON({
      action: "messageslist",
      since: String(since),
      limit: String(limit),
    });
  },

  /** Push: сохранить подписку */
  async pushSubscribe(sub) {
    return postJSON({ action: "push_subscribe", ...sub });
  },

  /** Заказы по дате */
  async ordersByDate(dateISO, includeAll = false) {
    return ordersOrGas(
      () => ordersRequest("list", { params: { date: String(dateISO || ""), includeAll: includeAll ? "1" : "0" } }),
      () => getJSON({
        action: "ordersbydate",
        date: String(dateISO || ""),
        includeAll: includeAll ? "1" : "0",
      }),
    );
  },

  /** Добавить обычное сообщение (или parsed — на бэке создаст заказ) */
  async messagesAdd(payload) {
    const id = identity();
    const author = (payload && payload.author) || id.displayName;
    const device = (payload && payload.device) || id.deviceId;
    const text = (payload && payload.text) || "";
    const parsed = payload && payload.parsed ? payload.parsed : undefined;

    return postJSON({
      action: "messagesadd",
      author,
      device,
      text,
      ...(parsed ? { parsed } : {}),
    });
  },

  /** Создать заказ */
  async createOrder(data) {
    const { deviceId, displayName } = identity();

    // --- нормализация типа (KT / RE / Orts) ---
    let type = String(data.type || "")
      .toUpperCase()
      .trim();
    if (type === "KT" || /krankentransport|krankenfahrt/.test(type)) {
      type = "KT";
    } else if (
      type === "RE" ||
      /\brechnungsfahrt\b/i.test(type) ||
      /\bauf\s+rechnung\b/i.test(type) ||
      /\brf\b/i.test(type) ||
      /\bflughafenfahrt(en)?\b/i.test(type) ||
      /\bairportfahrt(en)?\b/i.test(type) ||
      /\bzum\s+flughafen\b/i.test(type)
    ) {
      type = "RE";
    } else {
      type = "Orts";
    }

    const payload = Object.assign({}, data, {
      type, // ← гарантируем корректный тип
      created_by_name: displayName,
      created_by_device: deviceId,
    });

    const { requestId, ...orderData } = payload;
    // можно и GET, но POST надёжнее для длинных тел
    return ordersCreate(
      () => ordersRequest("create", { method: "POST", body: { data: orderData, requestId: String(requestId || newRequestId()) } }),
      () => postJSON({ action: "create", data: orderData }),
    );
  },

  /** Изменить существующий заказ */
  async updateOrder(id, data) {
    const { deviceId, displayName } = identity();
    const payload = Object.assign({}, data, {
      created_by_name: displayName,
      created_by_device: deviceId,
    });
    return ordersWrite(
      () => ordersRequest("update", { method: "POST", body: { id: String(id), data: payload } }),
      () => postJSON({ action: "updateorder", id: String(id), data: payload }),
    );
  },

  /** Список ближайших задач/заказов */
  async todos(hours = 24) {
    return ordersOrGas(
      () => ordersRequest("todos", { params: { hours: String(hours) } }),
      () => getJSON({
        action: "todos",
        hours: String(hours),
      }),
    );
  },

  /** Обновить статус заказа */
  async updateStatus(a, b, c, d) {
    let id, status, comment, allSeries;
    if (typeof a === "object" && a) {
      ({ id, status, comment = "", allSeries = false } = a);
    } else {
      id = a;
      status = b;
      comment = c || "";
      allSeries = d || false;
    }
    return ordersWrite(
      () => ordersRequest("status", { method: "POST", body: { id: String(id), status: String(status), comment: String(comment), allSeries: Boolean(allSeries) } }),
      () => postJSON({
        action: "updatestatus",
        id: String(id),
        status: String(status),
        comment: String(comment),
        allSeries: allSeries ? "1" : "0",
      }),
    );
  },

  /** Поиск заказов */
  async search(q, limit = 50) {
    return getJSON({
      action: "search",
      q: String(q || ""),
      limit: String(limit),
    });
  },

  async adminLogin(password) {
    const res = await postJSON({ action: "admin_login", password: String(password || "") });
    if (!res?.token) throw new Error(res?.error || "admin_login failed");
    sessionStorage.setItem("vorbestellungen_admin_token", res.token);
    return res;
  },

  async orderAdminSettings() {
    return getJSON({ action: "order_admin_settings", adminToken: sessionStorage.getItem("vorbestellungen_admin_token") || "" });
  },

  async saveOrderAdminSettings(settings) {
    return postJSON({
      action: "order_admin_settings_save",
      adminToken: sessionStorage.getItem("vorbestellungen_admin_token") || "",
      dayPhone: settings.dayPhone || "",
      nightPhone: settings.nightPhone || "",
      dayPhone1: settings.dayPhone1 || "",
      dayPhone2: settings.dayPhone2 || "",
      nightPhone1: settings.nightPhone1 || "",
      nightPhone2: settings.nightPhone2 || "",
    });
  },
};
