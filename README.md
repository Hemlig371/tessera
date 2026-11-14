# Tessera

Личная local-first база для Android и desktop. Источник требований — [target-specification-v4.0.md](target-specification-v4.0.md). Сейчас реализуется **этап 1: фундамент**, а не вся спецификация.

Рабочий путь: создать библиотеку → коллекцию с одним текстовым полем → явно сохранить запись → прочитать её из нативной SQLite. До «Сохранить» данные остаются в форме; «Отмена» ничего не пишет. Есть редактирование, проверка обязательного текста, виртуальный список с SQL-пагинацией, русский и английский интерфейс. Сеть, аккаунт и почта не нужны. Обычный браузер показывает требование открыть нативное приложение: подмены хранилища нет.

## Windows x64

Установить Git, **Node.js 24 LTS**, Rust stable (MSVC), Visual Studio Build Tools с workload **Desktop development with C++** и Windows SDK, Microsoft Edge WebView2 Runtime. Tauri 2: [официальные prerequisites](https://v2.tauri.app/start/prerequisites/). SQLite собирается из исходников через rusqlite bundled; отдельно устанавливать SQLite не нужно.

PowerShell:

```powershell
git clone https://github.com/Hemlig371/tessera.git
cd tessera
npm ci
npm run dev:desktop
```

Команда запускает Vite и Tauri с настоящим Rust SQLite. Dev-профиль изолирован: `%APPDATA%\app.tessera.personal.dev\databases\app.sqlite`; обычная сборка — `%APPDATA%\app.tessera.personal\databases\app.sqlite`. Не копируйте активный `.sqlite` отдельно от WAL. Согласованные копии перед миграциями — в `operational/backups/`. Копия создаётся и перед первой миграцией пустой базы.

```powershell
npx playwright install chromium   # один раз для UI-тестов
npm run typecheck
npm run lint
npm run test:all
npm run test:native
npm run test:native-api
npm run build:desktop             # Windows x64 / NSIS
```

После изменения Rust-зависимостей проверить оба Cargo.lock. `cargo test --locked --manifest-path src-tauri/Cargo.toml` требует системные зависимости Tauri; `test:native` проверяет SQLite-адаптер без WebView.

## Команды и границы проверок

| Команда | Проверка |
| --- | --- |
| `typecheck`, `lint` | строгий TypeScript / ESLint |
| `test:unit` | модель, локальное время, локализация |
| `test:db` / `test:integration` | файловая SQLite Node 24: API, миграции, FK, JSON, FTS5, expression index/query plan, WAL/checkpoint, rollback, версии/журнал |
| `test:sync` | **только HLC**: property tests, обратный ход часов, remote clock, tie-break; протокол/почта/chaos ещё не реализованы |
| `test:native` | Rust/rusqlite: перезапуск, backup, FTS5, rollback, типы bridge |
| `test:native-api` | тот же TS DB-контракт также через скомпилированный Rust/rusqlite, dev-only stdio driver |
| `test:e2e` | Playwright/Chromium → общий TS API → тестовый loopback bridge → **нативная Node SQLite**; сохранение/отмена/reload/мобильная ширина/язык. Это не Tauri WebView |
| `test:all` | unit + DB + HLC + Playwright; Rust отдельно, эмулятор не нужен |
| `build` | frontend, проверка лицензий и notices; публичная веб-версия не поставляется |
| `android:sync` / `dev:android` | frontend → Capacitor / Android Studio |
| `build:android` | устанавливаемый **debug APK**, обычное приложение без тестового кода |
| `test:android` | отдельный `.acceptance` APK и инструментальные тесты, нужен работающий эмулятор |

Все команды вызываются как `npm run <команда>`. В Linux с установленным Chromium можно задать `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. Для установленного Microsoft Edge — `PLAYWRIGHT_CHANNEL=msedge` (в Windows CI используется Edge из runner image). E2E имеет отдельную Vite-конфигурацию; test bridge отсутствует в обычной сборке.

Android: JDK 21, Android Studio/SDK 36, build-tools 36.0.0. Gradle wrapper включён. Локальный `android/local.properties` с `sdk.dir` не коммитится. Community SQLite использует приватный файл **`databases/appSQLite.db`** по собственной конвенции имени; он соответствует desktop `app.sqlite`. Шифрование отключено. Собственный SQLite-плагин не нужен. Backup — `VACUUM INTO` в приватный соседний файл. Отсутствие JSON/FTS5/WAL/FK блокирует запуск. Полная приёмка проверяет настоящий bridge, bind-параметры, индекс и rollback. Не вводить поля плагина `last_modified`/`sql_deleted`: они включают его неиспользуемые sync-механизмы и переписывание SQL удаления.

## Структура

| Файлы | Ответственность |
| --- | --- |
| `src/core/ports.ts`, `model.ts`, `hlc.ts` | границы адаптеров, типы, HLC |
| `src/core/schema.ts`, `migrate.ts`, `sqlite-check.ts` | единственный DDL, транзакционные миграции с checksum и backup, приёмка SQLite |
| `src/core/repository.ts` | UUID, библиотеки/коллекции/поля/records JSON, атомарные версии/журнал/FTS |
| `src/platform/` | последовательное соединение, Tauri/community SQLite; без browser fallback |
| `src/ui/`, `src/locales/` | React, Zustand для навигации/форм, TanStack Virtual, i18next ru/en |
| `src-tauri/sqlite-bridge/`, `src-tauri/src/` | узкий Rust-адаптер и Tauri-команды; single-instance writer |
| `android/` | Capacitor-проект, запрет backup ОС, инструментальные тесты |
| `tests/`, `scripts/`, `.github/workflows/ci.yml` | dev/CI-проверки и сборки |
| `AGENTS.md` | постоянные правила проекта |

В схему введены сущности текущего этапа. Связи, UI-конфигурации, вложения и transport state добавляются миграциями без замены records. UUID/HLC/device/deleted_at уже есть. Сохранение создаёт неизменяемую версию и журнал в той же транзакции; неизменённое сохранение их не создаёт. Будущие Top-20/очистка истории и репликация ещё не реализованы. Неизвестные UUID полей сохраняются. Публичных методов удаления/переименования пока нет.

## Карта прототипа

| Источник | Решение |
| --- | --- |
| библиотеки → коллекции, компактные строки, мобильные формы/шторки, оформление | сохранить принципы; минимальный UI перенесён на React |
| пресеты полей, параметры ввода/показа, CSV, предварительный результат формул, сводки | адаптировать на следующих этапах с тестами правил v4 |
| парсер без eval, примеры задач/питания и обратных связей | полезные ориентиры; нужны ID, Decimal и ограниченные запросы |
| sql.js/localStorage, таблица на коллекцию, глобальные скрипты, числовые ID, чтение всех строк | заменить нативной SQLite, общей JSON-моделью, ES-модулями, UUID и пагинацией |
| автосохранение формы, BLOB-вложения, отдельные «Виды», дамп-файл как sync, фиктивная биометрия | не переносить: противоречат v4 либо не выполняют заявленное действие |

Спецификация и исходники изучены до реализации; спецификация включена без изменений. Прототип целиком в новую сборку не копируется.

## Совместимость и лицензии

Зафиксированы package-lock.json и оба Cargo.lock: React 19, TS 6, Vite 8, Zustand 5, TanStack Virtual 3, i18next 27, Capacitor 8.6.2 + community SQLite 8.1.1, Tauri 2, rusqlite 0.42. Peer ranges Capacitor совместимы; Node 24/JDK 21 покрывают toolchain. React Compiler не включён; imperative API TanStack Virtual используется напрямую.

Основные npm-библиотеки — MIT; Tauri/rusqlite — MIT/Apache-2.0; SQLite — public domain; AndroidX — Apache-2.0; SQLCipher Community (транзитивная Android-зависимость, шифрование **не используется**) — BSD-style. Платная лицензия/служба не нужна. WebKitGTK — LGPL/BSD, динамическая системная библиотека. `npm run licenses` проверяет production npm-лицензии и генерирует [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt), включаемый в desktop/Android. Он содержит также неиспользуемые web-зависимости community SQLite; их наличие в npm-дереве не означает browser fallback. Нативные транзитивные notices и подписи требуют финального аудита перед публичным релизом. MIT-лицензия репозитория сохранена.

## CI и состояние этапа

Workflow: **любой push (включая tags), pull_request и вручную**. Сначала Ubuntu/Windows checks и HLC property tests, затем Windows x64 NSIS, macOS ARM64 DMG, Linux x64 AppImage, Android debug APK и API 35 x86_64 emulator. Артефакты загружаются после успешных проверок. Tags пока дают Actions-артефакты без публичного релиза. Сборки не подписаны релизными сертификатами; секретов в репозитории нет.

В CI предусмотрены Windows `tauri dev` smoke (WebView должен исполнить TS-миграции в нативной БД), Linux Tauri/WebKit WebDriver E2E с перезапуском процесса и Android WebView/Capacitor-контракт с повторным открытием БД. Merged manifest проверяется отдельно. Acceptance JS собирается только отдельной test-конфигурацией/application ID; обычные APK/desktop этих тестов не содержат.

**Локально проверено в Linux Cloud:** typecheck, lint, frontend build/Capacitor sync; 3 unit, 11 Node DB, 3 HLC/property tests (200 случайных последовательностей), 1 Playwright E2E, 2 Rust tests; полный TS-контракт — 22 проверки Node + Rust. Rust действительно скомпилирован и использует bundled SQLite.

**Пока не подтверждено:** Windows dev, полная Tauri-сборка/нативный WebView, macOS/Windows/AppImage/APK артефакты, Android Emulator. В Cloud нет GTK/WebKit headers, Android SDK/KVM и Windows/macOS. Наличие workflow не считается успешным CI; результаты первого запуска будут указаны в отчёте. Физический Android/OEM lifecycle и установка подписанных сборок — последующая ручная приёмка.

**Далее по §16:** подтвердить платформенный фундамент в CI, затем этап 2 — CRUD структуры со стабильными ID, начальный мобильный конструктор отдельных формы/карточки/списка, ограниченный набор типов, индексы/поиск и CSV. Почта, весь конструктор, все типы, черновики, Top-20, корзина и вложения сейчас не реализованы. HLC-тесты не означают готовую синхронизацию.
