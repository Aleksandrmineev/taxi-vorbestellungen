import { initForm } from "/assets/js/ui/form.js";
import { initOrdersList } from "/assets/js/ui/ordersList.js";
import { initTodoList } from "/assets/js/ui/todoList.js";
import { initSearch } from "/assets/js/ui/search.js";
import { initMainTabs } from "/assets/js/ui/tabs.js";

window.addEventListener("DOMContentLoaded", () => {
  // === 1) Форма
  let orders, todos;
  const { fillForm } = initForm({
    onCreated: () => {
      orders?.load?.();
      todos?.load?.(24);
    },
  });

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
      todos?.load?.(24);
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
