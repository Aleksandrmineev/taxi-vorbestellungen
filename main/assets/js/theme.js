(() => {
  const html = document.documentElement;
  const topBtn = document.getElementById("theme-toggle");
  const topIcon = document.getElementById("theme-icon");
  const footBtn = document.getElementById("theme-toggle-footer");
  const footIcon = document.getElementById("theme-icon-footer");

  const saved = localStorage.getItem("theme");
  html.dataset.theme =
    saved === "light" || saved === "dark"
      ? saved
      : matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";

  // иконки: 🌙 для светлой, ☀️ для тёмной темы
  function setIcons() {
    const moon = '<path d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z"/>'; // луна
    const sun =
      '<path d="M6.76 4.84l-1.9-1.9-1.41 1.41 1.9 1.9 1.41-1.41zM1 13h3a1 1 0 100-2H1a1 1 0 100 2zm10 10a1 1 0 001-1v-3a1 1 0 10-2 0v3a1 1 0 001 1zm9-10a1 1 0 100-2h-3a1 1 0 100 2h3zM6.76 19.16l-1.9 1.9 1.41 1.41 1.9-1.9-1.41-1.41zM12 6a6 6 0 100 12 6 6 0 000-12z"/>'; // солнце

    const icon = html.dataset.theme === "dark" ? sun : moon;
    topIcon.innerHTML = icon;
    footIcon.innerHTML = icon;
  }
  setIcons();

  function toggleTheme() {
    html.dataset.theme = html.dataset.theme === "light" ? "dark" : "light";
    localStorage.setItem("theme", html.dataset.theme);
    setIcons();
  }

  topBtn?.addEventListener("click", toggleTheme, { passive: true });
  footBtn?.addEventListener("click", toggleTheme, { passive: true });

  // автоматическая синхронизация при смене системной темы
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.(
    "change",
    (e) => {
      if (!localStorage.getItem("theme")) {
        html.dataset.theme = e.matches ? "dark" : "light";
        setIcons();
      }
    }
  );
})();
