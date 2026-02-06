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
pm2 start ecosystem.config.js      # Production with PM2
```

## Architecture

Most bot logic (commands, callbacks, location handling) lives in `src/index.js` as a monolith. The `src/handlers/` directory has modular files (registration.js, shift.js, admin.js) but they are not wired up — `index.js` handles everything directly.

### Data Flow

1. User sends `/start` → Bot checks `Сотрудники` sheet by Telegram ID
2. Unregistered users share phone → Bot matches phone in sheet via `normalizePhone()`, saves Telegram ID
3. Shift open/close requires geolocation → `pendingLocationChecks` Map stores action + timestamp, 10min timeout
4. On valid location → shift logged to `Shift Logs` sheet and optionally synced to iiko API
5. Bot uses inline keyboards (`Markup.inlineKeyboard`) for main UI, reply keyboards only for contact/location requests

### iiko Webhook Flow (reverse sync)

1. Employee opens/closes shift in iiko terminal
2. iiko sends POST to `/iiko-webhook` with PersonalShift event
3. `webhookServer.js` validates `Authorization` header (handles both `Bearer TOKEN` and bare `TOKEN` formats)
4. `webhookHandler.js` finds employee by `iiko_id` in Google Sheets
5. Shift is logged to `Shift Logs` and notification sent to employee via Telegram

### Cron Jobs (Asia/Novosibirsk)

All cron jobs use `{ timezone: 'Asia/Novosibirsk' }` option in node-cron. Expressions are in NSK time.

| NSK Time | Cron | Job |
|----------|------|-----|
| 20:00 | `0 20 * * *` | Evening reminders for tomorrow's shifts |
| 22:30 | `30 22 * * *` | Daily report to managers group |
| Every 5 min | `*/5 * * * *` | Check for "1 hour before start/end" reminders |
| Every 15 min | `*/15 * * * *` | Escalation check (late starts >15min, shifts >12h) |

### Google Sheets Structure

**Сотрудники (Employees)**: `A: Телефон | B: ФИО | C: ТГ username | D: Должность | E: Ставка | F: Telegram ID | G: iiko ID`

**Shift Logs**: `A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Часы | G: Ставка | H: К оплате`

**Расписание (Schedule)**: `A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Напом. вечер | G: Напом. начало | H: Напом. конец`

### Key Patterns

- **Telegraf.js v4**: `bot.command()`, `bot.action()`, `bot.on('contact')`, `bot.on('location')`, `Markup` for keyboards
- **iiko token management**: 1h lifetime, auto-refresh 5min before expiry, retry on 401/429/503 with exponential backoff
- **Phone normalization**: All phone comparisons use `normalizePhone()` which strips to 10 digits (removes country code 7/8). This is critical for matching — phones in sheets may be in any format.
- **Location validation**: `pendingLocationChecks` Map in `src/index.js` tracks open/close actions awaiting geolocation (10min timeout, cleaned up every 60s via setInterval)
- **Managers group**: Hardcoded `MANAGERS_GROUP_ID = -5237107467` in `cronService.js` and `testSystem.js` for escalations and daily reports
- **Startup order**: Webhook server starts first (for Railway health checks on `PORT`), then bot launches with retry logic (up to 10 attempts, handles 409 Conflict)
- **Graceful shutdown**: SIGINT/SIGTERM handlers stop webhook server and bot

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
- `NODE_ENV` (default: development)

### Deployment (Railway)

The app starts webhook server first (for Railway health checks on `PORT`), then initializes bot with retry logic. On startup, it calls `deleteWebhook({ drop_pending_updates: true })` to clear any stale polling sessions before launching. Graceful shutdown handlers are registered for SIGINT/SIGTERM.
