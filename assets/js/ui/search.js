// assets/js/ui/search.js
import { Api } from "../api.js";
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

          const status = it.status || "active";
          const badge = `<span class="badge ${status}">${status}</span>`;

          return `
            <div class="item"
                 data-order-id="${it.id || it.order_id || ""}"
                 data-type="${it.type || ""}"
                 data-dur="${it.duration_min || ""}"
                 data-phone="${display || ""}"
                 data-message="${(it.message || "").replace(/"/g, "&quot;")}"
                 data-start="${start}">
              
              <div class="item__top">
                <div class="item__dt">
                  <span class="item__date">${dateHuman}</span>
                  <span class="item__time">${time}</span>
                </div>

                <div class="item__right">
                  ${phoneHtml}
                  ${badge}
                </div>
              </div>

              ${it.message ? `<div class="sub">${it.message}</div>` : ``}

              <div class="item__bottom">
                <div class="btns">
                  <button class="icon-btn search-repeat" title="Wiederholen" aria-label="Wiederholen">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20 12a8 8 0 1 1-2.35-5.65"
                            fill="none" stroke="currentColor" stroke-width="1.8"
                            stroke-linecap="round" stroke-linejoin="round"/>
                      <polyline points="20 4 20 9 15 9"
                                fill="none" stroke="currentColor" stroke-width="1.8"
                                stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                </div>

                <div class="item__meta">
                  <span class="item__id">#${it.id || it.order_id || "—"}</span>
                  <span class="item__type">${it.type || "Bestellung"}</span>
                </div>
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
