# Tessera

Внутренний dev-документ. Local-first база для Android, Windows, macOS и Linux: React/TypeScript Core + нативные SQLite/Rust/Kotlin, без обязательных сервера, аккаунта и сети.

Версия разработки **0.20.0** (M2), Android **versionCode=21**, dev-схема `tessera-dev-bootstrap-2`. Ниже описан написанный код, а не подтверждение полной приёмки. Единственный текущий статус, доказательства CI, WIP и очередь M1–M7 — [audit.md](audit.md).

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
- HLC/LWW/журнал/baseline/active-paused-detached — примитивы; полного локального протокола, криптографии и почты ещё нет. Тип Secret имеет маскирование и исключён из производных поиска/общих списков/черновиков. Типы/Decimal и локальные формулы с кэшем добавлены в коде M2; его приёмка ещё не завершена. Остальные пробелы смотреть в audit.md.

## Разработка

Нужны Node.js **24.x**, Rust stable и нативные prerequisites Tauri. `npm ci`, затем `npm run dev:desktop`. SQLite bundled, отдельная установка не нужна. `npm run dev` запускает renderer; production browser-storage fallback нет. Playwright использует отдельный test-only HTTP/Node SQLite адаптер.

Windows: Visual Studio Build Tools (Desktop C++/Windows SDK), MSVC Rust, WebView2; [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Dev-профиль `%APPDATA%\app.tessera.personal.dev`, обычный `%APPDATA%\app.tessera.personal`. Не копировать активный `.sqlite` без WAL.

Android: JDK **21**, SDK platform/build-tools **36**, Gradle wrapper. `npm run android:sync`, затем build/test команды ниже; acceptance APK отдельный, тестовый JS в обычную сборку не входит. Конкретные runner/эмуляторные настройки — в [.github/workflows/ci.yml](.github/workflows/ci.yml).

Debug APK подписываются постоянным **публичным тестовым** ключом `android/app/tessera-debug.keystore` (alias `androiddebugkey`, пароль `android`); это не релизная подпись. При переходе с прежних CI APK с временным сертификатом сначала экспортировать БД во внешнюю папку и проверить ZIP; после переустановки импортировать архив. Затем debug-обновления совместимы по подписи. CI проверяет сертификат фактического APK. `npm ci` также применяет checksum-проверенный lifecycle-патч к SQLite 8.1.1: при уничтожении WebView откатить незавершённую транзакцию и закрыть соединения на их рабочем потоке.

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

Обычный push запускает быстрые проверки, обязательный UI ограничен `test:e2e:smoke` (один главный путь сохранения/отмены/перезапуска). Полный `test:e2e` сохранён для итоговой UI-приёмки. Промежуточные коммиты `[skip ci]`; правила/карантин — AGENTS.md, фактические результаты — audit.md. Успешная сборка APK не равна выполнению Android-тестов.

Ручной `ci.yml` по умолчанию использует `native_target=priority`: Android, Windows native и Windows/macOS desktop; Linux-приложение не входит. Android начинается без ожидания Windows Rust. `native_target=all` оставляет полную платформенную матрицу как явную опцию.

Адресный `native_resume=true` — **частичная приёмка**, не полный зелёный HEAD. `priority` требует проверяемого Windows fast/sync baseline и неизменных production/native входов; `android_priority` дополнительно требует успешных Windows native и Windows/macOS desktop baseline, допускает только перечисленные Android lifecycle/signing/test-изменения. Изменения Core/UI/зависимостей запрещают переиспользование. Guards — `scripts/ci-scope.mjs`, их тесты — `tests/unit/ci-scope.test.mjs`; конкретные run ID находятся только в audit.md.

`test:android` по умолчанию выполняет native-контракты данных, Activity recovery и отдельные force-stop/relaunch фазы. Для итогового полного UI/instrumentation набора: `TESSERA_ANDROID_FULL_UI=1 npm run test:android`.
