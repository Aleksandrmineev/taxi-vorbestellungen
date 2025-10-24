import { initForm } from "./ui/form.js";
import { initOrdersList } from "./ui/ordersList.js";
import { initTodoList } from "./ui/todoList.js";
import { initSearch } from "./ui/search.js";

window.addEventListener("DOMContentLoaded", () => {
  // форма
  const { fillForm } = initForm({
    onCreated: () => {
      orders.load();
      todos.load(24);
    },
  });

  // списки
  const orders = initOrdersList({ fillForm });
  const todos = initTodoList({ fillForm });
  initSearch({ fillForm });

  // стартовая загрузка
  orders.load();
  todos.load(24);
});

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("f");
  const submitBtn = form?.querySelector(".icon-btn--primary");

  if (form && submitBtn) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submitBtn.classList.add("loading");

      try {
        // пример: твоя логика сохранения
        await saveOrder(form);
        // после успешного сохранения — показать подтверждение
        showSuccessPopup(); // заменишь своей функцией
      } catch (err) {
        console.error(err);
        alert("Fehler beim Speichern!");
      } finally {
        submitBtn.classList.remove("loading");
      }
    });
  }

  // пример заглушек, чтобы не ломалось
  async function saveOrder(form) {
    return new Promise((resolve) => setTimeout(resolve, 2000)); // имитация 2 сек
  }
  function showSuccessPopup() {
    console.log("✅ Bestellung gespeichert!");
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const gcal = document.getElementById("footer-gcal");
  if (!gcal) return;

  const originalUrl = gcal.getAttribute("href");

  // Android: попытка открыть приложение Google Calendar через intent://
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
    // обычно intent лучше открывать в текущем окне
    gcal.removeAttribute("target");
  }

  // iOS: оставляем https — если установлен Google Calendar, часто перехватит
});
