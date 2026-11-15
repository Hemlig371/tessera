# Tessera

Личная local-first база для Android и desktop. Источник требований — [target-specification-v4.0.md](target-specification-v4.0.md). Версия **0.2.0, этап 2**; остальная спецификация реализуется последовательно.

Рабочий путь: библиотека → коллекция → поля → явное сохранение записи в нативную SQLite. Доступны переименование, значок/цвет, порядок, удаление с отменой; пять типов: текст, многострочный текст, логическое значение, целое число, календарная дата. Ноль и `false` — полноценные значения. UUID поля не меняется при переименовании; удаление сохраняет его значения в записях. Тип существующего поля не преобразуется автоматически.

Форма, карточка и список настраиваются независимо: порядок, группы, видимость, ширина; у формы — обязательность, подсказки и defaults. У списка — строки/карточки/таблица, SQL-фильтры, сортировка и группировка. Конструктор доступен на мобильной ширине. Поиск по словам/префиксам работает в коллекции, библиотеке и глобально, с Unicode-нормализацией. Большие списки читаются SQL-страницами по 100–200 записей и виртуализируются.

CSV: откройте коллекцию → **CSV**, выберите локаль и файл (UTF-8 или Windows-1251), сопоставьте столбцы, проверьте весь файл и первые десять строк, подтвердите импорт. Импорт добавляет новые записи одной транзакцией: ошибка отменяет весь файл, включая версии и журнал. Ограничение входного файла — 100 МБ. Целые числа проверяются без округления; русская локаль принимает `1 234`, `да/нет`, `дд.мм.гггг`; английская — `1,234`, `yes/no`; ISO-даты и `true/false` поддерживаются обеими. Экспорт позволяет выбрать поля и учитывать текущий поиск/фильтры, читает согласованный снимок БД порциями, сохраняет через стандартный desktop-диалог или Android Storage Access Framework. CSV не заменяет архив полной базы и не переносит историю/конфигурации.

До «Сохранить» запись существует только в форме; «Отмена» ничего не пишет. Сеть, аккаунт и почта не нужны. Браузер без нативного адаптера сообщает об этом; подмены SQLite нет. Совместимость с первоначальным примером-прототипом не требуется.

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
| `check:platforms` | совпадение major/minor установленных JS и Rust Tauri/API/dialog по Cargo.lock |
| `typecheck`, `lint` | строгий TypeScript / ESLint |
| `test:unit` | модель, типы полей, даты, Unicode-ключи, CSV-парсер, локализация |
| `test:db` / `test:integration` | файловая SQLite Node 24: API, миграции, FK, JSON, FTS5, expression index/query plan, WAL/checkpoint, rollback, версии/журнал |
| `test:sync` | **только HLC**: property tests, обратный ход часов, remote clock, tie-break; протокол/почта/chaos ещё не реализованы |
| `test:native` | Rust/rusqlite: перезапуск, backup, FTS5, rollback, типы bridge |
| `test:native-api` | тот же TS DB-контракт также через скомпилированный Rust/rusqlite, dev-only stdio driver в release-режиме для измерений SQLite |
| `test:e2e` | Playwright/Chromium → общий TS API → тестовый loopback bridge → **нативная Node SQLite**; сохранение/отмена/reload, мобильный конструктор пяти типов, независимые layouts, поиск, CSV и виртуализация 50K. Файловый picker подменён явно тестовым download-адаптером. Это не Tauri WebView |
| `test:scale` | 50 000 записей × 20 полей: атомарный импорт, FTS, сортировка, query plan, версии/журнал; метрики в `work/scale-*.json` |
| `test:all` | unit + DB + HLC + Rust/TS native-контракт + Playwright; эмулятор не нужен |
| `build` | frontend, проверка лицензий и notices; публичная веб-версия не поставляется |
| `android:sync` / `dev:android` | frontend → Capacitor / Android Studio |
| `build:android` | устанавливаемый **debug APK**, обычное приложение без тестового кода |
| `test:android` | отдельный `.acceptance` APK и инструментальные тесты, нужен работающий эмулятор |

