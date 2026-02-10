/**
 * Тестовый скрипт для отправки ежедневного отчёта
 * Вызывает ту же функцию, что и cron в index.js
 * Запуск: node scripts/testDailyReport.js
 */

require('dotenv').config();

const bot = require('../src/bot');
const GoogleSheetsService = require('../src/services/googleSheetsService');
const { sendDailyReport } = require('../src/services/dailyReport');

async function main() {
  console.log('🧪 Тестовая отправка ежедневного отчёта...\n');

  const sheetsService = new GoogleSheetsService(
    JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    process.env.GOOGLE_SHEET_ID
  );

  await sendDailyReport(bot, sheetsService);

  console.log('\n✅ Тест завершён');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Ошибка:', err);
  process.exit(1);
});
