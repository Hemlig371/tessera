# Tessera

Внутренний dev-документ. Local-first база для Android, Windows, macOS и Linux: React/TypeScript Core + нативные SQLite/Rust/Kotlin, без обязательных сервера, аккаунта и сети.

Версия **0.19.0**, Android **versionCode=20**, dev-схема `tessera-dev-bootstrap-2`. Ниже описан написанный код, а не подтверждение полной приёмки. Единственный текущий статус, доказательства CI, WIP и очередь M1–M7 — [audit.md](audit.md).

| Документ | Назначение |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Автономная работа, ограничения, пакетная приёмка и решения пользователя |
| [target-specification-v4.0.md](target-specification-v4.0.md) | Главный контракт (не изменять) |
| [ui-specification.md](ui-specification.md) | UX-контракт; UI целиком визуально ещё не принят |
| [tests/fixtures/README.md](tests/fixtures/README.md) | Универсальные dev/CI-библиотеки и целевые сценарии |

## Текущие возможности и границы

- Библиотеки/коллекции/UUID-поля, записи/поиск/FTS/связи/SQL-пагинация; каталоги, настраиваемые старты и Android-ярлыки (подтверждение лаунчера вручную).
- Отдельные формы/карточки/списки, конструктор, именованные профили/пресеты, быстрые формы, Markdown, ручные «Входящие» и перенос. Тема/плотность/100–150% текста локальны для устройства. Android Share пока отсутствует.
- Явное Save, stale-form HLC, локальный черновик только создания (один на коллекцию), Top-20/восстановление/clear markers; общая корзина 7/14/30/90/бессрочно, restore/purge с терминальными tombstones.
- File/image, приватные оригиналы/UUID/SHA-256, staging до Save, порции IO, история файлов/GC/проверка хеша, возврат/экспорт локальной копии, предупреждение о последней известной копии. Экран крупных вложений, групповой экспорт и кэш миниатюр остаются M4.
- Код M1: WAL-согласованный логический snapshot, ZIP STORE/ZIP64 с manifest.json/NDJSON/малыми оригиналами/хешами, крупные и отсутствующие — заглушки. Архив не зашифрован и содержит plaintext Secret; парольной защиты в v4.0 нет. DDL/производные/OS-секреты/ключи/пароли почты/локальные очереди/черновики не входят; NDJSON-часть и manifest ограничены 64 МиБ. Импорт проверяет архив в отдельном хранилище, заменяет базу без слияния после подтверждения/предложения экспорта, создаёт новый device_id и сохраняет либо отделяет dataset_id. Границы приёмки — в audit.md.
- HLC/LWW/журнал/baseline/active-paused-detached — примитивы; полного локального протокола, криптографии и почты ещё нет. Secret исключён из производных поиска, но полноценный тип/UI — M2. Остальные пробелы смотреть в audit.md.

## Разработка

Нужны Node.js **24.x**, Rust stable и нативные prerequisites Tauri. `npm ci`, затем `npm run dev:desktop`. SQLite bundled, отдельная установка не нужна. `npm run dev` запускает renderer; production browser-storage fallback нет. Playwright использует отдельный test-only HTTP/Node SQLite адаптер.

