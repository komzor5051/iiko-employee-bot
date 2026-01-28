# План разработки Telegram-бота для управления сменами с iiko

## Обзор проекта

**Цель**: Создать Telegram-бота для автоматизации учета рабочих смен сотрудников с интеграцией iiko Cloud API и Google Sheets.

**Технологический стек**:
- Node.js + Telegraf.js v4
- Google Sheets API (авторизация сотрудников + логирование)
- iiko Cloud API (открытие/закрытие смен)
- node-cron (автоматические напоминания)
- Axios (HTTP-клиент)
- dotenv (переменные окружения)

---

## Структура проекта

```
iiko-shift-bot/
├── src/
│   ├── index.js                    # Точка входа
│   ├── bot.js                      # Инициализация Telegraf
│   ├── handlers/
│   │   ├── registration.js         # Регистрация по номеру телефона
│   │   ├── shift.js                # Открытие/закрытие смены
│   │   ├── admin.js                # Админские команды
│   │   └── index.js
│   ├── services/
│   │   ├── googleSheetsService.js  # Работа с Google Sheets
│   │   ├── iikoService.js          # Интеграция iiko Cloud API
│   │   ├── locationService.js      # Проверка геолокации
│   │   └── cronService.js          # Напоминания по расписанию
│   ├── middleware/
│   │   ├── auth.js                 # Проверка регистрации
│   │   ├── errorHandler.js         # Обработка ошибок
│   │   └── logger.js               # Логирование
│   ├── utils/
│   │   ├── constants.js            # Константы, координаты точек
│   │   ├── messages.js             # Текстовые шаблоны
│   │   └── keyboards.js            # Клавиатуры бота
│   └── config/
│       └── env.js                  # Валидация переменных окружения
├── .env.example
├── .gitignore
├── package.json
├── ecosystem.config.js             # PM2 конфигурация
└── README.md
```

---

## Детальный план разработки (поэтапно)

### ЭТАП 1: Инициализация проекта и настройка окружения (30 мин)

**Цель**: Подготовить базовую структуру проекта

#### 1.1 Создать структуру папок
```bash
mkdir -p iiko-shift-bot/src/{handlers,services,middleware,utils,config}
cd iiko-shift-bot
npm init -y
```

#### 1.2 Установить зависимости
```bash
npm install telegraf axios googleapis dotenv node-cron
npm install --save-dev nodemon
```

#### 1.3 Создать файлы конфигурации

**package.json** - добавить скрипты:
```json
{
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js"
  }
}
```

**.env.example**:
```
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Google Sheets
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# iiko Cloud API
IIKO_BASE_URL=https://api-ru.iiko.services
IIKO_API_LOGIN=your_api_login
IIKO_ORGANIZATION_ID=your_org_id
IIKO_TERMINAL_GROUP_ID=your_terminal_group_id

# Admin
ADMIN_TELEGRAM_IDS=123456789,987654321

# Environment
NODE_ENV=development
```

**.gitignore**:
```
node_modules/
.env
*.log
```

#### 1.4 Создать базовую структуру файлов (пустые заготовки)

---

### ЭТАП 2: Настройка Google Sheets API (45 мин)

**Цель**: Реализовать сервис для работы с Google Sheets

#### 2.1 Структура Google Sheets

**Лист "Employees"** (авторизация):
| telegram_id | phone        | full_name      | position  | hourly_rate | iiko_employee_id |
|-------------|--------------|----------------|-----------|-------------|------------------|
| 123456789   | +79991234567 | Иванов Иван    | Бариста   | 300         | emp_001          |
| 987654321   | +79997654321 | Петрова Мария  | Официант  | 250         | emp_002          |

**Лист "Schedule"** (расписание смен):
| telegram_id | phone        | full_name      | position  | hourly_rate | iiko_employee_id | shift_date | shift_start_time |
|-------------|--------------|----------------|-----------|-------------|------------------|------------|------------------|
| 123456789   | +79991234567 | Иванов Иван    | Бариста   | 300         | emp_001          | 2025-01-15 | 09:00            |
| 987654321   | +79997654321 | Петрова Мария  | Официант  | 250         | emp_002          | 2025-01-15 | 10:00            |

**Лист "Shift Logs"** (логирование):
| telegram_id | full_name      | start_time          | end_time            | hours_worked | hourly_rate | total_payment | date       |
|-------------|----------------|---------------------|---------------------|--------------|-------------|---------------|------------|
| 123456789   | Иванов Иван    | 2025-01-14 09:05:32 | 2025-01-14 17:03:15 | 7.96         | 300         | 2388          | 2025-01-14 |

#### 2.2 Создать `src/services/googleSheetsService.js`

