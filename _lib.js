/* api/_lib.js — общее для серверных функций: хранилище (Upstash / Vercel KV по REST), сессии, лимиты, пароли, TOTP.
   Переменные Vercel: KV_REST_API_URL + KV_REST_API_TOKEN (или UPSTASH_REDIS_REST_URL + _TOKEN) и ADMIN_EMAILS (через запятую). */
const crypto = require('crypto');
const COOKIE = '__Host-kai';
const DUMMY = '00'.repeat(16) + ':' + '00'.repeat(64);

async function kv(...cmd) {
  const base = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !tok) throw new Error('no_store');
  const r = await fetch(base, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const d = await r.json(); if (d.error) throw new Error(d.error); return d.result;
}
const norm = s => String(s || '').trim().toLowerCase().slice(0, 254);
const isAdmin = e => (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean).includes(e);
const getUser = async e => JSON.parse((await kv('GET', 'u:' + e)) || 'null');
const putUser = (e, u) => kv('SET', 'u:' + e, JSON.stringify(u));
const send = (res, c, o) => { res.setHeader('Cache-Control', 'no-store'); res.status(c).json(o); };
const ipOf = req => String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '?').split(',')[0].trim();
async function hit(key, sec) { const n = await kv('INCR', key); if (n === 1) await kv('EXPIRE', key, sec); return n; }

/* пароли: scrypt + соль */
const scrypt = (p, salt) => new Promise((ok, no) => crypto.scrypt(p, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => e ? no(e) : ok(k)));
async function hashPw(pw) { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + (await scrypt(pw, s)).toString('hex'); }
async function checkPw(pw, stored) {
  const [s, h] = String(stored || DUMMY).split(':'), k = await scrypt(pw, Buffer.from(s, 'hex')), hb = Buffer.from(h || '', 'hex');
  return hb.length === k.length && crypto.timingSafeEqual(k, hb);
}

/* TOTP (RFC 6238, SHA-1, 6 цифр, шаг 30 с) — для Google Authenticator, Authy и т.п. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; }
function b32dec(s) { let bits = ''; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); }
function hotp(key, step) {
  const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(m).digest(), o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
function totpStep(secret, code) { /* номер шага, если код верный (окно ±1), иначе -1 */
  if (!/^\d{6}$/.test(code)) return -1;
  const key = b32dec(secret), now = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) if (crypto.timingSafeEqual(Buffer.from(hotp(key, now + d)), Buffer.from(code))) return now + d;
  return -1;
}

/* сессии: случайный id в HttpOnly-cookie, данные на сервере (можно отозвать) */
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(/;\s*/).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
const cookie = (v, age) => COOKIE + '=' + v + '; Path=/; HttpOnly; Secure; SameSite=Strict' + (age != null ? '; Max-Age=' + age : '');
async function startSession(res, email, tfa, keep, v) {
  const id = crypto.randomBytes(32).toString('hex'), ttl = tfa ? 14400 : (keep ? 2592000 : 43200);
  await kv('SET', 's:' + id, JSON.stringify({ e: email, tfa: !!tfa, v: v || 0 }), 'EX', ttl);
  res.setHeader('Set-Cookie', cookie(id, keep || tfa ? ttl : null));
}
async function endSession(req, res) {
  const id = cookies(req)[COOKIE]; if (/^[a-f0-9]{64}$/.test(id || '')) await kv('DEL', 's:' + id);
  res.setHeader('Set-Cookie', cookie('', 0));
}
async function session(req) {
  const id = cookies(req)[COOKIE]; if (!/^[a-f0-9]{64}$/.test(id || '')) return null;
  const s = JSON.parse((await kv('GET', 's:' + id)) || 'null'); if (!s) return null;
  const u = await getUser(s.e); if (!u || u.banned || (u.v || 0) !== (s.v || 0)) return null;
  return { id, email: s.e, name: u.name, tfa: !!s.tfa, admin: !!s.tfa && isAdmin(s.e) };
}
function sameOrigin(req) { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch (_) { return false; } }

/* защита любой другой серверной функции: const s = await guard(req, res, 'chat', 30); if (!s) return; */
async function guard(req, res, bucket, max) {
  try {
    if (!sameOrigin(req)) { send(res, 403, { error: 'origin' }); return null; }
    const s = await session(req); if (!s) { send(res, 401, { error: 'auth' }); return null; }
    if ((await hit('rl:' + bucket + ':' + s.email, 60)) > (max || 30)) { send(res, 429, { error: 'rate_limited' }); return null; }
    return s;
  } catch (_) { send(res, 503, { error: 'unavailable' }); return null; }
}

module.exports = { kv, norm, isAdmin, getUser, putUser, send, ipOf, hit, hashPw, checkPw, DUMMY, b32enc, totpStep, hotp, b32dec,
  startSession, endSession, session, sameOrigin, guard };
