/**
 * Тестовый скрипт для проверки всей системы
 * Запуск: node scripts/testSystem.js
 */

require('dotenv').config();

const bot = require('../src/bot');
const GoogleSheetsService = require('../src/services/googleSheetsService');
const IikoService = require('../src/services/iikoService');
const CronService = require('../src/services/cronService');

const MANAGERS_GROUP_ID = -5237107467;

async function main() {
  console.log('🧪 ТЕСТИРОВАНИЕ СИСТЕМЫ\n');
  console.log('='.repeat(50));

  const sheetsService = new GoogleSheetsService(
    JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    process.env.GOOGLE_SHEET_ID
  );

  const iikoService = new IikoService(
    process.env.IIKO_BASE_URL,
    process.env.IIKO_API_LOGIN,
    process.env.IIKO_ORGANIZATION_ID,
    process.env.IIKO_TERMINAL_GROUP_ID
  );

  // 1. Проверка Google Sheets
  console.log('\n📊 1. GOOGLE SHEETS');
  console.log('-'.repeat(30));
  try {
    const employees = await sheetsService.getSheetData('Сотрудники!A2:G100');
    console.log(`✅ Сотрудников в таблице: ${employees.length}`);

    const todaySchedule = await sheetsService.getTodaySchedule();
    console.log(`✅ Смен в расписании на сегодня: ${todaySchedule.length}`);

    const activeShifts = await sheetsService.getAllActiveShifts();
    console.log(`✅ Открытых смен сейчас: ${activeShifts.length}`);

    const todayLogs = await sheetsService.getTodayShiftLogs();
    console.log(`✅ Закрытых смен сегодня: ${todayLogs.length}`);
  } catch (error) {
    console.error('❌ Ошибка Google Sheets:', error.message);
  }

  // 2. Проверка iiko API
  console.log('\n🔌 2. IIKO API');
  console.log('-'.repeat(30));
  if (process.env.IIKO_API_LOGIN) {
    try {
      const token = await iikoService.getAccessToken();
      console.log(`✅ Токен iiko получен: ${token.slice(0, 20)}...`);

      const couriers = await iikoService.getCouriers();
      console.log(`✅ Сотрудников в iiko: ${couriers.length}`);
    } catch (error) {
      console.error('❌ Ошибка iiko API:', error.message);
    }
  } else {
    console.log('⚠️ IIKO_API_LOGIN не настроен, пропускаем');
  }

  // 3. Проверка Webhook настроек
  console.log('\n🔔 3. IIKO WEBHOOK');
  console.log('-'.repeat(30));
  if (process.env.IIKO_API_LOGIN) {
    try {
      const webhookSettings = await iikoService.getWebhookSettings();
      console.log('✅ Настройки webhook:');
      console.log(`   URL: ${webhookSettings.webhooksUri || 'не настроен'}`);
      console.log(`   Auth Token: ${webhookSettings.authToken ? '***настроен***' : 'не настроен'}`);
    } catch (error) {
      console.error('❌ Ошибка получения webhook настроек:', error.message);
    }
  } else {
    console.log('⚠️ IIKO_API_LOGIN не настроен, пропускаем');
  }

  // 4. Проверка отправки в группу
  console.log('\n📨 4. TELEGRAM ГРУППА');
  console.log('-'.repeat(30));
  try {
    await bot.telegram.sendMessage(
      MANAGERS_GROUP_ID,
      '🧪 *Тестовое сообщение*\n\nПроверка системы — всё работает!',
      { parse_mode: 'Markdown' }
    );
    console.log('✅ Сообщение отправлено в группу');
  } catch (error) {
    console.error('❌ Ошибка отправки в группу:', error.message);
  }

  // 5. Проверка эскалации
  console.log('\n⚠️ 5. ЭСКАЛАЦИЯ');
  console.log('-'.repeat(30));
  const cronService = new CronService(bot, sheetsService);
  try {
    await cronService.checkProblemsAndEscalate();
    console.log('✅ Проверка эскалации завершена');
  } catch (error) {
    console.error('❌ Ошибка эскалации:', error.message);
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ ТЕСТИРОВАНИЕ ЗАВЕРШЕНО');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Критическая ошибка:', err);
  process.exit(1);
});
