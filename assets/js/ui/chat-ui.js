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

/* ===== Audio ===== */
let AC = null;
let didInitAudio = false;
function ensureAudio() {
  if (!AC) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    AC = new Ctor();
  }
  if (AC.state === "suspended") AC.resume().catch(() => {});
  return AC;
}
function envTone({
  freq = 600,
  type = "sine",
  dur = 0.12,
  attack = 0.005,
  decay = 0.08,
  gain = 0.08,
  when = 0,
}) {
  const ac = ensureAudio();
  if (!ac) return;
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + Math.max(attack + decay, dur));
}
function playSend() {
  envTone({
    freq: 520,
    type: "triangle",
    gain: 0.07,
    attack: 0.005,
    decay: 0.07,
    dur: 0.1,
    when: 0,
  });
  envTone({
    freq: 740,
    type: "triangle",
    gain: 0.06,
    attack: 0.005,
    decay: 0.08,
    dur: 0.12,
    when: 0.06,
  });
}
function playReceive() {
  envTone({
    freq: 540,
    type: "sine",
    gain: 0.07,
    attack: 0.003,
    decay: 0.09,
    dur: 0.1,
    when: 0,
  });
}
function playOrder() {
  envTone({
    freq: 420,
    type: "sine",
    gain: 0.08,
    attack: 0.004,
    decay: 0.12,
    dur: 0.14,
    when: 0,
  });
  envTone({
    freq: 880,
    type: "sine",
    gain: 0.07,
    attack: 0.004,
    decay: 0.14,
    dur: 0.16,
    when: 0.1,
  });
}
["click", "keydown", "touchstart"].forEach((ev) =>
  document.addEventListener(
    ev,
    () => {
      ensureAudio();
      didInitAudio = true;
    },
    { once: true, passive: true }
  )
);

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
  let list = dedupOrderCreated(items);
  list = state.filterOrdersOnly ? list.filter((x) => x.is_order) : list;
  if (state.filterOrdersOnly)
    list = list.slice().sort((a, b) => orderStamp(a) - orderStamp(b));
  chatEl.innerHTML =
    list.map(bubbleHtml).join("") ||
    "<p class='msg them'>Keine Nachrichten.</p>";
  chatEl.scrollTop = chatEl.scrollHeight;
}

// показать кэш сразу, потом свежие
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
  if (didInitAudio) playSend();

  // 3) лёгкая эвристика: заказ или обычный текст
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

  // 5) отправка на GAS с мягкой задержкой, без await
  setTimeout(() => {
    sendMessage(raw).catch(() => {
      // опционально: отметить ошибку/ретрай
    });
  }, SEND_DELAY);
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

/* ===== Голосовой ввод: нажми-и-держи (улучшенное склеивание без дублей) ===== */
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recog = null;
let isListening = false;
let listenTimeoutId = null;

// буферы для качественной склейки
let baseTextAtStart = "";
let finalBuffer = ""; // только финальные фразы
let interimBuffer = ""; // самый свежий промежуточный фрагмент

function ensureRecognition() {
  if (!SpeechRecognition) return null;
  if (recog) return recog;
  const r = new SpeechRecognition();

  // — Ключевые настройки:
  r.lang = "de-DE";
  r.interimResults = true; // даёт «живой» текст
  r.continuous = true; // чтобы поток не обрывался преждевременно

  r.maxAlternatives = 1;

  r.onresult = (e) => {
    // собираем все результаты заново каждый раз: это защищает от дублей
    let finals = [];
    let interim = "";

    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      const txt = (res[0]?.transcript || "").trim();
      if (!txt) continue;
      if (res.isFinal) finals.push(txt);
      else interim = txt; // оставляем только последний промежуточный
    }

    finalBuffer = sanitizeText(finals.join(" "));
    interimBuffer = sanitizeText(interim);

    // показываем пользователю: base + finals + interim (без дублей на стыках)
    const visible = smartMerge(baseTextAtStart, finalBuffer, interimBuffer);
    setTextareaValue(visible);
  };

  r.onerror = () => stopListening();
  r.onend = () => stopListening();

  recog = r;
  return recog;
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
    listenTimeoutId = setTimeout(() => stopListening(), 60000); // авто-стоп 60с
  } catch {
    // повторный start может бросить — игнор
  }
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

  // Коммитим только base + final (без interim), ещё раз прогоняем санитайзер
  const committed = smartMerge(baseTextAtStart, finalBuffer, "");
  setTextareaValue(committed);
  input.focus();
}

