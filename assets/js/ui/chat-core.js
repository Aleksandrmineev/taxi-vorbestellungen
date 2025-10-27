import { Api } from "../api.js";
import { parseOrderCandidate } from "../utils/parseOrder.js";

// ===== identity (device) =====
export const deviceId =
  localStorage.getItem("deviceId") ||
  (() => {
    const id =
      self.crypto?.randomUUID?.() ||
      String(Date.now()) + Math.random().toString(16).slice(2);
    localStorage.setItem("deviceId", id);
    return id;
  })();

// ===== cache =====
const CACHE_KEY = "chat_cache_v1";

// Сбрасываем кэш при «перезагрузке страницы»
(function resetCacheOnReloadOnce() {
  try {
    const navs = performance.getEntriesByType?.("navigation");
    const isReload =
      navs?.[0]?.type === "reload" ||
      (performance.navigation && performance.navigation.type === 1);
    if (isReload) localStorage.removeItem(CACHE_KEY);
  } catch (_) {}
})();

function loadCache() {
  try {
    const x = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return {
      items: Array.isArray(x.items) ? x.items : [],
      lastTs: Number(x.lastTs || 0) || 0,
    };
  } catch {
    return { items: [], lastTs: 0 };
  }
}
function saveCache(items, lastTs) {
  const MAX = 500;
  const trimmed = items.slice(-MAX);
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ items: trimmed, lastTs: Number(lastTs || 0) })
  );
}

// ===== state =====
const cache = loadCache();

export const state = {
  items: cache.items,
  filterOrdersOnly: false,
  displayName: localStorage.getItem("displayName") || "",
  lastTs: cache.lastTs || 0,
};

// ===== utils =====
export function escapeHtml(s = "") {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

// stamp по ДАТЕ ЗАКАЗА (yyyy-mm-dd или dd.mm.yyyy) + time
export function orderStamp(m) {
  const o = m?.order || {};
  const date = String(o.date || "");
  const time = String(o.time || "00:00");
  let y, mn, d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date))
    [y, mn, d] = date.split("-").map(Number);
  else {
    const p = date.split(".");
    d = +p[0];
    mn = +p[1];
    y = +p[2];
  }
  const [hh, mm] = time.split(":").map((n) => parseInt(n || "0", 10));
  const t = new Date(
    y || 0,
    (mn || 1) - 1,
    d || 1,
    hh || 0,
    mm || 0,
    0,
    0
  ).getTime();
  return Number.isFinite(t) ? t : 0;
}

// аккуратный merge новых сообщений + dedup tmp_
export function mergeItems(newItems) {
  if (!Array.isArray(newItems) || !newItems.length) return;
  const byId = new Map(state.items.map((m) => [m.id, m]));
  const now = state.items;

  for (const m of newItems) {
    if (!m || !m.id) continue;
    if (byId.has(m.id)) continue;

    // Сносим временное локальное, совпадающее по отправителю/тексту/времени
    const isMine = (x) =>
      (m.device && x.device && m.device === x.device) ||
      (!m.device && !x.device && (m.author || "") === (x.author || ""));

    const idxTmp = now.findIndex(
      (x) =>
        x.id?.startsWith?.("tmp_") &&
        isMine(x) &&
        String(x.text || "") === String(m.text || "") &&
        Math.abs(Number(m.ts || 0) - Number(x.ts || 0)) <= 15000
    );
    if (idxTmp !== -1) now.splice(idxTmp, 1);

    now.push(m);
    byId.set(m.id, m);
  }

  state.lastTs = Math.max(
    state.lastTs || 0,
    ...newItems.map((x) => Number(x.ts || 0))
  );
  saveCache(now, state.lastTs);
}

// ===== локальный optimistic для обычного текста (НЕ для заказов) =====
export function addLocalTextMessage(text) {
  const m = {
    id: "tmp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    ts: Date.now(),
    author: state.displayName,
    device: deviceId,
    text: String(text || ""),
    is_order: false,
  };
  state.items.push(m);
  saveCache(state.items, state.lastTs || 0);
  return m;
}

// ===== data fetch =====
export async function loadIncremental() {
  try {
    const res = await Api.messagesList({
      since: state.lastTs || 0,
      limit: 300,
    });
    if (res?.ok && Array.isArray(res.items)) {
      const newItems = res.items;
      mergeItems(newItems);
      return newItems; // возвращаем новые для звуков и логики
    }
  } catch {}
  return [];
}

export async function fullRefresh() {
  try {
    const res = await Api.messagesList({ since: 0, limit: 500 });
    if (res?.ok && Array.isArray(res.items)) {
      state.items = res.items.slice();
      state.lastTs = Math.max(0, ...res.items.map((x) => Number(x.ts || 0)));
      saveCache(state.items, state.lastTs);
    }
  } catch {}
}

// ===== send (без локального рендера для заказов) =====
export async function sendMessage(text) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: false, error: "empty" };

  const cand = parseOrderCandidate(raw);

  if (cand.is_order) {
    // заказ — без локального пузыря, ждём order_created
    return Api.messagesAdd({ text: raw, parsed: cand });
  }

  // обычный текст — просто отправляем (оптимистический рендер делаем снаружи)
  return Api.messagesAdd({ text: raw });
}
