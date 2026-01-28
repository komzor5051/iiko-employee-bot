/**
 * Скрипт инициализации листа "Расписание"
 * Создаёт лист и заполняет его сотрудниками на сегодня/завтра
 *
 * Использование: node scripts/initScheduleSheet.js
 */

require('dotenv').config();
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

const auth = new google.auth.GoogleAuth({
  credentials: SERVICE_ACCOUNT,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

async function main() {
  console.log('🚀 Инициализация листа "Расписание"...\n');

  // 1. Получаем список сотрудников
  console.log('📋 Читаю список сотрудников...');
  const employeesResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Сотрудники!A2:G1000'
  });

  const employees = (employeesResponse.data.values || [])
    .filter(row => row[0] && row[1]) // Есть телефон и ФИО
    .map(row => ({
      phone: row[0],
      full_name: row[1],
      telegram_id: row[5] || ''
    }));

  console.log(`✅ Найдено ${employees.length} сотрудников\n`);

  if (employees.length === 0) {
    console.log('❌ Нет сотрудников для добавления в расписание');
    return;
  }

  // 2. Проверяем, существует ли лист "Расписание"
  console.log('🔍 Проверяю наличие листа "Расписание"...');
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID
  });

  const scheduleSheet = spreadsheet.data.sheets.find(
    s => s.properties.title === 'Расписание'
  );

  if (!scheduleSheet) {
    // Создаём лист
    console.log('📝 Создаю лист "Расписание"...');
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      resource: {
        requests: [{
          addSheet: {
            properties: {
              title: 'Расписание',
              gridProperties: {
                rowCount: 1000,
                columnCount: 8
              }
            }
          }
        }]
      }
    });
    console.log('✅ Лист создан\n');
  } else {
    console.log('✅ Лист уже существует\n');
  }

  // 3. Добавляем заголовки
  console.log('📝 Записываю заголовки...');
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Расписание!A1:H1',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [['Дата', 'Телефон', 'ФИО', 'Начало', 'Конец', 'Напом. вечер', 'Напом. начало', 'Напом. конец']]
    }
  });

  // 4. Формируем даты (сегодня и завтра)
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const formatDate = (d) => d.toLocaleDateString('ru-RU'); // ДД.ММ.ГГГГ

  const todayStr = formatDate(today);
  const tomorrowStr = formatDate(tomorrow);

  // 5. Формируем строки расписания
  const rows = [];

  // Смены на сегодня
  for (const emp of employees) {
    rows.push([
      todayStr,
      emp.phone,
      emp.full_name,
      '09:00',
      '21:00',
      '', // Напом. вечер
      '', // Напом. начало
      ''  // Напом. конец
    ]);
  }

  // Смены на завтра
  for (const emp of employees) {
    rows.push([
      tomorrowStr,
      emp.phone,
      emp.full_name,
      '09:00',
      '21:00',
      '', // Напом. вечер
      '', // Напом. начало
      ''  // Напом. конец
    ]);
  }

  // 6. Очищаем старые данные и записываем новые
  console.log('🗑️  Очищаю старые данные...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: 'Расписание!A2:H1000'
  });

  console.log('📝 Записываю расписание...');
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Расписание!A2',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: rows
    }
  });

  console.log(`\n✅ Готово! Добавлено ${rows.length} смен:`);
  console.log(`   - ${employees.length} смен на сегодня (${todayStr})`);
  console.log(`   - ${employees.length} смен на завтра (${tomorrowStr})`);
  console.log(`   - Время: 09:00 - 21:00`);

  console.log('\n📋 Сотрудники в расписании:');
  employees.forEach((emp, i) => {
    const tgStatus = emp.telegram_id ? '✅' : '⚠️ нет TG ID';
    console.log(`   ${i + 1}. ${emp.full_name} (${emp.phone}) ${tgStatus}`);
  });
}

main().catch(err => {
  console.error('❌ Ошибка:', err.message);
  process.exit(1);
});
