/* /api/auth — регистрация, вход, сброс пароля и админка (вход админа только с кодом из приложения-аутентификатора).
   Админ = email из ADMIN_EMAILS. Все ответы — JSON, все запросы — POST с application/json. */
const crypto = require('crypto');
const L = require('./_lib');
const MAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,}$/, PW = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;
const clean = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim();
const recCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; crypto.randomBytes(12).forEach((b, i) => { s += A[b % A.length]; if (i % 4 === 3 && i < 11) s += '-'; }); return s; };
const locked = async (e, ip) => Number(await L.kv('GET', 'lf:e:' + e) || 0) >= 5 || Number(await L.kv('GET', 'lf:i:' + ip) || 0) >= 25;
const fail = async (e, ip) => { await L.hit('lf:e:' + e, 900); await L.hit('lf:i:' + ip, 900); };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return L.send(res, 405, { error: 'method' });
  if (!L.sameOrigin(req) || !/application\/json/i.test(req.headers['content-type'] || '')) return L.send(res, 403, { error: 'origin' });
  const b = req.body && typeof req.body === 'object' ? req.body : {}, a = String(b.action || ''), ip = L.ipOf(req);
  const out = (c, o) => L.send(res, c, o);
  try {
    if (a === 'register') {
      if ((await L.hit('rg:' + ip, 3600)) > 5) return out(429, { error: 'locked' });
      const e = L.norm(b.email), name = clean(b.name), pw = String(b.password || '');
      if (!MAIL.test(e)) return out(400, { error: 'mail' });
      if (name.length < 2 || name.length > 40) return out(400, { error: 'name' });
      if (!PW.test(pw)) return out(400, { error: 'pass' });
      const rc = recCode(), u = { name, pw: await L.hashPw(pw), rc: await L.hashPw(rc.replace(/-/g, '')), t: Date.now(), v: 0 };
      if (!(await L.kv('SET', 'u:' + e, JSON.stringify(u), 'NX'))) return out(409, { error: 'exists' });
      await L.kv('SADD', 'users', e); await L.startSession(res, e, false, true, 0);
      return out(200, { user: { email: e, name }, recovery: rc });
    }
    if (a === 'login') {
      const e = L.norm(b.email); if (await locked(e, ip)) return out(429, { error: 'locked' });
      const u = MAIL.test(e) ? await L.getUser(e) : null;
      const ok = await L.checkPw(String(b.password || '').slice(0, 128), u && u.pw);
      if (!u || !ok || u.banned) { await fail(e, ip); return out(401, { error: 'bad' }); }
      await L.kv('DEL', 'lf:e:' + e); await L.startSession(res, e, false, !!b.keep, u.v);
      return out(200, { user: { email: e, name: u.name } });
    }
    if (a === 'reset') {
      const e = L.norm(b.email); if (await locked(e, ip)) return out(429, { error: 'locked' });
      const pw = String(b.password || ''), cd = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      if (!PW.test(pw)) return out(400, { error: 'newpass' });
      const u = MAIL.test(e) ? await L.getUser(e) : null;
      if (!(await L.checkPw(cd, u && u.rc)) || !u) { await fail(e, ip); return out(401, { error: 'code' }); }
      u.pw = await L.hashPw(pw); u.v = (u.v || 0) + 1; await L.putUser(e, u); await L.kv('DEL', 'lf:e:' + e);
      return out(200, { ok: true });
    }
    if (a === 'admin_login') {
      const e = L.norm(b.email); if (await locked(e, ip)) return out(429, { error: 'locked' });
      const u = L.isAdmin(e) ? await L.getUser(e) : null, code = String(b.code || '').replace(/\s/g, '');
      const ok = await L.checkPw(String(b.password || '').slice(0, 128), u && u.pw);
      if (!u || !ok || u.banned) { await fail(e, ip); return out(401, { error: 'bad' }); }
      if (!u.totp) { /* первый вход: привязка приложения-аутентификатора */
        if (!u.pend) { u.pend = L.b32enc(crypto.randomBytes(20)); await L.putUser(e, u); }
        if (!code) return out(200, { setup: { secret: u.pend, uri: 'otpauth://totp/KentaevAI:' + encodeURIComponent(e) + '?secret=' + u.pend + '&issuer=KentaevAI' } });
        const s0 = L.totpStep(u.pend, code);
        if (s0 < 0) { await fail(e, ip); return out(401, { error: 'code' }); }
        await L.kv('SET', 't:' + e + ':' + s0, '1', 'NX', 'EX', 120);
        u.totp = u.pend; delete u.pend; await L.putUser(e, u);
      } else {
        if (!code) return out(200, { need: 'code' });
        const st = L.totpStep(u.totp, code); /* один код — один раз */
        if (st < 0 || !(await L.kv('SET', 't:' + e + ':' + st, '1', 'NX', 'EX', 120))) { await fail(e, ip); return out(401, { error: 'code' }); }
      }
      await L.kv('DEL', 'lf:e:' + e); await L.startSession(res, e, true, false, u.v);
      return out(200, { ok: true });
    }

    const s = await L.session(req);
    if (a === 'me') return out(200, { user: s ? { email: s.email, name: s.name, admin: s.admin } : null });
    if (a === 'logout') { await L.endSession(req, res); return out(200, { ok: true }); }
    if (!s) return out(401, { error: 'auth' });
    if (a === 'rename') {
      const name = clean(b.name); if (name.length < 2 || name.length > 40) return out(400, { error: 'name' });
      const u = await L.getUser(s.email); u.name = name; await L.putUser(s.email, u); return out(200, { user: { email: s.email, name } });
    }
    if (a === 'delete_me') {
      if (L.isAdmin(s.email)) return out(403, { error: 'admin' });
      await L.kv('DEL', 'u:' + s.email); await L.kv('SREM', 'users', s.email); await L.endSession(req, res); return out(200, { ok: true });
    }

    if (!s.admin) return out(403, { error: 'forbidden' }); /* дальше только админ с подтверждённым кодом */
    if (a === 'admin_list') {
      const em = (await L.kv('SMEMBERS', 'users')) || [], raw = em.length ? await L.kv('MGET', ...em.map(x => 'u:' + x)) : [];
      return out(200, { users: em.map((x, i) => { const u = JSON.parse(raw[i] || 'null') || {}; return { email: x, name: u.name || '', t: u.t || 0, banned: !!u.banned, admin: L.isAdmin(x) }; }).sort((p, q) => q.t - p.t) });
    }
    const t = L.norm(b.email);
    if ((a === 'admin_ban' || a === 'admin_delete') && L.isAdmin(t)) return out(400, { error: 'admin' });
    if (a === 'admin_ban') {
      const u = await L.getUser(t); if (!u) return out(404, { error: 'none' });
      u.banned = !!b.banned; u.v = (u.v || 0) + 1; await L.putUser(t, u); return out(200, { ok: true });
    }
    if (a === 'admin_delete') { await L.kv('DEL', 'u:' + t); await L.kv('SREM', 'users', t); return out(200, { ok: true }); }
    return out(400, { error: 'action' });
  } catch (e) { return out(e && e.message === 'no_store' ? 503 : 500, { error: 'server' }); }
};
