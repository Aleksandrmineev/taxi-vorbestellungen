import { Api } from "../api.js";
import {
  deviceId,
  state,
  escapeHtml,
  orderStamp,
  loadIncremental,
  fullRefresh,
  sendMessage,
  addLocalTextMessage,
} from "./chat-core.js";

import {
  ensureUserGestureListeners,
  insertEnableButton,
  isAudioReady,
  playSend,
  playReceive,
  playOrder,
} from "./chat-audio.js";

const chatEl = document.getElementById("chat");
const form = document.getElementById("sendForm");
const input = document.getElementById("msg");
const btnAll = document.getElementById("btn-all");
const btnOnly = document.getElementById("btn-only");
const btnName = document.getElementById("btn-name");
const btnVoice = document.getElementById("btn-voice");

// имя один раз
if (!state.displayName) {
  state.displayName =
    prompt("Dein Name (wird im Chat angezeigt):")?.trim() || "Fahrer";
  localStorage.setItem("displayName", state.displayName);
}

/* ===== Audio boot ===== */
ensureUserGestureListeners();
if (!isAudioReady()) insertEnableButton(".chat-header");

/* ===== Sticky-to-bottom helpers ===== */
let initialRendered = false;
// по умолчанию «держимся» за низ
let shouldStickBottom = true;

function isNearBottom(el, threshold = 120) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}
function scrollToBottom({ smooth = false } = {}) {
  chatEl.scrollTo({
    top: chatEl.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
}
function maybeScrollToBottom({ force = false, smooth = false } = {}) {
  if (force || shouldStickBottom || isNearBottom(chatEl)) {
    scrollToBottom({ smooth });
  }
}

/* ===== Templates ===== */
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

/* ===== Render ===== */
function render(items = state.items) {
  // если пользователь пролистал далеко вверх — не дёргать вниз
  shouldStickBottom = isNearBottom(chatEl);

  let list = dedupOrderCreated(items);
  list = state.filterOrdersOnly ? list.filter((x) => x.is_order) : list;
  if (state.filterOrdersOnly)
    list = list.slice().sort((a, b) => orderStamp(a) - orderStamp(b));

  // рендрим
  chatEl.innerHTML =
    (list.map(bubbleHtml).join("") ||
      "<p class='msg them'>Keine Nachrichten.</p>") +
    "<div id='chat-bottom' aria-hidden='true'></div>";

  // всегда держим внизу, если пользователь был внизу
  maybeScrollToBottom({ smooth: initialRendered });
  initialRendered = true;
}

/* ===== First show + refresh ===== */
render();
await fullRefresh();
render();

/* ===== Send (инпут чистим и звук — сразу, отправка — с задержкой) ===== */
const SEND_DELAY = 250; // мс

// Enter → новая строка; Ctrl/Cmd+Enter → отправка
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const raw = input.value;
  const text = raw.trim();
  if (!text) return;

  // 1) мгновенно чистим инпут и возвращаем фокус
  input.value = "";
  input.focus();

  // 2) сразу звук отправки
  playSend();

  // 3) эвристика: заказ или обычный текст
  let isOrder = false;
  try {
    isOrder =
      /(^|\b)(heute|morgen|übermorgen|uebermorgen|\d{1,2}[\. ](?:jan|januar|feb|februar|mär|maerz|mrz|april|apr|mai|jun[i]?|jul[i]?|aug|se[p|pt]|okt|nov|dez|dezember)|\d{1,2}\.\d{1,2}(?:\.\d{2,4})?|20\d{2}-\d{1,2}-\d{1,2}|um\s+\d{1,2}(:\d{2})?\s*uhr)($|\b)/i.test(
        raw
      );
  } catch {}

  // 4) оптимистический рендер — только для обычного текста
  if (!isOrder) {
    addLocalTextMessage(text);
    render();
  }

  // 5) отправка на GAS — чуть позже, не блокируем
  setTimeout(() => {
    sendMessage(raw).catch(() => {
      // TODO: тост/ретрай
    });
  }, SEND_DELAY);

  // держим низ после отправки
  shouldStickBottom = true;
  maybeScrollToBottom({ force: true, smooth: true });
});

/* ===== Фильтры ===== */
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

/* ===== Смена имени ===== */
btnName.addEventListener("click", () => {
  const next = prompt("Neuer Anzeigename:", state.displayName)?.trim();
  if (!next || next === state.displayName) return;
  state.displayName = next;
  localStorage.setItem("displayName", state.displayName);
  render();
});

/* ===== Голосовой ввод: нажми-и-держи (с анти-дублирующей склейкой) ===== */
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recog = null;
let isListening = false;
let listenTimeoutId = null;
// буферы
let baseTextAtStart = "";
let finalBuffer = "";
let interimBuffer = "";

function ensureRecognition() {
  if (!SpeechRecognition) return null;
  if (recog) return recog;
  const r = new SpeechRecognition();
  r.lang = "de-DE";
  r.interimResults = true;
  r.continuous = true;
  r.maxAlternatives = 1;

  r.onresult = (e) => {
    let finals = [];
    let interim = "";
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      const txt = (res[0]?.transcript || "").trim();
      if (!txt) continue;
      if (res.isFinal) finals.push(txt);
      else interim = txt;
    }
    finalBuffer = sanitizeText(finals.join(" "));
    interimBuffer = sanitizeText(interim);
    const visible = smartMerge(baseTextAtStart, finalBuffer, interimBuffer);
    setTextareaValue(visible);
    // при наборе голосом держим низ
    shouldStickBottom = true;
    maybeScrollToBottom({ smooth: true });
  };

  r.onerror = () => stopListening();
  r.onend = () => stopListening();
  recog = r;
  return r;
}

