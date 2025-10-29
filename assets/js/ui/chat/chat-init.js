// Имя, аудио, отправка, пуш, голос — точка входа initView()
import { state, sendMessage, addLocalTextMessage } from "../chat-core.js";
import {
  ensureUserGestureListeners,
  insertEnableButton,
  isAudioReady,
  playSend,
} from "../chat-audio.js";
import { render } from "./chat-render.js";
import {
  isNearBottom,
  setStickBottom,
  attachViewportGuards,
} from "./chat-scroll.js";

const form = document.getElementById("sendForm");
const input = document.getElementById("msg");
const btnName = document.getElementById("btn-name");
const btnVoice = document.getElementById("btn-voice");

/* === Имя === */
function ensureDisplayName() {
  if (!state.displayName) {
    state.displayName =
      prompt("Dein Name (wird im Chat angezeigt):")?.trim() || "Fahrer";
    localStorage.setItem("displayName", state.displayName);
  }
}

/* === Аудио === */
function bootAudio() {
  ensureUserGestureListeners();
  if (!isAudioReady()) insertEnableButton(".chat-header");
}

/* === Autosize === */
function autosizeTextarea(el) {
  if (!el) return;
  const maxRows = Number(el.dataset.maxRows || 5);
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
  const lh = parseFloat(getComputedStyle(el).lineHeight || "20");
  const maxH = lh * maxRows;
  if (el.scrollHeight > maxH) el.style.height = maxH + "px";
}

/* === Отправка === */
const SEND_DELAY = 250;

function attachSendHandlers() {
  if (!input || !form) return;

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

    const wasNear = isNearBottom();

    input.value = "";
    input.focus();
    autosizeTextarea(input);
    playSend();

    // Локальная оптимистичная вставка для обычных текстов
    const looksLikeOrder =
      /(\b(heute|morgen|übermorgen|uebermorgen)\b|\d{1,2}\.\d{1,2}|\bum\s+\d{1,2}(:\d{2})?\s*uhr)/i.test(
        raw
      );
    if (!looksLikeOrder) {
      addLocalTextMessage(text);
      render();
    }

    setTimeout(() => {
      sendMessage(raw).catch(() => {});
    }, SEND_DELAY);

    if (wasNear) setStickBottom(true);
  });
}

/* === Имя (кнопка) === */
function attachNameHandler() {
  btnName?.addEventListener("click", () => {
    const next = prompt("Neuer Anzeigename:", state.displayName)?.trim();
    if (!next || next === state.displayName) return;
    state.displayName = next;
    localStorage.setItem("displayName", state.displayName);
    render();
  });
}

/* === Голосовой ввод (полная версия) === */
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recog = null,
  isListening = false,
  listenTimeoutId = null;
let baseTextAtStart = "",
  finalBuffer = "",
  interimBuffer = "";

function ensureRecognition() {
  if (!SpeechRecognition) return null;
  if (recog) return recog;

  const r = new SpeechRecognition();
  r.lang = "de-DE";
  r.interimResults = true;
  r.continuous = true;
  r.maxAlternatives = 1;

  r.onresult = (e) => {
    let finals = [],
      interim = "";
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
    if (input) {
      input.value = visible;
      autosizeTextarea(input);
    }
    if (isNearBottom()) setStickBottom(true);
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
    alert("Spracherkennung wird von diesem Browser nicht unterstützt.");
    return;
  }
  try {
    baseTextAtStart = (input?.value || "").trim();
    finalBuffer = "";
    interimBuffer = "";
    r.start();
    isListening = true;
    btnVoice?.classList.add("listening");
    btnVoice?.setAttribute("aria-pressed", "true");
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
  btnVoice?.classList.remove("listening");
  btnVoice?.setAttribute("aria-pressed", "false");
  clearTimeout(listenTimeoutId);
  listenTimeoutId = null;

  const committed = smartMerge(baseTextAtStart, finalBuffer, "");
  if (input) {
    input.value = committed;
    autosizeTextarea(input);
    input.focus();
  }
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
function smartMerge(base = "", add = "", tail = "") {
  let merged = base.trim();
  if (add) merged = mergeWithOverlap(merged, add.trim());
  if (tail) merged = mergeWithOverlap(merged, tail.trim());
  return merged.replace(/\s+/g, " ").trim();
}

function attachVoiceHandlers() {
  if (!btnVoice) return;
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

/* === Публичный init === */
export function initView() {
  ensureDisplayName();
  bootAudio();
  attachSendHandlers();
  attachNameHandler();
  attachVoiceHandlers();
  attachViewportGuards();
  render();
}