**Функционал**:
```javascript
class GoogleSheetsService {
  constructor(serviceAccountJson, spreadsheetId)

  // Авторизация
  async findEmployeeByPhone(phone)              // Поиск в листе "Employees"
  async updateTelegramId(phone, telegramId)     // Обновление telegram_id

  // Расписание
  async getTodaySchedule()                      // Смены на сегодня
  async getTomorrowSchedule()                   // Смены на завтра (для night reminder)
  async getScheduleForUser(telegramId)          // Расписание конкретного юзера

  // Логирование смен
  async logShiftStart(data)                     // Запись начала смены
  async logShiftEnd(data)                       // Запись окончания смены

  // Админ
  async updateHourlyRate(employeeId, newRate)   // Обновление ставки
}
```

**Ключевые моменты**:
- Использовать `googleapis` пакет
- Service Account авторизация через JSON ключ
- Обработка ошибок (лист не найден, нет доступа)
- Кеширование auth клиента

**Пример реализации метода**:
```javascript
async findEmployeeByPhone(phone) {
  const range = 'Employees!A2:F1000';
  const response = await this.sheets.spreadsheets.values.get({
    spreadsheetId: this.spreadsheetId,
    range,
  });

  const rows = response.data.values || [];
  const employee = rows.find(row => row[1] === phone);

  if (!employee) return null;

  return {
    telegram_id: employee[0] || null,
    phone: employee[1],
    full_name: employee[2],
    position: employee[3],
    hourly_rate: parseFloat(employee[4]),
    iiko_employee_id: employee[5]
  };
}
```

---

### ЭТАП 3: Интеграция iiko Cloud API (60 мин)

**Цель**: Создать сервис для работы с iiko API

#### 3.1 Создать `src/services/iikoService.js`

**Функционал**:
```javascript
class IikoService {
  constructor(baseUrl, apiLogin, organizationId, terminalGroupId)

  // Управление токеном
  async getAccessToken()                        // Получить токен (lifetime: 1 час)
  async ensureValidToken()                      // Проверка и авто-обновление токена

  // Работа со сменами
  async openShift(iikoEmployeeId)              // Открыть смену (clock-in)
  async closeShift(iikoEmployeeId)             // Закрыть смену (clock-out)
  async getShiftStatus(iikoEmployeeId)         // Проверить статус текущей смены

  // Вспомогательные
  async makeRequest(endpoint, method, body)    // HTTP запросы с retry
}
```

**Ключевые моменты**:
- **Токен**: хранить в памяти с timestamp, обновлять за 5 минут до истечения
- **Retry логика**: exponential backoff для 429 (rate limit) и 503 ошибок
- **Эндпоинты**:
  - `POST /api/1/auth/access_token` - получение токена
  - `POST /api/1/employees/openPersonalSession` - открытие смены
  - `POST /api/1/employees/closePersonalSession` - закрытие смены

**Пример реализации**:
```javascript
async openShift(iikoEmployeeId) {
  const token = await this.ensureValidToken();

  const response = await axios.post(
    `${this.baseUrl}/api/1/employees/openPersonalSession`,
    {
      organizationId: this.organizationId,
      employeeId: iikoEmployeeId,
      terminalGroupId: this.terminalGroupId
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}
```

**Обработка ошибок**:
- 401 Unauthorized → обновить токен и повторить
- 429 Too Many Requests → exponential backoff retry
- 400 Bad Request → логировать и выбросить ошибку

---

### ЭТАП 4: Сервис геолокации (30 мин)

**Цель**: Проверка расстояния до точки через Haversine formula

#### 4.1 Создать `src/utils/constants.js`

**Хранение координат терминалов**:
```javascript
// Координаты точек (будет масштабироваться)
const TERMINAL_LOCATIONS = [
  {
    id: 1,
    name: 'Кофейня "Центральная"',
    latitude: 55.030199,
    longitude: 82.920430,
    maxDistance: 150  // метры
  },
  // Будут добавляться новые точки
];

const MESSAGES = {
  LOCATION_TOO_FAR: '❌ Ты слишком далеко от точки. Подойди ближе (макс. 150м).',
  LOCATION_SUCCESS: '✅ Геолокация подтверждена!',
  // ...
};

module.exports = { TERMINAL_LOCATIONS, MESSAGES };
```

#### 4.2 Создать `src/services/locationService.js`

**Функционал**:
```javascript
class LocationService {
  // Haversine formula - расчет расстояния между двумя точками
  calculateDistance(lat1, lon1, lat2, lon2)     // Возвращает расстояние в метрах

  // Проверка близости к любой из точек
  findNearestTerminal(userLat, userLon)         // Ищет ближайший терминал

  // Валидация
  isWithinRange(userLat, userLon, terminalId)   // true если < 150м
}
```

