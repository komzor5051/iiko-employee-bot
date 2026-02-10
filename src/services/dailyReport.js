const config = require('../config/env');

/**
 * Нормализация даты для сравнения.
 * "08.02.2026" → "8.2.2026", "08/02/2026" → "8.2.2026"
 * Убирает ведущие нули и приводит / к .
 */
function normalizeDate(str) {
  if (!str) return '';
  return str.replace(/\//g, '.').split('.').map(p => String(parseInt(p, 10))).join('.');
}

/**
 * Ежедневный отчёт в группу руководителей.
 * Отправляет сводку по закрытым и открытым сменам за сегодня.
 *
 * @param {Object} bot - Telegraf bot instance
 * @param {Object} sheetsService - GoogleSheetsService instance
 */
async function sendDailyReport(bot, sheetsService) {
  const now = new Date();
  const today = now.toLocaleDateString('ru-RU', { timeZone: 'Asia/Novosibirsk' });
  const todayNorm = normalizeDate(today);
  const timeNSK = now.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit' });
  console.log(`📊 [DailyReport] Запуск в ${timeNSK} NSK, дата: "${today}" (norm: "${todayNorm}")`);

  // 1. Получаем данные из Google Sheets (без лимита строк)
  let rows;
  try {
    rows = await sheetsService.getSheetData('Shift Logs!A2:H');
  } catch (error) {
    console.error('❌ [DailyReport] Ошибка Google Sheets:', error.message);
    throw error;
  }

  // 2. Фильтруем смены за сегодня (нормализуем даты для сравнения)
  const todayShifts = rows.filter(row => normalizeDate(row[0]) === todayNorm);
  const closedShifts = todayShifts.filter(row => row[4]); // Есть время окончания
  const openShifts = todayShifts.filter(row => row[3] && !row[4]); // Есть начало, нет конца

  console.log(`📊 [DailyReport] Найдено смен: ${todayShifts.length} всего, ${closedShifts.length} закрытых, ${openShifts.length} открытых`);

  // 3. Диагностика если смен 0 — логируем формат дат из таблицы
  if (todayShifts.length === 0) {
    const sampleDates = rows.slice(-5).map(r => r[0]).filter(Boolean);
    console.log(`📊 [DailyReport] Смен 0. today="${today}", norm="${todayNorm}", последние даты: [${sampleDates.join(', ')}], norm: [${sampleDates.map(normalizeDate).join(', ')}]`);
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

module.exports = { sendDailyReport, normalizeDate };
