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

  function render(items) {
    list.innerHTML =
      items
        .map((it) => {
          const st = it.start_iso ? new Date(it.start_iso) : null;
          const time = st
            ? `${pad2(st.getHours())}:${pad2(st.getMinutes())}`
            : "";
          const dateHuman = st ? formatDateFromISO(it.start_iso) : "";
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
                 data-start="${it.start_iso || ""}">
              <h4>
                #${it.id || it.order_id || "—"}
                ${st ? ` — ${dateHuman} ${time}` : ""}
                ${it.type ? ` — ${it.type}` : ""}
                ${phoneHtml ? ` — ${phoneHtml}` : ""}
                ${badge}
              </h4>
              ${it.message ? `<div class="sub">${it.message}</div>` : ``}

              <div class="btns">
                <button class="icon-btn search-repeat" title="Wiederholen" aria-label="Wiederholen">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 12a8 8 0 1 1-2.35-5.65" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <polyline points="20 4 20 9 15 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
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

  // ввод с дебаунсом
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => doSearch(input.value), DEBOUNCE_MS);
  });

  // клик «повторить» заполняет форму
  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".search-repeat");
    if (!btn) return;
    const item = btn.closest(".item");
    if (!item) return;

    fillForm({
      date: (item.dataset.start || "").slice(0, 10), // YYYY-MM-DD
      time: (item.dataset.start || "").slice(11, 16), // HH:MM
      type: item.dataset.type || "Orts",
      duration_min: item.dataset.dur || "15",
      phone: item.dataset.phone || "",
      message: item.dataset.message || "",
    });
  });

  return { search: doSearch };
}
