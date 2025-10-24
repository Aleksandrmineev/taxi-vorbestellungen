// Простой утилитарный модуль для показа всплывающих сообщений (5с по умолчанию)
export function showToast(message, { ms = 5000, variant = "" } = {}) {
  const el = document.getElementById("out");
  if (!el) return;

  // вариант оформления (ok / err)
  el.classList.remove("toast--ok", "toast--err");
  if (variant) el.classList.add(`toast--${variant}`);

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove("show");
  }, ms);
}

export function hideToast() {
  const el = document.getElementById("out");
  if (!el) return;
  el.classList.remove("show");
  clearTimeout(el._timer);
}

// (необязательно) сделаем глобальный доступ, если захочешь вызывать прямо из консоли
window.Toast = { show: showToast, hide: hideToast };
