// assets/js/ui/chat-ui.js
import { Api } from "../api.js";
import {
  deviceId,
  state,
  escapeHtml,
  orderStamp,
  mergeItems,
  loadIncremental,
  fullRefresh,
  sendMessage, // ← используем отправку без локального рендера для заказов
} from "./chat-core.js";

const chatEl = document.getElementById("chat");
const form = document.getElementById("sendForm");
const input = document.getElementById("msg");
const btnAll = document.getElementById("btn-all");
const btnOnly = document.getElementById("btn-only");
const btnName = document.getElementById("btn-name");

// имя один раз
if (!state.displayName) {
  state.displayName =
    prompt("Dein Name (wird im Chat angezeigt):")?.trim() || "Fahrer";
  localStorage.setItem("displayName", state.displayName);
}

// ==== шаблоны ====
function bubbleHtml(m) {
  const me = m.device ? m.device === deviceId : m.author === state.displayName;
  const isOrder =
    m.is_order === true ||
    m.type === "order_created" ||
    m.type === "order_updated";
  const cls = `msg ${me ? "me" : "them"} ${isOrder ? "order" : ""}`;
  const when = new Date(m.ts).toLocaleString();

  if (isOrder) {
    const o = m.order || {};
    const titleParts = [];
    if (o.date) titleParts.push(String(o.date));
    if (o.time) titleParts.push(`um ${o.time}`);
    if (o.type) titleParts.push(String(o.type));
    const title = titleParts.length
      ? titleParts.join(" ")
      : m.text || "Bestellung";
    const phone = o.phone_norm || o.phone || "";
    const msg = o.message || m.text || "";

    return `<div class="${cls}" data-id="${m.id}">
              <span class="badge">Bestellung</span>
              ${escapeHtml(title)}
              ${msg ? `<div class="mt-1">${escapeHtml(msg)}</div>` : ""}
              ${
                phone
                  ? `<div class="mt-1">📞 <a href="tel:${escapeHtml(
                      phone
                    )}">${escapeHtml(phone)}</a></div>`
                  : ""
              }
              <div class="meta"><span>${escapeHtml(
                m.author || ""
              )}</span><span>${when}</span></div>
            </div>`;
  }

  return `<div class="${cls}" data-id="${m.id}">
            ${escapeHtml(m.text || "")}
            <div class="meta"><span>${escapeHtml(
              m.author || ""
            )}</span><span>${when}</span></div>
          </div>`;
}

// Удаляем возможные дубликаты сообщений о создании заказа
function dedupOrderCreated(items) {
  const seen = new Set();
  const out = [];
  for (const m of items) {
    if (
      m &&
      (m.type === "order_created" || m.is_order === true) &&
      m.order_id
    ) {
      const key = String(m.order_id);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(m);
  }
  return out;
}

// ==== рендер ====
// При включённом фильтре "Bestellungen" сортируем по orderStamp.
function render(items = state.items) {
  let list = dedupOrderCreated(items);
  list = state.filterOrdersOnly ? list.filter((x) => x.is_order) : list;
  if (state.filterOrdersOnly) {
    list = list.slice().sort((a, b) => orderStamp(a) - orderStamp(b));
  }
  chatEl.innerHTML =
    list.map(bubbleHtml).join("") ||
    "<p class='msg them'>Keine Nachrichten.</p>";
  chatEl.scrollTop = chatEl.scrollHeight;
}

// показать кэш сразу, потом подтянуть сервер
render();
await fullRefresh();
render();

// ==== отправка ====
// Больше НЕ делаем оптимистический рендер для заказов — это убирает «дубли».
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  try {
    await sendMessage(text); // ← chat-core сам решит, заказ это или обычный текст
  } finally {
    input.value = "";
    input.focus();
  }
});

// ==== фильтры ====
btnAll.addEventListener("click", () => {
  state.filterOrdersOnly = false;
  btnAll.setAttribute("aria-pressed", "true");
  btnOnly.setAttribute("aria-pressed", "false");
  render();
});
btnOnly.addEventListener("click", () => {
  state.filterOrdersOnly = true;
  btnOnly.setAttribute("aria-pressed", "true");
  btnAll.setAttribute("aria-pressed", "false");
  render();
});

// ==== смена имени ====
btnName.addEventListener("click", () => {
  const next = prompt("Neuer Anzeigename:", state.displayName)?.trim();
  if (!next || next === state.displayName) return;
  state.displayName = next;
  localStorage.setItem("displayName", state.displayName);
  render();
});

// ==== поллинг ====
setInterval(async () => {
  await loadIncremental();
  render();
}, 3000);

// при возвращении во вкладку — мягкая сверка (подтянет, если чат был закрыт)
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden) {
    await fullRefresh();
    render();
  }
});
