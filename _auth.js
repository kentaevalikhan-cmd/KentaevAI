'use strict';
// Серверная защита. Файлы с "_" в api/ Vercel НЕ публикует как маршруты.
const crypto = require('crypto');

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET не задан (нужно 32+ символов)');
  return s;
};
const sign = d => crypto.createHmac('sha256', secret()).update(d).digest('base64url');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Подписанный токен: base64url({p:назначение,e:срок}).подпись
function makeToken(purpose, ttlSec) {
  const body = Buffer.from(JSON.stringify({ p: purpose, e: Date.now() + ttlSec * 1000 })).toString('base64url');
  return body + '.' + sign(body);
}
function readToken(tok, purpose) {
  if (typeof tok !== 'string') return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig || !safeEq(sig, sign(body))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString());
    return d.p === purpose && d.e > Date.now() ? d : null;
  } catch { return null; }
}

// Пароль: scrypt$N$соль$хеш (хранится только в переменной окружения)
function hashPassword(pw, N = 32768) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pw), salt, 32, { N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return ['scrypt', N, salt.toString('base64'), dk.toString('base64')].join('$');
}
function verifyPassword(pw, stored) {
  const [alg, N, salt, hash] = String(stored || 'scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$x').split('$');
  if (alg !== 'scrypt') return false;
  const dk = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), 32, { N: +N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return !!stored && safeEq(dk.toString('base64'), hash);
}

// TOTP (RFC 6238): Google Authenticator, Authy, 1Password и т.п.
function b32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of String(s).replace(/=+$/, '').toUpperCase()) { const v = A.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }
  const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function newTotpSecret() {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return Array.from(crypto.randomBytes(20), b => A[b % 32]).join('');
}
function hotp(key, counter) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(b).digest(), o = h[19] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
let lastStep = 0; // один код — один раз (защита от повторного использования)
function verifyTotp(sec, code, now = Date.now()) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code) || !sec) return false;
  const key = b32(sec), c = Math.floor(now / 30000); let hit = 0;
  for (const d of [-1, 0, 1]) if (safeEq(hotp(key, c + d), code)) hit = c + d;
  if (!hit || hit <= lastStep) return false;
  lastStep = hit; return true;
}

// Ограничение попыток. Память инстанса: на serverless это лишь частичная защита.
const hits = new Map();
const ip = req => String(req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '?').trim();
function limited(req, key, max = 5, ms = 15 * 60 * 1000) {
  const k = key + ':' + ip(req), now = Date.now(), h = hits.get(k);
  return !!h && h.t > now && h.n >= max;
}
function fail(req, key, max = 5, ms = 15 * 60 * 1000) {
  const k = key + ':' + ip(req), now = Date.now(); let h = hits.get(k);
  if (!h || h.t <= now) h = { n: 0, t: now + ms };
  h.n++; hits.set(k, h);
  if (hits.size > 5000) for (const [a, v] of hits) if (v.t <= now) hits.delete(a);
}

const COOKIE = '__Host-kai_admin';
const cookie = (req, n) => (req.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(p => p[0] === n)?.[1];
const setSession = (res, ttl = 3600) =>
  res.setHeader('Set-Cookie', `${COOKIE}=${makeToken('admin', ttl)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl}`);
const clearSession = res => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
const isAdmin = req => !!readToken(cookie(req, COOKIE), 'admin');
// Для любых закрытых эндпоинтов: if (!requireAdmin(req, res)) return;
function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"unauthorized"}'); return false;
}
// Защита от CSRF: запрос должен идти с нашего же домена
const sameOrigin = req => { try { return new URL(req.headers.origin || '').host === req.headers.host; } catch { return false; } };

module.exports = { makeToken, readToken, hashPassword, verifyPassword, newTotpSecret, verifyTotp, limited, fail,
  setSession, clearSession, isAdmin, requireAdmin, sameOrigin, safeEq };
