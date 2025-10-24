// assets/js/api.js
import { API } from "./config.js";

async function jget(params) {
  const qs = new URLSearchParams(
    Object.entries(params).reduce((acc, [k, v]) => {
      acc[k] = v == null ? "" : String(v);
      return acc;
    }, {})
  ).toString();

  const res = await fetch(`${API}?${qs}`);
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const Api = {
  // создание заказа
  createOrder(data) {
    return jget({ action: "create", data: JSON.stringify(data) });
  },

  // обновление статуса (удаление из календаря произойдёт на сервере при cancelled/done)
  updateStatus(id, status, comment = "") {
    return jget({
      action: "updatestatus",
      id: String(id),
      status: String(status),
      comment,
    });
  },

  // заказы за дату
  ordersByDate(date, includeAll = false) {
    return jget({
      action: "ordersbydate",
      date,
      includeAll: includeAll ? "1" : "0",
    });
  },

  // ближайшие поездки
  todos(hours = 24) {
    return jget({ action: "todos", hours: String(hours) });
  },

  // поиск
  search(q, limit = 30) {
    return jget({ action: "search", q, limit: String(limit) });
  },
};
