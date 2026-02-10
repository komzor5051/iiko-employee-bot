const { google } = require('googleapis');

/**
 * Сервис для работы с Google Sheets API
 * Управляет авторизацией сотрудников и логированием смен
 *
 * Структура листа "Сотрудники":
 * A: Телефон | B: ФИО | C: ТГ username | D: Должность | E: Ставка | F: Telegram ID | G: iiko ID
 *
 * Структура листа "Shift Logs":
 * A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Часы | G: Ставка | H: К оплате
 *
 * Структура листа "Расписание":
 * A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Напом. вечер | G: Напом. начало | H: Напом. конец
 */
class GoogleSheetsService {
  constructor(serviceAccountJson, spreadsheetId) {
    this.spreadsheetId = spreadsheetId;

    // Инициализация Google Auth
    this.auth = new google.auth.GoogleAuth({
      credentials: serviceAccountJson,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  /**
   * Нормализация номера телефона
   * Убирает все нецифровые символы и приводит к формату 9XXXXXXXXX
   * @param {string} phone - Номер телефона в любом формате
   * @returns {string} - Нормализованный номер (10 цифр без кода страны)
   */
  normalizePhone(phone) {
    // Убираем все нецифровые символы
    const digits = phone.replace(/\D/g, '');

    // Если начинается с 7 или 8 и длина 11 — убираем первую цифру
    if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
      return digits.slice(1);
    }

    // Если уже 10 цифр — возвращаем как есть
    if (digits.length === 10) {
      return digits;
    }

    // Возвращаем как есть для нестандартных номеров
    return digits;
  }

  /**
   * Получить данные из указанного диапазона
   */
  async getSheetData(range) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
        valueRenderOption: 'FORMATTED_VALUE'
      });

