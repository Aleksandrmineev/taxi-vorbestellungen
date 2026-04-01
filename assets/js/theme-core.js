const STORAGE_KEY = "theme";

const ICONS = {
  moon: '<path d="M14.85 5.25a5.5 5.5 0 0 0 3.87 9.32 7.1 7.1 0 1 1-3.87-9.32Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="3.25" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 4.4v1.8M12 17.8v1.8M19.6 12h-1.8M6.2 12H4.4M17.37 6.63l-1.27 1.27M7.9 16.1l-1.27 1.27M17.37 17.37 16.1 16.1M7.9 7.9 6.63 6.63" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

function getHtml() {
  return document.documentElement;
}

export function resolveInitialTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function applyTheme(theme) {
  const html = getHtml();
  html.dataset.theme = theme === "light" ? "light" : "dark";
  syncThemeUi();
}

export function toggleTheme() {
  const html = getHtml();
  const next = html.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem(STORAGE_KEY, next);
  applyTheme(next);
}

export function syncThemeUi() {
  const html = getHtml();
  const theme = html.dataset.theme === "light" ? "light" : "dark";
  const iconMarkup = theme === "dark" ? ICONS.sun : ICONS.moon;
  const toggles = [
    document.getElementById("theme-toggle"),
    document.getElementById("theme-toggle-footer"),
  ].filter(Boolean);

  toggles.forEach((toggle) => {
    toggle.dataset.themeToggle = "1";
    toggle.classList.add("theme-toggle");
    toggle.setAttribute("aria-pressed", theme === "light" ? "true" : "false");

    const directIcon = toggle.querySelector("svg");
    if (directIcon) {
      directIcon.innerHTML = iconMarkup;
    } else if (!toggle.children.length) {
      toggle.textContent = theme === "light" ? "☀️" : "🌙";
    }
  });

  [
    document.getElementById("theme-icon"),
    document.getElementById("theme-icon-footer"),
  ]
    .filter(Boolean)
    .forEach((icon) => {
      icon.innerHTML = iconMarkup;
    });
}

export function bindThemeToggle(toggle) {
  if (!toggle || toggle.dataset.themeBound === "1") return;
  toggle.dataset.themeBound = "1";
  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    toggleTheme();
  });
}

export function initThemeController() {
  applyTheme(resolveInitialTheme());

  document.addEventListener("DOMContentLoaded", () => {
    [
      document.getElementById("theme-toggle"),
      document.getElementById("theme-toggle-footer"),
    ]
      .filter(Boolean)
      .forEach(bindThemeToggle);

    syncThemeUi();
  });

  window.addEventListener("storage", (e) => {
    if (
      e.key === STORAGE_KEY &&
      (e.newValue === "light" || e.newValue === "dark")
    ) {
      applyTheme(e.newValue);
    }
  });

  window.matchMedia?.("(prefers-color-scheme: light)")?.addEventListener?.(
    "change",
    (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        applyTheme(e.matches ? "light" : "dark");
      }
    }
  );
}
