const listEl = document.getElementById("list");
const q = document.getElementById("q");
const hint = document.getElementById("hint");
const clearBtn = document.getElementById("clear");
const toast = document.getElementById("toast");
const recentEl = document.getElementById("recent");
const dlg = document.getElementById("dlg");
const newPhone = document.getElementById("newPhone");
const newAddr = document.getElementById("newAddr");

let data = [];
let lastTap = 0;

const normalizeDigits = (s) => (s || "").replace(/\D+/g, "");
const ls = {
  get(key, def) {
    try {
      return JSON.parse(localStorage.getItem(key)) || def;
    } catch {
      return def;
    }
  },
  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },
};
/* === Список водителей: отредактируй номера/имена под себя === */
const drivers = JSON.parse(localStorage.getItem("driversList") || "null") || [
  { name: "Aleks", phone: "+4368181289405" },
  { name: "Berti", phone: "+4367763113438" },
  { name: "Gabi", phone: "+436506367662" },
  { name: "Günter", phone: "+436641660694" },
  { name: "Michael", phone: "+436503781007" },
  { name: "Sascha", phone: "+436765654250" },
];

/* Сохранить кастомный список (если потом захочешь редактировать из кода) */
function saveDriversList(list) {
  localStorage.setItem("driversList", JSON.stringify(list));
}

/* ===== Активные на смене (по дням) ===== */

/* Устойчивый ID водителя по номеру (только цифры) */
const driverId = (d) => (d.phone || "").replace(/\D+/g, "");

/* Сегодняшний ключ yyyy-mm-dd по локальному времени (Вена/Австрия) */
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* Хранилище: { "2025-10-11": ["43664...","43665..."], ... } */
const ACTIVE_STORE_KEY = "activeDriversByDate";

function loadActiveMap() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_STORE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveActiveMap(map) {
  localStorage.setItem(ACTIVE_STORE_KEY, JSON.stringify(map));
}

function getTodayActiveIds() {
  const map = loadActiveMap();
  return new Set(map[todayKey()] || []);
}
function setTodayActiveIds(idArray) {
  const map = loadActiveMap();
  map[todayKey()] = Array.from(new Set(idArray));
  saveActiveMap(map);
}

function isDriverActiveToday(d) {
  const ids = getTodayActiveIds();
  return ids.has(driverId(d));
}

/* Если на сегодня ничего не отмечено — умолчание: ВСЕ активны (можно поменять на пусто) */
function ensureTodayDefaults() {
  const map = loadActiveMap();
  const key = todayKey();
  if (!map[key]) {
    map[key] = drivers.map((d) => driverId(d)); // по умолчанию все
    saveActiveMap(map);
  }
}

/* UI: диалог выбора активных */
function showShiftDialog() {
  const activeSet = getTodayActiveIds();
  const wrap = document.createElement("div");
  wrap.className = "shift-popup";
  wrap.innerHTML = `
<div class="shift-popup__inner">
<p class="shift-title">Aktive Fahrer — ${todayKey()}</p>
<div class="shift-list">
  ${drivers
    .map((d) => {
      const id = driverId(d);
      const checked = activeSet.has(id) ? "checked" : "";
      return `
      <label class="shift-row">
        <input type="checkbox" value="${id}" ${checked}>
        <span>${d.name} — ${d.phone}</span>
      </label>
    `;
    })
    .join("")}
</div>
<div class="shift-actions">
  <button class="shift-btn" data-act="none">Keiner</button>
  <button class="shift-btn" data-act="all">Alle</button>
  <button class="shift-btn shift-btn--save" data-act="save">Speichern</button>
  <button class="shift-btn" data-act="close">Schließen</button>
</div>
</div>
`;
  document.body.appendChild(wrap);

  const inner = wrap.querySelector(".shift-popup__inner");
  const checkboxes = Array.from(
    inner.querySelectorAll('input[type="checkbox"]')
  );

  inner.addEventListener("click", (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;

    if (act === "all") {
      checkboxes.forEach((cb) => (cb.checked = true));
    } else if (act === "none") {
      checkboxes.forEach((cb) => (cb.checked = false));
    } else if (act === "save") {
      const ids = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
      setTodayActiveIds(ids);
      wrap.remove();
    } else if (act === "close") {
      wrap.remove();
    }
  });

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.remove();
  });
}

