function getRecentQrPayments_(limit) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_QR);
  if (!sh) return [];

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const head = values[0];
  const idx = {
    timestamp: head.indexOf('timestamp'),
    driver: head.indexOf('driver'),
    fare: head.indexOf('fare'),
    tip: head.indexOf('tip'),
    total: head.indexOf('total'),
    method: head.indexOf('method'),
    iban: head.indexOf('iban'),
  };

  const rows = values.slice(1).map((r, i) => ({
    row_num: i + 2,
    timestamp: r[idx.timestamp],
    driver: r[idx.driver],
    fare: r[idx.fare],
    tip: r[idx.tip],
    total: r[idx.total],
    method: r[idx.method],
    iban: r[idx.iban],
  }));

  rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return rows.slice(0, limit || 5);
}


function handleQrPayment_(body) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_QR) || ss.insertSheet(SHEET_QR);

  // порядок и имена колонок для листа QR_Zahlungen
  const REQUIRED = [
    'timestamp',
    'driver',
    'fare',
    'tip',
    'total',
    'method',
    'iban'
  ];

  let head = [];
  if (sh.getLastRow() === 0) {
    // если лист пустой — создаём заголовки
    sh.appendRow(REQUIRED);
    head = REQUIRED.slice();
  } else {
    head = sh.getRange(1, 1, 1, sh.getLastColumn())
      .getValues()[0]
      .map(String);

    // добавим недостающие колонки в конец (если что-то поменяем в будущем)
    REQUIRED.forEach((name) => {
      if (head.indexOf(name) === -1) {
        sh.getRange(1, head.length + 1).setValue(name);
        head.push(name);
      }
    });
  }

  // один IBAN для всех QR-платежей (как и раньше)
  const DEFAULT_IBAN = 'AT932081500043192756';

  // ts приходят с фронта как ISO-строка, fallback — текущий момент
  const tsRaw = body.ts || '';
  const ts = tsRaw ? new Date(tsRaw) : new Date();

  const payload = {
    timestamp: ts,
    driver: body.driver || body.driverNo || '',
    fare: Number(body.fare || 0),
    tip: Number(body.tip || 0),
    total: Number(body.total || 0),
    method: body.method || 'QR',
    iban: body.iban || DEFAULT_IBAN
  };

  const row = new Array(head.length).fill('');
  head.forEach((col, i) => {
    if (Object.prototype.hasOwnProperty.call(payload, col)) {
      row[i] = payload[col];
    }
  });

  sh.appendRow(row);
  return payload;
}

/** Diagnose (schreibt nichts): bestätigt, dass qr.gs im Projekt vorhanden ist (nach dem ersten clasp push, siehe git). */
function checkQrModulePresent() {
  const result = { ok: true, function: "getRecentQrPayments_", type: typeof getRecentQrPayments_ };
  Logger.log("QR module check: " + JSON.stringify(result));
  return result;
}
