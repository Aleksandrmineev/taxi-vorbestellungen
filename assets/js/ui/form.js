import { Api } from "../api.js";
import {
  todayISO,
  buildTimeOptionsHTML,
  normalizeTimeLoose,
} from "../utils/time.js";

export function initForm({ onCreated }) {
  const f = document.getElementById("f");
  const out = document.getElementById("out");

  // Standardwerte
  f.elements.date.value = todayISO();
  f.elements.type.addEventListener("change", () => {
    const dur = f.elements["duration_min"];
    if (f.elements.type.value === "KT") {
      dur.value = 120;
      dur.step = "1";
    } else {
      dur.value = 15;
      dur.step = "1";
    }
  });
  f.elements.type.dispatchEvent(new Event("change"));

  // Datalist für Zeit + weiche Normalisierung
  const timeInput = document.getElementById("time");
  const datalist = document.getElementById("time5");
  datalist.innerHTML = buildTimeOptionsHTML();
  timeInput.addEventListener("blur", () => {
    timeInput.value = normalizeTimeLoose(timeInput.value);
  });

  // === Automatische Markierung des Inhalts beim Fokus (input/textarea) ===
  document.querySelectorAll("input, textarea").forEach((el) => {
    el.addEventListener("focus", function () {
      setTimeout(() => {
        try {
          if (typeof this.select === "function") this.select();
          else if (this.setSelectionRange)
            this.setSelectionRange(0, (this.value || "").length);
        } catch (_) {}
      }, 0);
    });
    // Klick der Maus entfernt die Auswahl nicht sofort
    el.addEventListener("mouseup", (e) => e.preventDefault());
  });

  // Submit
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    timeInput.value = normalizeTimeLoose(timeInput.value);

    const fd = new FormData(f);
    const data = Object.fromEntries(fd.entries());
    data.phone = (data.phone || "").trim();

    const res = await Api.createOrder(data).catch((err) => ({
      ok: false,
      error: String(err),
    }));
    if (!res.ok) {
      out.innerHTML = `<div class="item">Fehler: ${
        res.error || "Netzwerkfehler"
      }</div>`;
      return;
    }

    const { id, conflicts, gcal_event_id } = res.data;
    const warn =
      conflicts && conflicts.length
        ? `<div class="item">Überschneidungen: ${conflicts.length}. Bitte Kalender prüfen.</div>`
        : "";
    out.innerHTML = `<div class="item"><h4>Bestellung Nr.${id} gespeichert</h4>
      <div class="sub">Ereignis: <code>${gcal_event_id}</code> — <a target="_blank" href="https://calendar.google.com/calendar/u/0/r/eventedit/${gcal_event_id}">Im Kalender öffnen</a></div>${warn}</div>`;

    localStorage.setItem("lastOrder", JSON.stringify(data));
    onCreated?.();
  });

  document.getElementById("repeatLast").addEventListener("click", () => {
    const last = JSON.parse(localStorage.getItem("lastOrder") || "{}");
    for (const [k, v] of Object.entries(last)) {
      if (k === "date" || k === "time") continue;
      if (f.elements[k]) f.elements[k].value = v;
    }
    f.elements.type.dispatchEvent(new Event("change"));
    if (!timeInput.value) timeInput.value = "08:00";
  });

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

// === Local history for phone & address (localStorage) ===
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

// --- PHONE: bind datalist ---
function bindPhoneDatalist(input, datalist) {
  const render = () => {
    const arr = loadList(LS_KEYS.phones);
    datalist.innerHTML = arr
      .map((v) => `<option value="${v}"></option>`)
      .join("");
  };
  render();

  // при фокусе/вводе — обновим список (на случай параллельных изменений)
  input.addEventListener("focus", render);
  input.addEventListener("input", () => {
    // Ничего не делаем тут — datalist фильтрует автоматически
  });
}

