// /api/gas.js — прокси к Google Apps Script Web App
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const configuredGasUrl = String(process.env.GAS_URL || "").trim();
  // Защита от старого нерабочего Library deployment в Vercel env.
  const GAS_URL = configuredGasUrl && !configuredGasUrl.includes("AKfycbxpGn11PT70usKYe0xE7S28FlwNIrJhXXEzaeK022VPZx7RObBEMvjq4ghpewnRyPGa")
    ? configuredGasUrl
    : "https://script.google.com/macros/s/AKfycbwS88JTgj1NVqhGAaMKi3MXxTawF9zA6mkG6avgxmIj8c61_20EjNZdY0_0U6kKor29/exec";
  const debug = String(req.query?.debug || '') === '1';

  try {
    if (req.method === 'GET') {
      const q = new URLSearchParams(req.query).toString();
      const r = await fetch(`${GAS_URL}?${q}`, { method: 'GET' });
      const txt = await r.text();
      if (debug) {
        return res.status(200).json({
          ok: true,
          debug: true,
          method: 'GET',
          gas_url_present: Boolean(GAS_URL),
          gas_url_prefix: GAS_URL ? GAS_URL.slice(0, 120) : '',
          upstream_url: `${GAS_URL}?${q}`,
          upstream_status: r.status,
          upstream_body: txt,
        });
      }
      try { return res.status(r.status).json(JSON.parse(txt)); }
      catch { return res.status(r.status).send(txt); }
    }

    if (req.method === 'POST') {
      const r = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {})
      });
      const txt = await r.text();
      if (debug) {
        return res.status(200).json({
          ok: true,
          debug: true,
          method: 'POST',
          gas_url_present: Boolean(GAS_URL),
          gas_url_prefix: GAS_URL ? GAS_URL.slice(0, 120) : '',
          upstream_url: GAS_URL,
          upstream_status: r.status,
          request_body: req.body || {},
          upstream_body: txt,
        });
      }
      try { return res.status(r.status).json(JSON.parse(txt)); }
      catch { return res.status(r.status).send(txt); }
    }

    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ ok:false, error:String(err) });
  }
}