      return response.data.values || [];
    } catch (error) {
      console.error(`Ошибка чтения Google Sheets (${range}):`, error.message);
      throw error;
    }
  }

  /**
   * Записать данные в указанный диапазон
   */
  async appendSheetData(range, values) {
    try {
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [values]
        }
      });

      return response.data;
    } catch (error) {
      console.error(`Ошибка записи в Google Sheets (${range}):`, error.message);
      throw error;
    }
  }

  /**
   * Обновить данные в конкретной ячейке
   */
  async updateSheetData(range, values) {
    try {
      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[values]]
        }
      });

      return response.data;
    } catch (error) {
      console.error(`Ошибка обновления Google Sheets (${range}):`, error.message);
      throw error;
    }
  }

  // ==================== МЕТОДЫ ДЛЯ СОТРУДНИКОВ ====================

  /**
   * Найти сотрудника по номеру телефона
   * Структура: A: Телефон | B: ФИО | C: ТГ username | D: Должность | E: Ставка | F: Telegram ID | G: iiko ID
   * @param {string} phone - Номер телефона в любом формате
   * @returns {Object|null} - Объект сотрудника или null
   */
  async findEmployeeByPhone(phone) {
    const rows = await this.getSheetData('Сотрудники!A2:G');
    const normalizedInput = this.normalizePhone(phone);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0]) continue;

      const normalizedRow = this.normalizePhone(row[0]);
      if (normalizedRow === normalizedInput) {
        return {
          phone: row[0],
          full_name: row[1] || '',
          username: row[2] || '',
          position: row[3] || '',
          hourly_rate: parseFloat(row[4]) || 0,
          telegram_id: row[5] || null,
          iiko_id: row[6] || null,
          rowIndex: i + 2 // +2 для корректного номера строки
        };
      }
    }

    return null;
  }

  /**
   * Найти сотрудника по Telegram ID
   * @param {number|string} telegramId - Telegram ID пользователя
   * @returns {Object|null} - Объект сотрудника или null
   */
  async findEmployeeByTelegramId(telegramId) {
    const rows = await this.getSheetData('Сотрудники!A2:G');
    const telegramIdStr = String(telegramId);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row[5] && String(row[5]) === telegramIdStr) {
        return {
          phone: row[0],
          full_name: row[1] || '',
          username: row[2] || '',
          position: row[3] || '',
          hourly_rate: parseFloat(row[4]) || 0,
          telegram_id: row[5],
          iiko_id: row[6] || null,
          rowIndex: i + 2
        };
      }
    }

    return null;
  }

  /**
   * Найти сотрудника по iiko ID
   * @param {string} iikoId - iiko ID (UUID)
   * @returns {Object|null} - Объект сотрудника или null
   */
  async findEmployeeByIikoId(iikoId) {
    const rows = await this.getSheetData('Сотрудники!A2:G');
    const iikoIdStr = String(iikoId);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row[6] && String(row[6]) === iikoIdStr) {
        return {
          phone: row[0],
          full_name: row[1] || '',
          username: row[2] || '',
          position: row[3] || '',
          hourly_rate: parseFloat(row[4]) || 0,
          telegram_id: row[5] || null,
          iiko_id: row[6],
          rowIndex: i + 2
        };
      }
    }

    return null;
  }

  /**
   * Сохранить Telegram ID для сотрудника (колонка F)
   * @param {number} rowIndex - Номер строки в таблице
   * @param {number} telegramId - Telegram ID
   */
  async saveTelegramId(rowIndex, telegramId) {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Сотрудники!F${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[telegramId]] }
    });

    console.log(`✅ Telegram ID сохранён в строке ${rowIndex}: ${telegramId}`);
  }

  /**
   * Сохранить iiko ID для сотрудника (колонка G)
   * @param {number} rowIndex - Номер строки в таблице
   * @param {string} iikoId - iiko ID (UUID)
   */
  async saveIikoId(rowIndex, iikoId) {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Сотрудники!G${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[iikoId]] }
    });

    console.log(`✅ iiko ID сохранён в строке ${rowIndex}: ${iikoId}`);
  }

  /**
   * Получить всех сотрудников из таблицы
   * @returns {Array} - Массив сотрудников с rowIndex
   */
  async getAllEmployees() {
    const rows = await this.getSheetData('Сотрудники!A2:G');

    return rows.map((row, i) => ({
      phone: row[0] || '',
      full_name: row[1] || '',
      username: row[2] || '',
      position: row[3] || '',
      hourly_rate: parseFloat(row[4]) || 0,
      telegram_id: row[5] || null,
      iiko_id: row[6] || null,
      rowIndex: i + 2
    })).filter(emp => emp.full_name); // Только с заполненным ФИО
  }

  // ==================== МЕТОДЫ ДЛЯ РАСПИСАНИЯ ====================
  // Структура: A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Напом. вечер | G: Напом. начало | H: Напом. конец

  /**
   * Получить расписание на конкретную дату
   * @param {string} dateStr - Дата в формате ДД.ММ.ГГГГ
   * @returns {Array} - Массив смен на указанную дату
   */
  async getScheduleForDate(dateStr) {
    const rows = await this.getSheetData('Расписание!A2:H');

    return rows
      .map((row, i) => ({
        date: row[0] || '',
        phone: row[1] || '',
        full_name: row[2] || '',
        start_time: row[3] || '',
        end_time: row[4] || '',
        reminder_evening_sent: (row[5] || '').toLowerCase() === 'да',
        reminder_start_sent: (row[6] || '').toLowerCase() === 'да',
        reminder_end_sent: (row[7] || '').toLowerCase() === 'да',
        rowIndex: i + 2
      }))
      .filter(shift => shift.date === dateStr && shift.phone);
  }

  /**
   * Получить расписание на завтра
   * @returns {Array} - Массив смен на завтра
   */
  async getTomorrowSchedule() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk' });
    return this.getScheduleForDate(dateStr);
  }

  /**
   * Получить смены, которые начинаются через час (±5 минут)
   * @returns {Array} - Массив смен
   */
  async getShiftsStartingInOneHour() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk' });

    const shifts = await this.getScheduleForDate(todayStr);

    // Текущее время в Новосибирске
    const nskTime = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit', hour12: false });
    const [nskHours, nskMinutes] = nskTime.split(':').map(Number);
    const currentMinutes = nskHours * 60 + nskMinutes;

    return shifts.filter(shift => {
      if (!shift.start_time || shift.reminder_start_sent) return false;

      const [shiftHours, shiftMinutes] = shift.start_time.split(':').map(Number);
      const shiftStartMinutes = shiftHours * 60 + shiftMinutes;

      const targetMinutes = currentMinutes + 60; // Через час

      // Допуск ±5 минут
      return Math.abs(shiftStartMinutes - targetMinutes) <= 5;
    });
  }

  /**
   * Получить смены, которые заканчиваются через час (±5 минут)
   * @returns {Array} - Массив смен
   */
  async getShiftsEndingInOneHour() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk' });

    const shifts = await this.getScheduleForDate(todayStr);

    // Текущее время в Новосибирске
    const nskTime = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit', hour12: false });
    const [nskHours, nskMinutes] = nskTime.split(':').map(Number);
    const currentMinutes = nskHours * 60 + nskMinutes;

    return shifts.filter(shift => {
      if (!shift.end_time || shift.reminder_end_sent) return false;

      const [shiftHours, shiftMinutes] = shift.end_time.split(':').map(Number);
      const shiftEndMinutes = shiftHours * 60 + shiftMinutes;

      const targetMinutes = currentMinutes + 60; // Через час

      // Допуск ±5 минут
      return Math.abs(shiftEndMinutes - targetMinutes) <= 5;
    });
  }

  /**
   * Пометить напоминание как отправленное
   * @param {number} rowIndex - Номер строки в таблице
   * @param {string} reminderType - Тип напоминания: 'evening' | 'start' | 'end'
   */
  async markReminderSent(rowIndex, reminderType) {
    const columnMap = {
      evening: 'F',
      start: 'G',
      end: 'H'
    };

    const column = columnMap[reminderType];
    if (!column) {
      throw new Error(`Неизвестный тип напоминания: ${reminderType}`);
    }

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Расписание!${column}${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['да']] }
    });

    console.log(`✅ Напоминание ${reminderType} помечено как отправленное (строка ${rowIndex})`);
  }

  // ==================== МЕТОДЫ ДЛЯ SHIFT LOGS ====================
  // Структура: A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Часы | G: Ставка | H: К оплате

  /**
   * Логировать начало смены
   * @param {Object} data - { phone, full_name, hourly_rate }
   */
  async logShiftStart(data) {
    const now = new Date();
    const date = now.toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk' });
    const time = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit' });

    const values = [
      date,           // A: Дата
      data.phone,     // B: Телефон
      data.full_name, // C: ФИО
      time,           // D: Время начала
      '',             // E: Время окончания (пусто)
      '',             // F: Часы (пусто)
      data.hourly_rate, // G: Ставка
      ''              // H: К оплате (пусто)
    ];

    await this.appendSheetData('Shift Logs!A:H', values);

    console.log(`✅ Смена открыта для ${data.full_name} в ${time}`);

    return { date, time };
  }

  /**
   * Получить активную смену пользователя (без времени окончания)
   * @param {string} phone - Телефон сотрудника
   * @returns {Object|null} - Активная смена или null
   */
  async getActiveShift(phone) {
    const rows = await this.getSheetData('Shift Logs!A2:H');
    const normalizedPhone = this.normalizePhone(phone);

    // Ищем последнюю строку для этого пользователя без end_time
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (!row[1]) continue;

      const rowPhone = this.normalizePhone(row[1]);
      // Телефон совпадает и время окончания пусто
      if (rowPhone === normalizedPhone && !row[4]) {
        return {
          date: row[0],
          phone: row[1],
          full_name: row[2],
          start_time: row[3],
          hourly_rate: parseFloat(row[6]) || 0,
          rowIndex: i + 2 // +2 для корректного номера строки
        };
      }
    }

    return null;
  }

  /**
   * Закрыть смену и записать результаты
   * @param {Object} data - { phone, hourly_rate }
   * @returns {Object} - Результат закрытия смены
   */
  async logShiftEnd(data) {
    const activeShift = await this.getActiveShift(data.phone);

    if (!activeShift) {
      throw new Error('Активная смена не найдена');
    }

    const now = new Date();
    const endTime = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit' });

    // Парсим время начала и вычисляем длительность
    const [startHours, startMinutes] = activeShift.start_time.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);

    let durationMinutes = (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes);
    // Если смена перешла через полночь
    if (durationMinutes < 0) {
      durationMinutes += 24 * 60;
    }

    const hoursWorked = (durationMinutes / 60).toFixed(2);
    const totalPayment = Math.round(parseFloat(hoursWorked) * data.hourly_rate);

    const rowNumber = activeShift.rowIndex;

    // Обновляем одним batch запросом
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `Shift Logs!E${rowNumber}`, values: [[endTime]] },
          { range: `Shift Logs!F${rowNumber}`, values: [[hoursWorked]] },
          { range: `Shift Logs!H${rowNumber}`, values: [[totalPayment]] }
        ]
      }
    });

    console.log(`✅ Смена закрыта для ${activeShift.full_name}. Отработано: ${hoursWorked}ч, к оплате: ${totalPayment}₽`);

    return {
      full_name: activeShift.full_name,
      start_time: activeShift.start_time,
      end_time: endTime,
      hours_worked: hoursWorked,
      duration_minutes: durationMinutes,
      hourly_rate: data.hourly_rate,
      total_payment: totalPayment
    };
  }

  /**
   * Получить все закрытые смены за сегодня
   * @returns {Array} - Массив смен с данными
   */
  async getTodayShiftLogs() {
    const rows = await this.getSheetData('Shift Logs!A2:H');
    // Используем Asia/Novosibirsk для правильной даты на сервере
    const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk' }); // ДД.ММ.ГГГГ

    return rows
      .filter(row => row[0] === today && row[4]) // Только сегодняшние и закрытые смены
      .map(row => ({
        date: row[0],
        phone: row[1],
        full_name: row[2],
        start_time: row[3],
        end_time: row[4],
        hours_worked: parseFloat(row[5]) || 0,
        hourly_rate: parseFloat(row[6]) || 0,
        total_payment: parseFloat(row[7]) || 0
      }));
  }

  /**
   * Получить расписание на сегодня
   * @returns {Array} - Массив смен с данными о времени
   */
  async getTodaySchedule() {
    const rows = await this.getSheetData('Расписание!A2:H');
    const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk' });

    return rows
      .filter(row => row[0] === today)
      .map((row, index) => ({
        rowIndex: index + 2,
        date: row[0],
        phone: row[1],
        full_name: row[2],
        start_time: row[3],
        end_time: row[4]
      }));
  }

  /**
   * Получить все открытые (незакрытые) смены
   * @returns {Array} - Массив активных смен
   */
  async getAllActiveShifts() {
    const rows = await this.getSheetData('Shift Logs!A2:H');
    const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk' });

    return rows
      .filter(row => row[0] === today && row[3] && !row[4]) // Сегодняшние, есть начало, нет конца
      .map((row, index) => ({
        rowIndex: index + 2,
        date: row[0],
        phone: row[1],
        full_name: row[2],
        start_time: row[3]
      }));
  }
}

module.exports = GoogleSheetsService;
