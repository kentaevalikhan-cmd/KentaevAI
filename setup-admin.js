// Запуск на своём компьютере: node scripts/setup-admin.js
// Печатает значения для переменных окружения (Vercel -> Settings -> Environment Variables).
const readline = require('readline'), crypto = require('crypto'), A = require('../api/_auth');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let mute = false; const _w = rl._writeToOutput; rl._writeToOutput = s => { if (!mute) _w.call(rl, s); };
const ask = (q, m) => new Promise(r => { process.stdout.write(q); mute = !!m; rl.question('', a => { mute = false; if (m) console.log(); r(a.trim()); }); });
(async () => {
  const email = await ask('Почта админа: ');
  const pw = await ask('Пароль (12+ символов, не показывается): ', true);
  if (pw.length < 12) { console.error('Пароль короче 12 символов.'); process.exit(1); }
  process.env.SESSION_SECRET = 'x'.repeat(32);
  const totp = A.newTotpSecret();
  console.log('\nДобавьте в переменные окружения:\n');
  console.log('ADMIN_EMAIL=' + email);
  console.log('ADMIN_PASSWORD_HASH=' + A.hashPassword(pw));
  console.log('ADMIN_TOTP_SECRET=' + totp);
  console.log('SESSION_SECRET=' + crypto.randomBytes(48).toString('base64url'));
  console.log('\nВ приложении-аутентификаторе: «Добавить» -> «Ввести ключ вручную» -> тип «по времени»:');
  console.log(totp + '\n(или otpauth://totp/KentaevAI:' + encodeURIComponent(email) + '?secret=' + totp + '&issuer=KentaevAI)');
  rl.close();
})();
