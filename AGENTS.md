# AGENTS.md

## Purpose
Единый операционный регламент для проекта `AI Advisor`.

## Default Project Structure
- `raw/sources/` — immutable source materials.
- `raw/web-clipped/` — captured web materials.
- `raw/assets/` — images and attachments.
- `wiki/entities/` — entities.
- `wiki/concepts/` — concepts.
- `wiki/sources/` — source summaries.
- `wiki/synthesis/` — specifications, audits, runbooks, handoffs, and working notes.
- `wiki/index.md` — wiki entrypoint.
- `wiki/log.md` — append-only operation log.
- `docs/` — engineering acceptance reports and Agent OS documentation.
- `knowledge/` — проверенная база знаний консультанта.
- `public/` — публичные ассеты виджета.
- `scripts/` — служебные проверки и редакторские утилиты.
- `src/` — runtime-логика консультанта.
- `test/` — automated checks and smoke helpers.
- `tests/` — isolated Agent OS acceptance checks.

## Core Rules
1. Не класть `OPENAI_API_KEY` и другие секреты в browser code, HTML, `public/` или клиентские ответы.
2. Для `knowledge/store-faq.json` не добавлять статичные утверждения о цене, наличии, акциях и сроках, которые должны идти из live catalog или подтверждаться менеджером.
3. Для knowledge-карточек сохранять `sourceUrl` и `reviewedAt`.
4. Перед изменениями knowledge использовать project tooling: `npm run check:knowledge`, `npm run knowledge:find`, `npm run knowledge:upsert`.
5. `AGENTS.md` менять только для долгоживущих правил, не для разовых задач.
6. Не изменять существующие файлы в `raw/*`, кроме добавления новых source-файлов.
7. Поддерживать `wiki/index.md` и `wiki/log.md` в актуальном состоянии.
8. Для связей между wiki-страницами использовать Obsidian-ссылки `[[...]]`.

## Logging Policy
1. После каждого содержательного пользовательского запроса добавлять короткую запись в `wiki/log.md`.
2. В записи указывать:
   - тип операции (`query`, `implementation`, `config`, `handoff`, `lint`, `ingest`)
   - затронутые файлы
   - краткий итог
3. Канонический logger: `scripts/append-wiki-log.ps1`.
4. Logger пишет UTF-8 без BOM, сохраняет LF и не перезаписывает журнал целиком.
5. Изменения `AGENTS.md` и `wiki/synthesis/handoffs/HANDOFF_TEMPLATE.md` тоже фиксировать в `wiki/log.md`.

## Handoff Policy
1. Перед branch switch, archive длинного треда или переносом contour в новый чат готовить короткий handoff.
2. Минимальный handoff обязан включать:
   - goal
   - what is already done
   - next step
   - key files
3. Канонический файл-шаблон: `wiki/synthesis/handoffs/HANDOFF_TEMPLATE.md`.
4. Если чат стал слишком большим или смешанным и это уже бьет по скорости или точности, рекомендовать новый чат.

## Savepoint Policy
1. Перед стартом нового slice сначала смотреть `git status --short`, если git реально доступен в этом workspace.
2. Перед branch switch и перед переносом продолжения в новый чат делать savepoint через `wiki/log.md` и handoff-файл.
3. `commit` использовать для чистой технической единицы с прозрачным diff.
4. `savepoint` использовать как безопасную точку продолжения, даже если contour еще не завершен.
5. Если текущий change set нельзя честно описать одним предложением, считать scope смешанным и сначала изолировать его.

## Context Efficiency Advisory Policy
1. В содержательных ответах давать короткие практические советы, которые уменьшают раздувание контекста и повторяющиеся ошибки.
2. Следующие шаги и варианты scope помечать как `must-have`, `should-have` или `polish`.
3. При ответе `Что дальше?` разделять:
   - `Что именно (steps, budget)`
   - `Минимальный scope (steps, budget)`

## Multi-Step Task Teaming Policy
1. Многошаговую задачу рассматривать как работу, которую можно делать `solo` или через `subagents`.
2. Перед полным исполнением заметной многошаговой задачи сначала давать короткий план и получать подтверждение пользователя.
3. После подтверждения оценивать оба варианта:
   - `solo`
   - `subagents`
4. Для каждого варианта указывать:
   - количество шагов
   - процент от недельного лимита
5. Для коротких и очевидных задач эта политика не мешает выполнять их сразу.

## Next-Step Format
1. Когда предлагаются следующие шаги, использовать строки:
   - `Что именно (steps, budget)`
   - `Минимальный scope (steps, budget)`
2. Внутри скобок писать ровно два числа:
   - число шагов
   - процент от недельного лимита