/* ===== Помощники текста ===== */

// аккуратно объединяет base + add + tail с устранением дублей на стыках
function smartMerge(base = "", add = "", tail = "") {
  const a = base.trim();
  const b = add.trim();
  const c = tail.trim();

  let merged = a;
  if (b) merged = mergeWithOverlap(merged, b);
  if (c) merged = mergeWithOverlap(merged, c);

  // финальная зачистка
  return postClean(merged);
}

// объединение строк с учётом перекрытия последних/первых слов
function mergeWithOverlap(left, right) {
  if (!left) return right;
  if (!right) return left;

  const L = left.trim();
  const R = right.trim();

  const lWords = L.split(/\s+/);
  const rWords = R.split(/\s+/);
  const maxOverlap = Math.min(6, lWords.length, rWords.length);

  let best = 0;
  for (let k = maxOverlap; k > 0; k--) {
    const tail = lWords.slice(-k).join(" ").toLowerCase();
    const head = rWords.slice(0, k).join(" ").toLowerCase();
    if (tail === head) {
      best = k;
      break;
    }
  }
  const glued = best > 0 ? L + " " + rWords.slice(best).join(" ") : L + " " + R;

  return glued.replace(/\s+/g, " ").trim();
}

// базовая нормализация фраз: капс, пробелы, простая пунктуация
function sanitizeText(s = "") {
  let t = s;

  // Убираем повторы подряд ("jetzt jetzt", "der der") — регистронезависимо
  t = t.replace(/\b([\p{L}\p{N}][\p{L}\p{N}'’-]*)(?:\s+\1\b)+/giu, "$1");

  // Нормализуем пробелы вокруг пунктуации
  t = t.replace(/\s*([,.!?;:])\s*/g, "$1 ");
  t = t.replace(/\s+/g, " ");

  // Пробел после "um 12:30Uhr" -> "um 12:30 Uhr"
  t = t.replace(/(\d)(uhr)\b/gi, "$1 Uhr");

  // Лёгкая капитализация начала предложения
  t = t.replace(/(^|\.\s+)([a-zäöüß])/g, (m, p1, p2) => p1 + p2.toUpperCase());

  return t.trim();
}

// финальная зачистка всей строки
function postClean(s = "") {
  let t = s;

  // Повторы слов после склейки
  t = t.replace(/\b([\p{L}\p{N}][\p{L}\p{N}'’-]*)(?:\s+\1\b)+/giu, "$1");

  // Повторы знаков препинания
  t = t.replace(/([,.!?;:])\1+/g, "$1");

  // Пробелы
  t = t.replace(/\s*([,.!?;:])\s*/g, "$1 ");
  t = t.replace(/\s+/g, " ");

  return t.trim();
}

// авто-увеличение высоты textarea
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

// Навешиваем события «нажал-держи»
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

  // На некоторых моб. браузерах click может мешать — гасим
  btnVoice.addEventListener("click", (e) => e.preventDefault(), {
    passive: false,
  });
}

/* ===== Поллинг + звуки входящих ===== */
let didInitialPoll = false;

setInterval(async () => {
  const newItems = await loadIncremental(); // возвращает новые
  if (didInitialPoll && Array.isArray(newItems) && newItems.length) {
    const incoming = newItems.filter(
      (m) =>
        (m.device && m.device !== deviceId) ||
        (!m.device && (m.author || "") !== state.displayName)
    );
    const hasOrder = incoming.some(
      (m) => m.type === "order_created" || m.is_order === true
    );
    if (didInitAudio) {
      if (hasOrder) playOrder();
      else if (incoming.length) playReceive();
    }
  }
  render();
  didInitialPoll = true;
}, 3000);

// при возвращении во вкладку — мягкая сверка
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden) {
    await fullRefresh();
    render();
  }
});
