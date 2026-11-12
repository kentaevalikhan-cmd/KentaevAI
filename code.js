// Прокси для режима Code (отдельный ИИ через OpenRouter).
// Ключ берётся ТОЛЬКО из переменной окружения OPENROUTER_CODE_KEY (Vercel → Settings → Environment Variables).
export const config = { maxDuration: 60 };

const URL_OR = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.OPENROUTER_CODE_MODEL || 'qwen/qwen3-coder';
const MAX_TOKENS = 8000;

// защита от спама (в пределах одного инстанса)
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 30;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  const key = process.env.OPENROUTER_CODE_KEY;
  if (!key) return res.status(500).json({ error: { message: 'OPENROUTER_CODE_KEY не задан в Vercel' } });

  // принимаем запросы только с нашего же сайта
  const host = req.headers.host || '';
  const from = req.headers.origin || req.headers.referer || '';
  if (from && !from.includes(host)) return res.status(403).json({ error: { message: 'Forbidden' } });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: { message: 'Слишком много запросов, подожди минуту' } });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (!Array.isArray(b.messages) || !b.messages.length) {
    return res.status(400).json({ error: { message: 'messages обязателен' } });
  }

  // модель и лимиты выбирает сервер, а не браузер
  const body = {
    model: MODEL,
    messages: b.messages,
    max_tokens: Math.min(Number(b.max_tokens) || 4000, MAX_TOKENS),
  };
  if (Array.isArray(b.tools) && b.tools.length) body.tools = b.tools;

  try {
    const r = await fetch(URL_OR, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://' + host,
        'X-Title': 'KentaevAI Code',
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: { message: 'OpenRouter недоступен: ' + (e.message || e) } });
  }
}
