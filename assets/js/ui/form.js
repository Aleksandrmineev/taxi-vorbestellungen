// ui/form.js
// === Управление формой создания заказа (дефолты, нормализация, лок.история, отправка, toasts)

import { Api } from "../api.js";
import {
  todayISO,
  buildTimeOptionsHTML,
  normalizeTimeLoose,
} from "../utils/time.js";

/* ------------------------- Toasts (UI) ------------------------- */
/** Рисует toast в #out. type: 'ok' | 'warn' | 'error'
 *  opts: { title, message, timeout=2600, type='ok', sound=true, linkHTML? }
/* ------------------------- Toasts (UI) ------------------------- */
export function showToast({
  title = "",
  message = "",
  type = "ok", // ok | warn | error
  timeout = 5800,
  sound = true,
  linkHTML = "",
} = {}) {
  const host = document.getElementById("out");
  if (!host) return;

  const ICONS = {
    ok: `<svg class="toast__icon" viewBox="0 0 24 24" aria-hidden="true">
           <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
         </svg>`,
    warn: `<svg class="toast__icon" viewBox="0 0 24 24" aria-hidden="true">
           <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                 fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
         </svg>`,
    error: `<svg class="toast__icon" viewBox="0 0 24 24" aria-hidden="true">
           <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
         </svg>`,
  };

  const toast = document.createElement("div");
  toast.className = `toast toast--${type} is-in`;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.innerHTML = `
    ${ICONS[type] || ICONS.ok}
    <div class="toast__body">
      ${title ? `<div class="toast__title">${title}</div>` : ""}
      ${message ? `<div class="toast__msg">${message}</div>` : ""}
      ${linkHTML || ""}
    </div>
    <button class="toast__close" type="button" aria-label="Schließen">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>
  `;

  const close = () => {
    if (toast._closing) return;
    toast._closing = true;
    toast.classList.remove("is-in");
    toast.classList.add("is-out");
    setTimeout(() => toast.remove(), 280);
  };

  toast.querySelector(".toast__close")?.addEventListener("click", close);
  toast.addEventListener("click", close);

  const t = setTimeout(close, Math.max(1400, timeout));
  toast._timer = t;

  host.appendChild(toast);

  if (sound) playNotifySound(type);
}

/* ----------------------- Notify sound -------------------------- */
/* Двухтоновый короткий сигнал (≈ Google/календарь vibe) */
function playNotifySound(kind = "ok") {
  if (!("AudioContext" in window)) return;
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Параметры
    const seq =
      kind === "error"
        ? [
            /* ниже и резче */ { f: 660, t: 0.0, d: 0.14 },
            { f: 520, t: 0.12, d: 0.18 },
          ]
        : [
            /* светлый «ди-динг» */ { f: 880, t: 0.0, d: 0.12 },
            { f: 1320, t: 0.1, d: 0.16 },
          ];

    seq.forEach(({ f, t, d }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // чуть «колокольности»
      osc.type = "triangle";
      osc.frequency.value = f;

      // ADSR-подобная огибающая
      const g = gain.gain;
      g.setValueAtTime(0.0001, now + t);
      g.exponentialRampToValueAtTime(0.12, now + t + 0.02);
      g.exponentialRampToValueAtTime(0.0001, now + t + d);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + d + 0.02);
      osc.onended = () => {
        try {
          gain.disconnect();
        } catch {}
      };
    });

    // Автоматическое закрытие контекста
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {}
}

/* ---------------------- Кнопка загрузки (UI) --------------------- */
function makeSubmitLoading(btn, on) {
  if (!btn) return;
  if (on) {
    btn.disabled = true;
    btn.classList.add("is-loading");
    btn._prevHTML = btn._prevHTML || btn.innerHTML;
    btn.innerHTML = `
      <svg class="spin" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity=".25"/>
        <path d="M21 12a9 9 0 0 1-9 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="sr-only">Speichern…</span>
    `;
  } else {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    if (btn._prevHTML) btn.innerHTML = btn._prevHTML;
  }
}

