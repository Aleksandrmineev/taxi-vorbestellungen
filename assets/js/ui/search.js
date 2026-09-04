// assets/js/ui/search.js
import { Api } from "../api.js?v=20260904-3";
import { pad2, formatDateFromISO } from "../utils/time.js";
import { telHref } from "../utils/phone.js";

export function initSearch({ fillForm }) {
  const input = document.getElementById("q");
  const list = document.getElementById("searchList");
  if (!input || !list) return {};

  const DEBOUNCE_MS = 250;
  let t = null;

  function setLoading() {
    list.innerHTML = '<div class="item">Laden…</div>';
  }
  function setEmpty() {
    list.innerHTML = "";
  }
  function setError(msg) {
    list.innerHTML = `<div class="item">Fehler: ${msg}</div>`;
  }

  // Унифицированно достаём дату/время из разных форматов API
  function getDateTimeParts(it) {
    // 1) Самый желательный формат: start_iso / startISO / start
    const startIso =
      it.start_iso ||
      it.startISO ||
      it.start ||
      it.startAt ||
      it.start_at ||
      "";

    if (startIso) {
      const d = new Date(startIso);
      if (!isNaN(d)) {
        return {
          start: d.toISOString(), // для dataset и повторения
          dateHuman: formatDateFromISO(d.toISOString()),
          time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
        };
      }
    }

    // 2) Частый формат: date = 'YYYY-MM-DD', time = 'HH:MM'
    const date = (it.date || it.ride_date || it.day || "").trim?.() || "";
    const timeRaw = (it.time || it.ride_time || "").trim?.() || "";

    if (date) {
      const hhmm = (timeRaw || "00:00").padStart(5, "0").slice(0, 5);
      // делаем ISO для dataset/start (локальное время, без Z)
      const isoLocal = `${date}T${hhmm}:00`;
      return {
        start: isoLocal,
        dateHuman: formatDateFromISO(isoLocal),
        time: hhmm,
      };
    }

    // 3) Нет данных
    return { start: "", dateHuman: "—", time: "" };
  }

  function render(items) {
    list.innerHTML =
      items
        .map((it) => {
          const { start, dateHuman, time } = getDateTimeParts(it);

          const { display, href } = telHref(it.phone);
          const phoneHtml = display ? `<a href="${href}">${display}</a>` : "";

          return `
            <div class="order-row item search-order-row"
                 data-order-id="${it.id || it.order_id || ""}"
                 data-type="${it.type || ""}"
                 data-dur="${it.duration_min || ""}"
                 data-phone="${display || ""}"
                 data-message="${(it.message || "").replace(/"/g, "&quot;")}"
                 data-start="${start}">
              <div class="order-row__info">
                <div class="order-row__primary">
                  <strong class="order-row__time">${time || "—"}</strong>
                  <span class="order-row__phone">${phoneHtml || "Ohne Telefonnummer"}</span>
                  <span class="order-row__date">${dateHuman}</span>
                </div>
                <div class="order-row__secondary">
                  ${(it.message || "Keine Adresse / Notiz")} · ${it.type || "Bestellung"} · #${it.id || it.order_id || "—"}
                </div>
              </div>
              <div class="order-row__actions">
                <button class="order-action search-repeat" type="button" title="Als neue Vorbestellung kopieren" aria-label="Kopieren">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>
                  <small>Kopieren</small>
                </button>
              </div>
            </div>`;
        })
        .join("") || '<div class="item">Nichts gefunden.</div>';
  }

  async function doSearch(q) {
    const query = String(q || "").trim();
    if (query.length < 2) {
      setEmpty();
      return;
    }
    setLoading();

    const res = await Api.search(query, 50).catch((err) => ({
      ok: false,
      error: String(err),
    }));

    if (!res.ok) {
      setError(res.error || "unbekannter Fehler");
      return;
    }

    render(res.items || []);
  }

  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => doSearch(input.value), DEBOUNCE_MS);
  });

  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".search-repeat");
    if (!btn) return;

    const item = btn.closest(".item");
    if (!item) return;

    const start = item.dataset.start || "";

    fillForm({
      date: start ? start.slice(0, 10) : "", // YYYY-MM-DD
      time: start ? start.slice(11, 16) : "", // HH:MM
      type: item.dataset.type || "Orts",
      duration_min: item.dataset.dur || "15",
      phone: item.dataset.phone || "",
      message: item.dataset.message || "",
    });
  });

  return { search: doSearch };
}
