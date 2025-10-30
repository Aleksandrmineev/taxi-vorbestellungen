// qr.js
(function (global) {
  // Константы получателя (используются только для EPC/QR)
  const RECEIVER = {
    name: "Michael Kleißner",
    iban: "AT622081500040934572",
    bic: "STSPAT2GXXX",
  };

  function buildEpcString(totalEUR, driverNo) {
    const two = (n) => Math.round(n * 100) / 100;
    const amountDot = two(totalEUR).toFixed(2);
    const vz = `Taxi Murtal - Fahrer ${driverNo || "00"}`;
    return [
      "BCD",
      "001",
      "1",
      "SCT",
      RECEIVER.bic,
      RECEIVER.name,
      RECEIVER.iban,
      "EUR" + amountDot,
      "",
      "",
      "", // purpose, reference (empty)
      vz,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ].join("\n");
  }

  function renderQR(qrBox, text) {
    if (!qrBox || !global.qrcode) return;
    const safe = text.replace(/–/g, "-");
    const qr = qrcode(0, "M");
    qr.addData(safe);
    qr.make();
    qrBox.innerHTML = "";
    qrBox.insertAdjacentHTML("afterbegin", qr.createImgTag(6, 16));
  }

  global.QrPay = { RECEIVER, buildEpcString, renderQR };
})(window);
