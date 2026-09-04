import { initForm } from "/assets/js/ui/form.js";
import { initOrdersList } from "/assets/js/ui/ordersList.js";
import { initTodoList } from "/assets/js/ui/todoList.js";
import { initSearch } from "/assets/js/ui/search.js";
import { initMainTabs } from "/assets/js/ui/tabs.js";

window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("f");
  const dialog = document.createElement("dialog");
  dialog.id = "orderDialog";
  dialog.className = "order-dialog";
  dialog.innerHTML = `
    <div class="order-dialog__head">
      <h2>Neue Vorbestellung</h2>
      <button type="button" class="dialog-close" aria-label="Schließen" title="Schließen">×</button>
    </div>`;
  document.body.append(dialog);
  if (form) {
    dialog.append(form);
    form.classList.add("order-dialog__form");
  }
  const openForm = ({ reset = false } = {}) => {
    if (reset && form) {
      delete form.dataset.editingId;
      if (form.elements.rrule) form.elements.rrule.value = "";
      if (form.elements.until) form.elements.until.value = "";
      form.elements.rrule?.dispatchEvent(new Event("change"));
    }
    if (!dialog.open) dialog.showModal();
    form?.querySelector('[name="date"]')?.focus({ preventScroll: true });
  };
  const closeForm = () => dialog.close();
  dialog.querySelector(".dialog-close")?.addEventListener("click", closeForm);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closeForm();
  });
  document.getElementById("newOrderFab")?.addEventListener("click", () => openForm({ reset: true }));
  window.addEventListener("open-order-form", () => openForm({ reset: true }));

  // === 1) Форма
  let orders, todos;
  const formApi = initForm({
    onCreated: () => {
      orders?.load?.();
      todos?.load?.(24 * 366);
      closeForm();
    },
  });
  const fillForm = (data) => {
    formApi.fillForm(data);
    openForm();
  };

  const nextPanel = document.getElementById("panel-next");
  const searchPanel = document.getElementById("panel-search");
  const searchToggle = document.getElementById("orderSearchToggle");
  const searchBack = document.getElementById("orderSearchBack");
  const searchInput = document.getElementById("q");
  const setSearchOpen = (open) => {
    nextPanel?.toggleAttribute("hidden", open);
    searchPanel?.toggleAttribute("hidden", !open);
    if (open) searchInput?.focus();
  };
  searchToggle?.addEventListener("click", () => setSearchOpen(true));
  searchBack?.addEventListener("click", () => setSearchOpen(false));

  // === 2) Секции (поиск, списки)
  const search = initSearch({ fillForm });
  todos = initTodoList({ fillForm });
  orders = initOrdersList({ fillForm });

  // === 3) Табы внутри <main>
  initMainTabs({
    defaultPanelId: "panel-next",
    onSearchShown: () => {
      document.getElementById("q")?.focus();
      // при возврате на вкладку поле уже может содержать текст:
      const v = document.getElementById("q")?.value || "";
      if (v.trim().length >= 2) search?.search?.(v);
    },
    onNextShown: () => {
      todos?.load?.(24 * 366);
    },
    onDateShown: () => {
      orders?.load?.();
    },
  });

  // === 4) Footer: Google Calendar intent ...
  const gcal = document.getElementById("footer-gcal");
  if (gcal) {
    const originalUrl = gcal.getAttribute("href") || "";
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid && originalUrl.startsWith("https://")) {
      const intentUrl =
        "intent://" +
        originalUrl.replace(/^https?:\/\//, "") +
        "#Intent;scheme=https;package=com.google.android.calendar;" +
        "S.browser_fallback_url=" +
        encodeURIComponent(originalUrl) +
        ";end";

      gcal.setAttribute("href", intentUrl);
      gcal.removeAttribute("target");
    }
  }
});
