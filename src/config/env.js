require('dotenv').config();

// Список обязательных переменных окружения
const required = [
  'TELEGRAM_BOT_TOKEN',
  'GOOGLE_SHEET_ID',
  'GOOGLE_SERVICE_ACCOUNT_JSON'
];

// Проверка наличия всех обязательных переменных
required.forEach(key => {
  if (!process.env[key]) {
    console.error(`❌ Отсутствует обязательная переменная окружения: ${key}`);
    process.exit(1);
  }
});

// Парсинг JSON с проверкой
let googleServiceAccount;
try {
  googleServiceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
} catch (error) {
  console.error('❌ Невалидный JSON в GOOGLE_SERVICE_ACCOUNT_JSON:', error.message);
  process.exit(1);
}

module.exports = {
  // Telegram Bot
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,

  // Google Sheets
  googleSheetId: process.env.GOOGLE_SHEET_ID,
  googleServiceAccount,

  // iiko Cloud API
  iikoBaseUrl: process.env.IIKO_BASE_URL,
  iikoApiLogin: process.env.IIKO_API_LOGIN,
  iikoOrganizationId: process.env.IIKO_ORGANIZATION_ID,
  iikoTerminalGroupId: process.env.IIKO_TERMINAL_GROUP_ID,

  // Admin (опционально)
  adminIds: process.env.ADMIN_TELEGRAM_IDS
    ? process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => parseInt(id.trim()))
    : [],

  // Геолокация магазина
  storeLatitude: parseFloat(process.env.STORE_LATITUDE || '55.044311'),
  storeLongitude: parseFloat(process.env.STORE_LONGITUDE || '82.952690'),
  storeRadiusKm: parseFloat(process.env.STORE_RADIUS_KM || '0.2'),

  // Environment
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000')
};
