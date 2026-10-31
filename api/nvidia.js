export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const key = process.env.NVIDIA_API_KEY;
  if (!key) return res.status(500).json({ error: 'NVIDIA_API_KEY не задан в Vercel' });

  const b = req.body || {};
  if (!Array.isArray(b.messages)) return res.status(400).json({ error: 'bad request' });

  const body = {
    model: 'deepseek-ai/deepseek-v4.1-flash', // модель задаёт сервер, а не браузер
    messages: b.messages,
    tools: b.tools,
    max_tokens: Math.min(Number(b.max_tokens) || 2000, 8000),
  };

  try {
    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: 'не удалось связаться с NVIDIA' });
  }
}
