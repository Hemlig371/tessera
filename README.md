# Tessera

**Tessera v4.0** — local-first универсальная личная база данных для Android, Windows, macOS и Linux. Библиотеки, коллекции, типизированные поля, связи, Markdown, формы, профили отображения, сводки, история, вложения и необязательная зашифрованная синхронизация работают без обязательного сервера или аккаунта.

**Статус:** предрелизная реализация, ручная приёмка ещё требуется. Текущая версия исходников `0.24.0`, Android `versionCode 25` — это не опубликованный релиз.

## Документы

- [target-specification-v4.0.md](target-specification-v4.0.md) — функциональные требования.
- [ui-specification.md](ui-specification.md) — UX и интерфейс.
- [implementation.md](implementation.md) — фактическая реализация, CI-доказательства, ограничения и ручная приёмка.
- [AGENTS.md](AGENTS.md) — инварианты и правила сопровождения.

Тестовые библиотеки — в [tests/fixtures/README.md](tests/fixtures/README.md); лицензии — [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

## Репозиторий

| Путь | Назначение |
| --- | --- |
| `src/ui/`, `src/locales/` | React UI, состояние, локализация |
| `src/core/` | TypeScript Repository, модель, SQLite, история, архив, sync |
| `src/platform/` | Serial database и платформенные интерфейсы |
| `src-tauri/` | Desktop Tauri/Rust, native SQLite/OS |
| `android/` | Capacitor/Kotlin, ресурсы и instrumentation |
| `tests/` | Unit, DB, browser, native, sync/mail и фикстуры |
| `scripts/` | Сборка, лицензии, CI и native harness |
| `.github/workflows/` | GitHub Actions и статус main |

Данные: **UI → Repository / TS Core → serial database → native SQLite**. Бизнес-правила в общем TS-ядре, не в UI или Kotlin/Rust. Production browser-only SQLite/localStorage fallback отсутствует.

## Разработка и сборка

Node.js **24.x**; desktop — **Rust stable**, [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) (Windows: MSVC/Windows SDK/WebView2); Android — **JDK 21**, Android SDK/build-tools **36**, Gradle wrapper.

~~~sh
npm ci
npm run dev:desktop
npm run build
npm run build:desktop
npm run build:android
~~~

`npm run dev` запускает renderer без production SQLite. Android: `npm run android:sync` или `npm run dev:android`. Команды проверок (через `npm run`): `typecheck`, `check:platforms`, `lint`, `licenses`, `test:unit`, `test:db`, `test:sync`, `test:native`, `test:native-api`, `test:e2e:smoke`, `test:e2e`, `test:greenmail`, `test:android`, `test:scale`. Источник — `package.json`; native/mail тесты требуют специальных окружений.

`npm ci` применяет checksum-проверенный lifecycle-патч SQLite 8.1.1 (`scripts/patch-sqlite-lifecycle.mjs`). Не копировать активный `.sqlite` без WAL-контекста: пользовательский ZIP-архив проверяемый, **но не зашифрован**. Android debug APK использует постоянный **публичный тестовый** `android/app/tessera-debug.keystore` (alias `androiddebugkey`, пароль `android`), не пригодный для релизной подписи. При несовместимой подписи сначала проверить внешний ZIP backup, затем переустановить и импортировать.

## CI

[GitHub Actions — Tessera checks and native builds](https://github.com/Hemlig371/tessera/actions/workflows/ci.yml). Принятый функциональный commit [`bf73d74`](https://github.com/Hemlig371/tessera/commit/bf73d74ace2d6cf4994d1d3eab2067041bf6363e), [run 45005256554](https://github.com/Hemlig371/tessera/actions/runs/45005256554): **9/9 jobs success**. Документационные коммиты `[skip ci]` не дают нового функционального подтверждения.

Ручной запуск: Actions → workflow → Run workflow → `main`, `full_native=true`, `native_target=priority`, `native_resume=false`. Priority покрывает Windows checks/native/desktop, macOS arm64, Android APK/emulator и GreenMail; Linux application отдельно (`native_target=all`). Resume требует строгой верификации baseline и не превращает skipped jobs в passed. Матрицы и guards — `.github/workflows/ci.yml`, `scripts/ci-scope.mjs`, `tests/unit/ci-scope.test.mjs`.

Результат сборки/GreenMail/browser E2E не заменяет ручную приёмку физических устройств, native WebView и почтовых провайдеров. Точные границы — в [implementation.md](implementation.md). Публикация и release tags — только отдельным решением владельца.
