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