3. После этих строк давать короткую разбивку по slice/package.

## Command Normalization Policy
1. Короткие команды и управляющие фразы трактовать без учета регистра.
2. Завершающие `.`, `:`, `?` и одиночный `!` не меняют смысл команды.
3. Если команда уже существует в каноническом виде, вариант с другим регистром или завершающим знаком считать той же командой.

## Action Marker Policy
1. Суффикс `!!` означает execute-now marker для короткой команды.
2. Команды вроде `must-have!!`, `should-have!!`, `polish!!`, `сделай!!` трактовать как команду к действию, а не как brainstorming.
3. `!!` не отменяет safety, scope и savepoint-правила.

## Save Commands Handling Policy
1. Если пользователь явно просит сохранить текст в designated notes file проекта, сохранять весь переданный текст.
2. Не отговаривать от сохранения из-за длины записи.
3. По умолчанию такие записи оформлять в Markdown, если пользователь не запросил иной формат.

## Long-Lived Knowledge Docs Policy
1. Существенные operational-оговорки, редакторские правила и постоянные ограничения проекта хранить в canonical project docs, а не только в чате.
2. Для `AI Advisor` canonical knowledge docs по умолчанию:
   - `wiki/synthesis/specifications/TECHNICAL_SPECIFICATION.md`
   - `wiki/synthesis/audits/AUDIT_REPORT_2026-07-20.md`
   - `README.md`
   - `knowledge/store-faq.json`
   - актуальные `wiki/synthesis/handoffs/HANDOFF_*.md` для временного continuation-контекста
3. Handoff может ссылаться на эти документы, но не должен заменять их как основной source of truth.

## AI Advisor Knowledge Policy
1. Перед изменением knowledge-карточек сначала проверять, нужен ли факт в статической базе знаний, а не в live catalog/runtime.
2. Изменения в `knowledge/store-faq.json` валидировать через `npm run check:knowledge`.
3. Для проверки покрытия вопроса до редактирования использовать `npm run knowledge:find -- "<question>"`.
4. Если добавление делается через отдельный JSON entry-file, предпочитать `npm run knowledge:upsert -- --apply path\\to\\entry.json`.

## Agent OS Workflow
1. Перед началом работы запускать `git status --short` и идентифицировать все незакоммиченные изменения.
2. Проверять активную задачу через `.\scripts\agent-os.ps1 task status`. Если активная задача существует — сначала завершить её или отменить.
3. Создавать задачу через `.\scripts\agent-os.ps1 task new` с обязательными параметрами `-Title`, `-Goal`, `-AllowedScope`, `-ProtectedScope`.
4. Проверять AllowedScope: разрешённые изменения должны попадать только в указанные пути.
5. Проверять ProtectedScope: защищённые файлы (`src/**`, `.env`, `.env.*`, `secrets/**`, `credentials/**`, `.agent-os/state/**`, `.agent-os/logs/**`, `.agent-os/evidence/**`) не должны изменяться.
6. Не изменять файлы вне текущей задачи. Посторонние изменения — parking через `-AutoParkUnrelatedBaseline`.
7. Выполнять обязательные проверки перед commit:
   - `.\scripts\agent-os.ps1 scope check`
   - `.\scripts\agent-os.ps1 park check`
   - `.\scripts\agent-os.ps1 verify run -Profile <name>`
   - `.\scripts\agent-os.ps1 commit check`
8. Добавлять файлы в staging только явно: `git add -- <file1> <file2>`. Запрещены `git add .` и `git add -A`.
9. Завершать задачу с commit hash: `.\scripts\agent-os.ps1 task complete -CommitHash <hash>`.

## Forbidden Git Commands
Следующие команды запрещены в любом контексте работы с проектом:
- `git add .` — массовое добавление всех файлов, включая незакоммиченные изменения вне scope задачи.
- `git add -A` — массовое добавление всех изменений (включая удаления).
- `git reset --hard` — деструктивный сброс worktree, потеря незакоммиченных данных.
- `git clean -fd` — удаление неотслеживаемых файлов и директорий.
- `git push --force` — перезапись истории remote-репозитория.

## Verification Profiles
1. Для AI Advisor определены verification profiles в `.agent-os/config/commands.json`.
2. Использовать профиль `frontend-fast` для быстрой проверки: `lint`, `typecheck`, `test`.
3. Использовать профиль `frontend-full` для полной проверки: `lint`, `typecheck`, `test`, `build`, `smoke`.
4. Несуществующие команды не добавляются формально. Если команда не определена в `package.json`, она пропускается, а не падает.
5. Commit разрешён только после успешного прохождения всех доступных проверок verification profile.