/* Кнопка "Смена" */
document.getElementById("btnShift").addEventListener("click", showShiftDialog);

/* При загрузке — обеспечить умолчание на сегодня */
ensureTodayDefaults();

/* Открыть WA на конкретный номер с готовым текстом */
function sendToDriverPhone(phoneDigits, text) {
  const link = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`;

  const ua = navigator.userAgent || "";
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const isIOS =
    /iP(hone|ad|od)/.test(ua) ||
    (ua.includes("Mac") && "ontouchend" in document);

  // 📱 Мобильные: просто переход по ссылке — WhatsApp перехватывает и открывает приложение
  if (isMobile || isIOS) {
    window.location.href = link;
    return;
  }

  // 💻 Десктоп: открываем временный popup и закрываем его автоматически
  const w = window.open("about:blank", "_blank");

  if (w) {
    try {
      w.location.replace(link);
    } catch (e) {
      try {
        w.location.href = link;
      } catch (err) {
        console.warn("Der Link konnte nicht geöffnet werden:", err);
      }
    }

    // Закрываем popup через 3 секунды
    setTimeout(() => {
      try {
        w.close();
      } catch (e) {}
    }, 3000);
  } else {
    // fallback: если popup заблокирован, открываем напрямую
    window.location.href = link;
  }
}

// Универсальный парсер: найдёт номер в любой части строки, остальное — адрес
function parseLineToPhoneAddr(raw) {
  const line = String(raw || "").trim();
  if (!line) return { phone: "", address: "" };

  // первый «телефоноподобный» фрагмент: + или цифра, затем цифры/пробелы/()/-//
  const phoneMatch = line.match(/(\+?\d[\d\s()\/-]{4,})/);
  if (phoneMatch) {
    const phone = phoneMatch[1].trim().replace(/\s+/g, " ");
    const address = line
      .replace(phoneMatch[0], "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return { phone, address };
  }
  return { phone: "", address: line };
}

/* Попап выбора водителя */
// было: function showDriversPopup(textToSend) {
function showDriversPopup(textToSend, meta = {}) {
  const activeIds = getTodayActiveIds();
  const activeDrivers = drivers.filter((d) => activeIds.has(driverId(d)));

  const showing = activeDrivers.length ? activeDrivers : drivers;
  const hint = activeDrivers.length
    ? ""
    : `<div class="drivers-popup__hint">Für heute sind keine aktiven Fahrer markiert – zeige alle.</div>`;

  const wrap = document.createElement("div");
  wrap.className = "drivers-popup";
  wrap.innerHTML = `
<div class="drivers-popup__inner">
<p class="drivers-popup__title">An WhatsApp senden:</p>
${hint}
<div class="drivers-list">
  ${showing
    .map(
      (d) =>
        `<button class="wa-driver" data-id="${driverId(d)}">${d.name}</button>`
    )
    .join("")}
</div>
<div class="drivers-popup__footer">
  <span class="drivers-popup__small">${
    activeDrivers.length ? "Heutige aktive Fahrer" : "Alle Fahrer"
  }</span>
  <div>
    <button class="drivers-popup__link" data-act="shift">Ändern</button>
    <button class="drivers-popup__close" type="button">Schließen</button>
  </div>
</div>
</div>
`;

  // ✅ ВАЖНО: этот блок оставить (логируем + отправляем)
  wrap.querySelectorAll(".wa-driver").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const d = drivers.find((v) => driverId(v) === id);
      const driverPhone = driverId(d);
      const line = textToSend;

      addLog({
        driverName: d?.name || "",
        driverPhone: d?.phone || "", // как хранится (+43…)
        text: line,
        srcPhone: meta.srcPhone || "", // клиентский как есть
        srcAddr: meta.srcAddr || "", // адрес
        method: "WhatsApp",
      });

      sendToDriverPhone(driverPhone, line);
      wrap.remove();
    });
  });

  document.body.appendChild(wrap);

  wrap
    .querySelector(".drivers-popup__close")
    .addEventListener("click", () => wrap.remove());
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.remove();
  });
  wrap.querySelector('[data-act="shift"]').addEventListener("click", () => {
    wrap.remove();
    showShiftDialog();
  });
}

function safeDateStr(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("de-AT");
}

function showToastAt(x, y, text = "Kopiert") {
  toast.textContent = text;
  toast.style.left = x + "px";
  toast.style.top = y + "px";
  toast.classList.add("show");
  clearTimeout(showToastAt._t);
  showToastAt._t = setTimeout(() => toast.classList.remove("show"), 900);
}
function getEventXY(evt) {
  if (evt.touches && evt.touches[0])
    return { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
  if (evt.changedTouches && evt.changedTouches[0])
    return {
      x: evt.changedTouches[0].clientX,
      y: evt.changedTouches[0].clientY,
    };
  return { x: evt.clientX, y: evt.clientY };
}
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function highlightDigits(phone, digits) {
  if (!digits) return phone;
  const re = new RegExp(`(${digits})`, "g");
  return phone.replace(re, "<mark>$1</mark>");
}

function render(items) {
  listEl.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    const phoneRaw = item.phone_e164 || item.phone_raw || "";
    const digitsInput = normalizeDigits(q.value);

    // красивое отображение с подсветкой
    const phoneDisplayHTML = highlightDigits(phoneRaw, digitsInput);

    // href для звонка (e164, с плюсом если он был)
    const telTarget =
      (phoneRaw.trim().startsWith("+") ? "+" : "") + normalizeDigits(phoneRaw);
    const dateStr = safeDateStr(item.timestamp_iso);
    const address = item.address || "";

    li.innerHTML = `
<div class="row">
  <strong>
    <a class="phone-link" href="tel:${telTarget}" aria-label="Anrufen ${telTarget}">
      ${phoneDisplayHTML}
    </a>
  </strong>
  ${dateStr ? `<small>${dateStr}</small>` : ""}
  <div class="addr">${address}</div>
  <button class="btn-wa" title="В WhatsApp" type="button">WA</button>
</div>
`;

    // клик по карточке — копирование (как было)
    li.addEventListener("click", (ev) => {
      const line = address ? `${phoneRaw} ${address}` : `${phoneRaw}`;
      copyToClipboard(line.trim());
      li.classList.add("copied");
      setTimeout(() => li.classList.remove("copied"), 1200);
      const { x, y } = getEventXY(ev);
      showToastAt(x, y, "Kopiert");
    });

    // клик по телефону — не запускаем копирование
    li.querySelector(".phone-link").addEventListener("click", (ev) => {
      ev.stopPropagation(); // чтобы не сработал обработчик li
      // дальше всё отдаём системе (звонок/софтфон)
    });

    // WA — как уже сделали ранее
    li.querySelector(".btn-wa").addEventListener("click", (ev) => {
      ev.stopPropagation();
      const line = address ? `${phoneRaw} ${address}` : `${phoneRaw}`;
      showDriversPopup(line.trim(), {
        srcPhone: phoneRaw,
        srcAddr: address,
      });
    });

    listEl.appendChild(li);
  }
}

async function load() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    data = await res.json();
    const extra = ls.get("customOrders", []);
    data = data.concat(extra);
    data.sort((a, b) => {
      const da = a.timestamp_iso
        ? new Date(a.timestamp_iso).getTime()
        : -Infinity;
      const db = b.timestamp_iso
        ? new Date(b.timestamp_iso).getTime()
        : -Infinity;
      return db - da;
    });
    render([]);
    q.focus(); // автофокус
  } catch (e) {
    hint.textContent = "Fehler beim Laden (" + e.message + ")";
  }
  renderRecents();
}

function update() {
  const digits = normalizeDigits(q.value);
  if (!digits) {
    render([]);
    hint.textContent = "Geben Sie einige Ziffern ein.";
    return;
  }
  let recents = ls.get("recentSearches", []);
  if (!recents.includes(digits)) {
    recents.unshift(digits);
    if (recents.length > 10) recents.pop();
    ls.set("recentSearches", recents);
  }
  renderRecents();
  const out = [];
  for (const r of data) {
    const phoneDigits =
      r.phone_digits || normalizeDigits(r.phone_raw || r.phone_e164 || "");
    if (phoneDigits.includes(digits)) out.push(r);
    if (out.length >= 50) break;
  }
  render(out.slice(0, 10));
  hint.textContent = out.length
    ? `Gefunden: ${out.length} (zeige 10)`
    : "Keine Treffer";
}

function renderRecents() {
  const rec = ls.get("recentSearches", []);
  recentEl.innerHTML = "";
  for (const d of rec) {
    const b = document.createElement("button");
    b.textContent = d;
    b.addEventListener("click", () => {
      q.value = d;
      update();
    });
    recentEl.appendChild(b);
  }
}
q.addEventListener("click", () => {
  const now = Date.now();
  if (now - lastTap < 400) {
    q.value = "";
    update();
    setTimeout(() => q.focus(), 0);
  } else {
    q.select();
  }
  lastTap = now;
});
clearBtn.addEventListener("click", (e) => {
  e.preventDefault();
  q.value = "";
  update();
  setTimeout(() => q.focus(), 0);
});
let inputTimer;
q.addEventListener("input", () => {
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => update(), 1000);
});
document.getElementById("btnAdd").addEventListener("click", () => {
  dlg.showModal();
  // используем newAddr как единое поле (номер+адрес)
  newPhone.value = ""; // можно скрыть через CSS, но очищаем на всякий
  newAddr.value = "";
  newAddr.focus();
});

document
  .getElementById("cancelAdd")
  .addEventListener("click", () => dlg.close());

document.getElementById("saveAdd").addEventListener("click", () => {
  // читаем ВСЁ из newAddr (одно поле), номер ищем внутри
  const { phone: ph, address: addr } = parseLineToPhoneAddr(newAddr.value);

  if (!ph && !addr) {
    alert("Telefon und Adresse eingeben");
    return;
  }

  const now = new Date();
  const rec = {
    timestamp_iso: now.toISOString(),
    author: "user",
    phone_raw: ph || "",
    phone_digits: normalizeDigits(ph || ""),
    phone_e164: toE164(ph) || ph || "",
    address: addr || "",
    source_line: -1,
  };

  const all = ls.get("customOrders", []);
  all.push(rec);
  ls.set("customOrders", all);
  data.unshift(rec);
  dlg.close();
  update();
  showToastAt(window.innerWidth / 2, 40, "Gespeichert");
});

/* ==== WhatsApp Send Log ==== */
const LOG_KEY = "waSendLog";

function getLogs() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY)) || [];
  } catch {
    return [];
  }
}
function saveLogs(arr) {
  localStorage.setItem(LOG_KEY, JSON.stringify(arr));
}

/** Добавить запись
 *  payload: { ts, driverName, driverPhone, text, srcPhone, srcAddr, method }
 */
function addLog(payload) {
  const arr = getLogs();
  const driverPhoneRaw = payload.driverPhone || ""; // как есть (+43…)
  const srcPhoneRaw = payload.srcPhone || ""; // как есть (клиент)

  arr.unshift({
    ts: payload.ts || new Date().toISOString(),
    driverName: payload.driverName || "",

    // Водитель — красиво с плюсом и рабочий tel:
    driverPhoneDisplay: toE164(driverPhoneRaw) || driverPhoneRaw,
    driverPhoneTel: telHref(driverPhoneRaw),

    // Клиент — показываем как есть, но даём tel для клика:
    srcPhoneDisplay: srcPhoneRaw,
    srcPhoneTel: telHref(srcPhoneRaw),

    srcAddr: payload.srcAddr || "",
    text: payload.text || "",
    method: payload.method || "WhatsApp",
  });

  if (arr.length > 1000) arr.length = 1000;
  saveLogs(arr);
}

function fmtAT(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("de-AT");
}

/* Экспорт в CSV */
function exportLogsCSV() {
  const rows = getLogs();
  const header = [
    "Zeit",
    "Fahrer",
    "Fahrer-Nr",
    "Kunden-Nr",
    "Adresse",
    "Nachricht",
    "Kanal",
  ];
  const escape = (s) => `"${String(s || "").replace(/"/g, '""')}"`;
  const lines = [header.join(";")].concat(
    rows.map((r) =>
      [
        fmtAT(r.ts),
        r.driverName,
        r.driverPhoneDisplay || "",
        r.srcPhoneDisplay || "",
        r.srcAddr || "",
        r.text || "",
        r.method || "WhatsApp",
      ]
        .map(escape)
        .join(";")
    )
  );
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  const fn = `protokoll_${new Date().toISOString().slice(0, 10)}.csv`;
  a.href = URL.createObjectURL(blob);
  a.download = fn;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}

