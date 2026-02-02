/**
 * Скрипт для настройки webhook в iiko Cloud API
 *
 * Использование:
 * WEBHOOK_URL=https://your-domain.com/iiko-webhook node scripts/setupWebhook.js
 *
 * Или с ngrok для тестирования:
 * 1. Запустите: ngrok http 3000
 * 2. Скопируйте https URL
 * 3. WEBHOOK_URL=https://xxx.ngrok.io/iiko-webhook node scripts/setupWebhook.js
 */

require('dotenv').config();

const IikoService = require('../src/services/iikoService');

const config = {
  iikoBaseUrl: process.env.IIKO_BASE_URL,
  iikoApiLogin: process.env.IIKO_API_LOGIN,
  iikoOrganizationId: process.env.IIKO_ORGANIZATION_ID,
  iikoTerminalGroupId: process.env.IIKO_TERMINAL_GROUP_ID,
  iikoWebhookToken: process.env.IIKO_WEBHOOK_TOKEN
};

// URL для webhook (из аргументов или переменной окружения)
const webhookUrl = process.env.WEBHOOK_URL || process.argv[2];

async function main() {
  console.log('🔧 Настройка webhook в iiko Cloud API\n');

  // Проверяем наличие необходимых переменных
  if (!config.iikoBaseUrl || !config.iikoApiLogin || !config.iikoOrganizationId) {
    console.error('❌ Отсутствуют переменные окружения для iiko API');
    console.error('   Требуются: IIKO_BASE_URL, IIKO_API_LOGIN, IIKO_ORGANIZATION_ID');
    process.exit(1);
  }

  if (!webhookUrl) {
    console.error('❌ Не указан URL для webhook');
    console.error('   Использование: WEBHOOK_URL=https://... node scripts/setupWebhook.js');
    console.error('   Или: node scripts/setupWebhook.js https://your-domain.com/iiko-webhook');
    process.exit(1);
  }

  if (!config.iikoWebhookToken) {
    console.error('❌ Не указан IIKO_WEBHOOK_TOKEN в .env');
    console.error('   Добавьте: IIKO_WEBHOOK_TOKEN=ваш-секретный-токен');
    process.exit(1);
  }

  const iikoService = new IikoService(
    config.iikoBaseUrl,
    config.iikoApiLogin,
    config.iikoOrganizationId,
    config.iikoTerminalGroupId
  );

  try {
    // 1. Получаем текущие настройки
    console.log('📋 Текущие настройки webhooks:');
    try {
      const currentSettings = await iikoService.getWebhookSettings();
      console.log(JSON.stringify(currentSettings, null, 2));
    } catch (error) {
      console.log('   Настройки не заданы или ошибка получения');
    }

    console.log('\n' + '─'.repeat(50) + '\n');

    // 2. Обновляем настройки
    console.log('🔧 Обновление настроек webhooks...');
    console.log(`   URL: ${webhookUrl}`);
    console.log(`   Token: ${config.iikoWebhookToken.slice(0, 8)}...`);

    const result = await iikoService.updateWebhookSettings(
      webhookUrl,
      config.iikoWebhookToken,
      {
        // Включаем фильтр личных смен
        personalShift: true,
        // Можно включить и другие при необходимости:
        // deliveryOrderUpdate: true,
        // stopListUpdate: true,
        // reserveUpdate: true,
        // tableOrderUpdate: true,
      }
    );

    console.log('\n✅ Webhook успешно настроен!');
    console.log('\nРезультат:', JSON.stringify(result, null, 2));

    console.log('\n' + '─'.repeat(50));
    console.log('\n📝 Следующие шаги:');
    console.log('   1. Убедитесь, что сервер доступен по URL: ' + webhookUrl);
    console.log('   2. Запустите бота: npm run dev');
    console.log('   3. Откройте/закройте смену в iiko для тестирования');
    console.log('   4. Проверьте логи бота на наличие webhook событий');

  } catch (error) {
    console.error('\n❌ Ошибка настройки webhook:', error.message);

    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }

    process.exit(1);
  }
}

main();
