import { initThemeController } from "./theme-core.js";

initThemeController();

// Переключатель табов
// ===== Mobile tabs: aside <-> main
(() => {
  const layout = document.querySelector(".layout");
  const tabForm = document.getElementById("tab-form");
  const tabList = document.getElementById("tab-list");
  if (!layout || !tabForm || !tabList) return;

  function activate(which) {
    layout.setAttribute("data-active", which);
    const isForm = which === "form";
    tabForm.classList.toggle("is-active", isForm);
    tabList.classList.toggle("is-active", !isForm);
    tabForm.setAttribute("aria-selected", String(isForm));
    tabList.setAttribute("aria-selected", String(!isForm));
  }

  tabForm.addEventListener("click", () => activate("form"));
  tabList.addEventListener("click", () => activate("list"));

  // если пришли с якорем типа #list — открыть нужную вкладку
  const h = (location.hash || "").toLowerCase();
  if (h.includes("list") || h.includes("suche") || h.includes("fahrten")) {
    activate("list");
  } else {
    activate("form"); // по умолчанию — форма
  }

  // при ресайзе > 900px ничего не ломаем: обе колонки снова видны через твою desktop-сетку
})();
