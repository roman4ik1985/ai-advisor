# ТЗ для независимого testing subagent: Codex OpenTelemetry

## 1. Роль и независимость

Ты — независимый testing subagent. Ты не являешься автором реализации и не должен исправлять код во время основного прогона. Твоя задача — развернуть реализацию на целевой Windows-машине, выполнить тесты, зафиксировать доказательства и выдать итоговый вердикт.

Developer self-check и сообщения `FormalAcceptance=NOT_RUN` не являются доказательством приёмки.

## 2. Объект тестирования

Ветка: `feature/codex-otel-telemetry`.

Компоненты:

- `config/telemetry/otel-collector.yaml`;
- `scripts/telemetry/Telemetry.Common.psm1`;
- `Install-Telemetry.ps1`;
- `Start-Telemetry.ps1`;
- `Stop-Telemetry.ps1`;
- `Get-TelemetryStatus.ps1`;
- `Update-ModelBudgetLog.ps1`;
- `Test-Telemetry.ps1`;
- `config/telemetry/model-budget-calibration.example.json`;
- `docs/TELEMETRY.md`.

## 3. Статусы

Для каждого теста используй только:

- `passed`;
- `failed`;
- `blocked`;
- `not_run`.

Итоговый статус:

- `accepted`;
- `accepted_with_minor_issues`;
- `conditionally_ready`;
- `rejected`;
- `blocked`.

Не ставь `passed`, если проверка не запускалась.

## 4. Подготовка окружения

Зафиксируй до тестов:

- Windows version и architecture;
- PowerShell version;
- Codex version и surface;
- текущий commit SHA;
- выбранную фиксированную версию `otelcol-contrib`;
- состояние портов 4318 и 13133;
- hash исходного `%USERPROFILE%\.codex\config.toml`;
- наличие ранее установленного Collector.

Не публикуй секреты и полный `config.toml`.

## 5. Обязательные тесты

### TEL-001 — официальный пакет и checksum

Запусти установщик с фиксированной версией. Проверь официальный URL, совпадение SHA-256 и прекращение установки при намеренно неверной контрольной сумме/подменённом архиве в изолированном сценарии.

### TEL-002 — backup и безопасный merge TOML

Проверь создание timestamped backup, единственный блок `[otel]`, сохранность unrelated settings и возможность полного rollback.

### TEL-003 — prompt privacy

Проверь `log_user_prompt = false`. Выполни Codex turn с уникальным синтетическим текстом `PROMPT_SENTINEL_<RUN_ID>`. Убедись, что sentinel отсутствует в normalized JSONL, Markdown и test reports. Отдельно проверь raw telemetry и зафиксируй фактическое поведение без публикации содержимого.

### TEL-004 — локальная сетевая изоляция

Проверь, что OTLP receiver слушает только `127.0.0.1:4318`, health — только `127.0.0.1:13133`, нет binding на `0.0.0.0`, IPv6 wildcard и нет нового firewall rule.

### TEL-005 — валидация Collector config

Выполни `otelcol-contrib validate --config ...`. Если выбранная версия не поддерживает команду, выполни foreground startup validation и задокументируй замену метода.

### TEL-006 — lifecycle

Проверь start, status, повторный start, stop, повторный stop, stale PID, PID постороннего процесса и занятый порт. Скрипт не должен завершать посторонний процесс.

### TEL-007 — три OTLP signal

Отправь безопасные синтетические log, trace и metric через OTLP/HTTP. Проверь раздельные файлы и корректный формат JSONL.

### TEL-008 — реальный Codex end-to-end

Перезапусти Codex после изменения config. Выполни безопасный turn: `Ответь одним словом: telemetry-test`. Подтверди фактическое появление Codex telemetry. Без этого теста итог не выше `conditionally_ready`.

### TEL-009 — flush и restart

Проверь получение telemetry во время turn, после turn, после завершения Codex и после batch timeout. Перезапусти Collector и повтори turn.

### TEL-010 — нормализация

Проверь извлечение фактически доступных model, effort, tokens, duration, conversation/turn IDs, sandbox и approval. Поля, отсутствующие в telemetry, должны быть null/unavailable, а не выдуманными.

### TEL-011 — большие числа и повреждённый JSONL

Используй синтетические 64-bit token/timestamp values. Добавь одну повреждённую строку. Обработка должна продолжиться, ошибка — попасть в state без утечки payload.

### TEL-012 — дедупликация и rebuild

Дважды запусти incremental aggregation, затем дважды `-Rebuild`. Повторные записи не допускаются; rebuild должен быть детерминированным кроме явно динамического времени генерации.

### TEL-013 — rotation

На тестовой копии конфигурации уменьши threshold, вызови rotation для всех трёх signal и проверь продолжение записи, число backups и отсутствие двойного подсчёта rotated/current файлов.

### TEL-014 — evidence statuses

Проверь допустимые значения: `measured`, `configured`, `estimated`, `unavailable`. Отсутствующее значение не должно становиться `0`. `speed` не должен автоматически становиться `standard`.

### TEL-015 — weekly budget

Без рабочего calibration ожидаются `weekly_budget_pct=null` и `budget_evidence=unavailable`. На синтетическом calibration допускается только `estimated`. `measured` запрещён.

### TEL-016 — synthetic secret handling

Используй только синтетические маркеры `TEST_SECRET_DO_NOT_PERSIST_<RUN_ID>` и `TEST_API_KEY_DO_NOT_PERSIST_<RUN_ID>`. Проверь normalized output, Markdown, state, collector log и reports. Реальные секреты использовать запрещено.

### TEL-017 — Git hygiene

Проверь, что raw/normalized/state/test-result files не отслеживаются Git. `logs/` уже должен игнорироваться.

### TEL-018 — документация

Выполни установку, запуск, status, aggregation, rebuild, stop и rollback только по `docs/TELEMETRY.md`. Зафиксируй отсутствующие или неверные шаги.

## 6. Формат дефекта

Для каждого дефекта укажи:

- ID;
- severity: Critical/High/Medium/Low;
- test ID;
- environment;
- preconditions;
- exact steps;
- expected;
- actual;
- sanitized evidence;
- reproducibility;
- rollback impact.

Critical: утечка prompt/secret, внешний binding, повреждение config без rollback, внешний exporter, непроверенный бинарник.

High: отсутствует signal, дубли, ложный `measured`, неработающий rollback, несколько Collector-процессов.

## 7. Итоговый отчёт

Создай:

- `logs/telemetry/test-results/acceptance-<RUN_ID>.json`;
- `logs/telemetry/test-results/acceptance-<RUN_ID>.md`.

Отчёт должен содержать версии, commit SHA, таблицу всех TEL-тестов, доказательства, дефекты, retest/regression и итоговый статус.

Система может получить `accepted` только при `passed` для TEL-001—TEL-018 и отсутствии Critical/High дефектов. При невозможности TEL-008 максимум — `conditionally_ready`.
