import { API } from "./config.js"; // базовый URL

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
    body: JSON.stringify({ ...bodyObj, ts: Date.now() }),
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
    return getJSON({
      action: "ordersbydate",
      date: String(dateISO || ""),
      includeAll: includeAll ? "1" : "0",
    });
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
    const payload = Object.assign({}, data, {
      created_by_name: displayName,
      created_by_device: deviceId,
    });
    // можно и GET, но POST надёжнее для длинных тел
    return postJSON({ action: "create", data: payload });
  },

  /** Список ближайших задач/заказов */
  async todos(hours = 24) {
    return getJSON({
      action: "todos",
      hours: String(hours),
    });
  },

  /** Обновить статус заказа */
  async updateStatus(a, b, c) {
    let id, status, comment;
    if (typeof a === "object" && a) {
      ({ id, status, comment = "" } = a);
    } else {
      id = a;
      status = b;
      comment = c || "";
    }
    return getJSON({
      action: "updatestatus",
      id: String(id),
      status: String(status),
      comment: String(comment),
    });
  },

  /** Поиск заказов */
  async search(q, limit = 50) {
    return getJSON({
      action: "search",
      q: String(q || ""),
      limit: String(limit),
    });
  },
};
