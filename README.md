# iiko Shift Bot

Telegram-бот для управления сменами сотрудников с интеграцией iiko Cloud API и Google Sheets.

## Технологии

- Node.js + Telegraf.js v4
- Google Sheets API
- iiko Cloud API
- node-cron (автоматические напоминания)

## Установка

```bash
npm install
```

## Настройка

1. Скопируйте `.env.example` в `.env`
2. Заполните все необходимые переменные окружения
3. Настройте Google Sheets (3 листа: Employees, Schedule, Shift Logs)
4. Дайте доступ Service Account к таблице

## Запуск

```bash
# Development
npm run dev

# Production
npm start

# С PM2
pm2 start ecosystem.config.js
```

## Структура проекта

```
src/
├── handlers/       # Обработчики команд
├── services/       # Бизнес-логика
├── middleware/     # Middleware
├── utils/          # Утилиты
└── config/         # Конфигурация
```

## Функционал

- Регистрация по номеру телефона через Google Sheets
- Открытие/закрытие смены с геолокацией
- Интеграция с iiko Cloud API
- Автоматические напоминания (4 типа)
- Админ-команды
