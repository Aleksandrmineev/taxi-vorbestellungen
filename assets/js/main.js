// assets/js/main.js
import { initForm } from "./ui/form.js";
import { initOrdersList } from "./ui/ordersList.js";
import { initTodoList } from "./ui/todoList.js";
import { initSearch } from "./ui/search.js";
import { initMainTabs } from "./ui/tabs.js";

window.addEventListener("DOMContentLoaded", () => {
  // === 1) Форма
  // onCreated будет вызван после успешного сохранения нового заказа
  let orders, todos; // объявим заранее, чтобы onCreated имел доступ по замыканию
  const { fillForm } = initForm({
    onCreated: () => {
      // после создания — обновляем списки
      orders?.load?.();
      todos?.load?.(24);
    },
  });

  // === 2) Секции (поиск, списки)
  initSearch({ fillForm }); // поиск реагирует на ввод
  todos = initTodoList({ fillForm }); // вернёт { load }
  orders = initOrdersList({ fillForm }); // вернёт { load }

  // === 3) Табы внутри <main>
  // Коллбеки будут вызываться при показе соответствующей вкладки.
  initMainTabs({
    defaultPanelId: "panel-next", // ← теперь по умолчанию открывается Nächste Fahrten
    onSearchShown: () => {},
    onNextShown: () => {
      todos?.load?.(24);
    },
    onDateShown: () => {
      orders?.load?.();
    },
  });

  // === 4) Footer: Google Calendar intent для Android
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
      gcal.removeAttribute("target"); // intent лучше открывать в текущем окне
    }
  }
});
