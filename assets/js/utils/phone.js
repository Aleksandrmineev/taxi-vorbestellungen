// Нормализация телефона для отображения и клика
// Правила: если начинается с "+", оставляем как есть.
// Если начинается с "0", заменяем на +43 (без ведущего нуля).
// Иначе: если начинается с "43" — добавляем "+", иначе просто добавим "+" к цифрам.
export function normalizePhoneDisplay(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = s.replace(/\s+/g, "").replace(/[^\d+]/g, ""); // оставим + и цифры

  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return "+43" + digits.slice(1);
  if (digits.startsWith("43")) return "+" + digits;
  // иначе: добавим плюс перед цифрами
  const onlyDigits = digits.replace(/\D+/g, "");
  return onlyDigits ? "+" + onlyDigits : "";
}

export function telHref(raw) {
  const disp = normalizePhoneDisplay(raw);
  const tel = disp.replace(/\s+/g, ""); // без пробелов в href
  return { display: disp, href: `tel:${tel}` };
}
