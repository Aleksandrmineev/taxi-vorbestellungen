import { Api } from "../api.js";
import {
  pad2,
  todayISO,
  hhmmFromISO,
  dateForRepeat,
  formatDateFromISO,
} from "../utils/time.js";
import { telHref } from "../utils/phone.js";
import { promptReason } from "./dialog.js";

export function initTodoList({ fillForm }) {
  const todoList = document.getElementById("todoList");

  // плавное скрытие карточки и удаление из DOM
  function fadeOutAndRemove(el) {
    if (!el) return;
    el.style.transition = "opacity .2s ease, transform .2s ease";
    el.style.opacity = 0;
    el.style.transform = "translateY(4px)";
    setTimeout(() => el.remove(), 220);
  }

  async function load(hours = 24) {
    todoList.innerHTML = '<div class="item">Laden…</div>';

    const res = await Api.todos(hours).catch((err) => ({
      ok: false,
      error: String(err),
    }));

    if (!res.ok) {
      todoList.innerHTML = `<div class="item">Fehler: ${res.error}</div>`;
      return;
    }

    // показываем только актуальные задачи (не done/cancelled)
    const items =
      (res.items || []).filter(
        (it) => it.status !== "done" && it.status !== "cancelled"
      ) || [];

    todoList.innerHTML =
      items
        .map((it) => {
          const st = new Date(it.start_iso);
          const time = `${pad2(st.getHours())}:${pad2(st.getMinutes())}`;
          const dateHuman = formatDateFromISO(it.start_iso);
          const badge = `<span class="badge ${it.status}">${it.status}</span>`;
          const { display, href } = telHref(it.phone);
          const phoneHtml = display ? `<a href="${href}">${display}</a>` : "";
          const disabled = it.order_id ? "" : " disabled";

          return `
          <div class="item"
               data-order-id="${it.order_id || ""}"
               data-type="${it.type || ""}"
               data-dur="${it.duration_min || ""}"
               data-phone="${display || ""}"
               data-message="${(it.message || "").replace(/"/g, "&quot;")}"
               data-start="${it.start_iso}">
            <h4>#${it.order_id || "—"} — ${dateHuman} ${time} — ${
            it.type || "Bestellung"
          } — ${phoneHtml} ${badge}</h4>
            ${it.message ? `<div class="sub">${it.message}</div>` : ``}

            <div class="btns">
              <!-- Wiederholen -->
              <button class="icon-btn todo-repeat" title="Wiederholen" aria-label="Wiederholen">
                <svg viewBox="0 0 24 24" aria-hidden="true">
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

              <!-- Bestätigen -->
              <button class="icon-btn icon-btn--primary todo-done"${disabled} title="Erledigt" aria-label="Erledigt">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M5 12.5l4 4 10-10"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>

              <!-- Stornieren -->
              <button class="icon-btn todo-cancel"${disabled} title="Stornieren" aria-label="Stornieren">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M18 6L6 18M6 6l12 12"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>`;
        })
        .join("") || '<div class="item">Keine Aufgaben.</div>';
  }

  // кнопки фильтра (12h, 24h, 1W)
  document.querySelectorAll(".todo").forEach((b) => {
    b.addEventListener("click", () => load(Number(b.dataset.h)));
  });

  // обработка кликов на действия
  todoList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const item = btn.closest(".item");
    if (!item) return;

    const orderId = item.dataset.orderId;

    // Повторить (заполнить форму)
    if (btn.classList.contains("todo-repeat")) {
      fillForm({
        date: dateForRepeat(item.dataset.start),
        time: hhmmFromISO(item.dataset.start),
        type: item.dataset.type || "Orts",
        duration_min: item.dataset.dur || "15",
        phone: item.dataset.phone || "",
        message: item.dataset.message || "",
      });
      return;
    }

    if (!orderId) return;

    // Завершить
    if (btn.classList.contains("todo-done")) {
      await Api.updateStatus(orderId, "done");
      item.querySelector(".badge").className = "badge done";
      item.querySelector(".badge").textContent = "done";
      fadeOutAndRemove(item);
      return;
    }

    // Отменить
    if (btn.classList.contains("todo-cancel")) {
      const comment =
        (await promptReason({
          title: "Bestellung stornieren",
          message: "Grund (optional):",
          placeholder: "z. B. Kunde hat abgesagt …",
          okText: "Stornieren",
        })) || "";

      await Api.updateStatus(orderId, "cancelled", comment);
      item.querySelector(".badge").className = "badge cancelled";
      item.querySelector(".badge").textContent = "cancelled";
      fadeOutAndRemove(item);
      return;
    }
  });

  // авто-обновление при возврате на вкладку
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load(24);
  });

  return { load };
}
