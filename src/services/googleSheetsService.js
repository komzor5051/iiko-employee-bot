const { google } = require('googleapis');
const { formatDateNSK, getDatePartsNSK, dateMatchesRef, parseSheetDate, datePartsEqual } = require('../utils/dateUtils');

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

  /**
   * Найти сотрудника по ФИО (точное совпадение, fallback — вхождение подстроки)
   * @param {string} name - ФИО из расписания
   * @returns {Object|null} - Объект сотрудника или null
   */
  async findEmployeeByName(name) {
    if (!name) return null;
    const rows = await this.getSheetData('Сотрудники!A2:G');
    const nameLower = name.trim().toLowerCase();

    // Точное совпадение
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const fullName = (row[1] || '').trim();
      if (fullName.toLowerCase() === nameLower) {
        return {
          phone: row[0] || '',
          full_name: fullName,
          username: row[2] || '',
          position: row[3] || '',
          hourly_rate: parseFloat(row[4]) || 0,
          telegram_id: row[5] || null,
          iiko_id: row[6] || null,
          rowIndex: i + 2
        };
      }
    }

    // Fallback: вхождение подстроки
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const fullName = (row[1] || '').trim();
      if (fullName.toLowerCase().includes(nameLower) || nameLower.includes(fullName.toLowerCase())) {
        return {
          phone: row[0] || '',
          full_name: fullName,
          username: row[2] || '',
          position: row[3] || '',
          hourly_rate: parseFloat(row[4]) || 0,
          telegram_id: row[5] || null,
          iiko_id: row[6] || null,
          rowIndex: i + 2
        };
      }
    }

    return null;
  }

  // ==================== МЕТОДЫ ДЛЯ РАСПИСАНИЯ (МАТРИЧНЫЙ ФОРМАТ) ====================
  //
  // Лист "Расписание" — календарная матрица:
  //   Строка 1: пусто | 10.февр. | 11.февр. | ...
  //   Строки 2+: ФИО   | 8:30-21:00 | ...
  //   Секции ("Администратор", "Кухня") — строки без смен, пропускаются.
  //
  // Лист "Напоминания":
  //   A: Дата | B: ФИО | C: Тип (evening/start/end)

  /**
   * Прочитать матричное расписание и вернуть структурированные данные.
   *
   * @returns {{ dates: Array<{col: number, day: number, month: number, year: number}>, employees: Array<{name: string, shifts: Object}> }}
   */
  async getScheduleMatrix() {
    const rows = await this.getSheetData('Расписание');

    if (!rows || rows.length === 0) {
      return { dates: [], employees: [] };
    }

    // Строка 1: заголовки с датами (столбец 0 = пусто / "ФИО")
    const headerRow = rows[0];
    const dates = [];
    for (let col = 1; col < headerRow.length; col++) {
      const parsed = parseSheetDate(headerRow[col]);
      if (parsed) {
        dates.push({ col, ...parsed });
      }
    }

    // Строки 2+: сотрудники и их смены
    const employees = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const name = (row[0] || '').trim();
      if (!name) continue;

      // Проверяем, есть ли хоть одна смена в строке (иначе это секция)
      let hasShift = false;
      const shifts = {};

      for (const d of dates) {
        const cell = (row[d.col] || '').trim();
        if (!cell) continue;

        // Парсим "8:30-21:00"
        const timeMatch = cell.match(/^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/);
        if (timeMatch) {
          hasShift = true;
          const key = `${d.day}.${d.month}.${d.year}`;
          shifts[key] = { start: timeMatch[1], end: timeMatch[2] };
        }
      }

      if (hasShift) {
        employees.push({ name, shifts });
      }
    }

    return { dates, employees };
  }

  /**
   * Получить все напоминания за конкретную дату из листа "Напоминания".
   * @param {string} dateStr - Дата в формате DD.MM.YYYY
   * @returns {Array<{name: string, type: string}>}
   */
  async getRemindersForDate(dateStr) {
    try {
      const rows = await this.getSheetData('Напоминания!A2:C');
      return rows
        .filter(row => (row[0] || '').trim() === dateStr)
        .map(row => ({ name: (row[1] || '').trim(), type: (row[2] || '').trim() }));
    } catch (error) {
      // Если лист не существует — возвращаем пустой массив
      if (error.message && error.message.includes('Unable to parse range')) {
        console.log('⚠️ Лист "Напоминания" не найден, создайте его вручную');
        return [];
      }
      throw error;
    }
  }

  /**
   * Проверить, отправлено ли напоминание.
   * @param {string} dateStr - Дата "DD.MM.YYYY"
   * @param {string} name - ФИО сотрудника
   * @param {string} type - Тип: 'evening' | 'start' | 'end'
   * @param {Array} [cachedReminders] - Кешированные напоминания (чтобы не читать лист повторно)
   * @returns {boolean}
   */
  isReminderSent(dateStr, name, type, cachedReminders) {
    if (!cachedReminders) return false;
    return cachedReminders.some(
      r => r.name.toLowerCase() === name.toLowerCase() && r.type === type
    );
  }

  /**
   * Пометить напоминание как отправленное (добавить строку в лист "Напоминания").
   * @param {string} dateStr - Дата "DD.MM.YYYY"
   * @param {string} name - ФИО сотрудника
   * @param {string} type - Тип: 'evening' | 'start' | 'end'
   */
  async markReminderSent(dateStr, name, type) {
    try {
      await this.appendSheetData('Напоминания!A:C', [dateStr, name, type]);
      console.log(`✅ Напоминание ${type} помечено для ${name} на ${dateStr}`);
    } catch (error) {
      console.error(`❌ Ошибка записи напоминания:`, error.message);
    }
  }

  /**
   * Получить расписание на конкретную дату (совместимый формат для cronService).
   * @param {Date} refDate - Объект Date
   * @returns {Array} - Массив смен [{full_name, start_time, end_time, phone, reminder_*_sent}]
   */
  async getScheduleForDate(refDate) {
    const matrix = await this.getScheduleMatrix();
    const refParts = getDatePartsNSK(refDate);

    // Ищем столбец с нужной датой
    const dateCol = matrix.dates.find(d =>
      d.day === refParts.day && d.month === refParts.month && d.year === refParts.year
    );
    if (!dateCol) return [];

    const dateKey = `${refParts.day}.${refParts.month}.${refParts.year}`;
    const dateStr = formatDateNSK(refDate);

    // Читаем напоминания один раз
    const reminders = await this.getRemindersForDate(dateStr);

    const result = [];
    for (const emp of matrix.employees) {
      const shift = emp.shifts[dateKey];
      if (!shift) continue;

      // Ищем сотрудника для получения телефона и telegram_id
      const employee = await this.findEmployeeByName(emp.name);

      result.push({
        full_name: emp.name,
        start_time: shift.start,
        end_time: shift.end,
        date: dateStr,
        phone: employee ? employee.phone : '',
        telegram_id: employee ? employee.telegram_id : null,
        reminder_evening_sent: this.isReminderSent(dateStr, emp.name, 'evening', reminders),
        reminder_start_sent: this.isReminderSent(dateStr, emp.name, 'start', reminders),
        reminder_end_sent: this.isReminderSent(dateStr, emp.name, 'end', reminders)
      });
    }

    return result;
  }

  /**
   * Получить расписание на завтра
   * @returns {Array}
   */
  async getTomorrowSchedule() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.getScheduleForDate(tomorrow);
  }

  /**
   * Получить расписание на сегодня
   * @returns {Array}
   */
  async getTodaySchedule() {
    return this.getScheduleForDate(new Date());
  }

  /**
   * Получить смены, которые начинаются через час (±5 минут)
   * @returns {Array}
   */
  async getShiftsStartingInOneHour() {
    const now = new Date();
    const shifts = await this.getScheduleForDate(now);

    const nskTime = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit', hour12: false });
    const [nskHours, nskMinutes] = nskTime.split(':').map(Number);
    const currentMinutes = nskHours * 60 + nskMinutes;

    console.log(`🕐 [StartCheck] Время NSK: ${nskTime}, расписание: ${shifts.length} смен, ищем начало в ~${Math.floor((currentMinutes + 60) / 60)}:${String((currentMinutes + 60) % 60).padStart(2, '0')}`);

    return shifts.filter(shift => {
      if (!shift.start_time) return false;
      if (shift.reminder_start_sent) {
        console.log(`   ⏭️ ${shift.full_name}: напоминание уже отправлено`);
        return false;
      }

      const [shiftHours, shiftMinutes] = shift.start_time.split(':').map(Number);
      const shiftStartMinutes = shiftHours * 60 + shiftMinutes;
      const targetMinutes = currentMinutes + 60;
      const diff = Math.abs(shiftStartMinutes - targetMinutes);

      if (diff <= 5) {
        console.log(`   ✅ ${shift.full_name}: начало ${shift.start_time}, разница ${diff} мин — ПОПАДАЕТ в окно`);
        return true;
      }
      return false;
    });
  }

  /**
   * Получить смены, которые заканчиваются через час (±5 минут)
   * @returns {Array}
   */
  async getShiftsEndingInOneHour() {
    const now = new Date();
    const shifts = await this.getScheduleForDate(now);

    const nskTime = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit', hour12: false });
    const [nskHours, nskMinutes] = nskTime.split(':').map(Number);
    const currentMinutes = nskHours * 60 + nskMinutes;

    console.log(`🕐 [EndCheck] Время NSK: ${nskTime}, расписание: ${shifts.length} смен, ищем конец в ~${Math.floor((currentMinutes + 60) / 60)}:${String((currentMinutes + 60) % 60).padStart(2, '0')}`);

    return shifts.filter(shift => {
      if (!shift.end_time) return false;
      if (shift.reminder_end_sent) {
        console.log(`   ⏭️ ${shift.full_name}: напоминание уже отправлено`);
        return false;
      }

      const [shiftHours, shiftMinutes] = shift.end_time.split(':').map(Number);
      const shiftEndMinutes = shiftHours * 60 + shiftMinutes;
      const targetMinutes = currentMinutes + 60;
      const diff = Math.abs(shiftEndMinutes - targetMinutes);

      if (diff <= 5) {
        console.log(`   ✅ ${shift.full_name}: конец ${shift.end_time}, разница ${diff} мин — ПОПАДАЕТ в окно`);
        return true;
      }
      return false;
    });
  }

  // ==================== МЕТОДЫ ДЛЯ SHIFT LOGS ====================
  // Структура: A: Дата | B: Телефон | C: ФИО | D: Начало | E: Конец | F: Часы | G: Ставка | H: К оплате

  /**
   * Логировать начало смены
   * @param {Object} data - { phone, full_name, hourly_rate }
   */
  async logShiftStart(data) {
    const now = new Date();
    const date = formatDateNSK(now);
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
    const todayParts = getDatePartsNSK();

    return rows
      .filter(row => dateMatchesRef(row[0], todayParts) && row[4]) // Только сегодняшние и закрытые смены
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
   * Получить все открытые (незакрытые) смены
   * @returns {Array} - Массив активных смен
   */
  async getAllActiveShifts() {
    const rows = await this.getSheetData('Shift Logs!A2:H');
    const todayParts = getDatePartsNSK();

    return rows
      .filter(row => dateMatchesRef(row[0], todayParts) && row[3] && !row[4]) // Сегодняшние, есть начало, нет конца
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
