const config = require('../config/env');
const { formatDateNSK, getDatePartsNSK, dateMatchesRef } = require('../utils/dateUtils');

/**
 * Ежедневный отчёт в группу руководителей.
 * Отправляет сводку по закрытым и открытым сменам за сегодня.
 *
 * @param {Object} bot - Telegraf bot instance
 * @param {Object} sheetsService - GoogleSheetsService instance
 */
async function sendDailyReport(bot, sheetsService) {
  const now = new Date();
  const today = formatDateNSK(now);
  const todayParts = getDatePartsNSK(now);
  const timeNSK = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit' });
  console.log(`📊 [DailyReport] Запуск в ${timeNSK} NSK, дата: "${today}" (${todayParts.day}.${todayParts.month}.${todayParts.year})`);

  // 1. Получаем данные из Google Sheets (без лимита строк)
  let rows;
  try {
    rows = await sheetsService.getSheetData('Shift Logs!A2:H');
  } catch (error) {
    console.error('❌ [DailyReport] Ошибка Google Sheets:', error.message);
    throw error;
  }

  // 2. Фильтруем смены за сегодня (dateMatchesRef обрабатывает DD.MM.YYYY и MM/DD/YYYY)
  const todayShifts = rows.filter(row => dateMatchesRef(row[0], todayParts));
  const closedShifts = todayShifts.filter(row => row[4]); // Есть время окончания
  const openShifts = todayShifts.filter(row => row[3] && !row[4]); // Есть начало, нет конца

  console.log(`📊 [DailyReport] Найдено смен: ${todayShifts.length} всего, ${closedShifts.length} закрытых, ${openShifts.length} открытых`);

  // 3. Диагностика если смен 0 — логируем формат дат из таблицы
  if (todayShifts.length === 0) {
    const sampleDates = rows.slice(-5).map(r => r[0]).filter(Boolean);
    console.log(`📊 [DailyReport] Смен 0. today="${today}", последние даты в таблице: [${sampleDates.join(', ')}]`);
  }

  // 4. Формируем сообщение
  let message;
  let totalHours = 0;
  let totalPayment = 0;

  if (todayShifts.length === 0) {
    message = `📊 <b>Отчёт за ${today}</b>\n\nСегодня смен не было.`;
  } else {
    const employeeLines = [];

    for (const row of closedShifts) {
      const hours = parseFloat(row[5]) || 0;
      const payment = parseFloat(row[7]) || 0;
      totalHours += hours;
      totalPayment += payment;
      employeeLines.push(`• ${row[2]}: ${row[3]}–${row[4]} (${hours.toFixed(1)} ч) — ${payment.toLocaleString('ru-RU')} ₽`);
    }

    const openLines = openShifts.map(row => `• ${row[2]}: с ${row[3]} (ещё открыта)`);

    message = `📊 <b>Отчёт за ${today}</b>\n\n`;

    if (employeeLines.length > 0) {
      message += `👥 <b>Закрытые смены:</b>\n${employeeLines.join('\n')}\n\n`;
    }

    if (openLines.length > 0) {
      message += `⚠️ <b>Ещё открытые:</b>\n${openLines.join('\n')}\n\n`;
    }

    message += `━━━━━━━━━━━━━━━\n`;
    message += `⏱ <b>Всего часов:</b> ${totalHours.toFixed(1)} ч\n`;
    message += `💰 <b>К выплате:</b> ${totalPayment.toLocaleString('ru-RU')} ₽`;
  }

  // 5. Отправляем в группу руководителей
  try {
    await bot.telegram.sendMessage(config.managersGroupId, message, { parse_mode: 'HTML' });
  } catch (sendError) {
    console.error(`❌ [DailyReport] Ошибка отправки в Telegram (группа ${config.managersGroupId}):`, sendError.message);
    if (sendError.response) {
      console.error(`❌ [DailyReport] Telegram API: ${sendError.response.error_code} — ${sendError.response.description}`);
    }
    throw sendError;
  }

  console.log(`✅ [DailyReport] Отправлен. Закрытых: ${closedShifts.length}, открытых: ${openShifts.length}, часов: ${totalHours.toFixed(1)}, сумма: ${totalPayment}₽`);
}

module.exports = { sendDailyReport };
