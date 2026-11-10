# Защита KentaevAI

## Что уже сделано в index.html
- **CSP** (политика безопасности): страница может обращаться только к своему серверу, open-meteo, NVIDIA и pollinations. Чужим сайтам данные не уйдут, плагины, `<base>`, фреймы и отправка форм запрещены.
- **Referrer-Policy: no-referrer**: адрес вашего сайта не утекает на другие сайты.
- **XSS**: весь текст ответов ИИ экранируется перед показом, `eval` и `document.write` не используются. Превью фото проверяется функцией `safeSrc` (пропускает только `data:image` и `blob:`).
- **Новые окна**: открываются с `noopener,noreferrer`.
- **Вход**: пароли хранятся как хэш PBKDF2 с солью, после 5 неверных попыток вход блокируется на минуту (это уже было).
- **Ключей в файле нет**: `NV_KEY` пустой, запросы идут через `/api/nvidia`.

## Что нельзя защитить в одном HTML-файле
Всё, что лежит в браузере (аккаунты, заметки, история в `localStorage`), может прочитать тот, кто сидит за этим же браузером. Проверка пароля на стороне страницы не считается настоящей защитой. Код страницы нельзя «спрятать»: любой видит его через «Просмотр кода», обфускация не даёт безопасности.

## Что нужно сделать на сервере (самое важное)
1. **Лимиты на `/api/chat` и `/api/nvidia`**: например, 20 запросов в минуту на IP. Без этого любой может вызывать ваш API и сжечь деньги.
2. **Проверка Origin/Referer** на этих адресах: пускать только ваш домен.
3. **Ключи только в переменных окружения** (Environment Variables). Если ключ когда-либо попадал в код или чат, замените его на новый.
4. **Ограничьте размер запроса** (например, 1 МБ) и длину сообщений.
5. **Заголовки ответа.** Для Vercel (`vercel.json`):

```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "Referrer-Policy", "value": "no-referrer" },
      { "key": "Permissions-Policy", "value": "camera=(), geolocation=(), payment=()" }
    ]
  }]
}
```

Для Netlify или Cloudflare Pages (файл `_headers`):

```
/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), geolocation=(), payment=()
```

`X-Frame-Options` защищает от встраивания сайта в чужую страницу (кликджекинг). Если открываете сайт внутри другого приложения во фрейме, значение `DENY` надо убрать.

## Если хотите ещё надёжнее
Настоящие аккаунты с паролями и сессиями делаются на сервере (например, Supabase или Firebase Auth), а история чатов хранится там же.
