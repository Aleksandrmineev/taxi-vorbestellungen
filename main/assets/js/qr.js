(function (global) {
  const RECEIVER = {
    name: "Michael Kleißner",
    iban: "AT932081500043192756",
    bic: "STSPAT2GXXX",
  };

  // Базовая EPC-нормализация: ASCII, без uppercase
  function epcSanitizeLower(str) {
    if (!str) return "";
    return String(str)
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/Ä/g, "Ae")
      .replace(/Ö/g, "Oe")
      .replace(/Ü/g, "Ue")
      .replace(/ß/g, "ss")
      .replace(/[^\x20-\x7E]/g, ""); // убрать не-ASCII
  }

  // Но имя Sparkasse предпочитает в UPPERCASE — и так надёжнее
  function epcSanitizeUpper(str) {
    return epcSanitizeLower(str).toUpperCase();
  }

  function buildEpcString(totalEUR, driverNo) {
    const two = (n) => Math.round(n * 100) / 100;
    const amountDot = two(totalEUR).toFixed(2);

    const vzRaw = `Taxi Murtal - Fahrer ${driverNo || "00"}`;

    const name = epcSanitizeUpper(RECEIVER.name); // имя — UPPER
    const vz = epcSanitizeLower(vzRaw); // VZ — lower-case

    return [
      "BCD",
      "001",
      "1",
      "SCT",
      RECEIVER.bic,
      name,
      RECEIVER.iban,
      "EUR" + amountDot,
      "",
      "",
      vz, // <-- lower-case ASCII VZ
    ].join("\n");
  }

  function renderQR(qrBox, text) {
    if (!qrBox || !global.qrcode) return;
    const safe = text.replace(/–/g, "-"); // на случай, если где-то попадёт
    const qr = qrcode(0, "M");
    qr.addData(safe);
    qr.make();
    qrBox.innerHTML = "";
    qrBox.insertAdjacentHTML("afterbegin", qr.createImgTag(6, 16));
  }

  global.QrPay = { RECEIVER, buildEpcString, renderQR };
})(window);
