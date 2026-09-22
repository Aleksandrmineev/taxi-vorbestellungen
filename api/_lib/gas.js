// Вызовы Google Apps Script с сервера (Vercel -> GAS).
const API_SECRET = "102030"; // тот же общий секрет, что в GAS (code.gs) и на клиентах

export function gasUrl() {
  const configured = String(process.env.GAS_URL || "").trim();
  // Защита от старого нерабочего Library deployment в Vercel env (как в api/gas.js).
  return configured && !configured.includes("AKfycbxpGn11PT70usKYe0xE7S28FlwNIrJhXXEzaeK022VPZx7RObBEMvjq4ghpewnRyPGa")
    ? configured
    : "https://script.google.com/macros/s/AKfycbwS88JTgj1NVqhGAaMKi3MXxTawF9zA6mkG6avgxmIj8c61_20EjNZdY0_0U6kKor29/exec";
}

export async function gasPost(body, { timeoutMs = 25000 } = {}) {
  const response = await fetch(gasUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, secret: API_SECRET }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("gas_invalid_response"); }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `gas_http_${response.status}`);
    error.business = Boolean(data.error); // GAS ответил осмысленной ошибкой (не сбой сети/сервера)
    throw error;
  }
  return data;
}

// Доверенный вызов: GAS принимает driverJson только вместе с SYNC_SECRET.
export function trustedFields(driver) {
  const serverKey = String(process.env.SYNC_SECRET || "");
  if (!serverKey) throw new Error("sync_not_configured");
  return { serverKey, driverJson: JSON.stringify(driver) };
}

// Server-Schlüssel für vertrauenswürdige GAS-Aufrufe (Bestellungen): nur der Wert von SYNC_SECRET.
export function serverKey() {
  const key = String(process.env.SYNC_SECRET || "");
  if (!key) throw new Error("sync_not_configured");
  return key;
}
