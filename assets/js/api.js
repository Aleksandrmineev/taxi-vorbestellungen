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
  // cache-busting
  params.set("ts", Date.now().toString());

  const url = `${API}?${params.toString()}`;
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  return res.json();
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

  // ДОБАВЬ к остальным методам Api
  async ordersByDate(dateISO, includeAll = false) {
    return getJSON({
      action: "ordersbydate",
      date: String(dateISO || ""),
      includeAll: includeAll ? "1" : "0",
    });
  },

  /** Добавить сообщение в чат */
  async messagesAdd(payload) {
    const id = identity();
    const author = (payload && payload.author) || id.displayName;
    const device = (payload && payload.device) || id.deviceId;
    const text = (payload && payload.text) || "";
    const parsed =
      payload && payload.parsed ? JSON.stringify(payload.parsed) : "";

    return getJSON({
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
    return getJSON({
      action: "create",
      data: JSON.stringify(payload),
    });
  },

  /** Список ближайших задач/заказов (на hours часов вперёд) */
  async todos(hours = 24) {
    return getJSON({
      action: "todos",
      hours: String(hours), // как на сервере
    });
  },

  /** Обновить статус заказа — гибкая сигнатура */
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
