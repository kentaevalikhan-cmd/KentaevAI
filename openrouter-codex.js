/* Прокси для Codex → OpenRouter (бесплатные :free модели).
   Ключ берётся из переменной окружения OPENROUTER_CODEX_KEY (Vercel → Settings → Environment Variables).
   Файл называется openrouter-codex.js, чтобы не затереть твой существующий api/openrouter.js (Crystal). */

const ALLOWED = [
  'thinkingmachines/inkling-2-small:free',    // основная модель Codex
  'nvidia/nemotron-3-ultra-550b-a55b:free'    // запасная, если основная занята
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const key = process.env.OPENROUTER_CODEX_KEY;
  if (!key) return res.status(500).json({ error: 'no_key', detail: 'OPENROUTER_CODEX_KEY не задан на сервере' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = null; } }
  if (!b || typeof b !== 'object') return res.status(400).json({ error: 'bad_json' });

  /* Только свои модели, чтобы твой ключ нельзя было потратить на что-то другое */
  if (!ALLOWED.includes(b.model)) return res.status(400).json({ error: 'model_not_allowed' });
  if (!Array.isArray(b.messages) || !b.messages.length) return res.status(400).json({ error: 'no_messages' });

  const out = { model: b.model, messages: b.messages };
  if (Array.isArray(b.tools) && b.tools.length) out.tools = b.tools;
  out.max_tokens = Math.min(Number(b.max_tokens) || 4000, 8000);

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
        'X-Title': 'KentaevAI Codex'
      },
      body: JSON.stringify(out)
    });
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json');
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: 'upstream_failed', detail: String((e && e.message) || e) });
  }
};
