# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

iiko Shift Bot — Telegram bot for employee shift management with iiko Cloud API and Google Sheets integration. Written in Russian for Russian users.

## Commands

```bash
npm install                    # Install dependencies
npm run dev                    # Development with nodemon hot reload
npm start                      # Production
npm run sync-iiko              # Sync iiko employee IDs to Google Sheets
npm run setup-webhook          # Configure iiko webhook (requires WEBHOOK_URL env)
npm run init-schedule          # Initialize schedule sheet structure
node scripts/testSystem.js     # Run full system test (Google Sheets, iiko API, Telegram, escalation)
pm2 start ecosystem.config.js  # Production with PM2
```

## Architecture

```
src/
├── index.js                    # Entry point with all bot commands/actions
├── bot.js                      # Telegraf instance with middleware setup
├── config/env.js               # Environment validation (exits on missing vars)
├── services/
│   ├── googleSheetsService.js  # Google Sheets CRUD for employees and shifts
│   ├── iikoService.js          # iiko Cloud API with token auto-refresh + webhook config
│   ├── cronService.js          # Cron reminders + escalation + daily reports
│   ├── webhookServer.js        # HTTP server for receiving iiko webhooks
│   ├── webhookHandler.js       # Handler for PersonalShift events from iiko
│   └── locationService.js      # Geolocation check for store proximity
├── handlers/                   # (Modular handlers - currently unused, logic in index.js)
├── middleware/
│   ├── logger.js               # Request logging middleware
│   ├── auth.js                 # Authentication middleware
│   └── errorHandler.js         # Global error handler
└── utils/
    ├── constants.js            # App constants
    ├── messages.js             # Bot message templates
    └── keyboards.js            # Inline/reply keyboard builders
scripts/
├── syncIikoIds.js              # One-time script to match employees by name
├── setupWebhook.js             # Configure iiko webhook endpoint
├── initScheduleSheet.js        # Initialize schedule sheet columns
└── testSystem.js               # Full system test script
```

### Data Flow

1. User sends `/start` → Bot checks `Сотрудники` sheet by Telegram ID
2. Unregistered users share phone → Bot matches phone in sheet, saves Telegram ID
3. Shift operations require geolocation → Bot validates user is within store radius
4. Shift data writes to `Shift Logs` sheet and optionally syncs to iiko API

### iiko Webhook Flow (reverse sync)

1. Employee opens/closes shift in iiko terminal
2. iiko sends POST to `/iiko-webhook` with PersonalShift event
3. webhookHandler finds employee by iiko_id in Google Sheets
4. Shift is logged to `Shift Logs` and notification sent to employee via Telegram

### Cron Jobs (Asia/Novosibirsk timezone)

- **20:00** — Evening reminders for tomorrow's shifts
- **Every 5 min** — Check for "1 hour before start/end" reminders
- **Every 15 min** — Escalation check (late starts, shifts >12h → notify managers group)
- **21:30** — Daily report to managers group (shift summary, hours, payments)

### Google Sheets Structure

**Сотрудники (Employees)**: `A: Телефон | B: ФИО | C: ТГ username | D: Должность | E: Ставка | F: Telegram ID | G: iiko ID`

**Shift Logs**: `A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Часы | G: Ставка | H: К оплате`

**Расписание (Schedule)**: `A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Напом. вечер | G: Напом. начало | H: Напом. конец`

### Key Patterns

- **Telegraf.js v4**: `bot.command()`, `bot.action()`, `bot.on('contact')`, `bot.on('location')`, `Markup` for keyboards
- **iiko token management**: 1h lifetime, auto-refresh 5min before expiry, retry on 401/429/503 with exponential backoff
- **Phone normalization**: All phone comparisons use `normalizePhone()` to strip country code and non-digits
- **Location validation**: `pendingLocationChecks` Map tracks open/close actions awaiting geolocation (10min timeout)
- **Graceful shutdown**: SIGINT/SIGTERM handlers stop webhook server and bot
- **Startup order**: Webhook server starts first (for Railway health checks), then bot with retry logic

### Environment Variables

Required (validated at startup):
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

### Webhook Setup

1. Add `IIKO_WEBHOOK_TOKEN=your-secret-token` to `.env`
2. Deploy server with public URL (or use ngrok for testing)
3. Run: `WEBHOOK_URL=https://your-domain.com/iiko-webhook npm run setup-webhook`
4. Or configure in iikoWeb: Settings → Cloud API → Webhook settings
