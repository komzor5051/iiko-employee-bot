const config = require('./config/env');
const bot = require('./bot');
const { Markup } = require('telegraf');
const GoogleSheetsService = require('./services/googleSheetsService');
const IikoService = require('./services/iikoService');
const locationService = require('./services/locationService');
const CronService = require('./services/cronService');
const WebhookServer = require('./services/webhookServer');
const WebhookHandler = require('./services/webhookHandler');
const { sendDailyReport } = require('./services/dailyReport');
const cron = require('node-cron');

console.log('🚀 Запуск бота...');
console.log(`Environment: ${config.nodeEnv}`);

// Map для хранения ожидающих проверки локации
// Map<telegramId, { action: 'open'|'close', timestamp: number, messageId?: number }>
const pendingLocationChecks = new Map();

// Очистка устаревших записей (старше 10 минут)
const LOCATION_TIMEOUT_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [telegramId, data] of pendingLocationChecks.entries()) {
    if (now - data.timestamp > LOCATION_TIMEOUT_MS) {
      pendingLocationChecks.delete(telegramId);
    }
  }
}, 60 * 1000);

// Инициализация Google Sheets сервиса
const sheetsService = new GoogleSheetsService(
  config.googleServiceAccount,
  config.googleSheetId
);
console.log('✅ Google Sheets подключен');

// Инициализация iiko сервиса
const iikoService = new IikoService(
  config.iikoBaseUrl,
  config.iikoApiLogin,
  config.iikoOrganizationId,
  config.iikoTerminalGroupId
);
console.log('✅ iiko сервис инициализирован');