/* ----------------------- Основная форма -------------------------- */
export function initForm({ onCreated }) {
  const f = document.getElementById("f");
  const out = document.getElementById("out");
  if (!f) return { fillForm: () => {} };

  const timeInput = f.querySelector("#time");
  const datalist = document.getElementById("time5");
  const submitBtn = f.querySelector(".icon-btn--primary");

  // 1) Дефолты
  f.elements.type.addEventListener("change", () => {
    const dur = f.elements["duration_min"];
    const type = f.elements.type.value;

    if (type === "KT") {
      dur.value = 120;
      dur.step = "1";
    } else if (type === "RE") {
      dur.value = 120;
      dur.step = "1";
    } else {
      dur.value = 15;
      dur.step = "1";
    }
  });

  f.elements.type.dispatchEvent(new Event("change"));

  // 2) Время + нормализация
  datalist.innerHTML = buildTimeOptionsHTML();
  timeInput.addEventListener("blur", () => {
    timeInput.value = normalizeTimeLoose(timeInput.value);
  });

  // 3) Удобства ввода
  document.querySelectorAll("input, textarea").forEach((el) => {
    el.addEventListener("focus", function () {
      setTimeout(() => {
        try {
          if (this.select) this.select();
          else if (this.setSelectionRange)
            this.setSelectionRange(0, (this.value || "").length);
        } catch {}
      }, 0);
    });
    el.addEventListener("mouseup", (e) => e.preventDefault());
  });

  // 4) Submit
  f.addEventListener("submit", async (e) => {
    e.preventDefault();

    // мгновенный отклик
    makeSubmitLoading(submitBtn, true);

    try {
      timeInput.value = normalizeTimeLoose(timeInput.value);
      const fd = new FormData(f);
      const data = Object.fromEntries(fd.entries());
      data.phone = (data.phone || "").trim();

      const res = await Api.createOrder(data).catch((err) => ({
        ok: false,
        error: String(err),
      }));
      if (!res.ok) {
        showToast({
          title: "Fehler",
          message: res.error || "Netzwerkfehler",
          type: "error",
        });
        return;
      }

      const payload = res.data || res;
      const { id, conflicts, gcal_event_id } = payload || {};

      let linkHTML = "";
      if (gcal_event_id) {
        linkHTML = `<div class="toast__msg">
          <a target="_blank" href="https://calendar.google.com/calendar/u/0/r/eventedit/${gcal_event_id}">Im Kalender öffnen</a>
        </div>`;
      }
      const hasConf = conflicts && conflicts.length;
      const msg = hasConf
        ? `Überschneidungen: ${conflicts.length}. Bitte Kalender prüfen.`
        : "Gespeichert.";

      showToast({
        title: `Bestellung Nr.${id}`,
        message: hasConf
          ? `Überschneidungen: ${conflicts.length}. Bitte Kalender prüfen.`
          : "Gespeichert.",
        type: hasConf ? "warn" : "ok",
        linkHTML: gcal_event_id
          ? `<div class="toast__msg"><a target="_blank" href="https://calendar.google.com/calendar/u/0/r/eventedit/${gcal_event_id}">Im Kalender öffnen</a></div>`
          : "",
      });

      localStorage.setItem("lastOrder", JSON.stringify(data));
      onCreated?.();
    } finally {
      makeSubmitLoading(submitBtn, false);
    }
  });

  // 5) Повтор последнего
  document.getElementById("repeatLast")?.addEventListener("click", () => {
    const last = JSON.parse(localStorage.getItem("lastOrder") || "{}");
    for (const [k, v] of Object.entries(last)) {
      if (k === "date" || k === "time") continue;
      if (f.elements[k]) f.elements[k].value = v;
    }
    f.elements.type.dispatchEvent(new Event("change"));
    if (!timeInput.value) timeInput.value = "08:00";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Публичная функция
  function fillForm({ date, time, type, duration_min, phone, message }) {
    if (date) f.elements.date.value = date;
    if (time) timeInput.value = normalizeTimeLoose(time);
    if (type) f.elements.type.value = type;
    if (duration_min) f.elements.duration_min.value = duration_min;
    if (phone !== undefined) f.elements.phone.value = phone || "";
    if (message !== undefined) f.elements.message.value = message || "";
    f.elements.type.dispatchEvent(new Event("change"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return { fillForm };
}

/* ----------------- Локальная история (тел./адрес) ----------------- */
const LS_KEYS = {
  phones: "mt_recent_phones",
  addresses: "mt_recent_addresses",
};
const MAX_ITEMS = 8;

function loadList(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}
function saveList(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr.slice(0, MAX_ITEMS)));
}
function upsertValue(key, value, { normalize } = {}) {
  let v = (value || "").trim();
  if (!v) return;
  if (normalize) v = normalize(v);
  const list = loadList(key).filter((x) => x && x !== v);
  list.unshift(v);
  saveList(key, list);
}
function normalizePhone(v) {
  let s = v.replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("0")) return "+43" + s.slice(1);
  if (s.startsWith("43")) return "+" + s;
  const d = s.replace(/[^\d]/g, "");
  return d ? "+" + d : "";
}

function bindPhoneDatalist(input, datalist) {
  const render = () => {
    const arr = loadList(LS_KEYS.phones);
    datalist.innerHTML = arr
      .map((v) => `<option value="${v}"></option>`)
      .join("");
  };
  render();
  input.addEventListener("focus", render);
}

function createSuggestionMenu() {
  const overlay = document.createElement("div");
  overlay.className = "addr-suggest";
  const css = document.createElement("style");
  css.textContent = `
    .addr-suggest{ position:absolute; z-index:50; display:none; background:var(--cl-surface,#14171f);
      color:var(--cl-text,#e8e8e8); border:1px solid var(--cl-border,rgba(255,255,255,.15));
      border-radius:10px; box-shadow:0 10px 24px rgba(0,0,0,.35); max-height:220px; overflow:auto; min-width:240px; }
    .addr-suggest__item{ padding:8px 10px; cursor:pointer; line-height:1.2; border-bottom:1px dashed rgba(255,255,255,.06); }
    .addr-suggest__item:last-child{ border-bottom:none; }
    .addr-suggest__item:hover,.addr-suggest__item--active{ background:rgba(255,255,255,.08); }
  `;
  document.head.appendChild(css);
  document.body.appendChild(overlay);
  return overlay;
}

function bindAddressSuggest(textarea) {
  const menu = createSuggestionMenu();
  let activeIndex = -1;
  let currentList = [];
  const positionMenu = () => {
    const r = textarea.getBoundingClientRect();
    menu.style.left = `${window.scrollX + r.left}px`;
    menu.style.top = `${window.scrollY + r.bottom + 6}px`;
    menu.style.minWidth = `${r.width}px`;
  };
  const hide = () => {
    menu.style.display = "none";
    activeIndex = -1;
  };
  const show = () => {
    positionMenu();
    menu.style.display = "block";
  };
  const render = (filter = "") => {
    const all = loadList(LS_KEYS.addresses);
    const f = (filter || "").trim().toLowerCase();
    currentList = (
      f ? all.filter((x) => x.toLowerCase().includes(f)) : all
    ).slice(0, MAX_ITEMS);
    if (!currentList.length) return hide();
    menu.innerHTML = currentList
      .map(
        (txt, i) =>
          `<div class="addr-suggest__item" data-i="${i}">${txt.replace(
            /</g,
            "&lt;"
          )}</div>`
      )
      .join("");
    menu.querySelectorAll(".addr-suggest__item").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const i = Number(el.dataset.i);
        textarea.value = currentList[i];
        hide();
        textarea.focus();
      });
    });
    activeIndex = -1;
    show();
  };
  textarea.addEventListener("focus", () => render(textarea.value));
  textarea.addEventListener("input", () => render(textarea.value));
  textarea.addEventListener("blur", () => setTimeout(hide, 120));
  textarea.addEventListener("keydown", (e) => {
    if (menu.style.display !== "block") return;
    const items = [...menu.querySelectorAll(".addr-suggest__item")];
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
    } else if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        textarea.value = currentList[activeIndex];
        hide();
      }
    } else if (e.key === "Escape") {
      hide();
      return;
    } else {
      return;
    }
    items.forEach((el) => el.classList.remove("addr-suggest__item--active"));
    if (activeIndex >= 0)
      items[activeIndex].classList.add("addr-suggest__item--active");
  });
  window.addEventListener("resize", () => {
    if (menu.style.display === "block") positionMenu();
  });
  window.addEventListener(
    "scroll",
    () => {
      if (menu.style.display === "block") positionMenu();
    },
    true
  );
}

/* -------- Автоинициализация локальной истории ---------- */
export function initLocalHistory() {
  const form = document.getElementById("f");
  if (!form) return;
  const phone = form.querySelector("#phone");
  const phonesList = document.getElementById("phones");
  const message = form.querySelector("#message");
  if (phone && phonesList) bindPhoneDatalist(phone, phonesList);
  if (message) bindAddressSuggest(message);
  form.addEventListener("submit", () => {
    const phoneVal = phone?.value || "";
    if (phoneVal.trim())
      upsertValue(LS_KEYS.phones, phoneVal, { normalize: normalizePhone });
    const msgVal = message?.value || "";
    if (msgVal.trim().length >= 4) upsertValue(LS_KEYS.addresses, msgVal);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initLocalHistory();
});
