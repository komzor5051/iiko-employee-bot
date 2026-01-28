const { Markup } = require('telegraf');

/**
 * Обработчик регистрации по номеру телефона через Google Sheets
 */
module.exports = (bot, sheetsService) => {

  // Команда /start
  bot.command('start', async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      // Проверяем, зарегистрирован ли пользователь
      const employee = await sheetsService.findEmployeeByTelegramId(telegramId);

      if (employee) {
        return ctx.reply(
          `Привет, ${employee.full_name}! 👋\n\n` +
          `Должность: ${employee.position}\n` +
          `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
          `Используй /open для открытия смены`
        );
      }

      // Не зарегистрирован - запрашиваем номер телефона
      await ctx.reply(
        'Добро пожаловать! 👋\n\n' +
        'Для регистрации нужен твой номер телефона.',
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

  // Обработка контакта (номера телефона)
  bot.on('contact', async (ctx) => {
    const phone = ctx.message.contact.phone_number;
    const telegramId = ctx.from.id;

    try {
      // Нормализуем номер (добавляем + если нет)
      const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

      console.log(`📞 Получен номер: ${normalizedPhone} от пользователя ${telegramId}`);

      // Ищем сотрудника в Google Sheets
      const employee = await sheetsService.findEmployeeByPhone(normalizedPhone);

      if (!employee) {
        return ctx.reply(
          '❌ Ты не найден в базе сотрудников.\n\n' +
          'Обратись к менеджеру:\n' +
          '@manager_username или +7-XXX-XXX-XXXX',
          Markup.removeKeyboard()
        );
      }

      // Сохраняем Telegram ID в Google Sheets
      await sheetsService.updateTelegramId(normalizedPhone, telegramId);

      await ctx.reply(
        `✅ Регистрация завершена!\n\n` +
        `Добро пожаловать, ${employee.full_name}!\n` +
        `Должность: ${employee.position}\n` +
        `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
        `Используй /open для открытия смены`,
        Markup.removeKeyboard()
      );
    } catch (error) {
      console.error('Ошибка при регистрации:', error);
      ctx.reply(
        '❌ Произошла ошибка при регистрации. Попробуй ещё раз /start',
        Markup.removeKeyboard()
      );
    }
  });
};
