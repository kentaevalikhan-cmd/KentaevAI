'use strict';
// Вход админа: пароль -> код 2FA -> сессия (HttpOnly cookie). Панель отдаётся ТОЛЬКО после проверки на сервере.
const A = require('./_auth');
const crypto = require('crypto');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (res, code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 4096) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });

function page(res, inner, nonce) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Админ</title>
<style nonce="${nonce}">body{margin:0;background:#000;color:#f4f4f4;font:16px Inter,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}main{width:min(92vw,360px)}input,button{width:100%;box-sizing:border-box;padding:14px;margin:6px 0;border-radius:12px;border:1px solid #333;background:#111;color:#fff;font:inherit}button{background:#fff;color:#000;font-weight:600;cursor:pointer}#m{color:#bdbdbd;min-height:1.4em}</style>${inner}`);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const nonce = crypto.randomBytes(16).toString('base64');

  if (req.method === 'GET') {
    if (A.isAdmin(req)) {
      return page(res, `<main><h2>Админ-панель</h2><p>Вы вошли как ${esc(process.env.ADMIN_EMAIL || 'admin')}.</p><p>Здесь подключаются закрытые инструменты. Каждый закрытый эндпоинт обязан начинаться с <code>requireAdmin</code>.</p><button id="o">Выйти</button></main>
<script nonce="${nonce}">o.onclick=async()=>{await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"a":"logout"}'});location.reload()}</script>`, nonce);
    }
    return page(res, `<main><h2>Вход для админа</h2><div id="s1"><input id="e" type="email" placeholder="Почта" autocomplete="username"><input id="p" type="password" placeholder="Пароль" autocomplete="current-password"><button id="b1">Далее</button></div>
<div id="s2" hidden><input id="c" inputmode="numeric" maxlength="6" placeholder="Код из приложения" autocomplete="one-time-code"><button id="b2">Войти</button></div><p id="m"></p></main>
<script nonce="${nonce}">let t='';const post=async o=>{const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)});return[r.ok,await r.json().catch(()=>({}))]};
b1.onclick=async()=>{const[ok,d]=await post({a:'login',email:e.value,password:p.value});if(ok){t=d.t;s1.hidden=true;s2.hidden=false;c.focus();m.textContent=''}else m.textContent=d.error||'Ошибка'};
b2.onclick=async()=>{const[ok,d]=await post({a:'totp',t,code:c.value});if(ok)location.reload();else m.textContent=d.error||'Ошибка'};</script>`, nonce);
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  if (!A.sameOrigin(req) || !/application\/json/.test(req.headers['content-type'] || '')) return json(res, 403, { error: 'forbidden' });
  const b = await readBody(req);

  if (b.a === 'logout') { A.clearSession(res); return json(res, 200, { ok: true }); }
  if (A.limited(req, 'admin')) return json(res, 429, { error: 'Слишком много попыток. Подождите 15 минут.' });

  if (b.a === 'login') {
    const okPw = A.verifyPassword(b.password, process.env.ADMIN_PASSWORD_HASH);
    const okMail = A.safeEq(String(b.email || '').trim().toLowerCase(), String(process.env.ADMIN_EMAIL || '').toLowerCase());
    if (!(okPw && okMail)) { A.fail(req, 'admin'); return json(res, 401, { error: 'Неверная почта или пароль' }); }
    return json(res, 200, { t: A.makeToken('pw', 300) });
  }
  if (b.a === 'totp') {
    if (!A.readToken(b.t, 'pw') || !A.verifyTotp(process.env.ADMIN_TOTP_SECRET, b.code)) { A.fail(req, 'admin'); return json(res, 401, { error: 'Неверный код' }); }
    A.setSession(res); return json(res, 200, { ok: true });
  }
  return json(res, 400, { error: 'bad request' });
};
