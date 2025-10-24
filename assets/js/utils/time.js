export const pad2 = (n) => String(n).padStart(2, "0");
export const todayISO = () => new Date().toISOString().slice(0, 10);

export function buildTimeOptionsHTML() {
  let html = "";
  for (let h = 0; h < 24; h++)
    for (let m = 0; m < 60; m += 5)
      html += `<option value="${pad2(h)}:${pad2(m)}"></option>`;
  return html;
}

// Мягкая нормализация времени в HH:MM (любые минуты допустимы)
export function normalizeTimeLoose(s) {
  s = String(s || "").trim();
  if (!s) return "";
  const mColon = s.match(/^(\d{1,2})\D+(\d{1,2})$/);
  if (mColon) {
    let h = Math.max(0, Math.min(23, parseInt(mColon[1], 10) || 0));
    let m = Math.max(0, Math.min(59, parseInt(mColon[2], 10) || 0));
    return `${pad2(h)}:${pad2(m)}`;
  }
  const digits = s.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length <= 2)
    return `${pad2(Math.max(0, Math.min(23, parseInt(digits, 10) || 0)))}:00`;
  if (digits.length === 3) {
    const h = Math.max(0, Math.min(23, parseInt(digits.slice(0, 1), 10) || 0));
    const m = Math.max(0, Math.min(59, parseInt(digits.slice(1), 10) || 0));
    return `${pad2(h)}:${pad2(m)}`;
  }
  const h = Math.max(0, Math.min(23, parseInt(digits.slice(0, -2), 10) || 0));
  const m = Math.max(0, Math.min(59, parseInt(digits.slice(-2), 10) || 0));
  return `${pad2(h)}:${pad2(m)}`;
}

export const hhmmFromISO = (iso) => {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// Дата в формате DD.MM.YYYY из 'YYYY-MM-DD'
export function formatDateHuman(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${pad2(d)}.${pad2(m)}.${y}`;
}

// Дата в формате DD.MM.YYYY из ISO datetime
export function formatDateFromISO(iso) {
  const d = new Date(iso);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function dateForRepeat(startIso) {
  const now = new Date();
  const st = new Date(startIso);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const stMin = st.getHours() * 60 + st.getMinutes();
  return stMin <= nowMin
    ? new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10)
    : todayISO();
}
