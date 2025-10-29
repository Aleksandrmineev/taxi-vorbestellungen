// Рендер сообщений (только чат) + day-separators
import { state, escapeHtml } from "../chat-core.js";
import {
  isNearBottom,
  getStickBottom,
  getUserIsReading,
  scrollToBottomStrong,
  updateSendbarHeightVar,
} from "./chat-scroll.js";

const chatEl = document.getElementById("chat");
let initialRendered = false;

/* === форматтеры === */
const fmtTime = (d) =>
  new Date(d).toLocaleTimeString("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(x.getDate()).padStart(2, "0")}`;
};

/* === шаблон пузыря === */
function bubbleHtml(m) {
  const cls = `msg ${m.author === state.displayName ? "me" : "them"}`;
  const time = fmtTime(m.ts);
  return `<div class="${cls}" data-id="${m.id}">
    ${escapeHtml(m.text || "")}
    <div class="meta"><span>${escapeHtml(
      m.author || ""
    )}</span><span>${time}</span></div>
  </div>`;
}

/* === безопасный render === */
export function render(items = state.items) {
  if (!chatEl) return;

  // щит: не затираем DOM при временной недоступности
  if (!Array.isArray(items)) {
    updateSendbarHeightVar();
    return;
  }
  const hadAnyMsg = !!chatEl.querySelector(".msg");
  if (items.length === 0 && hadAnyMsg) {
    updateSendbarHeightVar();
    return;
  }

  const wasNear = isNearBottom(chatEl);

  // day-separators
  let lastKey = null;
  const parts = [];
  for (const m of items) {
    const k = dateKey(m.ts || Date.now());
    if (k !== lastKey) {
      parts.push(
        `<div class="day-sep" data-day="${k}"><span>${fmtDate(
          m.ts || Date.now()
        )}</span></div>`
      );
      lastKey = k;
    }
    parts.push(bubbleHtml(m));
  }

  chatEl.innerHTML =
    (parts.length
      ? parts.join("")
      : "<p class='msg them'>Keine Nachrichten.</p>") +
    "<div id='chat-bottom' aria-hidden='true'></div>";

  updateSendbarHeightVar();

  if (
    !initialRendered ||
    ((wasNear || getStickBottom()) && !getUserIsReading())
  ) {
    scrollToBottomStrong({ smooth: initialRendered });
  }
  initialRendered = true;
}
