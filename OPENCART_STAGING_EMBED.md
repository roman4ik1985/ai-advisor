# OpenCart staging embed

Подключать только после создания backup файлов и базы данных staging-копии.

## 1. Файлы ассета

На HTTPS-домене backend/static разместить только:

- `public/widget.js`
- `public/widget.css`
- `public/assets/mascot.png`

Репозиторий, `.env`, тесты и API key на сайт OpenCart не загружаются.

## 2. Минимальный snippet

Вставить через активный OpenCart template/modifier перед `</head>` или перед `</body>`:

```html
<link rel="stylesheet" href="https://ASSISTANT_HOST/widget.css">
<script
  src="https://ASSISTANT_HOST/widget.js"
  data-endpoint="https://ASSISTANT_HOST/api/chat"
  data-mascot="https://ASSISTANT_HOST/assets/mascot.png"
  defer
></script>
```

`ASSISTANT_HOST` заменить на фактический HTTPS-домен backend после его выбора. Не вставлять ключ в этот snippet.

## 3. Перед staging smoke

- backend работает в `api` режиме;
- `ALLOWED_ORIGINS` содержит `https://ledprojector.com.ua` и staging origin;
- backend доступен только по HTTPS;
- CORS preflight возвращает `204` для разрешённого origin;
- `/health` возвращает `200`;
- `widget.js`, `widget.css` и `mascot.png` возвращают `200`;
- на desktop и mobile персонаж виден без серого фона;
- открытие, закрытие, Escape, отправка вопроса и ошибка backend работают;
- корзина, checkout, SEO-разметка и консоль магазина не нарушены.

## 4. Ограничение публикации

До подтверждённого hosting/OpenCart доступа этот snippet является staging-шаблоном. На production его не устанавливать.
