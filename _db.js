'use strict';
// Upstash Redis по REST (Vercel -> Storage -> Upstash Redis). Переменные добавляются автоматически.
const url = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const tok = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
exports.enabled = () => !!(url() && tok());
exports.cmd = async (...a) => {
  const r = await fetch(url(), { method: 'POST', headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: JSON.stringify(a.map(String)) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'db ' + r.status);
  return j.result;
};