/* UI диалог просмотра */
function showLogDialog() {
  const data = getLogs();
  const wrap = document.createElement("div");
  wrap.className = "log-popup";
  wrap.innerHTML = `
<div class="log-popup__inner">
<div class="log-head">
  <strong>Protokoll der gesendeten Nachrichten</strong>
  <div class="log-actions">
    <button class="log-btn" data-act="export">Export CSV</button>
    <button class="log-btn log-btn--danger" data-act="clear">Leeren</button>
    <button class="log-btn" data-act="close">Schließen</button>
  </div>
</div>
${
  data.length
    ? `
<table class="log-table">
  <thead>
    <tr>
      <th>Zeit</th><th>Fahrer</th><th>Fahrer-Nr</th>
      <th>Quelle-Nr</th><th>Adresse</th><th>Nachricht</th><th>Kanal</th>
    </tr>
  </thead>
  <tbody>
    ${data
      .map(
        (r) => `
      <tr>
        <td>${fmtAT(r.ts)}</td>
        <td>${r.driverName || ""}</td>
<td>
${
  r.driverPhoneDisplay
    ? `<a href="tel:${(r.driverPhoneTel || "").replace(/"/g, "&quot;")}">
   ${(r.driverPhoneDisplay || "").replace(/</g, "&lt;")}
 </a>`
    : ""
}
</td>
<td>
${
  r.srcPhoneDisplay
    ? `<a href="tel:${(r.srcPhoneTel || "").replace(/"/g, "&quot;")}">
   ${(r.srcPhoneDisplay || "").replace(/</g, "&lt;")}
 </a>`
    : ""
}
</td>

        <td>${r.srcAddr || ""}</td>
        <td>${(r.text || "").replace(/</g, "&lt;")}</td>
        <td>${r.method || "WhatsApp"}</td>
      </tr>
    `
      )
      .join("")}
  </tbody>
