// /assets/js/theme.js
(function () {
  const html = document.documentElement;
  const key = "theme";
  const saved = localStorage.getItem(key);
  if (saved === "dark" || saved === "light")
    html.setAttribute("data-theme", saved);

  const toggles = [
    document.getElementById("theme-toggle"),
    document.getElementById("theme-toggle-footer"),
  ].filter(Boolean);
  const icons = [
    document.getElementById("theme-icon"),
    document.getElementById("theme-icon-footer"),
  ].filter(Boolean);

  function setIcon() {
    const dark = html.getAttribute("data-theme") === "dark";
    const path = dark
      ? // moon
        '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="currentColor"/>'
      : // sun
        '<circle cx="12" cy="12" r="4" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="M4.2 4.2l2.2 2.2"/><path d="M17.6 17.6l2.2 2.2"/><path d="M4.2 19.8l2.2-2.2"/><path d="M17.6 6.4l2.2-2.2"/></g>';
    icons.forEach((svg) => {
      if (svg) svg.innerHTML = path;
    });
  }
  function toggle() {
    const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem(key, next);
    setIcon();
  }
  toggles.forEach((btn) => btn && btn.addEventListener("click", toggle));
  setIcon();
})();

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
