/**
 * Тестовый скрипт для отправки ежедневного отчёта
 * Запуск: node scripts/testDailyReport.js
 */

require('dotenv').config();

const bot = require('../src/bot');
const GoogleSheetsService = require('../src/services/googleSheetsService');
const CronService = require('../src/services/cronService');

async function main() {
  console.log('🧪 Тестовая отправка ежедневного отчёта...\n');

  const sheetsService = new GoogleSheetsService(
    JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    process.env.GOOGLE_SHEET_ID
  );

  const cronService = new CronService(bot, sheetsService);

  await cronService.sendDailyReport();

  console.log('\n✅ Тест завершён');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Ошибка:', err);
  process.exit(1);
});
