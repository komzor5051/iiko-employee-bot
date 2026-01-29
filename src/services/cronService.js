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
    this.managersGroupId = -5237107467; // ID группы руководителей
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

    // Ежедневный отчёт в группу руководителей в 21:00
    cron.schedule('0 21 * * *', () => this.sendDailyReport(), {
      timezone: 'Asia/Novosibirsk'
    });
    console.log('⏰ Cron: ежедневный отчёт запланирован на 21:00');
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

  /**
   * Отправить ежедневный отчёт в группу руководителей
   */
  async sendDailyReport() {
    console.log('📊 Формирование ежедневного отчёта...');

    try {
      const shifts = await this.sheetsService.getTodayShiftLogs();
      const today = new Date().toLocaleDateString('ru-RU');

      if (shifts.length === 0) {
        const message = `📊 *Отчёт за ${today}*\n\nСегодня смен не было.`;
        await this.bot.telegram.sendMessage(this.managersGroupId, message, { parse_mode: 'Markdown' });
        console.log('✅ Отправлен пустой отчёт (смен не было)');
        return;
      }

      // Считаем итоги
      const totalHours = shifts.reduce((sum, s) => sum + s.hours_worked, 0);
      const totalPayment = shifts.reduce((sum, s) => sum + s.total_payment, 0);

      // Формируем список сотрудников
      const employeeLines = shifts.map(s =>
        `• ${s.full_name}: ${s.start_time}–${s.end_time} (${s.hours_worked.toFixed(1)} ч) — ${s.total_payment.toLocaleString('ru-RU')} ₽`
      ).join('\n');

      const message =
        `📊 *Отчёт за ${today}*\n\n` +
        `👥 *Сотрудники:*\n${employeeLines}\n\n` +
        `━━━━━━━━━━━━━━━\n` +
        `⏱ *Всего часов:* ${totalHours.toFixed(1)} ч\n` +
        `💰 *К выплате:* ${totalPayment.toLocaleString('ru-RU')} ₽`;

      await this.bot.telegram.sendMessage(this.managersGroupId, message, { parse_mode: 'Markdown' });
      console.log(`✅ Ежедневный отчёт отправлен. Смен: ${shifts.length}, часов: ${totalHours.toFixed(1)}, сумма: ${totalPayment}₽`);
    } catch (error) {
      console.error('❌ Ошибка отправки ежедневного отчёта:', error);
    }
  }
}

module.exports = CronService;
