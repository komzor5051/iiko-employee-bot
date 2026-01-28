const cron = require('node-cron');

/**
 * Сервис автоматических напоминаний о сменах
 *
 * Типы напоминаний:
 * 1. Вечернее (20:00) — "Завтра у тебя смена с X до Y"
 * 2. За час до начала — "Через час начинается твоя смена"
 * 3. За час до окончания — "Через час смена заканчивается"
 */
class CronService {
  constructor(bot, sheetsService) {
    this.bot = bot;
    this.sheetsService = sheetsService;
  }

  /**
   * Запустить все cron-задачи
   */
  start() {
    // Вечернее напоминание в 20:00 по Asia/Novosibirsk
    cron.schedule('0 20 * * *', () => this.sendEveningReminders(), {
      timezone: 'Asia/Novosibirsk'
    });
    console.log('⏰ Cron: вечерние напоминания запланированы на 20:00');

    // Проверка каждые 5 минут для напоминаний "за час"
    cron.schedule('*/5 * * * *', () => this.sendHourlyReminders(), {
      timezone: 'Asia/Novosibirsk'
    });
    console.log('⏰ Cron: проверка напоминаний каждые 5 минут');
  }

  /**
   * Отправить вечерние напоминания о завтрашних сменах
   */
  async sendEveningReminders() {
    console.log('🔔 Запуск вечерних напоминаний...');

    try {
      const tomorrowShifts = await this.sheetsService.getTomorrowSchedule();
      console.log(`📋 Найдено ${tomorrowShifts.length} смен на завтра`);

      for (const shift of tomorrowShifts) {
        // Пропускаем, если напоминание уже отправлено
        if (shift.reminder_evening_sent) {
          console.log(`⏭️ Пропуск ${shift.full_name}: вечернее напоминание уже отправлено`);
          continue;
        }

        // Ищем telegram_id сотрудника по телефону
        const employee = await this.sheetsService.findEmployeeByPhone(shift.phone);

        if (!employee || !employee.telegram_id) {
          console.log(`⚠️ Не найден telegram_id для ${shift.full_name} (${shift.phone})`);
          continue;
        }

        const message =
          `🔔 Напоминание о смене\n\n` +
          `Привет, ${shift.full_name}!\n` +
          `Завтра у тебя смена:\n` +
          `📅 ${shift.date}\n` +
          `⏰ ${shift.start_time} — ${shift.end_time}\n\n` +
          `Хорошего рабочего дня!`;

        try {
          await this.bot.telegram.sendMessage(employee.telegram_id, message);
          await this.sheetsService.markReminderSent(shift.rowIndex, 'evening');
          console.log(`✅ Вечернее напоминание отправлено: ${shift.full_name}`);
        } catch (sendError) {
          console.error(`❌ Ошибка отправки вечернего напоминания ${shift.full_name}:`, sendError.message);
        }
      }
    } catch (error) {
      console.error('❌ Ошибка в sendEveningReminders:', error);
    }
  }

  /**
   * Отправить напоминания "за час до начала" и "за час до окончания"
   */
  async sendHourlyReminders() {
    await this.sendStartReminders();
    await this.sendEndReminders();
  }

  /**
   * Отправить напоминания "за час до начала смены"
   */
  async sendStartReminders() {
    try {
      const shifts = await this.sheetsService.getShiftsStartingInOneHour();

      for (const shift of shifts) {
        const employee = await this.sheetsService.findEmployeeByPhone(shift.phone);

        if (!employee || !employee.telegram_id) {
          console.log(`⚠️ Не найден telegram_id для ${shift.full_name} (${shift.phone})`);
          continue;
        }

        const message =
          `⏰ Смена через час!\n\n` +
          `${shift.full_name}, через час начинается твоя смена.\n` +
          `Время начала: ${shift.start_time}\n\n` +
          `Не забудь открыть смену в боте!`;

        try {
          await this.bot.telegram.sendMessage(employee.telegram_id, message, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📥 Открыть смену', callback_data: 'open_shift' }]
              ]
            }
          });
          await this.sheetsService.markReminderSent(shift.rowIndex, 'start');
          console.log(`✅ Напоминание о начале отправлено: ${shift.full_name}`);
        } catch (sendError) {
          console.error(`❌ Ошибка отправки напоминания о начале ${shift.full_name}:`, sendError.message);
        }
      }
    } catch (error) {
      console.error('❌ Ошибка в sendStartReminders:', error);
    }
  }

  /**
   * Отправить напоминания "за час до окончания смены"
   */
  async sendEndReminders() {
    try {
      const shifts = await this.sheetsService.getShiftsEndingInOneHour();

      for (const shift of shifts) {
        const employee = await this.sheetsService.findEmployeeByPhone(shift.phone);

        if (!employee || !employee.telegram_id) {
          console.log(`⚠️ Не найден telegram_id для ${shift.full_name} (${shift.phone})`);
          continue;
        }

        const message =
          `⏰ Смена заканчивается через час!\n\n` +
          `${shift.full_name}, не забудь закрыть смену.\n` +
          `Время окончания: ${shift.end_time}`;

        try {
          await this.bot.telegram.sendMessage(employee.telegram_id, message, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📤 Закрыть смену', callback_data: 'close_shift' }]
              ]
            }
          });
          await this.sheetsService.markReminderSent(shift.rowIndex, 'end');
          console.log(`✅ Напоминание об окончании отправлено: ${shift.full_name}`);
        } catch (sendError) {
          console.error(`❌ Ошибка отправки напоминания об окончании ${shift.full_name}:`, sendError.message);
        }
      }
    } catch (error) {
      console.error('❌ Ошибка в sendEndReminders:', error);
    }
  }
}

module.exports = CronService;
