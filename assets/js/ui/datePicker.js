// ui/datePicker.js
// Eigener Datumsauswahl-Dialog (Kalender-Sheet) für das Bestellformular:
// - ein Tipp wählt ein Datum, im Modus „Mehrere Tage“ toggeln Tipps mehrere Tage
// - Schnellwahl (Heute, Morgen, Mo–Fr diese/nächste Woche, bei „bis“: +1/2/4 Wochen, Monatsende)
// - das native <input type="date"> bleibt (versteckt) als Wertträger für FormData und bestehenden Code.
// Die reinen Hilfsfunktionen sind exportiert und ohne DOM testbar.

export const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
export const WEEKDAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const MAX_DATES = 62;

const pad = (n) => String(n).padStart(2, "0");
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function fromISO(iso) {
  if (!ISO_RE.test(String(iso || ""))) return null;
  const date = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Number.isNaN(date.getTime()) || toISO(date) !== iso ? null : date;
}

export function addDays(iso, days) {
  const date = fromISO(iso);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return toISO(date);
}

export const todayISO = (now = new Date()) => toISO(now);

// Nur gültige, eindeutige Daten, aufsteigend sortiert, höchstens MAX_DATES.
export function cleanDates(list) {
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((value) => {
    if (fromISO(value)) seen.add(value);
  });
  return [...seen].sort().slice(0, MAX_DATES);
}

// 42 Zellen (6 Wochen, Montag zuerst): { iso, day } oder null vor/nach dem Monat.
export function monthGrid(year, month) {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const day = i - lead + 1;
    cells.push(day >= 1 && day <= days ? { iso: `${year}-${pad(month + 1)}-${pad(day)}`, day } : null);
  }
  return cells;
}

// Mo–Fr der Woche, die `offsetWeeks` Wochen nach der von `today` liegt; vergangene Tage entfallen.
export function workweek(today, offsetWeeks = 0) {
  const base = fromISO(today);
  if (!base) return [];
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((base.getDay() + 6) % 7) + offsetWeeks * 7);
  const result = [];
  for (let i = 0; i < 5; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const iso = toISO(day);
    if (iso >= today) result.push(iso);
  }
  return result;
}

export function formatDate(iso) {
  const date = fromISO(iso);
  return date ? date.toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}

const short = (iso) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;

// Text im Feld: ein Datum ausgeschrieben, mehrere kompakt.
export function formatSelection(dates) {
  const list = cleanDates(dates);
  if (!list.length) return "";
  if (list.length === 1) return formatDate(list[0]);
  const range = list.length <= 3 ? list.map(short).join(", ") : `${short(list[0])} – ${short(list[list.length - 1])}`;
  return `${list.length} Tage · ${range}`;
}

// Schnellwahl für „Wiederholen bis“, relativ zum Startdatum.
export function untilChips(startISO) {
  const start = fromISO(startISO);
  if (!start) return [];
  const chips = [
    { label: "+1 Woche", dates: [addDays(startISO, 7)] },
    { label: "+2 Wochen", dates: [addDays(startISO, 14)] },
    { label: "+4 Wochen", dates: [addDays(startISO, 28)] },
  ];
  const monthEnd = toISO(new Date(start.getFullYear(), start.getMonth() + 1, 0));
  if (monthEnd > startISO) chips.push({ label: "Monatsende", dates: [monthEnd] });
  return chips;
}

const ICON_CAL = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 3v4M16 3v4M3.5 10h17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const ICON_PREV = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_NEXT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Ersetzt die Anzeige eines <input type="date"> durch ein Auswahlfeld mit Kalender-Sheet.
 * options: { placeholder, title, multiple, chips: () => [{label, dates}], label: HTMLLabelElement }
 * Rückgabe: { get dates, setDates, setMultipleAllowed, onChange, open, close, trigger }
 */
