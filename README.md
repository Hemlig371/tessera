# Tessera

Внутренний dev-документ. Local-first база для Android, Windows, macOS и Linux: React/TypeScript Core + нативные SQLite/Rust/Kotlin, без обязательных сервера, аккаунта и сети.

Версия разработки **0.24.0** (**M6 в разработке, Android encrypted-mail path добавлен, свежая CI-приёмка ещё не подтверждена**; M5 принят на SHA [`48aace2`](https://github.com/Hemlig371/tessera/commit/48aace27cdf4740569327db9ba878a34a47d74be), [run #44919215785](https://github.com/Hemlig371/tessera/actions/runs/44919215785), 8/8 jobs), Android **versionCode=25**, dev-схема `tessera-dev-bootstrap-2`. Ниже описан написанный код, а не подтверждение полной приёмки. Единственный текущий статус, доказательства CI, WIP и очередь M1–M7 — [audit.md](audit.md).

| Документ | Назначение |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Автономная работа, ограничения, пакетная приёмка и решения пользователя |
| [target-specification-v4.0.md](target-specification-v4.0.md) | Главный контракт (не изменять) |
| [ui-specification.md](ui-specification.md) | UX-контракт; UI целиком визуально ещё не принят |
| [tests/fixtures/README.md](tests/fixtures/README.md) | Универсальные dev/CI-библиотеки и целевые сценарии |

## Карта репозитория

Путь данных: **UI → Repository / TS Core → последовательный SQLite-адаптер → native SQLite**. UI не выполняет SQL; Rust/Kotlin реализуют OS/хранилище, бизнес-правила остаются в TS. Состояние приёмки M1–M5, ограничения и текущая работа M6 — только в [audit.md](audit.md).

| Где | Что искать / точка входа |
| --- | --- |
| [src/main.tsx](src/main.tsx), [src/ui/App.tsx](src/ui/App.tsx) | Запуск и маршрутизация экранов; компоненты в `src/ui/`, локали в `src/locales/`, UI-state в `src/ui/store.ts` |
| [src/core/repository.ts](src/core/repository.ts) | Публичный API, транзакционные операции и единая точка записи |
| [model.ts](src/core/model.ts), [ports.ts](src/core/ports.ts), [schema.ts](src/core/schema.ts), [migrate.ts](src/core/migrate.ts) | Доменные типы, порты адаптеров, текущая dev-схема и bootstrap |
| [queries.ts](src/core/queries.ts), [entry-data.ts](src/core/entry-data.ts), [relations.ts](src/core/relations.ts) | SQL-пагинация/фильтры, подготовка данных, прямые и обратные связи |
| [decimal.ts](src/core/decimal.ts), [formula.ts](src/core/formula.ts), [calculated-fields.ts](src/core/calculated-fields.ts), [quick-actions.ts](src/core/quick-actions.ts) | Точная арифметика, парсер/вычисление, кэш/инвалидация и быстрые действия |
| [history.ts](src/core/history.ts), [hlc.ts](src/core/hlc.ts), [change-journal.ts](src/core/change-journal.ts), [trash.ts](src/core/trash.ts) | История, часы, журнал и tombstones — основа принятого M5 local sync |
| [sync-protocol.ts](src/core/sync-protocol.ts), [sync-apply.ts](src/core/sync-apply.ts), [sync-safety.ts](src/core/sync-safety.ts), [local-sync-engine.ts](src/core/local-sync-engine.ts), [local-sync-attachments.ts](src/core/local-sync-attachments.ts) | **M5 принят:** локальные валидированные пакеты, SQLite replay/ACK, 90-дневная защита, файловый mailbox и chunk-передача; шифрование и почтовый SMTP/IMAP транспорт — только M6 |
| [secure-sync-envelope.ts](src/core/secure-sync-envelope.ts), [encrypted-sync-mailbox.ts](src/core/encrypted-sync-mailbox.ts), [sync-pairing.ts](src/core/sync-pairing.ts) | M6: AES-256-GCM authenticated envelopes/receipts/chunks, проверяемая QR-приглашение и защита от переполнения/подделки; M5 core replay не заменяется |
| [mail-sync-cycle.ts](src/platform/mail-sync-cycle.ts), [mail-sync-stage.ts](src/platform/mail-sync-stage.ts), [mail-sync-setup.ts](src/platform/mail-sync-setup.ts), [AndroidMailSyncSettings.tsx](src/ui/AndroidMailSyncSettings.tsx) | M6 Android WIP: ручное включение почтового обмена, SMTP/IMAP plugin, Keystore, QR через ZXing/OS camera, защищённая offline inbox очередь и foreground 15-minute opt-in; Windows/macOS email не готовы |
| [database-archive.ts](src/core/database-archive.ts), [archive-zip.ts](src/core/archive-zip.ts), [attachments.ts](src/core/attachments.ts) | Логический экспорт/импорт, ZIP и файловые ссылки/GC |
| [src/platform/open.ts](src/platform/open.ts), [serial-database.ts](src/platform/serial-database.ts) | Выбор native-платформы и сериализация; остальные адаптеры — рядом |
| [src-tauri/src](src-tauri/src), [src-tauri/sqlite-bridge](src-tauri/sqlite-bridge) | Desktop OS/SQLite/replacement и общий Rust test-driver |
| [android/app/src/main/java/app/tessera/personal](android/app/src/main/java/app/tessera/personal) | Capacitor-плагины, Android файлы/replacement/внешние действия; instrumentation в `android/app/src/androidTest/` |
| [tests](tests), [tests/fixtures/README.md](tests/fixtures/README.md) | `unit` — правила, `db` — общие API на SQLite, `native` — процессы/адаптеры, `e2e` — browser UI, `sync` — пока HLC; общие мосты/контракты в `support` |
| [.github/workflows/ci.yml](.github/workflows/ci.yml), [.github/workflows/ci-status.yml](.github/workflows/ci-status.yml), [scripts/ci-scope.mjs](scripts/ci-scope.mjs) | Основные 8 jobs/артефакты и отдельная публикация ссылочного commit status по завершении push CI; выбор scope/baseline |
| `work/` (ignored) | Локальные SDK/JDK/кэши, логи и scratch; не источник правил или обязательных исходников |

## Разработка

Нужны Node.js **24.x**, Rust stable и нативные prerequisites Tauri. `npm ci`, затем `npm run dev:desktop`. SQLite bundled, отдельная установка не нужна. `npm run dev` запускает renderer; production browser-storage fallback нет. Playwright использует отдельный test-only HTTP/Node SQLite адаптер.

Windows: Visual Studio Build Tools (Desktop C++/Windows SDK), MSVC Rust, WebView2; [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Dev-профиль `%APPDATA%\app.tessera.personal.dev`, обычный `%APPDATA%\app.tessera.personal`. Не копировать активный `.sqlite` без WAL.

Android: JDK **21**, SDK platform/build-tools **36**, Gradle wrapper. `npm run android:sync`, затем build/test команды ниже; acceptance APK отдельный, тестовый JS в обычную сборку не входит. Конкретные runner/эмуляторные настройки — в [.github/workflows/ci.yml](.github/workflows/ci.yml).

Debug APK подписываются постоянным **публичным тестовым** ключом `android/app/tessera-debug.keystore` (alias `androiddebugkey`, пароль `android`); это не релизная подпись. При переходе с прежних CI APK с временным сертификатом сначала экспортировать БД во внешнюю папку и проверить ZIP; после переустановки импортировать архив. Затем debug-обновления совместимы по подписи. CI проверяет сертификат фактического APK. `npm ci` также применяет checksum-проверенный lifecycle-патч к SQLite 8.1.1: при уничтожении WebView откатить незавершённую транзакцию и закрыть соединения на их рабочем потоке.

## Команды (npm run)

| Команда | Назначение |
| --- | --- |
| `check:platforms`, `typecheck`, `lint`, `licenses` | Версии/lock-файлы, TypeScript, ESLint, notices |
| `test:unit` | Правила Core/инфраструктуры; не доказывает native |
| `test:db` / `test:integration` | Node 24 файловая SQLite, API/JSON/FTS/индексы/WAL/rollback/история/файлы/архив/50k |
| `test:sync` | Сейчас только HLC property tests, не готовый sync/chaos |
| `test:native` | Rust SQLite/файлы/replacement/crash; нужен Cargo |
| `test:native-api` | Общие DB-контракты также через Rust driver + native process-death |
| `test:e2e:smoke` | Один необходимый browser UI-сценарий, обязательный в текущем CI |
| `test:e2e` | Playwright/Chromium + явный test-only Node SQLite/files bridge; не Tauri/Capacitor |
| `test:scale` | 50k записей/21 поле/~5k связей; метрики work/scale-*.json |
| `build` | Типы/версии/notices/Vite/запрет тестовых мостов в production |
| `build:desktop` | Tauri-пакет для host OS; native WebView отдельно |
| `build:android` | Production frontend + Capacitor + debug APK |
| `test:android` | Acceptance APK, instrumentation и host force-stop/relaunch |
| `test:all` | Все группы; требует native prerequisites и не нужен после каждой правки |

`npx playwright install chromium` — один раз; целевой UI-файл: `npx playwright test tests/e2e/database-archive.spec.ts`. В Cloud можно использовать `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`; точный браузер CI установлен в `work/playwright-browsers` (`PLAYWRIGHT_BROWSERS_PATH=$PWD/work/playwright-browsers`).

Если Rust установлен только в work: `CARGO_HOME=$PWD/work/cargo RUSTUP_HOME=$PWD/work/rustup PATH=$PWD/work/cargo/bin:$PATH npm run test:native`. Node/Rust driver не проверяет Kotlin/SAF или настоящий WebView.

## Запуск workflow

Workflow: [Tessera checks and native builds](https://github.com/Hemlig371/tessera/actions/workflows/ci.yml). GitHub: **Actions → workflow → Run workflow → main**, затем выбрать inputs. Для CLI нужен авторизованный `gh` с правом запуска Actions; команды выполнять из репозитория после push. Dispatch берёт удалённый main, а не локальный WIP.

```sh
# Быстрые Windows core/DB/sync/build + один browser UI-smoke; без native/APK.
gh workflow run ci.yml --ref main -f full_native=false -f native_target=priority -f native_resume=false

# Приёмка значимого блока: Windows fast/native, Windows/macOS desktop, Android APK + emulator.
gh workflow run ci.yml --ref main -f full_native=true -f native_target=priority -f native_resume=false

# Наблюдение; RUN_ID взять из списка, не подставлять старый baseline как текущий прогон.
gh run list --workflow ci.yml --branch main --limit 5
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log-failed
gh run download RUN_ID -n tessera-android-debug-apk -D work/downloaded-apk
```

Политику частоты запусков/карантина задаёт [AGENTS.md](AGENTS.md); конкретные доказательства, использованный бюджет и run ID — [audit.md](audit.md). Markdown-only изменения не требуют dispatch. `[skip ci]` в промежуточном коммите подавляет автоматический push CI; ручной dispatch остаётся доступным. Для свежей приоритетной приёмки на `main` также разрешён **явный push-коммит с `[priority ci]`**: он запускает Windows fast/native, Windows/macOS desktop, Android APK/эмулятор без Linux application, без resume. На других ветках и в PR маркер не сокращает матрицу.

### Inputs и фактическая область проверки

| Input | Значение |
| --- | --- |
| `full_native` | `true` (ручной default) включает выбранные native/build jobs; `false` оставляет fast + sync, несовместим с resume |
| `native_target=priority` | Ручной default: fast/bridge Windows, desktop Windows x64 + macOS arm64, Android APK/emulator; Linux application исключён |
| `native_target=all` | Fast/bridge Windows+Linux, desktop Windows/macOS/Linux с Linux WebView, Android; явная расширенная матрица |
| `native_target=android` | Без resume: fresh fast Windows+Linux/sync и Android; без bridge/desktop. С resume: отдельные строгие all-platform baseline guards, это не синоним android_priority |
| `native_target=android_priority` | Только APK/emulator, обязательно `native_resume=true` и два проверенных baseline; остальные jobs пропущены |
| `native_target=linux_android` | Legacy продолжение M1: Linux desktop/WebView + Android, обязательно resume и два baseline; не обычный профиль разработки |
| `native_resume` | Default `false`. `true` допускает только ручной запуск на main с full_native=true и доказанным покрытием неизменённых входов |
| `baseline_run` | Числовой ID fast/sync baseline, нужен для resume |
| `native_baseline_run` | Дополнительный ID native/desktop baseline для android_priority/android/linux_android; для priority/all не нужен |

**Push/PR сейчас отличаются от ручного default:** scope выбирает `all`; обычные изменения запускают fast Windows+Linux и sync, а native включается по критическим путям (native/platform, схема/порты, scripts, зависимости, fixtures и т.д.). Маркер `[full ci]` или `[native ci]` в push-коммите также включает native `all`. Поэтому для планового priority checkpoint использовать `[skip ci]` + явный dispatch выше; не вызывать случайно широкую матрицу. Список путей — `ciScope()` в scripts/ci-scope.mjs. Поддержка PR/tags в YAML не разрешает создавать их вопреки AGENTS.md.

Одинаковые ref/event/inputs имеют concurrency group с `cancel-in-progress`: повторный dispatch того же профиля отменяет предыдущий. APK и emulator запускаются параллельно после fast/sync; desktop ждёт bridge. Успешный `android-apk` не означает успешный `android-emulator`.

### Адресное продолжение после сбоя

Resume нужен для неизменённой уже проверенной части, а не для обхода красных тестов. `scope` проверяет через GitHub API последнюю attempt, repo/workflow/main, strict ancestor SHA, конкретные successful jobs/steps и diff входов. Весь baseline run может быть красным из-за другой группы, но переиспользуемые jobs/steps должны быть успешны. Summary фиксирует SHA и границы доказательств.

- `priority + resume`: Windows fast/sync baseline; production/native-входы должны совпадать. Разрешены узкие перечисленные изменения CI/docs/test harness; некоторые сравниваются по содержимому.
- `android_priority + resume`: дополнительно Windows native и Windows/macOS desktop baseline; разрешены только перечисленные Android lifecycle/signing/data-test изменения. Fast и desktop не выполняются заново.
- `all/android/linux_android + resume`: исторические узкие guards M1, с другими требованиями к платформам/изменённым файлам; читать соответствующие validators, не переносить допуски priority автоматически.

```sh
# Шаблон, FAST_RUN_ID / NATIVE_RUN_ID заменить проверенными числовыми ID.
gh workflow run ci.yml --ref main -f full_native=true -f native_target=priority -f native_resume=true -f baseline_run=FAST_RUN_ID

gh workflow run ci.yml --ref main -f full_native=true -f native_target=android_priority -f native_resume=true -f baseline_run=FAST_RUN_ID -f native_baseline_run=NATIVE_RUN_ID
```

Старые M2 baseline **не подходят текущему main с M3-файлами**, даже если они ещё не подключены: production TS изменён, guards должны отказать. После новой функциональности нужна fresh приёмка блока. Ошибку `scope` сначала объяснить diff/доказательствами; не расширять allowlist, чтобы просто получить зелёный статус. Разные SHA и skipped jobs не превращаются в один полный зелёный HEAD.

Артефакты: `tessera-android-debug-apk` — устанавливаемый dev APK; `android-instrumentation-results` — отчёты; `tessera-windows-x64` / `tessera-macos-arm64` / `tessera-linux-x64` — пакеты соответствующих профилей; `scale-metrics-*` и `test-results-*` — метрики/диагностика. Они имеют срок хранения GitHub, не являются опубликованным релизом.

## Как изменять CI дальше

1. Менять jobs/inputs в `.github/workflows/ci.yml` вместе с выбором матриц и guards в `scripts/ci-scope.mjs`, правила профилей — в `tests/unit/ci-scope.test.mjs`. Новое имя job или шага может сломать baseline: validators проверяют точные строки, включая `Run npm run …` и matrix names. Менять и позитивные, и негативные ожидания; отсутствие шага/непокрытый diff/неверный repo/SHA должны отклоняться.
2. Сохранять data/unit/DB/native/kill проверки по рискам. UI-smoke минимальный; полная browser suite — `npm run test:e2e`. Android по умолчанию — data/recreation + 8 force-stop фаз; полный набор локально: `TESSERA_ANDROID_FULL_UI=1 npm run test:android`. Сейчас такого dispatch input нет: для полной Android UI-приёмки в CI нужно явно передать env в emulator job или добавить отдельный проверяемый input, а не считать её уже выполненной.
3. Ближайшие содержательные изменения: при необходимости согласовать push scope с priority (сейчас он all), не добавляя Linux в обычный путь; M3 — включить новые core/DB контракты автоматически существующими scripts и проверить критические пути; M5 — расширить `test:sync` независимыми SQLite/файловым протоколом и chaos, а не оставлять только HLC; M6 — native transport/crypto проверки после M5; M7 — явная широкая UI/сквозная матрица. Это будущие изменения, в текущем YAML они не реализованы.
4. SQLite dependency update требует проверить/обновить pinned hashes и cleanup в `scripts/patch-sqlite-lifecycle.mjs`, локально собрать production/test APK, прогнать lifecycle/recovery. Сохранить проверку production bundle, backup policy и постоянной debug-подписи; release debug-ключом не подписывать.
5. До отправки CI-изменений: `work/actionlint -shellcheck='' .github/workflows/ci.yml` (или установленный actionlint) и `npx vitest run tests/unit/ci-scope.test.mjs`; при изменении JS также lint, при native — локальная компиляция. Эти guard-тесты не запускают облачную матрицу. Затем проверить diff и README. Не тратить полный прогон только на YAML-синтаксис.

GitHub token workflow ограничен `contents: read`, у scope дополнительно `actions: read`; для baseline используется `github.token`. Повышать permissions без конкретной необходимости не требуется. Релизная подпись/публикация и реальные почтовые credentials не входят в этот workflow.