</table>`
    : `<div class="log-empty">Keine Einträge.</div>`
}
</div>
`;
  document.body.appendChild(wrap);

  const inner = wrap.querySelector(".log-popup__inner");
  inner.addEventListener("click", (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    if (act === "export") exportLogsCSV();
    if (act === "clear") {
      if (confirm("Protokoll wirklich leeren?")) saveLogs([]), wrap.remove();
    }
    if (act === "close") wrap.remove();
  });

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.remove();
  });
}

/* кнопка «Protokoll» */
document.getElementById("btnLog").addEventListener("click", showLogDialog);

const digitsOnly = (s) => String(s || "").replace(/\D+/g, "");

/** Гарантируем E.164 с плюсом (если сохранили без '+') */
function toE164(phone) {
  if (!phone) return "";
  const raw = String(phone).trim();
  if (raw.startsWith("+")) return raw; // уже E.164
  const d = digitsOnly(raw);
  if (!d) return "";
  // если пользователь хранит австрийские номера без '+'
  if (d.startsWith("43")) return "+" + d;
  // иначе всё равно вернём +<digits> (универсально)
  return "+" + d;
}

/** tel: для href — из любого ввода */
function telHref(phone) {
  const e = toE164(phone);
  return e ? e : "+" + digitsOnly(phone);
}