**Реализация Haversine**:
```javascript
calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Радиус Земли в метрах
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Расстояние в метрах
}

findNearestTerminal(userLat, userLon) {
  const terminals = TERMINAL_LOCATIONS.map(terminal => ({
    ...terminal,
    distance: this.calculateDistance(
      userLat, userLon,
      terminal.latitude, terminal.longitude
    )
  }));

  // Сортируем по расстоянию
  terminals.sort((a, b) => a.distance - b.distance);

  const nearest = terminals[0];

  return {
    terminal: nearest,
    isInRange: nearest.distance <= nearest.maxDistance
  };
}
```

---

### ЭТАП 5: Telegram Bot - Регистрация (45 мин)

**Цель**: Реализовать авторизацию сотрудников через номер телефона

#### 5.1 Создать `src/bot.js`

```javascript
const { Telegraf, Markup } = require('telegraf');
const config = require('./config/env');

const bot = new Telegraf(config.telegramToken);

// Middleware
bot.use(require('./middleware/logger'));
bot.use(require('./middleware/errorHandler'));

// Handlers
require('./handlers')(bot);

module.exports = bot;
```

#### 5.2 Создать `src/handlers/registration.js`

**Флоу регистрации**:
1. `/start` → Запрос номера телефона через кнопку
2. Получение контакта → Поиск в Google Sheets
3. Если найден → Сохранить telegram_id, приветствие
4. Если не найден → Сообщение с контактом менеджера

