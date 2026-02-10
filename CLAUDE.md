# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

iiko Shift Bot — Telegram bot for employee shift management with iiko Cloud API and Google Sheets integration. Written in Russian for Russian users. Deployed on Railway.

## Commands

```bash
npm install                        # Install dependencies
npm run dev                        # Development with nodemon hot reload
npm start                          # Production
npm run sync-iiko                  # Sync iiko employee IDs to Google Sheets
npm run setup-webhook              # Configure iiko webhook (requires WEBHOOK_URL env)
npm run init-schedule              # Initialize schedule sheet structure
node scripts/testSystem.js         # Full system test (Google Sheets, iiko API, Telegram, escalation)
node scripts/testDailyReport.js    # Test daily report generation
node scripts/syncShifts.js         # Probe iiko API endpoints and check active shifts
pm2 start ecosystem.config.js      # Production with PM2
```

## Architecture

### Monolith in index.js

All bot logic (commands, callbacks, location handling) lives in `src/index.js`. The service layer is in `src/services/`.

**Dead code directories** — these files exist but are **not wired up** (stubs from original plan in `TODO.md`):
- `src/handlers/` — `registration.js`, `shift.js`, `admin.js` (all logic is in `index.js`)
- `src/utils/constants.js`, `messages.js`, `keyboards.js` — empty stubs
- `src/middleware/auth.js` — never imported (auth is inline in `index.js`)

**Active service layer**:
- `src/bot.js` — Telegraf instance with logger and error handler middleware
- `src/services/googleSheetsService.js` — Google Sheets CRUD, employee lookup, shift logging, schedule queries
- `src/services/iikoService.js` — iiko Cloud API with token management and retry logic
- `src/services/locationService.js` — Haversine distance check against store coordinates
- `src/services/cronService.js` — Scheduled reminders, escalation (evening, hourly, and problem checks)
- `src/services/dailyReport.js` — Daily report generation (shared between cron and `/report` command)
- `src/utils/dateUtils.js` — Deterministic date formatting (`formatDateNSK` via `formatToParts`), robust comparison (`dateMatchesRef`), and schedule header parsing (`parseSheetDate` for "10.февр." format)
- `src/services/webhookServer.js` — HTTP server for iiko webhooks + health check
- `src/services/webhookHandler.js` — Processes iiko PersonalShift events into sheet logs + Telegram notifications
- `src/config/env.js` — Environment variable validation and parsing (includes `managersGroupId`)

### Data Flow

1. User sends `/start` → Bot checks `Сотрудники` sheet by Telegram ID
2. Unregistered users share phone → Bot matches phone in sheet via `normalizePhone()`, saves Telegram ID
3. Shift open/close requires geolocation → `pendingLocationChecks` Map stores action + timestamp, 10min timeout
4. On valid location → shift logged to `Shift Logs` sheet and optionally synced to iiko API
5. Bot uses inline keyboards (`Markup.inlineKeyboard`) for main UI, reply keyboards only for contact/location requests

### iiko Cloud API Endpoints

The bot uses iiko Cloud API (`api-ru.iiko.services`):
- `POST /api/1/access_token` — get Bearer token (1h lifetime)
- `POST /api/1/employees/shift/clockin` — open employee shift
- `POST /api/1/employees/shift/clockout` — close employee shift
- `POST /api/1/employees/couriers` — list employees (used by `syncIikoIds.js` script)
- `POST /api/1/webhooks/settings` — get webhook config
- `POST /api/1/webhooks/update_settings` — update webhook config

### iiko Webhook Flow (reverse sync)

1. Employee opens/closes shift in iiko terminal
2. iiko sends POST to `/iiko-webhook` with PersonalShift event
3. `webhookServer.js` validates `Authorization` header (handles both `Bearer TOKEN` and bare `TOKEN` formats)
4. `webhookHandler.js` finds employee by `iiko_id` in Google Sheets
5. Shift is logged to `Shift Logs` and notification sent to employee via Telegram
6. Duplicate protection: if shift already open/closed in sheets, the webhook event is skipped

### Cron Jobs (Asia/Novosibirsk)

All cron jobs use `{ timezone: 'Asia/Novosibirsk' }` option in node-cron. Expressions are in NSK time.

| NSK Time | Cron | Location | Job |
|----------|------|----------|-----|
| 20:00 | `0 20 * * *` | `cronService.js` | Evening reminders for tomorrow's shifts |
| 22:30 | `30 22 * * *` | **`index.js` (top-level)** | Daily report to managers group |
| Every 5 min | `*/5 * * * *` | `cronService.js` | Check for "1 hour before start/end" reminders |
| Every 15 min | `*/15 * * * *` | `cronService.js` | Escalation check (late starts >15min, shifts >12h) |

**Daily report architecture**: The 22:30 report is registered as a top-level `cron.schedule()` in `index.js`, calling `sendDailyReport()` from `src/services/dailyReport.js`. It uses `normalizeDate()` to handle Google Sheets date format mismatches (leading zeros, `/` vs `.`), and reports both closed and still-open shifts. Can be triggered manually via `/report` command. Test with `node scripts/testDailyReport.js` (calls the same function).

### Google Sheets Structure

