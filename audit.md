# Tessera — статус и точка продолжения

Срез 18.11.2026: **0.20.0 / Android code 21**, схема `tessera-dev-bootstrap-2`. **M1/M2 закрыты по обязательной автоматике с test-only UI пробелами ниже; M3 сохранён, не интегрирован и не принят.** Физический телефон не проверен. Одного полного зелёного HEAD нет.

Последний функциональный M2 SHA `e85a97b`; handoff docs `3b9600f`, изолированный M3 WIP `d173e73` (34 файла). Текущий HEAD/дерево проверять Git. Правила/решения — [AGENTS.md](AGENTS.md); карта кода, команды и workflow — [README.md](README.md). Третий полный прогон M2 запрещён: два уже использованы.

## Единственная актуальная очередь

| Блок | Состояние и оставшийся объём |
| --- | --- |
| Фундамент | Есть SQLite/TS Core, CRUD/CSV/FTS/связи/пагинация, библиотеки/каталоги/старты/ярлыки, формы/карточки/профили/пресеты, черновики создания, Top-20/clear markers, корзина/tombstones, файлы/хеши/GC. Merge/HLC/журнал ещё не полный sync |
| M1 — перенос и резерв (§10) | ZIP/manifest/NDJSON, малые оригиналы/заглушки крупных, staging/проверка/rollback/новый device_id, UI export/import и предупреждение об открытом ZIP реализованы. Native/kill подтверждены раздельно; picker-карантин и ручной SAF ниже |
| M2 — типы/формулы (§5) | Точный Decimal/деньги до 5 знаков half-up, типы/Secret/стабильные варианты, безопасные канонические формулы/прямые и обратные агрегаты/кэш/инвалидация/SQL sort/filter/group; UI редактора/предпросмотра и назначаемые быстрые действия без версии. Фикстура «Питание» общая DB/native/Android |
| **M3 — текущий** | Интегрировать Kanban/календарь/дерево, сводки, Сегодня/Неделя и итоги всего запроса. Изолированные исходники/тесты есть; шаги ниже |
| M4 — интеграции (§4.1, §8.5, §9, §12) | Android системная авторизация/биометрия и recent-apps, прямой Share, календарь/напоминания Intent и desktop .ics; диагностика с безопасным экспортом; экран крупных вложений, групповой экспорт/папка, миниатюры. Desktop-блокировки нет |
| M5 — локальный протокол | Независимые SQLite, файловый перенос/baseline архива, типизированные события/курсоры/ACK, повтор/перестановка/пропуск/offline, LWW/Top-20/clear markers/tombstones, pause/resume/detach/recovery; малые chunks/крупные метаданные; test:sync и chaos. Криптографический слой — M6 |
| M6 — после M5 | AES-256-GCM/WebCrypto, QR/secure storage/устройства, нативный SMTP/IMAP, лимиты/долгий offline. Письма не удалять; реальный ящик проверяет пользователь |
| M7 — сквозная приёмка (§14.3–14.4) | ≥50k/20–30 полей/тысячи связей, безопасность, адаптивность/полировка и широкие UI, физические устройства/OEM/SAF. Карантин исправить либо удалить с ведома пользователя. Гант/граф вне v4.0 |

## Доказательства приёмки

Это отдельные SHA/пакеты. Пропущенные jobs не считаются зелёными; сборка не заменяет native runtime.