Все команды вызываются как `npm run <команда>`. В Linux с установленным Chromium можно задать `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. Для установленного Microsoft Edge — `PLAYWRIGHT_CHANNEL=msedge` (в Windows CI используется Edge из runner image). E2E имеет отдельную Vite-конфигурацию; test bridge отсутствует в обычной сборке.

Android: JDK 21, Android Studio/SDK 36, build-tools 36.0.0. Gradle wrapper включён. Локальный `android/local.properties` с `sdk.dir` не коммитится. Community SQLite использует приватный файл **`databases/appSQLite.db`** по собственной конвенции имени; он соответствует desktop `app.sqlite`. Шифрование отключено. Собственный SQLite-плагин не нужен. Backup — `VACUUM INTO` в приватный соседний файл. Отсутствие JSON/FTS5/WAL/FK блокирует запуск. Полная приёмка проверяет настоящий bridge, bind-параметры, индекс и rollback. Во втором этапе отдельный acceptance APK также выполняет typed CRUD, конфигурации, поиск, CSV/rollback и импорт 50K × 20 через community SQLite. Не вводить поля плагина `last_modified`/`sql_deleted`: они включают его неиспользуемые sync-механизмы и переписывание SQL удаления.

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

Миграция 2 расширяет базу этапа 1; checksum миграции 1 сохранён. Перед обновлением создаётся согласованная копия; неизвестная/новая схема не сбрасывается. Тест обновляет реальную v1-схему с записью, историей и журналом, включая сбой DDL и повторную попытку. Пользовательские данные и UUID сохраняются.

Индексы JSON создаются по флагу **«Индексировать»** и постоянным требованиям списка, удаляются при исчезновении обоих оснований. Текстовая сортировка использует локальные нормализованные ключи русского алфавита (`е`, затем `ё`), одинаковые на всех платформах; это не полный ICU Collator для всех языков. FTS/ключи/`search_documents` — производные локальные данные: не попадают в пользовательские версии или журнал, перестраиваются возобновляемыми транзакциями по 200 записей. На desktop длительные SQL-команды исполняются вне UI-потока. Неизвестные UUID значений сохраняются. Конфигурации UI — самостоятельные объекты с UUID/HLC/device/deleted_at и атомарным журналом.

## Карта прототипа

| Источник | Решение |
| --- | --- |
| библиотеки → коллекции, компактные строки, мобильные формы/шторки, оформление | сохранить принципы; минимальный UI перенесён на React |
| параметры ввода/показа, CSV | реализованы заново через TS API; расширенные пресеты, формулы и сводки — следующие этапы |
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

**Проверки этапа 2:** локально выполняются typecheck, lint, unit, DB/API, HLC, Rust, Playwright и production build. Измерения 50K сохраняются в `work/scale-*.json` и CI-артефактах `scale-metrics-*`; они привязаны к машине/адаптеру, без обещания скорости на любом устройстве. Набор содержит 20 простых полей; тысячи связей будут добавлены в нагрузочную проверку вместе с реализацией связей. Android измеряется в отдельном emulator job и выводит `STAGE2_SCALE` в instrumentation report.

**Статус конкретного коммита:** [GitHub Actions](https://github.com/Hemlig371/tessera/actions). Зелёный предыдущий прогон не подтверждает новый код. Сборка APK сама по себе не доказывает выполнение SQLite bridge. При падении JUnit-assert выводится в GitHub Checks, полный отчёт сохраняется артефактом.

**Ручная приёмка:** физический Android/OEM lifecycle, системный выбор CSV на конкретных устройствах, установка и поведение подписанных Windows/macOS сборок. В локальном Cloud нет KVM и GTK/WebKit headers; GUI/emulator-проверки выполняются в CI. APK — debug, desktop-пакеты без релизной подписи. На Android отмена/ошибка экспорта пытается удалить незавершённый SAF-документ; успешное удаление зависит от document provider. Desktop пишет временный файл рядом с целевым и заменяет его после завершения.

**Далее по §16:** этап 3 — связи, индекс связей, обратные поля и блоки связанных записей. Decimal/формулы, полный каталог типов, страховочные черновики, Top-20/корзина, вложения, архив базы, сводки и почтовая синхронизация — последующие задачи. HLC-тесты не означают готовый sync-протокол.
