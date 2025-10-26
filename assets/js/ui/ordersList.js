// assets/js/ui/ordersList.js
import { Api } from "../api.js";
import { todayISO, formatDateHuman } from "../utils/time.js";
import { telHref } from "../utils/phone.js";
import { promptReason } from "./dialog.js";

export function initOrdersList({ fillForm }) {
  const list = document.getElementById("list");
  const listDate = document.getElementById("listDate");
  const showAll = document.getElementById("showAll");
  const reloadBtn = document.getElementById("reload");

  listDate.value = todayISO();

  // плавное скрытие карточки и удаление из DOM
  function fadeOutAndRemove(el) {
    if (!el) return;
    el.style.transition = "opacity .2s ease, transform .2s ease";
    el.style.opacity = "0";
    el.style.transform = "translateY(4px)";
    setTimeout(() => el.remove(), 220);
  }

  function cardHtml(it) {
    const badge = `<span class="badge ${it.status}">${it.status}</span>`;
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
        <h4>#${it.id} — ${dateHuman} ${it.time} — ${
      it.type
    } — ${phoneHtml} ${badge}</h4>
        ${it.message ? `<div class="sub">${it.message}</div>` : ``}

        <div class="btns">
          <!-- Kopieren -->
          <button class="icon-btn todo-repeat" title="Kopieren" aria-label="Kopieren">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.35-5.65"
                    fill="none" stroke="currentColor" stroke-width="1.8"
                    stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="20 4 20 9 15 9"
                        fill="none" stroke="currentColor" stroke-width="1.8"
                        stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- Erledigt -->
          <button class="icon-btn icon-btn--primary done" title="Erledigt" aria-label="Erledigt">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5.5 12.5l3.5 3.5 9.5-9.5"
                    fill="none" stroke="currentColor" stroke-width="1.8"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- Abbrechen -->
          <button class="icon-btn cancel" title="Abbrechen" aria-label="Abbrechen">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18"
                    fill="none" stroke="currentColor" stroke-width="1.8"
                    stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>`;
  }

  async function load() {
    list.innerHTML = '<div class="item">Laden…</div>';

    const res = await Api.ordersByDate(listDate.value, showAll.checked).catch(
      (err) => ({ ok: false, error: String(err) })
    );
    if (!res.ok) {
      list.innerHTML = `<div class="item">Fehler: ${res.error}</div>`;
      return;
    }

    const items = res.items || [];
    const now = new Date();
    const graceMin = 30; // время «буфера» после окончания поездки, мин.

    // фильтруем только те, что ещё актуальны или явно запрошены (showAll)
    const filtered = items.filter((it) => {
      if (showAll.checked) return true; // при активном чекбоксе показываем все

      // если дата поездки раньше сегодняшней → скрываем
      const rideDate = new Date(it.date);
      const today = new Date();
      if (rideDate < new Date(today.toISOString().split("T")[0])) return false;

      // время окончания = время начала + длительность + буфер
      const [h, m] = (it.time || "00:00").split(":").map(Number);
      const rideEnd = new Date(it.date);
      rideEnd.setHours(
        h,
        m + (parseInt(it.duration_min) || 0) + graceMin,
        0,
        0
      );

      // показываем, если поездка ещё не завершилась + буфер
      return rideEnd > now;
    });

    list.innerHTML =
      filtered.map(cardHtml).join("") ||
      '<div class="item">Keine aktiven Bestellungen.</div>';
  }

  reloadBtn.addEventListener("click", load);
  showAll.addEventListener("change", load);
  listDate.addEventListener("change", load);

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const item = btn.closest(".item");
    const id = item?.dataset?.id;

    // Kopieren (Formular vorfüllen)
    if (
      btn.classList.contains("todo-repeat") ||
      btn.classList.contains("copy")
    ) {
      fillForm({
        date: todayISO(),
        time: (item.dataset.time || "").padStart(5, "0"),
        type: item.dataset.type,
        duration_min: item.dataset.dur,
        phone: item.dataset.phone || "",
        message: item.dataset.message || "",
      });
      return;
    }
    if (!id) return;

    // Erledigt
    if (btn.classList.contains("done")) {
      await Api.updateStatus(id, "done");
      item.querySelector(".badge").className = "badge done";
      item.querySelector(".badge").textContent = "erledigt";
      fadeOutAndRemove(item);
      return;
    }

    // Abbrechen (mit optionalem Grund)
    if (btn.classList.contains("cancel")) {
      const res = await promptReason({
        title: "Bestellung stornieren",
        message: "Grund (optional):",
        placeholder: "z. B. Kunde hat abgesagt …",
        okText: "Stornieren",
        cancelText: "Abbrechen",
      });

      // Пользователь нажал Abbrechen / Esc / клик по фону — ничего не делаем
      if (res === null) return;

      // Пустая строка "" допустима — подтверждение без комментария
      const comment = res;

      await Api.updateStatus(id, "cancelled", comment);
      item.querySelector(".badge").className = "badge cancelled";
      item.querySelector(".badge").textContent = "storniert";
      fadeOutAndRemove(item);
      return;
    }
  });

  return { load };
}