// Утилита для форматирования длительности
function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}ч ${mins}мин`;
  if (hours > 0) return `${hours}ч`;
  return `${mins}мин`;
}

// ===== КОМАНДА /start =====
bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    // Проверяем, зарегистрирован ли пользователь
    const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

    if (employee) {
      // Пользователь найден — показываем меню
      return ctx.reply(
        `Привет, ${employee.full_name}! 👋\n\n` +
        `Должность: ${employee.position}\n` +
        `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
        `Выбери действие:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📥 Открыть смену', 'open_shift')],
          [Markup.button.callback('📤 Закрыть смену', 'close_shift')],
          [Markup.button.callback('📊 Статус смены', 'shift_status')]
        ])
      );
    }

    // Пользователь не найден — запрашиваем номер телефона
    await ctx.reply(
      'Добро пожаловать! 👋\n\n' +
      'Для регистрации отправь свой номер телефона.',
      Markup.keyboard([
        Markup.button.contactRequest('📱 Отправить номер телефона')
      ])
        .oneTime()
        .resize()
    );
  } catch (error) {
    console.error('Ошибка в /start:', error);
    ctx.reply('❌ Произошла ошибка. Попробуй ещё раз /start');
  }
});

// ===== ОБРАБОТКА КОНТАКТА (регистрация) =====
bot.on('contact', async (ctx) => {
  const phone = ctx.message.contact.phone_number;
  const telegramId = ctx.from.id;

  try {
    console.log(`📞 Получен номер: ${phone} от пользователя ${telegramId}`);

    // Ищем сотрудника в Google Sheets по номеру телефона
    const employee = await sheetsService.findEmployeeByPhone(phone);

    if (!employee) {
      return ctx.reply(
        '❌ Ты не найден в базе сотрудников.\n\n' +
        'Обратись к менеджеру для добавления в систему.',
        Markup.removeKeyboard()
      );
    }

    // Сохраняем Telegram ID в таблицу
    await sheetsService.saveTelegramId(employee.rowIndex, telegramId);

    await ctx.reply(
      `✅ Регистрация завершена!\n\n` +
      `Добро пожаловать, ${employee.full_name}!\n` +
      `Должность: ${employee.position}\n` +
      `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
      `Выбери действие:`,
      {
        reply_markup: {
          remove_keyboard: true,
          inline_keyboard: [
            [{ text: '📥 Открыть смену', callback_data: 'open_shift' }],
            [{ text: '📤 Закрыть смену', callback_data: 'close_shift' }],
            [{ text: '📊 Статус смены', callback_data: 'shift_status' }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Ошибка при регистрации:', error);
    ctx.reply(
      '❌ Произошла ошибка при регистрации. Попробуй ещё раз /start',
      Markup.removeKeyboard()
    );
  }
});

// ===== ОБРАБОТКА ГЕОЛОКАЦИИ (открытие/закрытие смены) =====
bot.on('location', async (ctx) => {
  const telegramId = ctx.from.id;
  const { latitude, longitude } = ctx.message.location;

  try {
    // Проверяем, есть ли ожидающее действие
    const pendingAction = pendingLocationChecks.get(telegramId);

    if (!pendingAction) {
      return ctx.reply(
        '❓ Не найдено активного запроса на проверку геолокации.\n\n' +
        'Используй кнопки меню для открытия или закрытия смены.',
        Markup.removeKeyboard()
      );
    }

    // Проверяем геолокацию
    const locationResult = locationService.checkLocation(latitude, longitude);

    console.log(`📍 Локация от ${telegramId}: ${latitude}, ${longitude} — ${locationResult.distanceFormatted} (${locationResult.isWithin ? 'OK' : 'FAR'})`);

    const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

    if (!employee) {
      pendingLocationChecks.delete(telegramId);
      return ctx.reply('❌ Ты не зарегистрирован в системе. Используй /start', Markup.removeKeyboard());
    }

    // Если пользователь слишком далеко
    if (!locationResult.isWithin) {
      pendingLocationChecks.delete(telegramId);
      return ctx.reply(
        `❌ Ты слишком далеко от магазина!\n\n` +
        `Расстояние: ${locationResult.distanceFormatted}\n` +
        `Допустимый радиус: ${config.storeRadiusKm * 1000} м\n\n` +
        `Подойди ближе к магазину и попробуй снова.`,
        {
          reply_markup: {
            remove_keyboard: true,
            inline_keyboard: [
              [{ text: '🔄 Попробовать снова', callback_data: pendingAction.action === 'open' ? 'open_shift' : 'close_shift' }],
              [{ text: '◀️ Назад', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
    }

    // Геолокация в порядке — выполняем действие
    if (pendingAction.action === 'open') {
      // === ОТКРЫТИЕ СМЕНЫ ===

      // Проверяем ещё раз, нет ли открытой смены
      const activeShift = await sheetsService.getActiveShift(employee.phone);
      if (activeShift) {
        pendingLocationChecks.delete(telegramId);
        return ctx.reply(
          '⚠️ У тебя уже есть открытая смена!',
          {
            reply_markup: {
              remove_keyboard: true,
              inline_keyboard: [
                [{ text: '📤 Закрыть смену', callback_data: 'close_shift' }],
                [{ text: '◀️ Назад', callback_data: 'back_to_menu' }]
              ]
            }
          }
        );
      }

      // Открываем смену в iiko
      let iikoStatus = '';
      if (!employee.iiko_id) {
        iikoStatus = '\n⚠️ iiko ID не указан — смена только в таблице';
      } else {
        try {
          await iikoService.openShift(employee.iiko_id);
          iikoStatus = '\n✅ Смена открыта в iiko';
        } catch (iikoError) {
          console.error('Ошибка iiko при открытии:', iikoError.message);
          const errorData = iikoError.response?.data;
          const errorMsg = typeof errorData === 'string' ? errorData : JSON.stringify(errorData || '');

          // Если iiko вернул ошибку "смена уже открыта"
          if (iikoError.response?.status === 400 || errorMsg.toLowerCase().includes('already') || errorMsg.toLowerCase().includes('opened') || errorMsg.includes('уже')) {
            pendingLocationChecks.delete(telegramId);
            return ctx.reply(
              '⚠️ У тебя уже есть открытая смена в iiko!\n\n' +
              'Закрой текущую смену перед открытием новой.',
              {
                reply_markup: {
                  remove_keyboard: true,
                  inline_keyboard: [
                    [{ text: '📤 Закрыть смену', callback_data: 'close_shift' }],
                    [{ text: '◀️ Назад', callback_data: 'back_to_menu' }]
                  ]
                }
              }
            );
          }

          iikoStatus = '\n⚠️ Не удалось открыть в iiko';
        }
      }

      // Логируем в Google Sheets
      const result = await sheetsService.logShiftStart({
        phone: employee.phone,
        full_name: employee.full_name,
        hourly_rate: employee.hourly_rate
      });

      pendingLocationChecks.delete(telegramId);

      ctx.reply(
        `✅ Смена успешно открыта!\n\n` +
        `📍 Ты в зоне магазина (${locationResult.distanceFormatted})\n\n` +
        `Сотрудник: ${employee.full_name}\n` +
        `Дата: ${result.date}\n` +
        `Начало: ${result.time}\n` +
        `Ставка: ${employee.hourly_rate} ₽/час${iikoStatus}\n\n` +
        `Хорошей смены! 💪`,
        {
          reply_markup: {
            remove_keyboard: true,
            inline_keyboard: [
              [{ text: '📊 Статус смены', callback_data: 'shift_status' }],
              [{ text: '◀️ Назад', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
    } else if (pendingAction.action === 'close') {
      // === ЗАКРЫТИЕ СМЕНЫ ===

      // Закрываем смену в iiko
      let iikoStatus = '';
      if (!employee.iiko_id) {
        iikoStatus = '\n⚠️ iiko ID не указан — смена только в таблице';
      } else {
        try {
          await iikoService.closeShift(employee.iiko_id);
          iikoStatus = '\n✅ Смена закрыта в iiko';
        } catch (iikoError) {
          console.error('Ошибка iiko при закрытии:', iikoError.message);
          const errorData = iikoError.response?.data;
          const errorMsg = typeof errorData === 'string' ? errorData : JSON.stringify(errorData || '');

          // Если iiko вернул ошибку "смена не открыта"
          if (iikoError.response?.status === 400 && (errorMsg.toLowerCase().includes('not opened') || errorMsg.toLowerCase().includes('closed') || errorMsg.includes('не открыта'))) {
            iikoStatus = '\n⚠️ Смена в iiko уже была закрыта';
          } else {
            iikoStatus = '\n⚠️ Не удалось закрыть в iiko';
          }
        }
      }

      // Закрываем смену в Google Sheets
      const result = await sheetsService.logShiftEnd({
        phone: employee.phone,
        hourly_rate: employee.hourly_rate
      });

      pendingLocationChecks.delete(telegramId);

      ctx.reply(
        `✅ Смена успешно закрыта!\n\n` +
        `📍 Ты в зоне магазина (${locationResult.distanceFormatted})\n\n` +
        `Сотрудник: ${result.full_name}\n` +
        `Начало: ${result.start_time}\n` +
        `Конец: ${result.end_time}\n` +
        `Длительность: ${formatDuration(result.duration_minutes)}\n` +
        `Часы: ${result.hours_worked}ч\n` +
        `К оплате: ${result.total_payment} ₽${iikoStatus}\n\n` +
        `Спасибо за работу! 🎉`,
        {
          reply_markup: {
            remove_keyboard: true,
            inline_keyboard: [
              [{ text: '📥 Открыть новую смену', callback_data: 'open_shift' }],
              [{ text: '◀️ Назад', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
    }
  } catch (error) {
    console.error('Ошибка при обработке геолокации:', error);
    pendingLocationChecks.delete(telegramId);
    ctx.reply(
      '❌ Произошла ошибка при обработке геолокации. Попробуй ещё раз.',
      Markup.removeKeyboard()
    );
  }
});

// ===== КОМАНДА /help =====
bot.command('help', (ctx) => {
  ctx.reply(
    '📋 Справка:\n\n' +
    'Этот бот помогает управлять сменами сотрудников.\n\n' +
    '🔹 /start - Главное меню\n' +
    '🔹 /status - Статус текущей смены\n\n' +
    'Или используй кнопки для быстрого доступа!'
  );
});

// ===== КОМАНДА /report (ручной запуск отчёта) =====
bot.command('report', async (ctx) => {
  const telegramId = ctx.from.id;

  if (config.adminIds.length > 0 && !config.adminIds.includes(telegramId)) {
    return ctx.reply('❌ Только администраторы могут запускать отчёт.');
  }

  await ctx.reply('📊 Генерирую отчёт...');
  try {
    await sendDailyReport(bot, sheetsService);
    await ctx.reply('✅ Отчёт отправлен в группу руководителей.');
  } catch (error) {
    await ctx.reply('❌ Ошибка при генерации отчёта: ' + error.message);
  }
});

// ===== КОМАНДА /test_reminder (тестовое оповещение) =====
bot.command('test_reminder', async (ctx) => {
  const telegramId = ctx.from.id;

  if (config.adminIds.length > 0 && !config.adminIds.includes(telegramId)) {
    return ctx.reply('❌ Только администраторы могут тестировать оповещения.');
  }

  await ctx.reply('🧪 Запускаю тестовые оповещения...');
  try {
    // Имитируем напоминание "за час до конца"
    await bot.telegram.sendMessage(telegramId,
      `⏰ Смена заканчивается через час!\n\n` +
      `Тестовый сотрудник, не забудь закрыть смену.\n` +
      `Время окончания: 21:00\n\n` +
      `🧪 (тестовое оповещение)`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Закрыть смену', callback_data: 'close_shift' }]
          ]
        }
      }
    );

    // Показываем реальное состояние расписания
    const startShifts = await sheetsService.getShiftsStartingInOneHour();
    const endShifts = await sheetsService.getShiftsEndingInOneHour();
    const todaySchedule = await sheetsService.getTodaySchedule();

    const scheduleDetails = todaySchedule.length > 0
      ? todaySchedule.map(s => `  • ${s.full_name}: ${s.start_time}—${s.end_time}`).join('\n')
      : '  (пусто)';

    await ctx.reply(
      `✅ Тестовое оповещение отправлено!\n\n` +
      `📋 Расписание на сегодня (${todaySchedule.length}):\n${scheduleDetails}\n\n` +
      `🔔 Начинаются через час: ${startShifts.length}\n` +
      `🔔 Заканчиваются через час: ${endShifts.length}`
    );
  } catch (error) {
    await ctx.reply('❌ Ошибка: ' + error.message);
  }
});

// ===== КОМАНДА /status =====
bot.command('status', async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

    if (!employee) {
      return ctx.reply(
        '❌ Ты не зарегистрирован в системе.\n\n' +
        'Используй /start для регистрации.'
      );
    }

    const activeShift = await sheetsService.getActiveShift(employee.phone);

    if (!activeShift) {
      return ctx.reply(
        '📊 Статус смены\n\n' +
        '❌ Смена не открыта\n\n' +
        'Используй кнопку ниже для открытия смены.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📥 Открыть смену', 'open_shift')]
        ])
      );
    }

    // Вычисляем текущую длительность
    const now = new Date();
    const [startHours, startMinutes] = activeShift.start_time.split(':').map(Number);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    let durationMinutes = currentMinutes - (startHours * 60 + startMinutes);
    if (durationMinutes < 0) durationMinutes += 24 * 60;

    const hours = (durationMinutes / 60).toFixed(2);
    const payment = Math.round(parseFloat(hours) * employee.hourly_rate);

    ctx.reply(
      `📊 Статус смены\n\n` +
      `✅ Смена открыта\n\n` +
      `Сотрудник: ${employee.full_name}\n` +
      `Должность: ${employee.position}\n` +
      `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
      `Начало: ${activeShift.start_time}\n` +
      `Длительность: ${formatDuration(durationMinutes)}\n` +
      `Часы: ${hours}ч\n` +
      `Текущая сумма: ${payment} ₽`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📤 Закрыть смену', 'close_shift')],
        [Markup.button.callback('🔄 Обновить', 'shift_status')]
      ])
    );
  } catch (error) {
    console.error('Ошибка в /status:', error);
    ctx.reply('❌ Произошла ошибка. Попробуй позже.');
  }
});

// ===== CALLBACK: Открыть смену =====
bot.action('open_shift', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id;

  try {
    const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

    if (!employee) {
      return ctx.editMessageText('❌ Ты не зарегистрирован в системе. Используй /start');
    }

    // Проверяем, нет ли уже открытой смены
    const activeShift = await sheetsService.getActiveShift(employee.phone);

    if (activeShift) {
      const now = new Date();
      const [startHours, startMinutes] = activeShift.start_time.split(':').map(Number);
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      let durationMinutes = currentMinutes - (startHours * 60 + startMinutes);
      if (durationMinutes < 0) durationMinutes += 24 * 60;

      return ctx.editMessageText(
        `⚠️ У тебя уже открыта смена!\n\n` +
        `Начало: ${activeShift.start_time}\n` +
        `Длительность: ${formatDuration(durationMinutes)}\n\n` +
        `Закрой текущую смену перед открытием новой.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📤 Закрыть смену', 'close_shift')],
          [Markup.button.callback('◀️ Назад', 'back_to_menu')]
        ])
      );
    }

    // Сохраняем ожидание проверки локации
    pendingLocationChecks.set(telegramId, {
      action: 'open',
      timestamp: Date.now()
    });

    // Запрашиваем геолокацию
    await ctx.editMessageText(
      `📥 Открытие смены\n\n` +
      `Сотрудник: ${employee.full_name}\n` +
      `Должность: ${employee.position}\n` +
      `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
      `📍 Отправь свою геолокацию для подтверждения открытия смены.`
    );

    // Отправляем клавиатуру с кнопкой геолокации
    await ctx.reply(
      'Нажми кнопку ниже:',
      Markup.keyboard([
        [Markup.button.locationRequest('📍 Отправить геолокацию')]
      ])
        .oneTime()
        .resize()
    );
  } catch (error) {
    console.error('Ошибка в open_shift:', error);
    ctx.editMessageText('❌ Произошла ошибка. Попробуй позже.');
  }
});


// ===== CALLBACK: Закрыть смену =====
bot.action('close_shift', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id;

  try {
    const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

    if (!employee) {
      return ctx.editMessageText('❌ Ты не зарегистрирован в системе.');
    }

    const activeShift = await sheetsService.getActiveShift(employee.phone);

    if (!activeShift) {
      return ctx.editMessageText(
        '❌ У тебя нет открытой смены.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📥 Открыть смену', 'open_shift')],
          [Markup.button.callback('◀️ Назад', 'back_to_menu')]
        ])
      );
    }

    // Вычисляем предварительные данные
    const now = new Date();
    const [startHours, startMinutes] = activeShift.start_time.split(':').map(Number);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    let durationMinutes = currentMinutes - (startHours * 60 + startMinutes);
    if (durationMinutes < 0) durationMinutes += 24 * 60;

    const hours = (durationMinutes / 60).toFixed(2);
    const payment = Math.round(parseFloat(hours) * employee.hourly_rate);

    // Сохраняем ожидание проверки локации
    pendingLocationChecks.set(telegramId, {
      action: 'close',
      timestamp: Date.now()
    });

    // Запрашиваем геолокацию
    await ctx.editMessageText(
      `📤 Закрытие смены\n\n` +
      `Сотрудник: ${employee.full_name}\n` +
      `Начало: ${activeShift.start_time}\n` +
      `Длительность: ${formatDuration(durationMinutes)}\n` +
      `Часы: ${hours}ч\n` +
      `К оплате: ${payment} ₽\n\n` +
      `📍 Отправь свою геолокацию для подтверждения закрытия смены.`
    );

    // Отправляем клавиатуру с кнопкой геолокации
    await ctx.reply(
      'Нажми кнопку ниже:',
      Markup.keyboard([
        [Markup.button.locationRequest('📍 Отправить геолокацию')]
      ])
        .oneTime()
        .resize()
    );
  } catch (error) {
    console.error('Ошибка в close_shift:', error);
    ctx.editMessageText('❌ Произошла ошибка. Попробуй позже.');
  }
});


// ===== CALLBACK: Статус смены =====
bot.action('shift_status', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id;

  try {
    const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

    if (!employee) {
      return ctx.editMessageText('❌ Ты не зарегистрирован в системе.');
    }

    const activeShift = await sheetsService.getActiveShift(employee.phone);

    if (!activeShift) {
      return ctx.editMessageText(
        '📊 Статус смены\n\n' +
        '❌ Смена не открыта\n\n' +
        'Используй кнопку ниже для открытия смены.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📥 Открыть смену', 'open_shift')],
          [Markup.button.callback('◀️ Назад', 'back_to_menu')]
        ])
      );
    }

    // Вычисляем текущую длительность
    const now = new Date();
    const [startHours, startMinutes] = activeShift.start_time.split(':').map(Number);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    let durationMinutes = currentMinutes - (startHours * 60 + startMinutes);
    if (durationMinutes < 0) durationMinutes += 24 * 60;

    const hours = (durationMinutes / 60).toFixed(2);
    const payment = Math.round(parseFloat(hours) * employee.hourly_rate);

    ctx.editMessageText(
      `📊 Статус смены\n\n` +
      `✅ Смена открыта\n\n` +
      `Сотрудник: ${employee.full_name}\n` +
      `Должность: ${employee.position}\n` +
      `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
      `Начало: ${activeShift.start_time}\n` +
      `Длительность: ${formatDuration(durationMinutes)}\n` +
      `Часы: ${hours}ч\n` +
      `Текущая сумма: ${payment} ₽`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📤 Закрыть смену', 'close_shift')],
        [Markup.button.callback('🔄 Обновить', 'shift_status')],
        [Markup.button.callback('◀️ Назад', 'back_to_menu')]
      ])
    );
  } catch (error) {
    console.error('Ошибка в shift_status:', error);
    ctx.editMessageText('❌ Произошла ошибка. Попробуй позже.');
  }
});

// ===== CALLBACK: Отмена действия =====
bot.action('cancel_action', async (ctx) => {
  await ctx.answerCbQuery('❌ Отменено');
  const telegramId = ctx.from.id;

  // Очищаем ожидающую проверку локации
  pendingLocationChecks.delete(telegramId);

  try {
    const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

    if (!employee) {
      return ctx.editMessageText('❌ Ты не зарегистрирован в системе.');
    }

    ctx.editMessageText(
      `${employee.full_name} 👋\n\n` +
      `Действие отменено. Выбери операцию:`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📥 Открыть смену', 'open_shift')],
        [Markup.button.callback('📤 Закрыть смену', 'close_shift')],
        [Markup.button.callback('📊 Статус смены', 'shift_status')]
      ])
    );
  } catch (error) {
    console.error('Ошибка в cancel_action:', error);
    ctx.editMessageText('❌ Произошла ошибка. Попробуй /start');
  }
});

// ===== CALLBACK: Назад в меню =====
bot.action('back_to_menu', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id;

  try {
    const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

    if (!employee) {
      return ctx.editMessageText('❌ Ты не зарегистрирован в системе. Используй /start');
    }

    ctx.editMessageText(
      `${employee.full_name} 👋\n\n` +
      `Должность: ${employee.position}\n` +
      `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
      `Выбери действие:`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📥 Открыть смену', 'open_shift')],
        [Markup.button.callback('📤 Закрыть смену', 'close_shift')],
        [Markup.button.callback('📊 Статус смены', 'shift_status')]
      ])
    );
  } catch (error) {
    console.error('Ошибка в back_to_menu:', error);
    ctx.editMessageText('❌ Произошла ошибка. Попробуй /start');
  }
});

// Graceful shutdown
let botStarted = false;

process.once('SIGINT', () => {
  console.log('⚠️ Получен сигнал SIGINT, останавливаем...');
  webhookServer.stop();
  if (botStarted) bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('⚠️ Получен сигнал SIGTERM, останавливаем...');
  webhookServer.stop();
  if (botStarted) bot.stop('SIGTERM');
});

// Инициализация и запуск cron-напоминаний
const cronService = new CronService(bot, sheetsService);

// Инициализация обработчика webhooks
const webhookHandler = new WebhookHandler(bot, sheetsService);

// Инициализация webhook сервера
const webhookServer = new WebhookServer((data) => webhookHandler.handle(data));

// Запуск webhook сервера СРАЗУ (чтобы Railway видел живой сервис)
webhookServer.start();

// Запуск cron-напоминаний на top-level (не зависит от bot.launch)
cronService.start();
console.log('✅ Cron-напоминания запущены');

// Ежедневный отчёт в 22:30 NSK (top-level, как в ШРМ_ЗАКУПКИ и ШРМ_ПЕРЕМЕЩЕНИЯ)
cron.schedule('30 22 * * *', async () => {
  console.log('Running daily report cron job...');
  try {
    await sendDailyReport(bot, sheetsService);
    console.log('Daily report cron job completed successfully');
  } catch (error) {
    console.error('Daily report cron job failed:', error.message);
  }
}, { timezone: 'Asia/Novosibirsk' });
console.log('📊 Ежедневный отчёт запланирован на 22:30 NSK');

// Функция запуска бота с retry
async function startBotWithRetry(maxRetries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Попытка запуска бота ${attempt}/${maxRetries}...`);

      // Сбрасываем предыдущую polling-сессию перед запуском
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });

      await bot.launch({ dropPendingUpdates: true });
      botStarted = true;
      console.log('✅ Бот успешно запущен!');
      console.log(`📱 Bot username: @${bot.botInfo?.username}`);
      return;
    } catch (err) {
      console.error(`❌ Попытка ${attempt} не удалась:`, err.message);

      if (err.message.includes('409') && attempt < maxRetries) {
        console.log(`⏳ Ждём ${delayMs / 1000} сек перед следующей попыткой...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else if (attempt === maxRetries) {
        console.error('❌ Все попытки исчерпаны. Бот не запущен.');
        // Не выходим из процесса — webhook сервер продолжает работать
      }
    }
  }
}

// Запуск бота
startBotWithRetry();
