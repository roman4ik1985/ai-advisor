# LedProjector AI Assistant

Полное техническое задание: [TECHNICAL_SPECIFICATION.md](./TECHNICAL_SPECIFICATION.md).

Комплексный аудит архитектуры, безопасности, API, доступности и производительности: [AUDIT_REPORT_2026-07-20.md](./AUDIT_REPORT_2026-07-20.md).

## Канонический baseline

На 29.07.2026 source savepoint `294b730` фиксирует:

- Agent OS 1.0: T01–T11 90/90 PASS, legacy suite 19/19 PASS;
- основной source suite: 69/69 PASS;
- production API через `https://ai.ledprojector.com.ua`;
- прямые server-side SalesDrive resolvers для актуальной цены, явного наличия, способов доставки и оплаты;
- `FRESH` / `STALE` / `UNAVAILABLE` и fail-closed ответы без модельного вызова при обязательном stale/unavailable evidence;
- неизменный публичный success contract: `answer`, `catalog`, `catalogDiagnostics`, `knowledge`, `provider`.

Последняя runtime acceptance на этой точке зафиксировала source/runtime diff 0 и локальный/публичный `/health` HTTP 200. Перед любой новой runtime-операцией health и diff проверяются заново; этот README не утверждает их текущий live-статус.

Канонический forward roadmap C00–C54 и deferred-зоны находятся в разделе 18 [TECHNICAL_SPECIFICATION.md](./TECHNICAL_SPECIFICATION.md#18-forward-roadmap). Персональный статус заказа не активирован: C20–C30, transport, provisioning, manager/notification sinks и durable outbox синхронизированы в active-runtime, но feature flag остаётся false. До config/test-bot acceptance запрещены anonymous lookup и реальные order API/customer-data операции.

P3 C30–C33 завершён в source. `npm run knowledge:coverage` строит read-only
coverage/gap отчёт; `npm run learning:review` ведёт явные `DEFER` / `DISMISS` /
`DRAFT` решения без автоматической публикации; `npm run
product-specifications:ingest` продвигает только проверенные характеристики
официальных product pages в отдельный evidence-файл. Цена, наличие, акции и
доставка не могут попасть в этот статический product evidence.

P4 C40–C45 завершён в source. Product analytics выключена по умолчанию, хранит
только три allow-listed события без visitor identity/free text и имеет retention
30 дней. Отдельный `/ready` проверяет зависимости и capacity; SLO-контракт
задаёт 99.5% availability, 98% success и p95 не более 15 секунд. Текущий
single-instance backend использует local limiter, а multi-instance запуск
fail-closed до atomic distributed limiter. Security maintenance, RU/UK
cost-quality benchmark и asset budgets выполняются командами
`npm run security:maintenance`, `npm run benchmark:quality` и
`npm run performance:budget`. Source assets проходят бюджет; реальные LCP/CLS/INP
остаются `STAGING_REQUIRED`. Acceptance:
[docs/ai-advisor-p4-operations-acceptance.md](./docs/ai-advisor-p4-operations-acceptance.md).

P5 C50–C52 завершены на изолированной OpenCart-копии `/dev`: подтверждены
JetBackup restore points, выполнены byte-for-byte footer restore drills и
установлен виджет в source + OCMOD CyberStore footer. Desktop functional
regression проходит на homepage/category/product/cart/checkout без browser
errors; старые PHP 8 warnings staging отмечены отдельно. После OCMOD refresh и
Lightning clear production clean-cache browser монтирует виджет, open/close/focus
и пять storefront routes проходят, browser errors 0. Warm mobile 390x844:
LCP 964 ms, CLS 0; tested interaction не создал Event Timing entry ≥16 ms.
C50-C54 приняты; ранний zero-root был stale test-browser cache, а не потеря
server embed. Acceptance и rollback evidence:
[docs/ai-advisor-p5-staging-acceptance.md](./docs/ai-advisor-p5-staging-acceptance.md),
[docs/ai-advisor-p5-regression-report.md](./docs/ai-advisor-p5-regression-report.md),
[docs/ai-advisor-p5-rollout-runbook.md](./docs/ai-advisor-p5-rollout-runbook.md).

P6 добавляет повторяемый read-only production gate:
`npm run production:smoke`. Он проверяет normal/cache-busted parity активного
Lightning widget bundle, HTTP 200 и mount на пяти маршрутах, mobile 390x844,
open/close/focus, LCP/CLS/INP и browser errors. Первый live run прошёл:
bundle 29,472 bytes, routes 5/5, LCP 1,268 ms, CLS 0, INP 56 ms, errors 0.
При любом нарушении команда возвращает non-zero и
`FREEZE_ROLLOUT_AND_USE_ROLLBACK_RUNBOOK`. Подробности:
[docs/ai-advisor-p6-production-monitoring.md](./docs/ai-advisor-p6-production-monitoring.md).

### Product-aware MVP source package

C10–C15 реализованы в source:

- canonical product DTO связывает SalesDrive identity/SKU с безопасным URL, aliases, specifications, images, provenance и freshness;
- рекомендации и сравнения детерминированны, ограничены тремя свежими подтверждёнными товарами и не выдумывают победителя;
- виджет отображает карточки из существующего `catalog`, находит реальную OpenCart-карточку по URL/ID/SKU/точному alias и перемещается к ней только после явного действия;
- mobile и reduced-motion используют highlight/focus без перемещения персонажа;
- полный source suite проходит 96/96.

Source acceptance: [docs/ai-advisor-product-aware-mvp.md](./docs/ai-advisor-product-aware-mvp.md). Active runtime и публичный магазин этим пакетом не изменены; real-store release/staging acceptance выполняется только по отдельной команде.

### Privacy-gated order status

C20–C29 реализованы как source-контракты без внешней интеграции. Веб-ассистент
создаёт одноразовую десятиминутную deep-link сессию, клиент открывает личный чат
бота и нажимает Telegram-кнопку `Поділитися номером`. Backend принимает только
собственный `request_contact` текущего пользователя в private chat, сверяет его
с телефоном клиента и создаёт phone-free привязку `telegramUserId → customerRef`.
Повторные, просроченные, групповые, введённые вручную и пересланные контакты
отклоняются.

Контракт и границы: [docs/ai-advisor-order-ownership-contract.md](./docs/ai-advisor-order-ownership-contract.md).
После успешной привязки C22 DTO может показать номер заказа, товары/количество,
сумму, статусы заказа/оплаты, доставку и ТТН. C23 использует только официальный
SalesDrive `GET /api/order/list/` с точным server-side ID и повторной ownership
проверкой до проекции. Контакты, точный адрес, платёжные
реквизиты, CRM-заметки, внутренние поля и чужие заказы исключаются. Telegram
order-flow работает только через фиксированное меню, без свободного текста и AI.
Source webhook проверяет Telegram secret/update ID; Redis-адаптер атомарно хранит
одноразовые link/selection/proof и phone-free binding; distributed limiter
закрывается при отказе Redis. Модули не открывают HTTP route и сами не соединяются
с Redis, Telegram или SalesDrive до включения `TELEGRAM_ORDER_ENABLED`. Fixed HTTP
route, Redis client, Telegram sender и verified-ID owned-order service уже
подключены в source и выключены по умолчанию. Acceptance:
[docs/ai-advisor-order-status-source-acceptance.md](./docs/ai-advisor-order-status-source-acceptance.md).
[docs/ai-advisor-telegram-order-webhook-source-acceptance.md](./docs/ai-advisor-telegram-order-webhook-source-acceptance.md).
[docs/ai-advisor-telegram-order-transport-source-acceptance.md](./docs/ai-advisor-telegram-order-transport-source-acceptance.md).
[docs/ai-advisor-telegram-production-activation-runbook.md](./docs/ai-advisor-telegram-production-activation-runbook.md).
Provisioning добавляет нейтральный real/decoy link contract и отдельную widget-форму:
номер заказа не передаётся AI, а существование заказа не раскрывается до
Telegram `request_contact`. Acceptance:
[docs/ai-advisor-telegram-order-provisioning-source-acceptance.md](./docs/ai-advisor-telegram-order-provisioning-source-acceptance.md).
Focused provisioning/widget проходит 19/19, полный source suite — 174/174.

Плавающий AI-консультант для `ledprojector.com.ua` с двумя режимами:

- `cli` — локальное тестирование через текущую авторизацию Codex CLI/ChatGPT;
- `api` — production через серверный OpenAI Responses API.

CLI-режим всегда слушает только `127.0.0.1` и не предназначен для публичного доступа.

## Быстрый запуск через CLI

Требования: Node.js 20+, установленный Codex CLI и успешный `codex login status`.

```powershell
cd C:\AI Advisor
Copy-Item .env.example .env
npm run start:cli
```

Откройте `http://127.0.0.1:8787`.

## Переключение на API

После безопасного добавления `OPENAI_API_KEY` в локальный `.env`:

```powershell
npm run start:api
```

Для локального фонового API на штатном порту `8788` с readiness-проверкой и логами:

```powershell
npm run start:api:background
```

### Постоянный локальный runtime на Windows

Рабочая копия API размещена в `F:\Services\AI Advisor`; исходная папка `C:\AI Advisor` сохранена как rollback-копия. Логи API находятся в `F:\Services\AI Advisor\logs`.

Перед переносом проверяйте release-кандидат: `npm test`, затем `npm run release:active:dry-run`. Профиль по умолчанию `P3P4Runtime` переносит только девять утверждённых runtime-файлов; `public/widget-config.json` жёстко исключён как runtime-owned конфигурация. Документация, тесты, scripts и package-файлы в этот профиль не входят.

Только после явного решения о production-release применяйте `pwsh -NoProfile -File scripts\release-active-runtime.ps1 -Profile P3P4Runtime -Apply` и отдельно перезапускайте API host в согласованное окно. Перед копированием скрипт создаёт hash-проверенный manifest в `F:\Services\AI Advisor\_release-backups`; точная команда отката возвращается в поле `RollbackCommand`. Откат принимает только manifest внутри этой backup-директории, проверяет active root и hashes, не затрагивает `.env`, логи, архивы или node_modules. Изменения `package.json`/`package-lock.json` требуют отдельного явно подтверждённого dependency-release и `npm ci --omit=dev`.

Для текущего пользователя настроены два recovery-механизма:

- Задача `AI Advisor API Host` запускает API от `SYSTEM` при старте Windows, до входа пользователя, и автоматически перезапускается после сбоя.
- Задача `AI Advisor Health Monitor` работает от `SYSTEM`, проверяет API каждые пять минут и перезапускает задачу API при сбое.
- Прежний `AI Advisor API.cmd` отключён как `AI Advisor API.cmd.disabled`, чтобы не создавать второй процесс после входа пользователя.
- Воспроизводимая установка задач: `scripts\install-local-host-tasks.ps1`; активация: `scripts\activate-local-host-tasks.ps1`; recovery-smoke: `scripts\test-api-task-recovery.ps1`; elevated-диагностика: `scripts\inspect-api-task.ps1`. Эти операции требуют elevated PowerShell.
- В Windows PowerShell 5.1 stderr Node нельзя запускать под завершающим `$ErrorActionPreference='Stop'`: штатные catalog-warning превращаются в `NativeCommandError` и останавливают host-задачу. `run-api-task.ps1` сохраняет strict-режим для setup, но переводит только долгоживущий Node-процесс в non-terminating stderr-режим.

Компьютер не должен переходить в сон при питании от сети. Именованный Cloudflare Tunnel `ai-advisor-ledprojector` установлен как автоматически запускаемая Windows-служба `Cloudflared` с восстановлением после сбоя. Постоянный публичный адрес API — `https://ai.ledprojector.com.ua`; локальный монитор проверяет и локальный `/health`, и этот публичный endpoint.

### Telegram-уведомления

- `AI Advisor Health Monitor` выполняется от `SYSTEM` каждую минуту и хранит переходное состояние в `logs\ai-advisor-monitor-state.json`.
- Оповещения `DOWN`, `RECOVERED`, `AUTO_RECOVERED` и `HOST_ONLINE` дедуплицируются: здоровый повторный цикл не создаёт новое сообщение.
- Отправка выполняется только через `scripts\send-telegram-notification.ps1` → `codex-tg notify`. Проект не читает и не копирует Telegram bot token.
- Пользовательский bridge запускается после входа в Windows через `AI Advisor Telegram Bridge.cmd` в Startup и `scripts\start-telegram-bridge.ps1`. SYSTEM-monitor пишет в его локальную allowlisted-очередь; если bridge временно не работает, очередь остаётся до следующего запуска.
- Контролируемый smoke: `scripts\test-monitor-notifications.ps1` кратко останавливает `Cloudflared`, проверяет по одному событию `DOWN` и `RECOVERED`, затем обязательно возвращает службу.
- Ограничение локального контура: полностью выключенный ПК не может отправить событие в момент отключения. Для немедленного оповещения о потере всего хоста нужен отдельный внешний uptime-monitor.

### Retention runtime-логов

- `AI Advisor Health Monitor` раз в минуту запускает `scripts\rotate-runtime-logs.ps1`.
- Если один из API/monitor логов достигает 10 МБ, helper копирует его в `logs\archive` с timestamp и очищает активный файл без перезапуска API.
- Удаляются только архивы AI Advisor старше 14 дней; Telegram-логи и Windows Event Log не затрагиваются.
- Isolated smoke: `npm run test:log-rotation`.

### Журнал обучения

- По умолчанию журнал выключен. После отдельного решения по приватности включите `LEARNING_LOG_ENABLED=true` в server-side `.env`.
- Успешный диалог записывается в `logs\ai-advisor-learning.log` как JSONL: очищенные последняя реплика пользователя и ответ, ID использованных knowledge-карточек и техническая диагностическая метка. Полная история, HTML страницы, IP-адреса и секреты не сохраняются; email и телефонные номера маскируются.
- Это не автоматическое переобучение и не автоматическая правка базы знаний. Если подходящей карточки не было или ответ направил к менеджеру, запись получает кандидата `pending`.
- Для просмотра кандидатов используйте `npm run learning:review`. Перед добавлением факта проверьте официальный источник и применяйте существующий `npm run knowledge:upsert -- --apply ...`.
- Файл входит в штатную ротацию: 10 МБ на активный лог и 14 дней хранения архивов.

### Внешний uptime-monitor

- В Better Stack создан монитор `ai.ledprojector.com.ua/health` (ID `4715620`): `https://ai.ledprojector.com.ua/health`, проверка раз в три минуты. На текущем Free-плане нет расписания on-call: при инциденте сервис уведомляет всю команду.
- При инциденте сначала проверить карточку инцидента Better Stack, затем локальный и публичный health: `Invoke-WebRequest http://127.0.0.1:8788/health` и `Invoke-WebRequest https://ai.ledprojector.com.ua/health`.
- Для диагностики Tunnel в elevated PowerShell: `Get-Service Cloudflared`. Управлять службой только после диагностики и только elevated-командой; не останавливать её ради обычной проверки.
- Безопасный внешний smoke: временно заменить URL монитора в Better Stack на `https://ai.ledprojector.com.ua/__ai_advisor_smoke_404`, дождаться `Down`, сразу вернуть точный `/health` URL и дождаться `Up`. Это проверяет внешний монитор без остановки сайта или Tunnel.
- Rollback настройки монитора: в Better Stack вернуть URL ровно `https://ai.ledprojector.com.ua/health`; не менять DNS, Cloudflare Tunnel или cPanel-файлы. Контролируемый smoke 2026-07-23 зафиксировал `Down`, затем `Up`; Cloudflared при этом не прерывался.
- Не полагаться на ссылку `Send test alert`: 2026-07-23 её встроенный маршрут вернул Better Stack `404` и не отправил письмо. Для проверки канала использовать только контролируемый temporary-404 smoke выше.

Модель по умолчанию — `gpt-5.6-terra`: баланс качества, задержки и стоимости для консультаций. Её можно заменить переменной `OPENAI_MODEL` без изменения кода.

## Встраивание виджета

На странице магазина нужны CSS и один скрипт:

```html
<link rel="stylesheet" href="https://ai.ledprojector.com.ua/widget.css">
<script
  src="https://ai.ledprojector.com.ua/widget.js"
  data-endpoint="https://ai.ledprojector.com.ua/api/chat"
></script>
```

Для production сохраняйте `ALLOWED_ORIGINS=https://ledprojector.com.ua`. Не размещайте `OPENAI_API_KEY` в HTML или `widget.js`.

### Переключатель видимости виджета

Видимость управляется публичным файлом `public/widget-config.json`. Команда изменяет только булево поле `enabled` в текущей копии проекта:

```powershell
.\scripts\set-widget-visibility.ps1 -Enabled $true
.\scripts\set-widget-visibility.ps1 -Enabled $false
```

`false` не создаёт интерфейс виджета на новых загрузках страницы, `true` возвращает его. Публичная конфигурация содержит только boolean-флаг, отдаётся без кеширования и разрешает анонимное cross-origin чтение без credentials. Если конфигурацию невозможно получить или проверить, сохраняется прежнее безопасное поведение — виджет отображается. Переключатель активирован в production; менять состояние нужно скриптом из active runtime `F:\Services\AI Advisor`. Перезапуск API не требуется, но уже открытая страница должна быть перезагружена.

В `widget.js` сохранён абсолютный fallback на `https://ai.ledprojector.com.ua/api/chat`: оптимизатор Lightning может объединять внешний скрипт и удалять его атрибут `data-endpoint`. Production footer использует `widget.js?v=20260801visibility`; при следующем изменении виджета версию нужно обновить в source и compiled CyberStore footer, затем очистить asset- и page-cache Lightning.

### Защита API от перегрузки

Локальные production-параметры:

```dotenv
RATE_LIMIT_PER_MINUTE=20
AI_MAX_CONCURRENT=4
AI_MAX_QUEUE=16
SHUTDOWN_TIMEOUT_MS=30000
```

Одновременно выполняются не более `AI_MAX_CONCURRENT` запросов к AI. Ещё `AI_MAX_QUEUE` запросов ожидают; сверх этого сервер отвечает `503` с кодом `AI_QUEUE_FULL`. При rate limit сервер отвечает `429` с кодом `RATE_LIMITED` и целочисленным заголовком `Retry-After`.

Все HTTP-ошибки имеют один JSON-контракт:

```json
{
  "error": "Понятное сообщение",
  "code": "RATE_LIMITED",
  "requestId": "UUID"
}
```

Тот же `requestId` возвращается в заголовке `X-Request-Id` и добавляется в серверный лог ошибки. При `SIGTERM` или `SIGINT` сервер прекращает принимать новые соединения, отклоняет очередь, очищает rate-limit buckets и даёт активным запросам до `SHUTDOWN_TIMEOUT_MS` на завершение.

Локальный live-smoke 2026-07-23 без вызовов OpenAI подтвердил 20 `400 INVALID_JSON`, затем `429 RATE_LIMITED` с `Retry-After: 60` и одинаковым `requestId` в JSON/заголовке. После 60 секунд новый запрос снова получил `400`, а `/health` остался `200`.

Полный HTTP-smoke очереди запускается только тестовым provider: при `NODE_ENV=test` допустим `--provider=test`, он слушает только loopback, не использует `OPENAI_API_KEY`, не обращается к каталогу и отвечает с контролируемой задержкой. Тест доказывает `1 active + 1 queued + 1 rejected` → `503 AI_QUEUE_FULL`, `Retry-After: 1`, единый error-contract и последующий `/health 200`. В обычном runtime `AI_PROVIDER=test` отклоняется.

### Проверка ответа перед отправкой

Перед поиском backend детерминированно относит запрос к одному из пяти маршрутов: store FAQ, product lookup, product advice, live fact или manager handoff. FAQ использует только knowledge; подбор и поиск получают каталог из прямого server-side SalesDrive YML; live-вопросы при необходимости подключают этот же YML для цены/остатка и GET-only SalesDrive API для списков способов доставки и оплаты. Вопрос только о способах оплаты/доставки не запускает каталог. Явный запрос менеджера не запускает каталог. Маршрут и freshness остаются внутренними и не меняют успешный JSON-контракт `/api/chat`.

Перед модельным ответом backend детерминированно рендерит подтверждённую SalesDrive цену, наличие и allow-listed способы доставки/оплаты. Русские и украинские формы слова «цена» включают price-resolver и получают детерминированный price-only ответ при уверенном совпадении. Наличие рендерится только при единственном кандидате либо наиболее специфичном совпадении полного названия/SKU; неоднозначный вопрос получает просьбу уточнить модель, а не произвольную первую карточку. Вопрос о доступных способах доставки или оплаты не запускает inventory-resolver. Payment renderer выводит только очищенные названия из safe DTO и не обещает одобрение кредита/рассрочки либо применимость метода к конкретному заказу; такие условия подтверждаются при оформлении. Каждый direct resolver передаёт явное состояние `FRESH`, `STALE` или `UNAVAILABLE`. Только `FRESH` со свежим timestamp может попасть в deterministic renderer и validator. Last-known-good YML при временном отказе остаётся внутренней диагностикой: stale-товары не возвращаются в публичном `catalog`, не передаются модели и не используются для цены или наличия. Обязательный stale/unavailable resolver немедленно даёт manager fallback без AI-вызова. Цена допускается только при точном совпадении со свежим SalesDrive YML-результатом; наличие — только при явном `IN_STOCK`/`OUT_OF_STOCK` из того же feed. Список способов доставки не является доказательством срока: renderer не формирует срок, а обещание «завтра» или количества дней по-прежнему переводится validator в безопасную просьбу уточнить у менеджера. Срок гарантии допускается только если он подтверждён найденной knowledge-карточкой, проверенной не более 180 дней назад. Проверка не записывает текст диалога в технический validation-log.

### Direct SalesDrive configuration

Для live-данных backend читает только server-side переменные: `SALESDRIVE_YML_URL`, `SALESDRIVE_SUBDOMAIN` и `SALESDRIVE_API_KEY`. Полный YML URL (включая `publicKey`) и API key являются секретами: не добавляйте их в Git, HTML, `widget.js`, логи или сообщения чата. При отсутствии настроек resolver закрывается безопасно: цена/наличие не подтверждаются, а пользователь получает manager fallback. Код персонального статуса заказа загружен в active runtime, но выключен и требует `TELEGRAM_ORDER_BOT_USERNAME`, bot/webhook secrets, Redis URL, manager chat ID и test-bot/config acceptance перед активацией.

Изолированный Telegram transport + Valkey preflight запускается через `npm run telegram:test-bot:preflight`; live smoke — через `npm run telegram:test-bot:smoke` только с процесс-scoped `VALKEY_AIVEN_TEST_URL`, `TELEGRAM_TEST_BOT_TOKEN` и `TELEGRAM_TEST_CHAT_ID`. Smoke требует TLS, отказывается работать при production `TELEGRAM_ORDER_ENABLED=true`, не использует SalesDrive/AI/customer-order payloads, отправляет одно фиксированное menu-only сообщение и удаляет свой уникальный Valkey namespace.

Production activation пока имеет статус NO-GO: SYSTEM-host не располагает
принятым защищённым secret-loader, а production runtime требует отдельно
авторизованный SalesDrive ownership/provisioning contour. Канонические gates,
webhook-последовательность и rollback описаны в
[production activation runbook](./docs/ai-advisor-telegram-production-activation-runbook.md);
`TELEGRAM_ORDER_ENABLED` остаётся false.

## База знаний консультанта

Редактируйте `knowledge/store-faq.json`. Каждая запись содержит заголовок, ключевые слова, проверенный текст, URL источника и дату проверки. Перед ответом сервер выбирает до четырёх релевантных записей и передаёт их модели вместе с текущей страницей и результатами поиска по каталогу.

Добавляйте отдельные короткие записи для доставки, оплаты, гарантии, возвратов, совместимости аксессуаров и правил подбора. Для изменяемых данных — цен, наличия, акций и сроков — не создавайте статичные записи: они должны оставаться данными живого каталога или подтверждаться менеджером.

Проверяйте файл перед использованием:

```powershell
npm run check:knowledge
```

Команда валидирует структуру, дубликаты и официальные ссылки LedProjector.

Чтобы быстро понять, какие карточки уже покрывают вопрос, используйте:

```powershell
npm run knowledge:find -- "как выбрать проектор для дома"
```

Чтобы добавить или обновить карточку из отдельного JSON-файла, используйте:

```powershell
npm run knowledge:upsert -- path\to\entry.json
```

По умолчанию команда делает dry-run и ничего не пишет. Для записи добавьте `--apply`.

```powershell
npm run knowledge:upsert -- --apply path\to\entry.json
```

При записи команда делает резервную копию `store-faq.json` перед изменением файла.

## Безопасная установка на OpenCart

Публичный исходный код OpenCart отсутствует на этом компьютере. До изменения production:

1. получить авторизованный доступ к cPanel/FTP/OpenCart Admin;
2. сделать резервные копии файлов и БД;
3. проверить целостность архивов;
4. установить виджет сначала на тестовую копию;
5. выполнить мобильный и desktop smoke-test.

## Проверки

```powershell
npm test
npm run test:cli
curl.exe http://127.0.0.1:8787/health
```

`npm test` не расходует лимит моделей. `npm run test:cli` выполняет один реальный запрос через текущую учётную запись Codex и поэтому зависит от доступного лимита.
