// Универсальный парсер "сообщение → кандидат заказа".
// Возвращает: { is_order: boolean, order?: { date, time, type, phone, message, duration_min? } }

const DE_MONTHS = {
  januar: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  märz: 3,
  maerz: 3,
  mrz: 3,
  mär: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISO(y, m, d) {
  const Y = Number(y),
    M = Number(m),
    D = Number(d);
  if (!Y || !M || !D) return "";
  return `${Y}-${pad2(M)}-${pad2(D)}`;
}

function inferYear(yy) {
  const n = Number(yy);
  if (String(yy).length === 2) return 2000 + n;
  return n;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysISO(baseISO, days) {
  const [Y, M, D] = baseISO.split("-").map(Number);
  const d = new Date(Y, M - 1, D);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Находит дату в raw. Возвращает { iso, span:[a,b] } или null. */
function findDate(raw) {
  const s = raw.toLowerCase(); // без добавочных пробелов → индексы совпадают с raw

  // 1) ключевые слова
  {
    const m = /\bheute\b/i.exec(s);
    if (m) return { iso: todayISO(), span: [m.index, m.index + m[0].length] };
  }
  {
    const m = /\bmorgen\b/i.exec(s);
    if (m)
      return {
        iso: addDaysISO(todayISO(), 1),
        span: [m.index, m.index + m[0].length],
      };
  }
  {
    const m = /\büberg?morgen\b/i.exec(s);
    if (m)
      return {
        iso: addDaysISO(todayISO(), 2),
        span: [m.index, m.index + m[0].length],
      };
  }

  // 2) yyyy-mm-dd
  {
    const r = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/i;
    const m = r.exec(s);
    if (m)
      return {
        iso: toISO(m[1], m[2], m[3]),
        span: [m.index, m.index + m[0].length],
      };
  }

  // 3) dd.mm[.yy(yy)]
  {
    const r = /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?\b/i;
    const m = r.exec(s);
    if (m) {
      const d = m[1],
        mo = m[2],
        y = m[3] ? inferYear(m[3]) : new Date().getFullYear();
      return { iso: toISO(y, mo, d), span: [m.index, m.index + m[0].length] };
    }
  }

  // 4) d [. ] monatname (27 oktober / 27. okt)
  {
    const r =
      /\b(\d{1,2})[\. ]+(januar|jan|februar|feb|märz|maerz|mrz|mär|april|apr|mai|juni|jun|juli|jul|august|aug|september|sep|sept|oktober|okt|november|nov|dezember|dez)\b/i;
    const m = r.exec(s);
    if (m) {
      const d = Number(m[1]);
      const mo = DE_MONTHS[m[2].toLowerCase()];
      const y = new Date().getFullYear();
      return { iso: toISO(y, mo, d), span: [m.index, m.index + m[0].length] };
    }
  }

  return null;
}

function normTime(h, min) {
  return `${pad2(h)}:${pad2(min || 0)}`;
}

/** Ищем время. stripRanges — массив [a,b] отрезков, которые нужно замаскировать (дата). */
function findTime(raw, stripRanges = []) {
  let s = raw;

  // замещаем найденные участки пробелами — длина не меняется
  for (const [a, b] of stripRanges) {
    s = s.slice(0, a) + " ".repeat(Math.max(0, b - a)) + s.slice(b);
  }
  const low = s.toLowerCase();

  // 1) явный HH:MM
  {
    const m = /(^|[^\d])(\d{1,2}):(\d{2})($|[^\d])/i.exec(low);
    if (m) return { time: normTime(m[2], m[3]) };
  }

  // 2) "um 4 uhr" / "um 4:15 uhr" / "um 4"
  {
    const m = /\bum\s+(\d{1,2})(?::(\d{2}))?\s*(uhr)?\b/i.exec(low);
    if (m) return { time: normTime(m[1], m[2]) };
  }

  // 3) просто "4 uhr" / "4:15 uhr"
  {
    const r = /\b(\d{1,2})(?::(\d{2}))\s*uhr\b|\b(\d{1,2})\s*uhr\b/i;
    const m = r.exec(low);
    if (m) {
      const h = m[1] || m[3];
      const mi = m[2] || 0;
      return { time: normTime(h, mi) };
    }
  }

  // точка как разделитель времени не используем — чтобы "27.10" не стало "27:10"
  return null;
}

function extractPhone(raw) {
  const m = raw.match(/(\+?\d[\d\s()+-]{7,})/);
  return m ? m[1].replace(/\s+/g, "") : "";
}

function detectType(raw) {
  const s = String(raw || "").toLowerCase();

  // 1) Krankentransport
  if (/\b(kt|krankentransport|krankenfahrt)\b/.test(s)) return "KT";

  // 2) Rechnungsfahrt (избегаем "Abrechnung")
  const hasAbrechnung = /\babrechnung/.test(s);
  const isRechnungsfahrt =
    /\brechnungsfahrt\b/.test(s) ||
    /\bauf\s+rechnung\b/.test(s) ||
    (/\brechnung(s)?\b/.test(s) && /\bfahrt(en)?\b/.test(s)) || // "Rechnung Fahrt"
    /\brf\b/.test(s); // опционально: короткая аббревиатура

  if (!hasAbrechnung && isRechnungsfahrt) return "RE";

  // 3) По умолчанию
  return "Orts";
}

export function parseOrderCandidate(text) {
  const raw = String(text || "");
  if (!raw.trim()) return { is_order: false };

  // 1) дата
  const d = findDate(raw);
  const strip = [];
  let dateISO = "";
  if (d) {
    dateISO = d.iso;
    strip.push(d.span);
  }

  // 2) время
  const t = findTime(raw, strip);
  let timeHM = t ? t.time : "";

  // 3) бизнес-правило "что считаем заказом"
  let isOrder = false;
  if (dateISO) isOrder = true;
  if (!isOrder && timeHM) {
    dateISO = todayISO();
    isOrder = true;
  }
  if (!isOrder) return { is_order: false };

  // 4) дефолты и нормализация
  if (!timeHM) timeHM = "00:00";

  const phone = extractPhone(raw);
  const type = detectType(raw);

  // 5) чистим сообщение от даты/времени/телефона
  let message = raw;

  // — вырезаем точно найденный участок даты
  if (d) {
    const [a, b] = d.span;
    message = message.slice(0, a) + " " + message.slice(b);
  }

  // — вырезаем конструкции времени (оба варианта: "um 4 uhr" и "HH:MM")
  message = message.replace(/\bum\s+\d{1,2}(?::\d{2})?\s*(uhr)?\b/gi, " ");
  message = message.replace(/\b\d{1,2}:\d{2}\b/g, " ");

  // — ключевые слова, если именно они дали дату
  message = message.replace(/\bheute\b/gi, " ");
  message = message.replace(/\bmorgen\b/gi, " ");
  message = message.replace(/\büberg?morgen\b/gi, " ");

  // — dd.mm(.yy) и названия месяцев (на случай дублей в тексте)
  message = message.replace(/\b\d{1,2}\.\d{1,2}(?:\.(\d{2}|\d{4}))?\b/gi, " ");
  message = message.replace(
    /\b(\d{1,2})[\. ]+(januar|jan|februar|feb|märz|maerz|mrz|mär|april|apr|mai|juni|jun|juli|jul|august|aug|september|sep|sept|oktober|okt|november|nov|dezember|dez)\b/gi,
    " "
  );

  // — телефон
  if (phone) message = message.replace(phone, " ");

  // — финальная зачистка
  message = message.replace(/\s+/g, " ").trim();

  return {
    is_order: true,
    order: {
      date: dateISO,
      time: timeHM,
      type,
      phone,
      message,
    },
  };
}
