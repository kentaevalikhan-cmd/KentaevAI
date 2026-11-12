// Положи этот файл в папку api/ репозитория: api/crystal.js
// Ключ хранится только на сервере: Vercel -> Settings -> Environment Variables -> OPENAI_API_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'OPENAI_API_KEY не задан в Vercel' });
  }

  const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

  // Берём только нужные поля, модель задаём на сервере
  const body = {
    model: 'gpt-4o-mini',
    messages: incoming.messages,
  };
  if (Array.isArray(incoming.tools) && incoming.tools.length) body.tools = incoming.tools;
  if (incoming.max_tokens) body.max_tokens = Math.min(Number(incoming.max_tokens) || 1000, 8000);

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'upstream_failed', detail: String(e.message || e) });
  }
}