function startListening() {
  if (isListening) return;
  const r = ensureRecognition();
  if (!r) {
    if (!btnVoice.hasAttribute("data-novoice")) {
      alert("Spracherkennung wird von diesem Browser nicht unterstützt.");
      btnVoice.setAttribute("data-novoice", "1");
      btnVoice.disabled = true;
    }
    return;
  }
  try {
    baseTextAtStart = (input.value || "").trim();
    finalBuffer = "";
    interimBuffer = "";
    r.start();
    isListening = true;
    btnVoice.classList.add("listening");
    btnVoice.setAttribute("aria-pressed", "true");
    clearTimeout(listenTimeoutId);
    listenTimeoutId = setTimeout(() => stopListening(), 60000);
  } catch {}
}

function stopListening() {
  if (!isListening) return;
  try {
    recog && recog.stop();
  } catch {}
  isListening = false;
  btnVoice.classList.remove("listening");
  btnVoice.setAttribute("aria-pressed", "false");
  clearTimeout(listenTimeoutId);
  listenTimeoutId = null;
  const committed = smartMerge(baseTextAtStart, finalBuffer, "");
  setTextareaValue(committed);
  input.focus();
}

function smartMerge(base = "", add = "", tail = "") {
  const a = base.trim(),
    b = add.trim(),
    c = tail.trim();
  let merged = a;
  if (b) merged = mergeWithOverlap(merged, b);
  if (c) merged = mergeWithOverlap(merged, c);
  return postClean(merged);
}
function mergeWithOverlap(left, right) {
  if (!left) return right;
  if (!right) return left;
  const L = left.trim(),
    R = right.trim();
  const lW = L.split(/\s+/),
    rW = R.split(/\s+/);
  const maxK = Math.min(6, lW.length, rW.length);
  let best = 0;
  for (let k = maxK; k > 0; k--) {
    const tail = lW.slice(-k).join(" ").toLowerCase();
    const head = rW.slice(0, k).join(" ").toLowerCase();
    if (tail === head) {
      best = k;
      break;
    }
  }
  const glued = best ? L + " " + rW.slice(best).join(" ") : L + " " + R;
  return glued.replace(/\s+/g, " ").trim();
}
function sanitizeText(s = "") {
  let t = s;
  t = t.replace(/\b([\p{L}\p{N}][\p{L}\p{N}'’-]*)(?:\s+\1\b)+/giu, "$1");
  t = t.replace(/\s*([,.!?;:])\s*/g, "$1 ");
  t = t.replace(/\s+/g, " ");
  t = t.replace(/(\d)(uhr)\b/gi, "$1 Uhr");
  t = t.replace(/(^|\.\s+)([a-zäöüß])/g, (m, p1, p2) => p1 + p2.toUpperCase());
  return t.trim();
}
function postClean(s = "") {
  let t = s;
  t = t.replace(/\b([\p{L}\p{N}][\p{L}\p{N}'’-]*)(?:\s+\1\b)+/giu, "$1");
  t = t.replace(/([,.!?;:])\1+/g, "$1");
  t = t.replace(/\s*([,.!?;:])\s*/g, "$1 ");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}
function autosizeTextarea(el) {
  const maxRows = Number(el.dataset.maxRows || 5);
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
  const lh = parseFloat(getComputedStyle(el).lineHeight || "20");
  const maxH = lh * maxRows;
  if (el.scrollHeight > maxH) el.style.height = maxH + "px";
}
function setTextareaValue(v) {
  input.value = v;
  autosizeTextarea(input);
}

// «нажал-держи»
if (btnVoice) {
  const down = (e) => {
    e.preventDefault();
    startListening();
  };
  const up = (e) => {
    e.preventDefault();
    stopListening();
  };
  btnVoice.addEventListener("pointerdown", down);
  btnVoice.addEventListener("pointerup", up);
  btnVoice.addEventListener("pointerleave", up);
  btnVoice.addEventListener("pointercancel", up);
  btnVoice.addEventListener("click", (e) => e.preventDefault(), {
    passive: false,
  });
}

/* ===== Поллинг + звуки входящих (и автоскролл вниз) ===== */
let didInitialPoll = false;

setInterval(async () => {
  const newItems = await loadIncremental(); // новые с сервера
  if (Array.isArray(newItems) && newItems.length) {
    if (didInitialPoll) {
      const incoming = newItems.filter((m) => {
        const mine =
          (m.device && m.device === deviceId) ||
          (!m.device && (m.author || "") === state.displayName);
        return !mine;
      });
      if (incoming.length) {
        const hasOrder = incoming.some(
          (m) => m.type === "order_created" || m.is_order === true
        );
        hasOrder ? playOrder() : playReceive();
        // прилипание к низу при входящих
        shouldStickBottom = true;
      }
    }
  }
  render();
  didInitialPoll = true;
}, 3000);

/* ===== Клавиатура на мобилке: держать форму в зоне видимости ===== */
function onViewportChange() {
  // если фокус в textarea — тянем низ и форму в видимую область
  if (document.activeElement === input) {
    // сначала сам чат к низу
    maybeScrollToBottom({ force: true, smooth: false });
    // затем гарантируем видимость формы
    form.scrollIntoView({
      block: "end",
      inline: "nearest",
      behavior: "smooth",
    });
  }
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", onViewportChange);
  window.visualViewport.addEventListener("scroll", onViewportChange);
}
window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    maybeScrollToBottom({ force: true, smooth: false });
  }, 150);
});

// когда пользователь кликает по полю — тоже дотягиваем вниз
input.addEventListener("focus", () => {
  shouldStickBottom = true;
  // две попытки – сразу и в следующий кадр (для iOS)
  maybeScrollToBottom({ force: true, smooth: false });
  requestAnimationFrame(() =>
    maybeScrollToBottom({ force: true, smooth: false })
  );
});
