const cron = require('node-cron');
const config = require('../config/env');

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
    this.managersGroupId = config.managersGroupId;
  }

  /**
   * Запустить все cron-задачи
   * Время в UTC (Railway не всегда поддерживает timezone)
   * Asia/Novosibirsk = UTC+7
   */
  start() {
    const tz = { timezone: 'Asia/Novosibirsk' };

    // Вечернее напоминание в 20:00 NSK
    cron.schedule('0 20 * * *', () => this.sendEveningReminders(), tz);
    console.log('⏰ Cron: вечерние напоминания запланированы на 20:00 NSK');

    // Проверка каждые 5 минут для напоминаний "за час"
    cron.schedule('*/5 * * * *', () => this.sendHourlyReminders(), tz);
    console.log('⏰ Cron: проверка напоминаний каждые 5 минут');

    // Ежедневный отчёт перенесён в index.js (top-level cron, как в ШРМ_ЗАКУПКИ и ШРМ_ПЕРЕМЕЩЕНИЯ)

    // Проверка проблем каждые 15 минут (эскалация)
    cron.schedule('*/15 * * * *', () => this.checkProblemsAndEscalate(), tz);
    console.log('⏰ Cron: проверка проблем каждые 15 минут');
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
   * Проверка проблем и эскалация в группу руководителей
   */
  async checkProblemsAndEscalate() {
    console.log('🔍 Проверка проблем для эскалации...');

    try {
      const problems = [];

      // 1. Проверяем сотрудников, которые не открыли смену вовремя
      const lateEmployees = await this.checkLateShiftStart();
      problems.push(...lateEmployees);

      // 2. Проверяем слишком длинные смены (> 12 часов)
      const longShifts = await this.checkLongShifts();
      problems.push(...longShifts);

      // Если есть проблемы — отправляем в группу
      if (problems.length > 0) {
        await this.sendEscalation(problems);
      } else {
        console.log('✅ Проблем не обнаружено');
      }
    } catch (error) {
      console.error('❌ Ошибка проверки проблем:', error.message);
    }
  }

  /**
   * Проверить сотрудников, которые опаздывают на смену
   * (по расписанию смена началась, но не открыта в течение 15 минут)
   */
  async checkLateShiftStart() {
    const problems = [];

    try {
      const now = new Date();
      const currentTime = now.toLocaleTimeString('ru-RU', {
        timeZone: 'Asia/Novosibirsk',
        hour: '2-digit',
        minute: '2-digit'
      });
      const today = now.toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk' });

      // Получаем расписание на сегодня
      const schedule = await this.sheetsService.getTodaySchedule();

      for (const shift of schedule) {
        // Парсим время начала смены
        const [startHour, startMin] = shift.start_time.split(':').map(Number);
        const [nowHour, nowMin] = currentTime.split(':').map(Number);

        const startMinutes = startHour * 60 + startMin;
        const nowMinutes = nowHour * 60 + nowMin;

        // Если прошло больше 15 минут после начала смены
        if (nowMinutes > startMinutes + 15 && nowMinutes < startMinutes + 60) {
          // Проверяем, открыта ли смена
          const activeShift = await this.sheetsService.getActiveShift(shift.phone);

          if (!activeShift) {
            problems.push({
              type: 'late_start',
              employee: shift.full_name,
              phone: shift.phone,
              scheduled_time: shift.start_time,
              current_time: currentTime,
              minutes_late: nowMinutes - startMinutes
            });
          }
        }
      }
    } catch (error) {
      console.error('❌ Ошибка проверки опозданий:', error.message);
    }

    return problems;
  }

  /**
   * Проверить слишком длинные смены (> 12 часов)
   */
  async checkLongShifts() {
    const problems = [];

    try {
      const activeShifts = await this.sheetsService.getAllActiveShifts();
      const now = new Date();
      const nskTime = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit', hour12: false });
      const [nskH, nskM] = nskTime.split(':').map(Number);
      const nowMinutes = nskH * 60 + nskM;

      for (const shift of activeShifts) {
        const [startHour, startMin] = shift.start_time.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;

        let durationMinutes = nowMinutes - startMinutes;
        if (durationMinutes < 0) durationMinutes += 24 * 60; // Переход через полночь

        // Если смена длится больше 12 часов
        if (durationMinutes > 12 * 60) {
          problems.push({
            type: 'long_shift',
            employee: shift.full_name,
            phone: shift.phone,
            start_time: shift.start_time,
            duration_hours: (durationMinutes / 60).toFixed(1)
          });
        }
      }
    } catch (error) {
      console.error('❌ Ошибка проверки длинных смен:', error.message);
    }

    return problems;
  }

  /**
   * Отправить эскалацию в группу руководителей
   */
  async sendEscalation(problems) {
    console.log(`⚠️ Отправка эскалации: ${problems.length} проблем`);

    const lines = problems.map(p => {
      if (p.type === 'late_start') {
        return `🚨 <b>Опоздание</b>: ${p.employee}\n   Должен был начать в ${p.scheduled_time}, опаздывает ${p.minutes_late} мин`;
      }
      if (p.type === 'long_shift') {
        return `⏰ <b>Длинная смена</b>: ${p.employee}\n   Работает уже ${p.duration_hours} часов (с ${p.start_time})`;
      }
      return `❓ Неизвестная проблема: ${JSON.stringify(p)}`;
    });

    const message =
      `⚠️ <b>ЭСКАЛАЦИЯ</b>\n\n` +
      lines.join('\n\n');

    try {
      await this.bot.telegram.sendMessage(this.managersGroupId, message, { parse_mode: 'HTML' });
      console.log('✅ Эскалация отправлена в группу');
    } catch (error) {
      console.error('❌ Ошибка отправки эскалации:', error.message);
    }
  }

}

module.exports = CronService;
