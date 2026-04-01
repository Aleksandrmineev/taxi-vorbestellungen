(function () {
  try {
    var saved = localStorage.getItem("theme");
    var prefersLight =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    var theme =
      saved === "light" || saved === "dark"
        ? saved
        : prefersLight
        ? "light"
        : "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
