// assets/js/ui/dialog.js
export function promptReason({
  title = "Stornieren",
  message = "Grund (optional):",
  placeholder = "z. B. Kunde hat abgesagt …",
  okText = "OK",
  cancelText = "Abbrechen",
  // быстрый выбор причин (можно переопределить снаружи)
  reasons = [
    "Kunde hat abgesagt",
    "Nicht erreichbar",
    "Nicht erschienen (No-Show)",
    "Falsche Zeit/Adresse",
    "Doppelbuchung",
    "Krankentransport entfällt",
    "Sonstiges…",
  ],
} = {}) {
  return new Promise((resolve) => {
    // --- singleton guard
    const EXISTING = document.querySelector(
      '.modal-overlay[data-modal="promptReason"]'
    );
    if (EXISTING) {
      try {
        EXISTING.remove();
      } catch {}
    }

    // overlay + dialog
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.tabIndex = -1;
    overlay.dataset.modal = "promptReason";

    const dialog = document.createElement("div");
    dialog.className = "modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const hId = "dlg-title-" + Math.random().toString(36).slice(2);
    const dId = "dlg-desc-" + Math.random().toString(36).slice(2);
    dialog.setAttribute("aria-labelledby", hId);
    dialog.setAttribute("aria-describedby", dId);

    const reasonsHTML = reasons
      .map(
        (r, i) =>
          `<button class="reason-btn" type="button" data-reason="${r.replace(
            /"/g,
            "&quot;"
          )}">${r}</button>`
      )
      .join("");

    dialog.innerHTML = `
      <div class="modal__header">
        <h3 id="${hId}" class="modal__title">${title}</h3>
      </div>
      <div id="${dId}" class="modal__body">
        <div class="modal__desc">${message}</div>
        <div class="reasons">${reasonsHTML}</div>
        <!-- скрытый блок для «Sonstiges…» -->
        <div class="custom-reason" hidden>
          <textarea class="modal__textarea" rows="3" placeholder="${placeholder}"></textarea>
          <div class="custom-actions">
            <button class="btn btn--primary modal__ok" type="button">${okText}</button>
          </div>
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn btn--ghost modal__cancel" type="button">${cancelText}</button>
        <!-- Разрушительная кнопка здесь не нужна: подтверждение — по клику на причине -->
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // анимация появления
    requestAnimationFrame(() => {
      overlay.classList.add("is-open");
      dialog.classList.add("is-open");
    });

    // элементы
    const btnCancel = dialog.querySelector(".modal__cancel");
    const reasonsBox = dialog.querySelector(".reasons");
    const customWrap = dialog.querySelector(".custom-reason");
    const textarea = dialog.querySelector(".modal__textarea");
    const btnOk = dialog.querySelector(".modal__ok");

    // запомнить активный элемент
    const activeBefore = document.activeElement;

    // блокировка скролла
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";

    let closed = false;
    function close(retVal) {
      if (closed) return;
      closed = true;

      overlay.classList.remove("is-open");
      dialog.classList.remove("is-open");

      setTimeout(() => {
        overlay.removeEventListener("click", onOverlay);
        document.removeEventListener("keydown", onKey);
        try {
          document.body.removeChild(overlay);
        } catch {}
        html.style.overflow = prevOverflow || "";
        if (activeBefore?.focus) activeBefore.focus();
        resolve(retVal);
      }, 200);
    }

    function onOverlay(e) {
      if (e.target === overlay) close(null);
    }

    function onKey(e) {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        // Ctrl/Cmd+Enter подтверждает кастомную причину, если поле видно
        if (!customWrap.hasAttribute("hidden")) btnOk.click();
      }
      if (e.key === "Tab") {
        const focusables = dialog.querySelectorAll(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    // быстрый выбор причины
    reasonsBox.addEventListener("click", (e) => {
      const btn = e.target.closest(".reason-btn");
      if (!btn) return;
      const reason = btn.dataset.reason || "";
      if (reason === "Sonstiges…") {
        // показать поле «свой вариант»
        customWrap.hidden = false;
        textarea.focus();
        // визуально отметить выбор
        reasonsBox
          .querySelectorAll(".reason-btn")
          .forEach((b) => b.classList.toggle("is-active", b === btn));
        return;
      }
      // мгновенное подтверждение
      close(reason);
    });

    // кастомная причина — по OK или по Enter (Ctrl/Cmd+Enter уже в onKey)
    btnOk.addEventListener("click", () => {
      close(textarea.value.trim() || "Sonstiges");
    });

    btnCancel.addEventListener("click", () => close(null));
    overlay.addEventListener("click", onOverlay);
    document.addEventListener("keydown", onKey);

    // стартовый фокус: на первую кнопку причины
    setTimeout(() => {
      const firstBtn = reasonsBox.querySelector(".reason-btn");
      if (firstBtn) firstBtn.focus();
    }, 0);
  });
}