export function enhanceDateInput(input, options = {}) {
  const { placeholder = "Datum wählen", title = "Datum wählen", multiple = false, chips = () => [] } = options;
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

  let dates = [];
  let multiAllowed = Boolean(multiple);
  const listeners = new Set();

  // ----- Feld -----
  const wrap = document.createElement("div");
  wrap.className = "dp-field";
  input.parentNode.insertBefore(wrap, input);
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "dp-trigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.id = `dp-${input.name || input.id || Math.random().toString(36).slice(2, 7)}`;
  trigger.innerHTML = `<span class="dp-trigger__text"></span><span class="dp-trigger__icon">${ICON_CAL}</span>`;
  wrap.append(trigger, input);
  input.classList.add("dp-native");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  input.removeAttribute("required"); // Pflichtprüfung übernimmt das Formular (natives Feld ist nicht fokussierbar)
  if (options.label) options.label.htmlFor = trigger.id;
  const textEl = trigger.querySelector(".dp-trigger__text");

  const renderTrigger = () => {
    const text = formatSelection(dates);
    textEl.textContent = text || placeholder;
    trigger.classList.toggle("is-placeholder", !text);
    trigger.title = dates.length > 1 ? dates.map(formatDate).join("\n") : "";
  };

  const notify = () => listeners.forEach((fn) => fn(dates.slice()));

  function setDates(list) {
    dates = cleanDates(list);
    if (!multiAllowed && dates.length > 1) dates = dates.slice(0, 1);
    valueDescriptor.set.call(input, dates[0] || "");
    renderTrigger();
    notify();
  }

  // Bestehender Code setzt input.value direkt (Standardwerte, Bearbeiten): Anzeige und Auswahl mitführen.
  Object.defineProperty(input, "value", {
    configurable: true,
    get() { return valueDescriptor.get.call(this); },
    set(value) {
      const iso = fromISO(value) ? String(value) : "";
      dates = iso ? [iso] : [];
      valueDescriptor.set.call(this, iso);
      renderTrigger();
      notify();
    },
  });
  input.focus = (focusOptions) => trigger.focus(focusOptions);

  // ----- Sheet (lazy) -----
  let sheet = null;
  let draft = [];
  let multiMode = false;
  let view = { year: new Date().getFullYear(), month: new Date().getMonth() };

  function buildSheet() {
    sheet = document.createElement("dialog");
    sheet.className = "dp-sheet";
    sheet.setAttribute("aria-label", title);
    sheet.innerHTML = `
      <div class="dp-panel">
        <div class="dp-head">
          <strong class="dp-title">${escapeHtml(title)}</strong>
          <button type="button" class="dp-close" aria-label="Schließen">×</button>
        </div>
        <div class="dp-chips" role="group" aria-label="Schnellwahl"></div>
        <label class="dp-mode" hidden><input type="checkbox" class="dp-mode__input" /><span>Mehrere Tage wählen</span></label>
        <div class="dp-nav">
          <button type="button" class="dp-nav__btn" data-nav="-1" aria-label="Vorheriger Monat">${ICON_PREV}</button>
          <span class="dp-month" aria-live="polite"></span>
          <button type="button" class="dp-nav__btn" data-nav="1" aria-label="Nächster Monat">${ICON_NEXT}</button>
        </div>
        <div class="dp-grid" role="grid"></div>
        <div class="dp-summary" hidden>
          <span class="dp-summary__text"></span>
          <button type="button" class="dp-clear">Auswahl löschen</button>
        </div>
        <button type="button" class="dp-done" hidden>Fertig</button>
      </div>`;
    document.body.append(sheet);

    sheet.addEventListener("click", (event) => { if (event.target === sheet) close(); });
    sheet.querySelector(".dp-close").addEventListener("click", close);
    sheet.querySelectorAll(".dp-nav__btn").forEach((btn) => btn.addEventListener("click", () => {
      const next = new Date(view.year, view.month + Number(btn.dataset.nav), 1);
      view = { year: next.getFullYear(), month: next.getMonth() };
      renderSheet();
    }));
    sheet.querySelector(".dp-mode__input").addEventListener("change", (event) => {
      multiMode = event.target.checked && multiAllowed;
      if (!multiMode && draft.length > 1) draft = draft.slice(0, 1);
      renderSheet();
    });
    sheet.querySelector(".dp-clear").addEventListener("click", () => { draft = []; renderSheet(); });
    sheet.querySelector(".dp-done").addEventListener("click", () => commit(draft));
    sheet.querySelector(".dp-grid").addEventListener("click", (event) => {
      const day = event.target.closest("[data-iso]");
      if (!day) return;
      const iso = day.dataset.iso;
      if (multiMode) {
        draft = draft.includes(iso) ? draft.filter((x) => x !== iso) : cleanDates([...draft, iso]);
        renderSheet();
      } else {
        commit([iso]);
      }
    });
    sheet.querySelector(".dp-chips").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-chip]");
      if (!chip) return;
      const picked = JSON.parse(chip.dataset.chip);
      if (picked.length > 1) {
        // mehrere Tage: erst anzeigen, Bestätigung mit „Fertig“
        multiMode = multiAllowed;
        draft = cleanDates(picked);
        view = monthOf(draft[0]);
        renderSheet();
      } else {
        commit(picked);
      }
    });
  }

  const monthOf = (iso) => {
    const date = fromISO(iso) || new Date();
    return { year: date.getFullYear(), month: date.getMonth() };
  };

  function renderSheet() {
    const gridEl = sheet.querySelector(".dp-grid");
    const focusedIso = gridEl.contains(document.activeElement) ? document.activeElement.dataset?.iso : "";
    const today = todayISO();
    // nur so viele Wochen zeigen, wie der Monat braucht (4–6): spart Höhe auf kleinen Telefonen
    const allCells = monthGrid(view.year, view.month);
    const lastFilled = allCells.map(Boolean).lastIndexOf(true);
    const cells = allCells.slice(0, Math.ceil((lastFilled + 1) / 7) * 7);
    sheet.querySelector(".dp-month").textContent = `${MONTHS_DE[view.month]} ${view.year}`;
    sheet.querySelector(".dp-grid").innerHTML =
      WEEKDAYS_DE.map((name) => `<span class="dp-wd" aria-hidden="true">${name}</span>`).join("") +
      cells.map((cell) => {
        if (!cell) return `<span class="dp-blank" aria-hidden="true"></span>`;
        const selected = draft.includes(cell.iso);
        const label = fromISO(cell.iso).toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        return `<button type="button" class="dp-day${selected ? " is-selected" : ""}${cell.iso === today ? " is-today" : ""}${cell.iso < today ? " is-past" : ""}" data-iso="${cell.iso}" aria-pressed="${selected}" aria-label="${label}">${cell.day}</button>`;
      }).join("");

    const chipList = (chips() || []).filter((chip) => multiAllowed || chip.dates.length === 1);
    sheet.querySelector(".dp-chips").innerHTML = chipList
      .map((chip) => `<button type="button" class="dp-chip" data-chip='${JSON.stringify(chip.dates)}'>${escapeHtml(chip.label)}</button>`)
      .join("");
    sheet.querySelector(".dp-chips").hidden = !chipList.length;

    const mode = sheet.querySelector(".dp-mode");
    mode.hidden = !multiAllowed;
    sheet.querySelector(".dp-mode__input").checked = multiMode;
    sheet.querySelector(".dp-summary").hidden = !multiMode;
    sheet.querySelector(".dp-done").hidden = !multiMode;
    sheet.querySelector(".dp-done").disabled = !draft.length;
    sheet.querySelector(".dp-summary__text").textContent = draft.length
      ? `${draft.length} ${draft.length === 1 ? "Tag" : "Tage"} gewählt`
      : "Tage antippen";
    sheet.querySelector(".dp-clear").hidden = !draft.length;
    // Fokus (Tastatur) nach dem Neuzeichnen auf dem gleichen Tag halten
    if (focusedIso) sheet.querySelector(`.dp-day[data-iso="${focusedIso}"]`)?.focus({ preventScroll: true });
  }

  function commit(list) {
    setDates(list);
    close();
  }

  function open() {
    if (!sheet) buildSheet();
    draft = dates.slice();
    multiMode = multiAllowed && dates.length > 1;
    view = monthOf(draft[0] || todayISO());
    renderSheet();
    if (!sheet.open) sheet.showModal();
    (sheet.querySelector(".dp-day.is-selected") || sheet.querySelector(".dp-day.is-today") || sheet.querySelector(".dp-day"))?.focus({ preventScroll: true });
  }

  function close() {
    if (sheet?.open) sheet.close();
  }

  trigger.addEventListener("click", open);
  renderTrigger();

  return {
    trigger,
    get dates() { return dates.slice(); },
    setDates,
    setMultipleAllowed(allowed) {
      multiAllowed = Boolean(allowed) && Boolean(multiple);
      if (!multiAllowed && dates.length > 1) setDates(dates.slice(0, 1));
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    open,
    close,
  };
}