// --- ADDRESS: lightweight dropdown under textarea ---
function createSuggestionMenu() {
  const overlay = document.createElement("div");
  overlay.className = "addr-suggest";
  const css = document.createElement("style");
  css.textContent = `
    .addr-suggest {
      position: absolute; z-index: 50; display: none;
      background: var(--cl-surface, #14171f);
      color: var(--cl-text, #e8e8e8);
      border: 1px solid var(--cl-border, rgba(255,255,255,.15));
      border-radius: 10px; box-shadow: 0 10px 24px rgba(0,0,0,.35);
      max-height: 220px; overflow:auto; min-width: 240px;
    }
    .addr-suggest__item {
      padding: 8px 10px; cursor: pointer; line-height: 1.2;
      border-bottom: 1px dashed rgba(255,255,255,.06);
    }
    .addr-suggest__item:last-child { border-bottom: none; }
    .addr-suggest__item:hover, .addr-suggest__item--active {
      background: rgba(255,255,255,.08);
    }
  `;
  document.head.appendChild(css);
  document.body.appendChild(overlay);
  return overlay;
}

function bindAddressSuggest(textarea) {
  const menu = createSuggestionMenu();
  let activeIndex = -1; // для стрелок
  let currentList = [];

  function positionMenu() {
    const r = textarea.getBoundingClientRect();
    menu.style.left = `${window.scrollX + r.left}px`;
    menu.style.top = `${window.scrollY + r.bottom + 6}px`;
    menu.style.minWidth = `${r.width}px`;
  }

  function hide() {
    menu.style.display = "none";
    activeIndex = -1;
  }
  function show() {
    positionMenu();
    menu.style.display = "block";
  }

  function render(filter = "") {
    const all = loadList(LS_KEYS.addresses);
    const f = (filter || "").trim().toLowerCase();
    currentList = f ? all.filter((x) => x.toLowerCase().includes(f)) : all;
    currentList = currentList.slice(0, MAX_ITEMS);

    if (!currentList.length) {
      hide();
      return;
    }

    menu.innerHTML = currentList
      .map(
        (txt, i) =>
          `<div class="addr-suggest__item" data-i="${i}">${txt.replace(
            /</g,
            "&lt;"
          )}</div>`
      )
      .join("");

    // клики
    menu.querySelectorAll(".addr-suggest__item").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault(); // не терять фокус
        const i = Number(el.dataset.i);
        textarea.value = currentList[i];
        hide();
        textarea.focus();
      });
    });

    activeIndex = -1;
    show();
  }

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
      return; // другие клавиши — пусть обрабатываются как обычно
    }

    items.forEach((el) => el.classList.remove("addr-suggest__item--active"));
    if (activeIndex >= 0)
      items[activeIndex].classList.add("addr-suggest__item--active");
  });

  // на ресайз/скролл перепозиционируем
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

// === Инициализация: вызови после того, как форма создана на странице ===
export function initLocalHistory() {
  const form = document.getElementById("f");
  if (!form) return;

  const phone = form.querySelector("#phone");
  const phonesList = document.getElementById("phones");
  const message = form.querySelector("#message");

  if (phone && phonesList) bindPhoneDatalist(phone, phonesList);
  if (message) bindAddressSuggest(message);

  // сохраняем значения при сабмите формы
  form.addEventListener("submit", () => {
    const phoneVal = phone?.value || "";
    if (phoneVal.trim()) {
      upsertValue(LS_KEYS.phones, phoneVal, { normalize: normalizePhone });
    }
    const msgVal = message?.value || "";
    if (msgVal.trim().length >= 4) {
      upsertValue(LS_KEYS.addresses, msgVal);
    }
  });
}

// --- Автоинициализация локальной истории при загрузке формы ---
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("f");
  if (!form) return;

  const phone = form.querySelector("#phone");
  const phonesList = document.getElementById("phones");
  const message = form.querySelector("#message");

  if (phone && phonesList) bindPhoneDatalist(phone, phonesList);
  if (message) bindAddressSuggest(message);

  // сохраняем значения при сабмите формы
  form.addEventListener("submit", () => {
    const phoneVal = phone?.value || "";
    if (phoneVal.trim()) {
      upsertValue(LS_KEYS.phones, phoneVal, { normalize: normalizePhone });
    }
    const msgVal = message?.value || "";
    if (msgVal.trim().length >= 4) {
      upsertValue(LS_KEYS.addresses, msgVal);
    }
  });
});
