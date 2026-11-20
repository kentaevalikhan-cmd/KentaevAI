// Vercel serverless proxy: KentaevAI -> APInex (Anthropic-compatible API).
// The key lives only in the Vercel env var APINEX_KEY. It is never put in index.html.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Only accept calls from the app's own site, so strangers can't spend your balance from other pages.
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (_) {}
    if (host !== req.headers.host) return res.status(403).json({ error: 'forbidden' });
  }

  const key = process.env.APINEX_KEY;
  if (!key) return res.status(500).json({ error: 'no_key' });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (!Array.isArray(b.messages) || !b.messages.length) {
    return res.status(400).json({ error: 'bad_request' });
  }

  // The model is fixed on the server; the client cannot choose it.
  const payload = {
    model: process.env.APINEX_MODEL || 'claude-opus-5.5',
    max_tokens: Math.min(Number(b.max_tokens) || 4096, 8000),
    messages: b.messages,
  };
  if (typeof b.system === 'string') payload.system = b.system;
  if (Array.isArray(b.tools) && b.tools.length) payload.tools = b.tools;

  try {
    const r = await fetch('https://api.apinex.bond/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unreachable' });
  }
};