**Реализация**:
```javascript
module.exports = (bot, sheetsService) => {
  // Команда /start
  bot.command('start', async (ctx) => {
    const telegramId = ctx.from.id;

    // Проверяем, зарегистрирован ли
    const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

    if (employee) {
      return ctx.reply(
        `Привет, ${employee.full_name}! 👋\n\n` +
        `Должность: ${employee.position}\n` +
        `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
        `Используй /open для открытия смены`
      );
    }

    // Не зарегистрирован - запрашиваем номер
    await ctx.reply(
      'Добро пожаловать! 👋\n\n' +
      'Для регистрации нужен твой номер телефона.',
      Markup.keyboard([
        Markup.button.contactRequest('📱 Отправить номер телефона')
      ])
        .oneTime()
        .resize()
    );
  });

  // Обработка контакта
  bot.on('contact', async (ctx) => {
    const phone = ctx.message.contact.phone_number;
    const telegramId = ctx.from.id;

    // Нормализуем номер
    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    // Ищем в Google Sheets
    const employee = await sheetsService.findEmployeeByPhone(normalizedPhone);

    if (!employee) {
      return ctx.reply(
        '❌ Ты не найден в базе сотрудников.\n\n' +
        'Обратись к менеджеру:\n' +
        '@manager_username или +7-XXX-XXX-XXXX',
        Markup.removeKeyboard()
      );
    }

    // Сохраняем telegram_id
    await sheetsService.updateTelegramId(normalizedPhone, telegramId);

    await ctx.reply(
      `✅ Регистрация завершена!\n\n` +
      `Добро пожаловать, ${employee.full_name}!\n` +
      `Должность: ${employee.position}\n` +
      `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
      `Используй /open для открытия смены`,
      Markup.removeKeyboard()
    );
  });
};
```

---

### ЭТАП 6: Telegram Bot - Открытие смены (60 мин)

**Цель**: Реализовать процесс открытия смены с геолокацией

#### 6.1 Создать `src/middleware/auth.js`

**Проверка регистрации**:
```javascript
module.exports = (sheetsService) => {
  return async (ctx, next) => {
    const telegramId = ctx.from.id;

    // Проверяем, есть ли пользователь в базе
    const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

    if (!employee) {
      return ctx.reply(
        '❌ Сначала нужно зарегистрироваться.\n' +
        'Используй команду /start'
      );
    }

    // Сохраняем данные в контекст для дальнейшего использования
    ctx.state.employee = employee;

    return next();
  };
};
```

#### 6.2 Создать `src/handlers/shift.js`

**Флоу открытия смены**:
1. `/open` → Запрос геолокации
2. Получение location → Проверка расстояния (< 150м)
3. Если ОК → Вызов iiko API `openPersonalSession`
4. Логирование в Google Sheets "Shift Logs"
5. Подтверждение пользователю

**Реализация**:
```javascript
module.exports = (bot, sheetsService, iikoService, locationService, authMiddleware) => {

  // Открытие смены
  bot.command('open', authMiddleware, async (ctx) => {
    const employee = ctx.state.employee;

    // Проверяем, не открыта ли уже смена
    const activeShift = await sheetsService.getActiveShift(employee.telegram_id);

    if (activeShift) {
      return ctx.reply(
        `⚠️ У тебя уже открыта смена!\n` +
        `Начало: ${activeShift.start_time}\n\n` +
        `Используй /close для закрытия`
      );
    }

    // Запрашиваем геолокацию
    await ctx.reply(
      '📍 Поделись своей геолокацией для открытия смены',
      Markup.keyboard([
        Markup.button.locationRequest('📍 Отправить геолокацию'),
        Markup.button.text('❌ Отмена')
      ])
        .oneTime()
        .resize()
    );

    // Сохраняем состояние "ожидание геолокации для открытия"
    ctx.session = ctx.session || {};
    ctx.session.awaitingLocationFor = 'open';
  });

  // Обработка геолокации для открытия смены
  bot.on('location', authMiddleware, async (ctx) => {
    if (ctx.session?.awaitingLocationFor !== 'open') {
      return; // Игнорируем если не ожидаем локацию
    }

    const employee = ctx.state.employee;
    const { latitude, longitude } = ctx.message.location;

    // Проверяем расстояние до ближайшего терминала
    const { terminal, isInRange } = locationService.findNearestTerminal(
      latitude,
      longitude
    );

    if (!isInRange) {
      return ctx.reply(
        `❌ Ты слишком далеко от точки "${terminal.name}".\n` +
        `Расстояние: ${Math.round(terminal.distance)}м (макс. ${terminal.maxDistance}м)\n\n` +
        `Подойди ближе и попробуй ещё раз /open`,
        Markup.removeKeyboard()
      );
    }

    try {
      // Открываем смену в iiko
      await iikoService.openShift(employee.iiko_employee_id);

      // Логируем начало смены в Google Sheets
      const startTime = new Date().toISOString();
      await sheetsService.logShiftStart({
        telegram_id: employee.telegram_id,
        full_name: employee.full_name,
        start_time: startTime,
        date: new Date().toISOString().split('T')[0],
        terminal_name: terminal.name
      });

      await ctx.reply(
        `✅ Смена открыта!\n\n` +
        `📍 Точка: ${terminal.name}\n` +
        `⏰ Время: ${new Date().toLocaleTimeString('ru-RU')}\n` +
        `💼 Должность: ${employee.position}\n` +
        `💰 Ставка: ${employee.hourly_rate} ₽/час\n\n` +
        `Не забудь закрыть смену командой /close`,
        Markup.removeKeyboard()
      );

      // Очищаем состояние
      delete ctx.session.awaitingLocationFor;

    } catch (error) {
      console.error('Ошибка открытия смены:', error);
      await ctx.reply(
        '❌ Не удалось открыть смену в системе iiko.\n' +
        'Попробуй ещё раз или обратись к администратору.',
        Markup.removeKeyboard()
      );
    }
  });

  // Отмена
  bot.hears('❌ Отмена', (ctx) => {
    delete ctx.session?.awaitingLocationFor;
    ctx.reply('Отменено', Markup.removeKeyboard());
  });
};
```

---

### ЭТАП 7: Telegram Bot - Закрытие смены (45 мин)

**Цель**: Закрыть смену, рассчитать оплату, логировать

#### 7.1 Обработчик `/close` в `src/handlers/shift.js`

**Флоу закрытия смены**:
1. `/close` → Проверка активной смены
2. Вызов iiko API `closePersonalSession`
3. Расчет: hours_worked = (end_time - start_time) / 3600
4. Расчет: total_payment = hours_worked * hourly_rate
5. Обновление Google Sheets "Shift Logs"
6. Подтверждение с деталями

**Реализация**:
```javascript
// Закрытие смены
bot.command('close', authMiddleware, async (ctx) => {
  const employee = ctx.state.employee;

  // Проверяем активную смену
  const activeShift = await sheetsService.getActiveShift(employee.telegram_id);

  if (!activeShift) {
    return ctx.reply(
      '⚠️ У тебя нет открытых смен.\n' +
      'Используй /open для открытия смены'
    );
  }

  try {
    // Закрываем смену в iiko
    await iikoService.closeShift(employee.iiko_employee_id);

    const endTime = new Date();
    const startTime = new Date(activeShift.start_time);

    // Расчет отработанных часов
    const hoursWorked = (endTime - startTime) / (1000 * 60 * 60);
    const totalPayment = Math.round(hoursWorked * employee.hourly_rate);

    // Логируем окончание смены
    await sheetsService.logShiftEnd({
      telegram_id: employee.telegram_id,
      full_name: employee.full_name,
      start_time: activeShift.start_time,
      end_time: endTime.toISOString(),
      hours_worked: hoursWorked.toFixed(2),
      hourly_rate: employee.hourly_rate,
      total_payment: totalPayment,
      date: activeShift.date
    });

    await ctx.reply(
      `✅ Смена закрыта!\n\n` +
      `⏰ Начало: ${startTime.toLocaleTimeString('ru-RU')}\n` +
      `⏰ Конец: ${endTime.toLocaleTimeString('ru-RU')}\n` +
      `⌛ Отработано: ${hoursWorked.toFixed(2)} часов\n` +
      `💰 К оплате: ${totalPayment} ₽\n\n` +
      `Данные сохранены в системе.`
    );

  } catch (error) {
    console.error('Ошибка закрытия смены:', error);
    await ctx.reply(
      '❌ Не удалось закрыть смену в системе iiko.\n' +
      'Попробуй ещё раз или обратись к администратору.'
    );
  }
});
```

---

### ЭТАП 8: Автоматические напоминания (60 мин)

**Цель**: Настроить cron-задачи для напоминаний

#### 8.1 Создать `src/services/cronService.js`

**Типы напоминаний**:
1. **Night Reminder** (22:00) - "Завтра смена в XX:XX, не забудь!"
2. **2 Hours Before** - "Через 2 часа смена!"
3. **1 Hour Before** - "Через 1 час смена!"
4. **5 Minutes Before End** - "Через 5 минут конец смены, не забудь закрыть в боте!"

**Реализация**:
```javascript
const cron = require('node-cron');

class CronService {
  constructor(bot, sheetsService) {
    this.bot = bot;
    this.sheetsService = sheetsService;
  }

  start() {
    // Night Reminder - каждый день в 22:00
    cron.schedule('0 22 * * *', () => {
      this.sendNightReminders();
    }, {
      timezone: "Asia/Novosibirsk"
    });

    // Проверка напоминаний за 2 часа - каждые 5 минут
    cron.schedule('*/5 * * * *', () => {
      this.send2HourReminders();
    }, {
      timezone: "Asia/Novosibirsk"
    });

    // Проверка за 1 час - каждые 5 минут
    cron.schedule('*/5 * * * *', () => {
      this.send1HourReminders();
    }, {
      timezone: "Asia/Novosibirsk"
    });

    // Напоминание закрыть смену - каждую минуту
    cron.schedule('* * * * *', () => {
      this.sendCloseShiftReminders();
    }, {
      timezone: "Asia/Novosibirsk"
    });

    console.log('✅ Cron задачи запущены');
  }

  async sendNightReminders() {
    try {
      // Получаем расписание на завтра
      const tomorrowSchedule = await this.sheetsService.getTomorrowSchedule();

      for (const shift of tomorrowSchedule) {
        await this.bot.telegram.sendMessage(
          shift.telegram_id,
          `🌙 Напоминание!\n\n` +
          `Завтра у тебя смена:\n` +
          `⏰ Начало: ${shift.shift_start_time}\n` +
          `📍 Позиция: ${shift.position}\n\n` +
          `Не забудь открыть смену в боте командой /open`
        );
      }

      console.log(`✅ Night reminders отправлено: ${tomorrowSchedule.length}`);
    } catch (error) {
      console.error('Ошибка в sendNightReminders:', error);
    }
  }

  async send2HourReminders() {
    try {
      const now = new Date();
      const in2Hours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const todaySchedule = await this.sheetsService.getTodaySchedule();

      for (const shift of todaySchedule) {
        const shiftTime = this.parseShiftDateTime(shift.shift_date, shift.shift_start_time);
        const timeDiff = Math.abs(shiftTime - in2Hours);

        // Если разница меньше 5 минут (чтобы не пропустить из-за cron интервала)
        if (timeDiff < 5 * 60 * 1000) {
          await this.bot.telegram.sendMessage(
            shift.telegram_id,
            `⏰ Через 2 часа смена!\n\n` +
            `Начало: ${shift.shift_start_time}\n` +
            `Позиция: ${shift.position}\n\n` +
            `Не забудь открыть смену командой /open`
          );
        }
      }
    } catch (error) {
      console.error('Ошибка в send2HourReminders:', error);
    }
  }

  async send1HourReminders() {
    try {
      const now = new Date();
      const in1Hour = new Date(now.getTime() + 60 * 60 * 1000);

      const todaySchedule = await this.sheetsService.getTodaySchedule();

      for (const shift of todaySchedule) {
        const shiftTime = this.parseShiftDateTime(shift.shift_date, shift.shift_start_time);
        const timeDiff = Math.abs(shiftTime - in1Hour);

        if (timeDiff < 5 * 60 * 1000) {
          await this.bot.telegram.sendMessage(
            shift.telegram_id,
            `🔔 Через 1 час смена!\n\n` +
            `Начало: ${shift.shift_start_time}\n\n` +
            `Готовься выходить!`
          );
        }
      }
    } catch (error) {
      console.error('Ошибка в send1HourReminders:', error);
    }
  }

  async sendCloseShiftReminders() {
    try {
      // Получаем все активные смены
      const activeShifts = await this.sheetsService.getAllActiveShifts();

      for (const shift of activeShifts) {
        const startTime = new Date(shift.start_time);
        const scheduleInfo = await this.sheetsService.getScheduleForUser(shift.telegram_id);

        if (!scheduleInfo) continue;

        // Парсим время окончания смены из расписания
        // Предполагаем, что смена длится определенное количество часов (например, 8)
        // Или можно добавить колонку shift_end_time в Schedule
        const scheduledEndTime = this.calculateEndTime(startTime, 8); // 8 часов

        const now = new Date();
        const timeUntilEnd = scheduledEndTime - now;

        // За 5 минут до конца
        if (timeUntilEnd > 0 && timeUntilEnd < 5 * 60 * 1000) {
          await this.bot.telegram.sendMessage(
            shift.telegram_id,
            `⏰ Через 5 минут конец смены!\n\n` +
            `Не забудь закрыть смену в боте командой /close`
          );
        }
      }
    } catch (error) {
      console.error('Ошибка в sendCloseShiftReminders:', error);
    }
  }

  parseShiftDateTime(date, time) {
    // date: "2025-01-15", time: "09:00"
    return new Date(`${date}T${time}:00`);
  }

  calculateEndTime(startTime, hours) {
    return new Date(startTime.getTime() + hours * 60 * 60 * 1000);
  }
}

module.exports = CronService;
```

**Важно**: Для напоминания "за 5 минут до конца смены" нужно либо:
- Добавить колонку `shift_end_time` в лист "Schedule"
- Или добавить колонку `shift_duration_hours` (по умолчанию 8)

---

### ЭТАП 9: Админ функционал (30 мин)

**Цель**: Команды для администраторов

#### 9.1 Создать `src/handlers/admin.js`

**Функционал**:
```javascript
module.exports = (bot, sheetsService) => {

  // Middleware проверки админа
  const isAdmin = (ctx, next) => {
    const adminIds = process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => parseInt(id));

    if (!adminIds.includes(ctx.from.id)) {
      return ctx.reply('❌ Доступ запрещен');
    }

    return next();
  };

  // Обновление ставки
  // Формат: /setrate @username 350
  bot.command('setrate', isAdmin, async (ctx) => {
    const args = ctx.message.text.split(' ');

    if (args.length < 3) {
      return ctx.reply(
        'Использование: /setrate @username 350\n' +
        'или /setrate +79991234567 350'
      );
    }

    const identifier = args[1]; // @username или номер
    const newRate = parseFloat(args[2]);

    if (isNaN(newRate) || newRate <= 0) {
      return ctx.reply('❌ Некорректная ставка');
    }

    try {
      // Ищем сотрудника
      let employee;
      if (identifier.startsWith('@')) {
        employee = await sheetsService.findEmployeeByUsername(identifier);
      } else {
        employee = await sheetsService.findEmployeeByPhone(identifier);
      }

      if (!employee) {
        return ctx.reply('❌ Сотрудник не найден');
      }

      // Обновляем ставку
      await sheetsService.updateHourlyRate(employee.phone, newRate);

      await ctx.reply(
        `✅ Ставка обновлена!\n\n` +
        `Сотрудник: ${employee.full_name}\n` +
        `Новая ставка: ${newRate} ₽/час`
      );

      // Уведомляем сотрудника
      if (employee.telegram_id) {
        await bot.telegram.sendMessage(
          employee.telegram_id,
          `💰 Твоя ставка изменена!\n\n` +
          `Новая ставка: ${newRate} ₽/час`
        );
      }

    } catch (error) {
      console.error('Ошибка обновления ставки:', error);
      ctx.reply('❌ Ошибка при обновлении ставки');
    }
  });

  // Статистика по сотруднику
  bot.command('stats', isAdmin, async (ctx) => {
    const args = ctx.message.text.split(' ');

    if (args.length < 2) {
      return ctx.reply('Использование: /stats @username');
    }

    const identifier = args[1];

    try {
      const stats = await sheetsService.getEmployeeStats(identifier);

      await ctx.reply(
        `📊 Статистика: ${stats.full_name}\n\n` +
        `Всего смен: ${stats.total_shifts}\n` +
        `Всего часов: ${stats.total_hours}\n` +
        `Заработано: ${stats.total_earned} ₽\n` +
        `Средняя смена: ${stats.avg_hours} часов`
      );
    } catch (error) {
      console.error('Ошибка получения статистики:', error);
      ctx.reply('❌ Ошибка при получении статистики');
    }
  });
};
```

---

### ЭТАП 10: Middleware и утилиты (30 мин)

#### 10.1 Создать `src/middleware/errorHandler.js`

```javascript
const logger = require('../utils/logger');

module.exports = (bot) => {
  bot.catch((err, ctx) => {
    const userId = ctx?.from?.id || 'unknown';
    const updateType = ctx?.updateType || 'unknown';

    logger.error({
      userId,
      updateType,
      error: err.message,
      stack: err.stack
    });

    // Игнорируем старые callback queries
    if (err.message.includes('query is too old')) {
      return;
    }

    // Rate limiting
    if (err.code === 'ETELEGRAM' && err.response?.error_code === 429) {
      logger.warn(`Rate limited for user ${userId}`);
      return;
    }

    // Отправляем user-friendly сообщение
    try {
      ctx.reply('❌ Произошла ошибка. Попробуй позже.');
    } catch (e) {
      logger.error('Cannot send error message:', e);
    }

    // Алерт админам в production
    if (process.env.NODE_ENV === 'production') {
      const adminIds = process.env.ADMIN_TELEGRAM_IDS.split(',');
      adminIds.forEach(adminId => {
        ctx.telegram.sendMessage(
          adminId,
          `🚨 Bot Error\nUser: ${userId}\nError: ${err.message}`
        ).catch(e => logger.error('Cannot send admin alert:', e));
      });
    }
  });
};
```

#### 10.2 Создать `src/middleware/logger.js`

```javascript
module.exports = () => {
  return (ctx, next) => {
    const start = Date.now();
    const userId = ctx.from.id;
    const username = ctx.from.username || 'no_username';
    const updateType = ctx.updateType;
    const text = ctx.message?.text?.substring(0, 50) || '';

    console.log(`→ [${userId}@${username}] ${updateType}: ${text}`);

    const result = next();

    const duration = Date.now() - start;
    console.log(`← [${userId}] Done in ${duration}ms`);

    return result;
  };
};
```

#### 10.3 Создать `src/utils/messages.js`

**Централизованные текстовые шаблоны**:
```javascript
module.exports = {
  WELCOME: (name, position, rate) =>
    `Привет, ${name}! 👋\n\n` +
    `Должность: ${position}\n` +
    `Ставка: ${rate} ₽/час\n\n` +
    `Используй /open для открытия смены`,

  NOT_REGISTERED:
    '❌ Ты не найден в базе сотрудников.\n\n' +
    'Обратись к менеджеру:\n' +
    '@manager_username или +7-XXX-XXX-XXXX',

  SHIFT_OPENED: (terminal, time, position, rate) =>
    `✅ Смена открыта!\n\n` +
    `📍 Точка: ${terminal}\n` +
    `⏰ Время: ${time}\n` +
    `💼 Должность: ${position}\n` +
    `💰 Ставка: ${rate} ₽/час\n\n` +
    `Не забудь закрыть смену командой /close`,

  SHIFT_CLOSED: (start, end, hours, payment) =>
    `✅ Смена закрыта!\n\n` +
    `⏰ Начало: ${start}\n` +
    `⏰ Конец: ${end}\n` +
    `⌛ Отработано: ${hours} часов\n` +
    `💰 К оплате: ${payment} ₽\n\n` +
    `Данные сохранены в системе.`,

  LOCATION_TOO_FAR: (terminal, distance, maxDistance) =>
    `❌ Ты слишком далеко от точки "${terminal}".\n` +
    `Расстояние: ${distance}м (макс. ${maxDistance}м)\n\n` +
    `Подойди ближе и попробуй ещё раз /open`,

  // ... остальные сообщения
};
```

#### 10.4 Создать `src/config/env.js`

**Валидация переменных окружения**:
```javascript
require('dotenv').config();

const required = [
  'TELEGRAM_BOT_TOKEN',
  'GOOGLE_SHEET_ID',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'IIKO_BASE_URL',
  'IIKO_API_LOGIN',
  'IIKO_ORGANIZATION_ID',
  'IIKO_TERMINAL_GROUP_ID',
  'ADMIN_TELEGRAM_IDS'
];

required.forEach(key => {
  if (!process.env[key]) {
    console.error(`❌ Missing env var: ${key}`);
    process.exit(1);
  }
});

module.exports = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  googleSheetId: process.env.GOOGLE_SHEET_ID,
  googleServiceAccount: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  iikoBaseUrl: process.env.IIKO_BASE_URL,
  iikoApiLogin: process.env.IIKO_API_LOGIN,
  iikoOrganizationId: process.env.IIKO_ORGANIZATION_ID,
  iikoTerminalGroupId: process.env.IIKO_TERMINAL_GROUP_ID,
  adminIds: process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => parseInt(id)),
  nodeEnv: process.env.NODE_ENV || 'development'
};
```

---

### ЭТАП 11: Точка входа и запуск (20 мин)

#### 11.1 Создать `src/index.js`

```javascript
const config = require('./config/env');
const bot = require('./bot');
const GoogleSheetsService = require('./services/googleSheetsService');
const IikoService = require('./services/iikoService');
const LocationService = require('./services/locationService');
const CronService = require('./services/cronService');

// Инициализация сервисов
const sheetsService = new GoogleSheetsService(
  config.googleServiceAccount,
  config.googleSheetId
);

const iikoService = new IikoService(
  config.iikoBaseUrl,
  config.iikoApiLogin,
  config.iikoOrganizationId,
  config.iikoTerminalGroupId
);

const locationService = new LocationService();

const cronService = new CronService(bot, sheetsService);

// Регистрация handlers
const authMiddleware = require('./middleware/auth')(sheetsService);

require('./handlers/registration')(bot, sheetsService);
require('./handlers/shift')(bot, sheetsService, iikoService, locationService, authMiddleware);
require('./handlers/admin')(bot, sheetsService);

// Запуск cron задач
cronService.start();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Запуск бота
bot.launch()
  .then(() => {
    console.log('✅ Бот запущен успешно!');
    console.log(`Environment: ${config.nodeEnv}`);
  })
  .catch(err => {
    console.error('❌ Ошибка запуска бота:', err);
    process.exit(1);
  });
```

#### 11.2 Создать `ecosystem.config.js` (PM2)

```javascript
module.exports = {
  apps: [{
    name: 'iiko-shift-bot',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: {
      NODE_ENV: 'production'
    },
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 4000,
    max_restarts: 10
  }]
};
```

---

### ЭТАП 12: Тестирование и деплой (45 мин)

#### 12.1 Локальное тестирование

**Чеклист**:
- [ ] Регистрация по номеру телефона
- [ ] Открытие смены с геолокацией
- [ ] Проверка расстояния до точки
- [ ] Закрытие смены и расчет оплаты
- [ ] Логирование в Google Sheets
- [ ] Напоминания (можно протестировать вручную изменив cron на */1 * * * *)
- [ ] Админ команды

#### 12.2 Подготовка к деплою

**VPS Setup**:
```bash
# 1. Установить Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Установить PM2
sudo npm install -g pm2

# 3. Клонировать проект
git clone <repo_url>
cd iiko-shift-bot

# 4. Установить зависимости
npm install

# 5. Создать .env файл
nano .env
# (вставить переменные)

# 6. Запустить через PM2
pm2 start ecosystem.config.js

# 7. Автозапуск при перезагрузке
pm2 startup
pm2 save
```

#### 12.3 Мониторинг

```bash
# Логи
pm2 logs iiko-shift-bot

# Статус
pm2 status

# Перезапуск
pm2 restart iiko-shift-bot
```

---

## Дополнительные рекомендации

### Безопасность
1. **Никогда не коммитить .env** в git
2. **Service Account JSON** должен быть в .env как строка
3. **Админские ID** хранить в переменных окружения
4. **Rate limiting** для предотвращения спама

### Масштабирование
1. **Добавление новых точек**: просто добавить в `TERMINAL_LOCATIONS` в `constants.js`
2. **Добавление сотрудников**: добавить строку в Google Sheets "Employees"
3. **Изменение расписания**: редактировать "Schedule" лист

### Оптимизация
1. **Кеширование**: кешировать данные из Google Sheets (обновлять раз в 5 минут)
2. **Batch операции**: группировать запросы к Google Sheets API
3. **Retry логика**: для всех внешних API вызовов

### Мониторинг и логирование
1. Использовать Winston или Pino для структурированных логов
2. Настроить алерты админам при критических ошибках
3. Логировать все операции со сменами для аудита

---

## Временная оценка

| Этап | Время |
|------|-------|
| 1. Инициализация проекта | 30 мин |
| 2. Google Sheets API | 45 мин |
| 3. iiko Cloud API | 60 мин |
| 4. Геолокация | 30 мин |
| 5. Регистрация | 45 мин |
| 6. Открытие смены | 60 мин |
| 7. Закрытие смены | 45 мин |
| 8. Напоминания | 60 мин |
| 9. Админ функционал | 30 мин |
| 10. Middleware | 30 мин |
| 11. Точка входа | 20 мин |
| 12. Тестирование | 45 мин |
| **Итого** | **~8 часов** |

---

## Следующие шаги после реализации

1. **Получить от клиента**:
   - iiko API credentials (organization_id, terminal_group_id, api_login)
   - Google Sheets ID
   - Координаты точки
   - Telegram IDs администраторов

2. **Настроить Google Sheets**:
   - Создать 3 листа: Employees, Schedule, Shift Logs
   - Дать доступ Service Account к таблице

3. **Создать Telegram бота**:
   - @BotFather → /newbot
   - Получить токен

4. **Деплой на VPS**:
   - Настроить окружение
   - Запустить через PM2
   - Настроить автозапуск

5. **Тестирование с реальными данными**

---

## Критические файлы для реализации

1. `src/services/googleSheetsService.js` - работа с Google Sheets
2. `src/services/iikoService.js` - интеграция iiko
3. `src/services/locationService.js` - проверка геолокации
4. `src/services/cronService.js` - напоминания
5. `src/handlers/shift.js` - основная логика открытия/закрытия смен
6. `src/middleware/auth.js` - проверка регистрации
7. `src/utils/constants.js` - координаты точек
8. `src/index.js` - точка входа

---

Этот план покрывает все требования и следует best practices разработки Telegram-ботов. Готов к реализации!