load();

(function () {
  // тема уже применена бутскриптом в <head>; здесь только кнопка
  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("themeToggle");
    const icon = document.getElementById("themeToggleIcon");
    const label = document.getElementById("themeToggleLabel");
    if (!btn) return;

    const ICONS = {
      moon:
        '<path d="M14.85 5.25a5.5 5.5 0 0 0 3.87 9.32 7.1 7.1 0 1 1-3.87-9.32Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
      sun: '<circle cx="12" cy="12" r="3.25" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 4.4v1.8M12 17.8v1.8M19.6 12h-1.8M6.2 12H4.4M17.37 6.63l-1.27 1.27M7.9 16.1l-1.27 1.27M17.37 17.37 16.1 16.1M7.9 7.9 6.63 6.63" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    };

    const setLabel = (t) => {
      const nextLabel = t === "dark" ? "Hell" : "Dunkel";
      if (label) label.textContent = nextLabel;
      if (icon) icon.innerHTML = t === "dark" ? ICONS.sun : ICONS.moon;
    };

    // синхронизируем надпись с текущей темой
    setLabel(document.documentElement.getAttribute("data-theme") || "dark");

    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
      setLabel(next);
    });
  });
})();

function goBack() {
  if (window.history.length > 1 && document.referrer) {
    history.back();
  } else {
    // если открыто напрямую — переход на главную страницу проекта
    window.location.href = "/main/index.html";
  }
}
