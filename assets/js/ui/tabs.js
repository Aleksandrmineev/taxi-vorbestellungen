// assets/js/ui/tabs.js
export function initMobileTabs() {
  const tabbar = document.querySelector(".tabs-mobile");
  if (!tabbar) return;

  const btns = Array.from(tabbar.querySelectorAll(".tabs-btn"));
  const panels = {
    "#panel-aside": document.querySelector("#panel-aside"),
    "#panel-main": document.querySelector("#panel-main"),
  };

  // Изначально активируем aside
  panels["#panel-aside"]?.classList.add("is-active");

  function activate(targetSel) {
    // кнопки
    btns.forEach((b) => {
      const active = b.dataset.target === targetSel;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
      if (active) b.focus({ preventScroll: true });
    });
    // панели
    Object.values(panels).forEach((p) => p?.classList.remove("is-active"));
    panels[targetSel]?.classList.add("is-active");
  }

  tabbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".tabs-btn");
    if (!btn) return;
    activate(btn.dataset.target);
  });

  // Клавиатура (стрелки влево/вправо)
  tabbar.addEventListener("keydown", (e) => {
    const idx = btns.indexOf(document.activeElement);
    if (idx === -1) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = (idx + dir + btns.length) % btns.length;
      const btn = btns[next];
      btn.focus();
      activate(btn.dataset.target);
    }
  });
}

// assets/js/ui/tabs.js
// Инициализация внутренних табов в <main class="main-tabs">…
// Позволяет передать коллбеки для ленивой подзагрузки данных.
export function initMainTabs({
  onSearchShown,
  onNextShown,
  onDateShown,
  storageKey = "mt_main_tab",
  defaultPanelId = "panel-next", // ← по умолчанию теперь panel-next
} = {}) {
  const root = document.querySelector(".main-tabs");
  if (!root) return;

  const tabButtons = root.querySelectorAll('.subtabs [role="tab"]');
  const panels = root.querySelectorAll('[role="tabpanel"]');

  const hasPanel = (id) => !!root.querySelector("#" + id);
  const saved = localStorage.getItem(storageKey);
  const initial = saved && hasPanel(saved) ? saved : defaultPanelId;

  function activate(panelId) {
    // панельки
    panels.forEach((p) => p.toggleAttribute("hidden", p.id !== panelId));
    // кнопки
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.target === panelId;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    localStorage.setItem(storageKey, panelId);

    // ленивые подгрузки
    if (panelId === "panel-next" && typeof onNextShown === "function")
      onNextShown();
    if (panelId === "panel-date" && typeof onDateShown === "function")
      onDateShown();
    if (panelId === "panel-search" && typeof onSearchShown === "function")
      onSearchShown();
  }

  // старт
  activate(initial);

  // клики по табам
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      if (target) activate(target);
    });

    // клавиатура: влево/вправо
    btn.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      const arr = Array.from(tabButtons);
      const i = arr.indexOf(btn);
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = (i + dir + arr.length) % arr.length;
      arr[next].focus();
      arr[next].click();
    });
  });
}
