'use strict';
// Аккаунты пользователей на сервере: регистрация, вход, сброс по коду, имя, удаление.
const A = require('./_auth'), db = require('./_db'), crypto = require('crypto');
const json = (res, c, o) => { res.statusCode = c; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 4096) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });
const PW = /^(?=.*[A-Za-z])(?=.*\d).{10,200}$/, MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const newCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 12; i++) { s += a[crypto.randomInt(a.length)]; if (i % 4 === 3 && i < 11) s += '-'; } return s; };
const get = async e => { try { return JSON.parse(await db.cmd('GET', 'u:' + e)); } catch { return null; } };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST' || !A.sameOrigin(req) || !/application\/json/.test(req.headers['content-type'] || '')) return json(res, 403, { error: 'forbidden' });
  if (!db.enabled()) return json(res, 503, { error: 'Сервер аккаунтов не настроен' });
  const b = await body(req), ip = A.ip(req), email = String(b.email || '').trim().toLowerCase().slice(0, 254), pw = String(b.password || '');
  const bad = (m) => json(res, 400, { error: m });
  const tooMany = () => json(res, 429, { error: 'Слишком много попыток. Подождите 15 минут.' });

  if (b.a === 'logout') { A.clearUserSession(res); return json(res, 200, {}); }
  if (b.a === 'me') { const u = await A.currentUser(req); return u ? json(res, 200, { email: u.email, name: u.name }) : json(res, 401, {}); }

  if (b.a === 'reg') {
    if ((await A.hit('reg:' + ip, 3600000)) > 5) return tooMany();
    const name = String(b.name || '').trim().slice(0, 40);
    if (!MAIL.test(email)) return bad('Проверьте почту'); if (name.length < 2) return bad('Введите имя');
    if (!PW.test(pw)) return bad('Пароль: от 10 символов, буква и цифра.');
    const code = newCode(), rec = { name, hash: A.hashPassword(pw), rh: A.hashPassword(norm(code)), v: 1, t: Date.now() };
    if ((await db.cmd('SET', 'u:' + email, JSON.stringify(rec), 'NX')) !== 'OK') return json(res, 409, { error: 'Эта почта уже зарегистрирована' });
    A.setUserSession(res, email, 1, b.keep !== false); return json(res, 200, { name, code });
  }
  if (b.a === 'login') {
    if (await A.limited('ip:' + ip, 8) || await A.limited('acct:' + email, 10)) return tooMany();
    const r = await get(email);
    if (!A.verifyPassword(pw.slice(0, 200), r && r.hash) || !r) { await A.fail('ip:' + ip); await A.fail('acct:' + email); return json(res, 401, { error: 'Неверная почта или пароль' }); }
    A.setUserSession(res, email, r.v, !!b.keep); return json(res, 200, { name: r.name });
  }
  if (b.a === 'reset') {
    if (await A.limited('rst:' + ip, 5) || await A.limited('rst:' + email, 5)) return tooMany();
    if (!PW.test(pw)) return bad('Новый пароль: от 10 символов, буква и цифра.');
    const r = await get(email);
    if (!A.verifyPassword(norm(b.code), r && r.rh) || !r) { await A.fail('rst:' + ip); await A.fail('rst:' + email); return json(res, 401, { error: 'Неверный код восстановления' }); }
    r.hash = A.hashPassword(pw); r.v++; // v++ завершает все старые сессии
    await db.cmd('SET', 'u:' + email, JSON.stringify(r)); return json(res, 200, {});
  }
  const u = await A.currentUser(req); if (!u) return json(res, 401, {});
  if (b.a === 'name') { const n = String(b.name || '').trim().slice(0, 40); if (n.length < 2) return bad('Имя слишком короткое'); u.rec.name = n; await db.cmd('SET', 'u:' + u.email, JSON.stringify(u.rec)); return json(res, 200, { name: n }); }
  if (b.a === 'del') {
    if (await A.limited('acct:' + u.email, 10)) return tooMany();
    if (!A.verifyPassword(pw.slice(0, 200), u.rec.hash)) { await A.fail('acct:' + u.email); return json(res, 401, { error: 'Неверный пароль' }); }
    await db.cmd('DEL', 'u:' + u.email); A.clearUserSession(res); return json(res, 200, {});
  }
  return bad('bad request');
};
