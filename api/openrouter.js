// Положи в папку api/ репозитория: api/openrouter.js
// Ключ хранится только на сервере: Vercel -> Settings -> Environment Variables -> OPENROUTER_API_KEY
// Модель можно поменять переменной OPENROUTER_MODEL (по умолчанию openrouter/free: сам выбирает бесплатную модель)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY не задан в Vercel' });
  }

  let incoming = req.body || {};
  if (typeof incoming === 'string') {
    try { incoming = JSON.parse(incoming); } catch (_) { incoming = {}; }
  }

  const body = {
    model: process.env.OPENROUTER_MODEL || 'openrouter/free',
    messages: incoming.messages,
  };
  if (Array.isArray(incoming.tools) && incoming.tools.length) body.tools = incoming.tools;
  if (incoming.max_tokens) body.max_tokens = Math.min(Number(incoming.max_tokens) || 1000, 8000);

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
        'HTTP-Referer': 'https://kentaevai.vercel.app',
        'X-Title': 'KentaevAI',
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'upstream_failed', detail: String(e.message || e) });
  }
}