| SHA / run | Подтверждено | Ограничения |
| --- | --- | --- |
| `9a60212` / [44017728014](https://github.com/Hemlig371/tessera/actions/runs/44017728014) | M1 fast Windows/Linux по 37 UI, sync, Linux native | Windows fsync был красным; desktop/APK/emulator пропущены |
| `e3bb175` / [44083474881](https://github.com/Hemlig371/tessera/actions/runs/44083474881) | Windows/Linux native: по 9 Rust + 287 DB/native; Windows/macOS desktop; Linux AppImage/blob-preview | Picker timeout, Android compile failure; не полный зелёный HEAD |
| `bbcd7a0` / [44087223879](https://github.com/Hemlig371/tessera/actions/runs/44087223879) | M1 Linux WebView/blob, Android archive roundtrip + 8 force-stop фаз, APK | Остальное переиспользовано guard-проверенными baseline; picker в карантине |
| `9edce3c` / [44130302490](https://github.com/Hemlig371/tessera/actions/runs/44130302490), полный M2 №1 | 118 unit + 155 DB на обеих ОС; Linux 37 UI и sync | Windows 36/37, HTTP harness допустил вложенный BEGIN; native/desktop/APK/emulator пропущены |
| `8e614f9` / [44135489364](https://github.com/Hemlig371/tessera/actions/runs/44135489364), полный M2 №2 | Windows fast/37 UI и sync — fast baseline M2 | Linux harness lease после disposal: 25 startup failures; native jobs пропущены. Исправлен teardown auto-fixture, 8 Node/Rust ownership-контрактов + smoke локально зелёные |
| `a242304` / [44140734992](https://github.com/Hemlig371/tessera/actions/runs/44140734992), priority resume | Windows 9 Rust + 329 DB/native; Windows NSIS, macOS arm64 DMG; production APK — native baseline M2 | Android Activity recreation оставила SQLite lock; force-stop не запускались. Linux application исключён |
| `e85a97b` / [44148895679](https://github.com/Hemlig371/tessera/actions/runs/44148895679), Android-only resume | Lifecycle fix: 10 instrumentation data/recreation тестов + 8 force-stop/relaunch фаз, APK/подпись | Windows/native/desktop — проверяемое переиспользование двух baseline выше; широкие UI/Linux application не выполнялись |

Локальные дополнения M1: 75 Node/Rust/serial/ZIP контрактов, убийства SQLite при экспорте/импорте, три Rust recovery-теста (20 rename-границ/повтор recovery/повреждённый журнал). M2 UI-пакет вручную: СУММ(0,1;0,2) → SUM(0.1,0.2), RU/EN, явная ошибка 1/0, 390px/150% dark и 1280px EN без overflow/pageerror. Это ограниченные проверки, не финальная UX-приёмка.

**APK M2:** [0.20.0 / code 21](https://github.com/Hemlig371/tessera/actions/runs/44148895679/artifacts/14356914311), SHA-256 `65ef5c86b6937cfab37e33b22743b0e9eca5d6f477ebdd54f1a3491764ce30c8`. Проверен скачанный APK: `app.tessera.personal`, min24/target36, ARM64, allowBackup=false/исключения переноса, без acceptance bundle, постоянная dev-подпись. Сертификат SHA-256 `ae62fc4e828d4ac9d33bb38117d73cf55df33cab23ecd08e322af1ff6959ee40`. Старые M1/M2 APK подписаны случайными несовместимыми ключами; порядок безопасного перехода — README.

## Известные проблемы и ручная проверка

- **Test-only карантин M1-native-archive-picker**, фрагмент `scripts/desktop-e2e.mjs`: locked Tauri 2.12.5 `__TAURI_INTERNALS__.invoke` read-only, save picker не подменяется, timeout «Экспорт · 0». Две GTK-попытки: ввод без фокуса; явный focus дал двойной `.zip`. Исключён только native UI export/replace, остальные blob/DB/replacement/crash/Android archive обязательны. Перед M7 исправить либо удалить с ведома пользователя.
- **Test-only M2-typed-formulas**, новый UI-черновик не допущен в CI: две правки — неоднозначный результат → ID поля, startup timeout → ожидание готовности. Затем `check()` увидел старый checkbox при async DOM replacement; итоговые данные/UI уже true. До итоговой UI-приёмки не отлаживать повторно. Черновик/trace/context только в `work/m2-ui-quarantine/` и локальном архиве передачи; в Git их нет, при отсутствии можно восстановить необходимый сценарий из требований. Это пробел UI-доказательств, не карантин данных.
- **Исправлено, не карантин:** Windows fsync использует write handle без create/truncate; Android nullable JSObject/O_DIRECTORY исправлены в M1; orphan SQLite lock исправлен на e85a97b. Патч SQLite 8.1.1 выполняет rollback/close на owner thread и проверяется checksum/idempotency; обновление зависимости требует повторной проверки lifecycle.
- Android DocumentsProvider не гарантирует атомарность внешнего ZIP при force-stop финального копирования. Успех только после close; неполный ZIP импорт отклоняет, исходная БД экспортом не меняется.
- Телефон/OEM/реальный SAF/launcher pin/календарные приложения/почта не проверены. На тестовой БД: запись+изображение → офлайн экспорт наружу → проверить ZIP/manifest → изменить запись → проверить/подтвердить импорт → проверить запись/изображение/перезапуск. Повторить на чистой установке и с повреждённым ZIP (БД не меняется). M2: проверить 0.1+0.2, RU/EN, ошибку формулы/агрегат, быстрый счётчик без новой истории, перезапуск. Перед сменой подписи — проверенный внешний экспорт; без него данные не удалять.

## Продолжение M3

1. **Следующая задача — интегрировать M3**, не переписывать готовое. Новые модули `src/core/{relative-dates,date-selection,mode-options,tree-projection,kanban-projection,calendar-projection,collection-projection,query-summary,query-insights,query-formula,grouped-summary,library-summary,summary-data}.ts`, UI CalendarView/KanbanBoard/TreeView/LibrarySummaryView/QueryTotals/QueryTotalsEditor/SummaryFormulaInput + formula-references и collection-modes.css, 12 unit/DB файлов. Они пока не подключены к App/Repository/модели/локалям. Сохранение этого кода не означает готовность режимов или сводок. Версию M3 ещё не повышали.
2. Реализовано в WIP: локальные Today/Week/range без UTC-сдвига; фиксация относительного интервала на многостраничный запрос; точные итоги всего запроса и групп; Kanban со стабильными/архивными/неизвестными ID; календарь 42 дней с диапазонами/формульной датой; дерево 50k без рекурсии, разрыв циклов только в проекции; ограниченные превью и исключение секретов; сводки metric/progress/chart/list/table/calendar/create с валидацией конфигурации. Минимальные UI-компоненты не смонтированы, переводы не добавлены.
3. M3 дальше: добавить `mode/mode_field/date_selection` в ListOptions и итоги в UiDefinition; встроить date-selection в SQL и cursor identity (Today через полночь не должен продолжать старый курсор); freeze интервала на весь обход. Подключить общие Repository API в одной транзакции, редактирование/сохранение config сводок через существующую точку записи/журнал; не создавать DDL. `query-formula` и `library-summary` пока разрешают только локальные ссылки длины 1: расширить путями связей через существующий Calculator, без второго движка. Учесть наследование default profile в queryEntries: собственные фильтры/даты должны явно переопределяться. В tree projection добавлять поля назначенных быстрых действий. Минимально связать App/конструктор/профили/старты библиотек; фильтры отношений показывают подписи записей, не сырые UUID. Проверить архивный roundtrip конфигурации, результаты всех страниц, формулы и ошибки. Полировка/широкие UI только в конце. Один bump M3 до 0.21.0/code 22 при интеграции блока; затем приоритетная пакетная приёмка.

Сохранённый WIP проверен 18.11: typecheck/lint/diff-check, 25 unit+Node DB тестов в 12 файлах; отдельно 12 DB-прогонов Node/Rust в 6 файлах. Это не M3-приёмка. Старые M2 baseline не покрывают эти новые production-файлы, resume на текущем main должен отказать. Следующая функциональная приёмка — fresh priority в конце интеграции M3.

## Передача и история

- Разработка остановлена для передачи по запросу пользователя. Код/правила/очередь в Git; локальный `work/tessera-handoff-2026-11-18.zip` — дополнительный snapshot d173e73 (bundle/APK/карантин/логи), не источник последних изменений. Для продолжения достаточно main; архивная ссылка чата может не скачиваться.
- Исходный прежний M4 WIP `attachment-catalog.ts`, `work/m4-catalog-repository.patch`, `work/tessera-continuation-wip.zip` отсутствовал в этом окружении с начала продолжения, здесь не удалялся. Не объявлять сохранённым/реализованным; при M4 сохранить mediaReferences.
- Окружение `/workspace/tessera`, Node24/gh; SDK/JDK21/Gradle/Rust в ignored work. Общие команды — README. Дополнительный локальный helper `python3 work/run-m2-native-build.py [-Pacceptance]`, driver `src-tauri/sqlite-bridge/target/release/sqlite-test-driver`. Actions secrets были недоступны токену интеграции (403); закреплён одобренный публичный debug key, release credentials не добавлялись.
- Исправленные A/D-дефекты не восстанавливать как очередь. Listener lifecycle — только по новому воспроизводимому дефекту; размер App/Repository сам по себе не задача рефакторинга. Подробности прежней передачи/локальные логи: `git show d173e73:audit.md`, более ранняя история `git show ae95a88:audit.md`.
