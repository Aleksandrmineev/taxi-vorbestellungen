// assets/js/ui/dialog.js
export function promptReason({
  title = "Stornieren",
  message = "Grund (optional):",
  placeholder = "z. B. Kunde hat abgesagt …",
  okText = "OK",
  cancelText = "Abbrechen",
} = {}) {
  return new Promise((resolve) => {
    // overlay + dialog
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay"; // стилизуй в CSS
    overlay.tabIndex = -1;

    const dialog = document.createElement("div");
    dialog.className = "modal"; // стилизуй в CSS
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const hId = "dlg-title-" + Math.random().toString(36).slice(2);
    const dId = "dlg-desc-" + Math.random().toString(36).slice(2);
    dialog.setAttribute("aria-labelledby", hId);
    dialog.setAttribute("aria-describedby", dId);

    dialog.innerHTML = `
        <div class="modal__header">
          <h3 id="${hId}" class="modal__title">${title}</h3>
        </div>
        <div id="${dId}" class="modal__body">
          <label class="label">${message}</label>
          <textarea class="modal__textarea" rows="3" placeholder="${placeholder}"></textarea>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost modal__cancel" type="button">${cancelText}</button>
          <button class="btn btn--primary modal__ok" type="button">${okText}</button>
        </div>
      `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // элементы
    const textarea = dialog.querySelector(".modal__textarea");
    const btnOk = dialog.querySelector(".modal__ok");
    const btnCancel = dialog.querySelector(".modal__cancel");

    // запомнить активный элемент, чтобы вернуть фокус
    const activeBefore = document.activeElement;

    // обработчики
    function close(retVal) {
      overlay.removeEventListener("click", onOverlay);
      document.removeEventListener("keydown", onKey);
      document.body.removeChild(overlay);
      if (activeBefore?.focus) activeBefore.focus();
      resolve(retVal);
    }
    function onOverlay(e) {
      if (e.target === overlay) close(null); // клик по фону => отмена
    }
    function onKey(e) {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        // Ctrl/Cmd+Enter — быстрый OK
        btnOk.click();
      }
      if (e.key === "Tab") {
        // примитивный фокус-трап
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

    btnCancel.addEventListener("click", () => close(null));
    btnOk.addEventListener("click", () => {
      // поле необязательное: можно вернуть пустую строку
      close(textarea.value || "");
    });
    overlay.addEventListener("click", onOverlay);
    document.addEventListener("keydown", onKey);

    // стартовый фокус
    setTimeout(() => textarea.focus(), 0);
  });
}