Windows: Visual Studio Build Tools (Desktop C++/Windows SDK), MSVC Rust, WebView2; [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Dev-профиль `%APPDATA%\app.tessera.personal.dev`, обычный `%APPDATA%\app.tessera.personal`. Не копировать активный `.sqlite` без WAL.

Android: JDK **21**, SDK platform/build-tools **36**, Gradle wrapper. `npm run android:sync`, затем build/test команды ниже; acceptance APK отдельный, тестовый JS в обычную сборку не входит. Конкретные runner/эмуляторные настройки — в [.github/workflows/ci.yml](.github/workflows/ci.yml).

До публичного релиза один bootstrap, без переходов между dev-схемами. Несовместимую базу не удалять: сохранять каталог и использовать совместимую сборку для доступного экспорта. После релиза — последовательные миграции/snapshots/recovery, без небезопасного downgrade. «Экспорт/Импорт БД» — единственная пользовательская backup-функция, CSV — обмен строками коллекции.

## Команды (npm run)

| Команда | Назначение |
| --- | --- |
| `check:platforms`, `typecheck`, `lint`, `licenses` | Версии/lock-файлы, TypeScript, ESLint, notices |
| `test:unit` | Правила Core/инфраструктуры; не доказывает native |
| `test:db` / `test:integration` | Node 24 файловая SQLite, API/JSON/FTS/индексы/WAL/rollback/история/файлы/архив/50k |
| `test:sync` | Сейчас только HLC property tests, не готовый sync/chaos |
| `test:native` | Rust SQLite/файлы/replacement/crash; нужен Cargo |
| `test:native-api` | Общие DB-контракты также через Rust driver + native process-death |
| `test:e2e` | Playwright/Chromium + явный test-only Node SQLite/files bridge; не Tauri/Capacitor |
| `test:scale` | 50k записей/21 поле/~5k связей; метрики work/scale-*.json |
| `build` | Типы/версии/notices/Vite/запрет тестовых мостов в production |
| `build:desktop` | Tauri-пакет для host OS; native WebView отдельно |
| `build:android` | Production frontend + Capacitor + debug APK |
| `test:android` | Acceptance APK, instrumentation и host force-stop/relaunch |
| `test:all` | Все группы; требует native prerequisites и не нужен после каждой правки |

`npx playwright install chromium` — один раз; целевой UI-файл: `npx playwright test tests/e2e/database-archive.spec.ts`. В Cloud можно использовать `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`; точный браузер CI установлен в `work/playwright-browsers` (`PLAYWRIGHT_BROWSERS_PATH=$PWD/work/playwright-browsers`).

Если Rust установлен только в work: `CARGO_HOME=$PWD/work/cargo RUSTUP_HOME=$PWD/work/rustup PATH=$PWD/work/cargo/bin:$PATH npm run test:native`. Node/Rust driver не проверяет Kotlin/SAF или настоящий WebView.

## CI и расположение кода

Обычный push — быстрые проверки; критические native/схемные/сборочные пути и `[full ci]`/`[native ci]` выбирают полную матрицу. Промежуточные коммиты `[skip ci]`. Ритм/карантин — AGENTS.md, фактические результаты — audit.md; успешная сборка APK не равна выполнению Android-тестов.

- Полный ручной: `gh workflow run ci.yml --ref main -f full_native=true`.
- Только быстрые: тот же вызов с `full_native=false`.
- Android при доказанно неизменённых остальных исходниках: `full_native=true -f native_target=android`; это частичная приёмка.
- Продолжить незавершённую native-приёмку: `gh workflow run ci.yml --ref main -f full_native=true -f native_resume=true -f baseline_run=44017728014`. Guard требует completed push/main того же workflow, успешные быстрые Linux/Windows + sync jobs, строгого предка HEAD и неизменность всех исходников/зависимостей/фикстур кроме `replacement_store.rs`, gate/его тестов и документов `AGENTS.md`, `audit.md`, `README.md`, `tests/fixtures/README.md`. Все native jobs выполняются заново; это частичная приёмка с явно указанным baseline, не полный зелёный CI нового HEAD.
- Для исправлений Android import после успешной desktop/native-части: добавить `-f native_target=android -f native_baseline_run=44083474881`. Второй baseline обязан завершиться с успешными обоими native jobs и всеми тремя desktop jobs; после него допустимы только два Android import-адаптера, gate/его тесты и README/audit. APK и эмулятор выполняются заново. Изменения других Android-файлов или desktop/Core/UI требуют нового подходящего набора проверок.
- Если остаётся Linux WebView вместе с Android: `-f native_target=linux_android -f native_baseline_run=44083474881`. Требуются оба native jobs и Windows/macOS desktop baseline; Linux desktop/WebView выполняется заново. Дополнительно допустима правка только `scripts/desktop-e2e.mjs`. Результат не подтверждает Android или Linux до фактического успеха соответствующих jobs.
- Дополнительные профили смотреть в workflow. Нельзя ослаблять проверки или обходить красные тесты данных; при недопустимом diff resume завершается ошибкой.

`src/core/` — модель/правила/DDL/архив; `src/platform/` — адаптеры; `src/ui/` — UI; `src-tauri/` и `android/` — OS/SQLite; `tests/fixtures/` и `tests/support/` — только dev/CI. `work/`, node_modules, target, dist, test-results и Android build-каталоги игнорируются; не читать их рекурсивно и не коммитить результаты тестов/секреты. Toolchains и актуальные WIP/логи M1 сохранены; старые UI-материалы — work/retired-ui-0.18.zip.

Публичных релизных tags/релизов нет. Лицензия — [LICENSE](LICENSE), зависимости — [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). Релизные подписи, реальные устройства/почтовые провайдеры и окончательная UX-приёмка остаются отдельной приёмкой.