**Сотрудники (Employees)**: `A: Телефон | B: ФИО | C: ТГ username | D: Должность | E: Ставка | F: Telegram ID | G: iiko ID`

**Shift Logs**: `A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Часы | G: Ставка | H: К оплате`

**Расписание (Schedule)** — календарная матрица:
```
         | 10.февр. | 11.февр. | 12.февр. | ...
Администратор | вт     | ср       | чт       | ...    ← секция (пропускается)
Артем С.  |          | 8:30-21:00 |          | ...    ← сотрудник
Кенан     | 8:30-21:00 | 8:30-21:00 | ...             ← сотрудник
Кухня     |          |          |          | ...    ← секция (пропускается)
```
- Строка 1: заголовки с датами в формате "10.февр." (сокращённые русские месяцы)
- Столбец A: ФИО сотрудника (полное, как в листе Сотрудники) или название секции
- Ячейки: "8:30-21:00" — время смены, пустые = выходной
- Секции (строки без смен в формате время-время) автоматически пропускаются

**Напоминания (Reminders)**: `A: Дата | B: ФИО | C: Тип (evening/start/end)`
- Отдельный лист для трекинга отправленных напоминаний
- Каждая отправка добавляет новую строку
- Используется вместо флагов в расписании (матричный формат не поддерживает per-cell флаги)

### Key Patterns

- **Telegraf.js v4**: `bot.command()`, `bot.action()`, `bot.on('contact')`, `bot.on('location')`, `Markup` for keyboards
- **iiko token management**: 1h lifetime, auto-refresh 5min before expiry, retry on 401/429/503 with exponential backoff (max 3 retries)
- **Phone normalization**: All phone comparisons use `normalizePhone()` in `googleSheetsService.js` which strips to 10 digits (removes country code 7/8). This is critical for matching — phones in sheets may be in any format.
- **Location validation**: `pendingLocationChecks` Map in `src/index.js` tracks open/close actions awaiting geolocation (10min timeout, cleaned up every 60s via setInterval)
- **Managers group**: `MANAGERS_GROUP_ID` configured in `config/env.js` as `managersGroupId` (env var `MANAGERS_GROUP_ID`, default `-5237107467`). Used by `dailyReport.js`, `cronService.js`, and `testSystem.js`
- **Startup order**: Webhook server starts first (for Railway health checks on `PORT`), then bot launches with retry logic (up to 10 attempts, handles 409 Conflict)
- **Graceful shutdown**: SIGINT/SIGTERM handlers stop webhook server and bot
- **All dates/times use NSK timezone**: Date writes use `formatDateNSK()` (from `src/utils/dateUtils.js`) via `Intl.DateTimeFormat.formatToParts` for deterministic DD.MM.YYYY output regardless of server locale. Date comparisons use `dateMatchesRef()` which handles DD.MM.YYYY and falls back to MM/DD/YYYY only when DD.MM is impossible (month > 12). Schedule header dates ("10.февр.") are parsed by `parseSheetDate()` with Russian month abbreviation mapping
- **Schedule reminder tracking**: Reminders are tracked in a separate "Напоминания" sheet (not in-cell flags), using `markReminderSent(dateStr, name, type)` and `isReminderSent()` in `googleSheetsService.js`. Employee lookup for schedule uses `findEmployeeByName()` instead of phone-based matching

### Gotchas

- `IIKO_WEBHOOK_TOKEN` in `env.js` defaults to `'your-secret-token'` — if env var is missing, webhook auth silently uses this default instead of failing
- `TODO.md` is the original development plan, not current TODOs — the actual implementation diverged from the plan (monolith instead of modular handlers, different iiko endpoints)
- Shift duration calculations assume same-day shifts; midnight crossover adds 24h but multi-day shifts are not supported
- `testSystem.js` still has a hardcoded `MANAGERS_GROUP_ID` — update it if the group changes (or switch to `config.managersGroupId`)

### Environment Variables

Required (validated at startup in `src/config/env.js`, exits on missing):
- `TELEGRAM_BOT_TOKEN`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (full JSON object as string)

Optional iiko:
- `IIKO_BASE_URL`, `IIKO_API_LOGIN`, `IIKO_ORGANIZATION_ID`, `IIKO_TERMINAL_GROUP_ID`
- `IIKO_WEBHOOK_TOKEN` — secret token for webhook auth (iiko sends in Authorization header)

Optional geolocation:
- `STORE_LATITUDE` (default: 55.044311)
- `STORE_LONGITUDE` (default: 82.952690)
- `STORE_RADIUS_KM` (default: 0.2)

Optional other:
- `PORT` — HTTP server port for webhooks (default: 3000)
- `ADMIN_TELEGRAM_IDS` (comma-separated)
- `MANAGERS_GROUP_ID` — Telegram group chat ID for reports/escalations (default: -5237107467)
- `NODE_ENV` (default: development)

### Deployment (Railway)

The app starts webhook server first (for Railway health checks on `PORT`), then initializes bot with retry logic. On startup, it calls `deleteWebhook({ drop_pending_updates: true })` to clear any stale polling sessions before launching. Graceful shutdown handlers are registered for SIGINT/SIGTERM.
