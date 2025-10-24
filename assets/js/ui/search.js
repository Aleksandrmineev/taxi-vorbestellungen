import { Api } from "../api.js";
import { formatDateHuman } from "../utils/time.js";
import { telHref } from "../utils/phone.js";

export function initSearch({ fillForm }) {
  const q = document.getElementById("q");
  const searchList = document.getElementById("searchList");
  let t;

  function cardHtml(it) {
    const { display, href } = telHref(it.phone);
    const phoneHtml = display ? `<a href="${href}">${display}</a>` : "";
    const dateHuman = formatDateHuman(it.date);

    return `
      <div class="item"
           data-id="${it.id}"
           data-type="${it.type}"
           data-dur="${it.duration_min}"
           data-phone="${display || ""}"
           data-message="${(it.message || "").replace(/"/g, "&quot;")}"
           data-time="${it.time}">
        <h4>#${it.id} — ${dateHuman} ${it.time} — ${it.type} — ${phoneHtml}
          <span class="badge ${it.status}">${it.status}</span>
        </h4>
        ${it.message ? `<div class="sub">${it.message}</div>` : ``}
  
        <div class="btns">
          <!-- Kopieren / Wiederholen (muted) -->
          <button class="icon-btn icon-btn--muted todo-repeat"
                  title="Kopieren"
                  aria-label="Kopieren">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <!-- круг и стрелка — современный refresh/copy -->
              <path
                d="M20 12a8 8 0 1 1-2.35-5.65"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                points="20 4 20 9 15 9"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>`;
  }

  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const term = (q.value || "").trim();
      if (term.length < 2) {
        searchList.innerHTML = "";
        return;
      }
      const res = await Api.search(term, 30).catch((err) => ({
        ok: false,
        error: String(err),
      }));
      if (!res.ok) {
        searchList.innerHTML = `<div class="item">Fehler: ${res.error}</div>`;
        return;
      }
      const items = res.items || [];
      searchList.innerHTML =
        items.map(cardHtml).join("") ||
        '<div class="item">Nichts gefunden.</div>';
    }, 250);
  });

  searchList.addEventListener("click", (e) => {
    const btn = e.target.closest(".copy");
    if (!btn) return;
    const item = btn.closest(".item");
    fillForm({
      date: null, // aktuelles Formulardatum beibehalten
      time: (item.dataset.time || "").padStart(5, "0"),
      type: item.dataset.type,
      duration_min: item.dataset.dur,
      phone: item.dataset.phone || "",
      message: item.dataset.message || "",
    });
  });
}
