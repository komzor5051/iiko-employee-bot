# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

iiko Shift Bot — Telegram bot for employee shift management with iiko Cloud API and Google Sheets integration. Written in Russian for Russian users.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Development with nodemon hot reload
npm start            # Production
npm run sync-iiko    # Sync iiko employee IDs to Google Sheets
npm run setup-webhook  # Configure iiko webhook (requires WEBHOOK_URL env)
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
│   ├── cronService.js          # Cron-based shift reminders (evening, 1h before start/end)
│   ├── webhookServer.js        # HTTP server for receiving iiko webhooks
│   ├── webhookHandler.js       # Handler for PersonalShift events from iiko
│   └── locationService.js      # Geolocation check for store proximity
├── middleware/
│   ├── logger.js               # Request logging middleware
│   └── errorHandler.js         # Global error handler
└── utils/                      # Constants, messages, keyboards (TODO)
scripts/
├── syncIikoIds.js              # One-time script to match employees by name
└── setupWebhook.js             # Configure iiko webhook endpoint
```

### Data Flow

1. User sends `/start` → Bot checks `Сотрудники` sheet by Telegram ID
2. Unregistered users share phone → Bot matches phone in sheet, saves Telegram ID
3. Shift operations write to `Shift Logs` sheet and optionally call iiko API

### iiko Webhook Flow (reverse sync)

1. Employee opens/closes shift in iiko terminal
2. iiko sends POST to `/iiko-webhook` with PersonalShift event
3. webhookHandler finds employee by iiko_id in Google Sheets
4. Shift is logged to `Shift Logs` and notification sent to employee via Telegram

### Google Sheets Structure

**Сотрудники (Employees)**: `A: Телефон | B: ФИО | C: ТГ username | D: Должность | E: Ставка | F: Telegram ID | G: iiko ID`

**Shift Logs**: `A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Часы | G: Ставка | H: К оплате`

**Расписание (Schedule)**: `A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Напом. вечер | G: Напом. начало | H: Напом. конец`

### Key Patterns

- **Telegraf.js v4**: `bot.command()`, `bot.action()`, `bot.on('contact')`, `Markup` for keyboards
- **iiko token management**: 1h lifetime, auto-refresh 5min before expiry, retry on 401/429/503 with exponential backoff
- **Phone normalization**: All phone comparisons use `normalizePhone()` to strip country code and non-digits
- **Graceful shutdown**: SIGINT/SIGTERM handlers call `bot.stop()`
- **Cron reminders**: node-cron with Asia/Novosibirsk timezone; evening at 20:00, hourly checks every 5 min

### Environment Variables

Required (validated at startup):
- `TELEGRAM_BOT_TOKEN`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (full JSON object as string)

Optional:
- `IIKO_BASE_URL`, `IIKO_API_LOGIN`, `IIKO_ORGANIZATION_ID`, `IIKO_TERMINAL_GROUP_ID`
- `IIKO_WEBHOOK_TOKEN` - secret token for webhook auth (iiko sends in Authorization header)
- `PORT` - HTTP server port for webhooks (default: 3000)
- `ADMIN_TELEGRAM_IDS` (comma-separated)
- `NODE_ENV` (default: development)

### Webhook Setup

1. Add `IIKO_WEBHOOK_TOKEN=your-secret-token` to `.env`
2. Deploy server with public URL (or use ngrok for testing)
3. Run: `WEBHOOK_URL=https://your-domain.com/iiko-webhook npm run setup-webhook`
4. Or configure in iikoWeb: Settings → Cloud API → Webhook settings
