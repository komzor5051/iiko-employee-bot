/**
 * Синхронизация смен iiko → Google Sheets
 * Запуск: node scripts/syncShifts.js
 */

require('dotenv').config();

const axios = require('axios');
const GoogleSheetsService = require('../src/services/googleSheetsService');
const IikoService = require('../src/services/iikoService');

async function tryEndpoint(baseUrl, token, endpoint, body) {
  try {
    const res = await axios.post(`${baseUrl}/api/1/${endpoint}`, body, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });
    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, status: err.response?.status, error: err.response?.data?.errorDescription || err.message };
  }
}

async function main() {
  console.log('🔍 Проверяем эндпоинты терминалов/отчётов...\n');

  const iikoService = new IikoService(
    process.env.IIKO_BASE_URL,
    process.env.IIKO_API_LOGIN,
    process.env.IIKO_ORGANIZATION_ID,
    process.env.IIKO_TERMINAL_GROUP_ID
  );

  const token = await iikoService.ensureValidToken();
  const baseUrl = process.env.IIKO_BASE_URL;
  const orgId = process.env.IIKO_ORGANIZATION_ID;
  const termId = process.env.IIKO_TERMINAL_GROUP_ID;

  const endpoints = [
    {
      name: 'terminal_groups',
      body: { organizationIds: [orgId] }
    },
    {
      name: 'terminal_groups/is_alive',
      body: { organizationIds: [orgId], terminalGroupIds: [termId] }
    },
    {
      name: 'reports/olap',
      body: { organizationId: orgId }
    },
    {
      name: 'reports/balance/stores',
      body: { organizationId: orgId }
    },
    {
      name: 'events',
      body: { organizationId: orgId }
    },
    {
      name: 'commands/status',
      body: { organizationId: orgId, correlationId: '00000000-0000-0000-0000-000000000000' }
    },
    {
      name: 'notifications/send',
      body: { organizationId: orgId }
    },
  ];

  for (const ep of endpoints) {
    const result = await tryEndpoint(baseUrl, token, ep.name, ep.body);
    if (result.ok) {
      console.log(`✅ ${ep.name} — ДОСТУПЕН`);
      const str = JSON.stringify(result.data, null, 2);
      console.log(str.substring(0, 2000));
      console.log('\n');
    } else {
      console.log(`❌ ${ep.name} — ${result.status}: ${result.error}`);
    }
  }

  // Теперь попробуем подход: попытка clock-in сотрудника, у которого 100% НЕТ смены
  // чтобы понять формат ошибки "уже на смене"
  // Для этого сначала проверим, есть ли у кого-то уже открытая смена в таблице
  const sheetsService = new GoogleSheetsService(
    JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    process.env.GOOGLE_SHEET_ID
  );

  const activeShifts = await sheetsService.getAllActiveShifts();
  console.log(`\n📊 Открытые смены в таблице сейчас: ${activeShifts.length}`);
  for (const s of activeShifts) {
    console.log(`  • ${s.full_name}: с ${s.start_time}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Ошибка:', err.message);
  process.exit(1);
});
