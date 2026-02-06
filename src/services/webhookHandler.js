/**
 * Обработчик webhook событий от iiko Cloud API
 * Синхронизирует открытие/закрытие смен из iiko в бота
 */
class WebhookHandler {
  constructor(bot, sheetsService) {
    this.bot = bot;
    this.sheetsService = sheetsService;
  }

  /**
   * Главный обработчик webhook событий
   * iiko отправляет массив событий, не один объект
   * @param {Array|Object} data - Данные webhook от iiko
   */
  async handle(data) {
    // iiko sends an array of events
    const events = Array.isArray(data) ? data : [data];

    for (const event of events) {
      const { eventType, eventInfo, organizationId, eventTime } = event;

      console.log(`🔔 Обработка события: ${eventType}`);

      switch (eventType) {
        case 'PersonalShift':
          await this.handlePersonalShift(eventInfo, eventTime);
          break;

        case 'StopListUpdate':
          console.log('📋 Обновление стоп-листа (игнорируем)');
          break;

        case 'DeliveryOrderUpdate':
          console.log('🚚 Обновление заказа доставки (игнорируем)');
          break;

        default:
          console.log(`❓ Неизвестный тип события: ${eventType}`);
      }
    }
  }

  /**
   * Обработка события изменения личной смены
   * @param {Object} eventInfo - Данные о смене
   * @param {string} eventTime - Время события
   */
  async handlePersonalShift(eventInfo, eventTime) {
    try {
      console.log('👤 Обработка PersonalShift:', JSON.stringify(eventInfo, null, 2));

      // Структура eventInfo может быть разной, логируем для изучения
      // Типичные поля: employeeId, isOpened, clockInTime, clockOutTime

      const employeeId = eventInfo.employeeId || eventInfo.employee?.id || eventInfo.id;
      const isOpened = eventInfo.isOpened ?? eventInfo.opened ?? eventInfo.isOpen;

      if (!employeeId) {
        console.warn('⚠️ PersonalShift: не найден employeeId в данных');
        return;
      }

      // Ищем сотрудника по iiko_id
      const employee = await this.sheetsService.findEmployeeByIikoId(employeeId);

      if (!employee) {
        console.warn(`⚠️ Сотрудник с iiko_id=${employeeId} не найден в таблице`);
        return;
      }

      console.log(`✅ Найден сотрудник: ${employee.full_name} (Telegram ID: ${employee.telegram_id})`);

      if (isOpened === true) {
        // Смена открыта в iiko
        await this.onShiftOpened(employee, eventInfo, eventTime);
      } else if (isOpened === false) {
        // Смена закрыта в iiko
        await this.onShiftClosed(employee, eventInfo, eventTime);
      } else {
        console.log('❓ Не удалось определить статус смены (isOpened не указан)');
        // Всё равно уведомляем для отладки
        await this.notifyEmployee(employee,
          `🔔 Изменение смены в iiko\n\n` +
          `Время: ${eventTime}\n` +
          `Данные: ${JSON.stringify(eventInfo, null, 2).slice(0, 500)}`
        );
      }

    } catch (error) {
      console.error('❌ Ошибка обработки PersonalShift:', error.message);
    }
  }

  /**
   * Обработка открытия смены из iiko
   */
  async onShiftOpened(employee, eventInfo, eventTime) {
    console.log(`📥 Смена открыта в iiko для ${employee.full_name}`);

    try {
      // Проверяем, нет ли уже открытой смены в таблице
      const activeShift = await this.sheetsService.getActiveShift(employee.phone);

      if (activeShift) {
        console.log('⚠️ Смена уже открыта в таблице, пропускаем');
        return;
      }

      // Логируем открытие смены в Google Sheets
      const result = await this.sheetsService.logShiftStart({
        phone: employee.phone,
        full_name: employee.full_name,
        hourly_rate: employee.hourly_rate
      });

      console.log(`✅ Смена записана в таблицу: ${result.date} ${result.time}`);

      // Уведомляем сотрудника в Telegram
      await this.notifyEmployee(employee,
        `📥 Смена автоматически открыта!\n\n` +
        `Источник: iiko\n` +
        `Дата: ${result.date}\n` +
        `Начало: ${result.time}\n` +
        `Ставка: ${employee.hourly_rate} ₽/час\n\n` +
        `Хорошей смены! 💪`
      );

    } catch (error) {
      console.error('❌ Ошибка при открытии смены из iiko:', error.message);
    }
  }

  /**
   * Обработка закрытия смены из iiko
   */
  async onShiftClosed(employee, eventInfo, eventTime) {
    console.log(`📤 Смена закрыта в iiko для ${employee.full_name}`);

    try {
      // Проверяем, есть ли открытая смена в таблице
      const activeShift = await this.sheetsService.getActiveShift(employee.phone);

      if (!activeShift) {
        console.log('⚠️ Нет открытой смены в таблице, пропускаем');
        return;
      }

      // Закрываем смену в Google Sheets
      const result = await this.sheetsService.logShiftEnd({
        phone: employee.phone,
        hourly_rate: employee.hourly_rate
      });

      console.log(`✅ Смена закрыта в таблице: ${result.end_time}`);

      // Уведомляем сотрудника в Telegram
      await this.notifyEmployee(employee,
        `📤 Смена автоматически закрыта!\n\n` +
        `Источник: iiko\n` +
        `Начало: ${result.start_time}\n` +
        `Конец: ${result.end_time}\n` +
        `Часы: ${result.hours_worked}ч\n` +
        `К оплате: ${result.total_payment} ₽\n\n` +
        `Спасибо за работу! 🎉`
      );

    } catch (error) {
      console.error('❌ Ошибка при закрытии смены из iiko:', error.message);
    }
  }

  /**
   * Отправка уведомления сотруднику в Telegram
   */
  async notifyEmployee(employee, message) {
    if (!employee.telegram_id) {
      console.warn(`⚠️ У сотрудника ${employee.full_name} не указан Telegram ID`);
      return;
    }

    try {
      await this.bot.telegram.sendMessage(employee.telegram_id, message);
      console.log(`📨 Уведомление отправлено: ${employee.full_name}`);
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления ${employee.full_name}:`, error.message);
    }
  }
}

module.exports = WebhookHandler;
