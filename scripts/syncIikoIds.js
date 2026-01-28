#!/usr/bin/env node
/**
 * Скрипт синхронизации iiko ID с Google Sheets
 * Сопоставляет сотрудников по ФИО и записывает iiko ID в колонку G
 *
 * Запуск: node scripts/syncIikoIds.js
 */

require('dotenv').config();

const GoogleSheetsService = require('../src/services/googleSheetsService');
const IikoService = require('../src/services/iikoService');

// Инициализация сервисов
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

/**
 * Нормализация имени для сравнения
 * Убираем лишние пробелы, приводим к нижнему регистру
 */
function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Варианты написания имён для fuzzy matching
 */
const nameVariants = {
  'даниил': ['данил', 'даня', 'дэниил'],
  'данил': ['даниил', 'даня'],
  'александр': ['саша', 'алекс', 'сан'],
  'михаил': ['миша', 'мишаня'],
  'денис': ['ден', 'дэн'],
  'егор': ['жора', 'гоша'],
  'владислав': ['влад', 'владик'],
  'влад': ['владислав', 'владик']
};

/**
 * Проверяет похожесть имён с учётом вариантов написания
 */
function namesAreSimilar(name1, name2) {
  if (!name1 || !name2) return false;

  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();

  // Точное совпадение
  if (n1 === n2) return true;

  // Одно содержит другое (для коротких форм)
  if (n1.startsWith(n2) || n2.startsWith(n1)) return true;

  // Проверяем варианты написания
  const variants1 = nameVariants[n1] || [];
  const variants2 = nameVariants[n2] || [];

  if (variants1.includes(n2) || variants2.includes(n1)) return true;

  return false;
}

/**
 * Проверяет совпадение ФИО из Google Sheets с данными из iiko
 * @param {string} sheetName - ФИО из таблицы (например "Ширяев Кирилл Дмитриевич")
 * @param {Object} iikoEmployee - Сотрудник из iiko
 * @returns {boolean}
 */
function namesMatch(sheetName, iikoEmployee) {
  const normalizedSheetName = normalizeName(sheetName);

  // Сравниваем с displayName из iiko
  const normalizedDisplayName = normalizeName(iikoEmployee.displayName);
  if (normalizedSheetName === normalizedDisplayName) {
    return true;
  }

  // Разбираем ФИО из таблицы на части
  const sheetParts = normalizedSheetName.split(' ').filter(p => p);
  const sheetLastName = sheetParts[0] || '';
  const sheetFirstName = sheetParts[1] || '';

  // Получаем данные из iiko
  const iikoLastName = normalizeName(iikoEmployee.lastName);
  const iikoFirstName = normalizeName(iikoEmployee.firstName);

  // Сравниваем фамилии (должны совпадать точно)
  if (!iikoLastName || sheetLastName !== iikoLastName) {
    // Попробуем обратный порядок (если в iiko "Имя Фамилия")
    const displayParts = normalizedDisplayName.split(' ').filter(p => p);
    if (displayParts.length >= 2) {
      // displayName может быть "Данил Соколовский"
      const displayFirstName = displayParts[0];
      const displayLastName = displayParts[1];

      if (sheetLastName === displayLastName && namesAreSimilar(sheetFirstName, displayFirstName)) {
        return true;
      }
    }
    return false;
  }

  // Фамилии совпали, проверяем имена с учётом вариантов
  if (iikoFirstName && sheetFirstName) {
    if (namesAreSimilar(sheetFirstName, iikoFirstName)) {
      return true;
    }
  }

  // Если имя в iiko пустое, но фамилия совпала
  if (!iikoFirstName && sheetLastName === iikoLastName) {
    return true;
  }

  return false;
}

async function syncIikoIds() {
  console.log('🔄 Начинаем синхронизацию iiko ID...\n');

  try {
    // 1. Получаем сотрудников из Google Sheets
    console.log('📊 Загрузка сотрудников из Google Sheets...');
    const sheetEmployees = await sheetsService.getAllEmployees();
    console.log(`   Найдено ${sheetEmployees.length} сотрудников в таблице\n`);

    // 2. Получаем курьеров из iiko
    console.log('🍽️ Загрузка курьеров из iiko...');
    const iikoEmployees = await iikoService.getCouriers();
    console.log(`   Найдено ${iikoEmployees.length} активных курьеров\n`);

    // 3. Сопоставляем и обновляем
    console.log('🔍 Сопоставление по ФИО...\n');

    let matched = 0;
    let alreadyHasId = 0;
    let notFound = [];

    for (const sheetEmp of sheetEmployees) {
      // Пропускаем если уже есть iiko ID
      if (sheetEmp.iiko_id) {
        alreadyHasId++;
        console.log(`   ⏭️ ${sheetEmp.full_name} - уже есть iiko ID`);
        continue;
      }

      // Ищем совпадение в iiko
      const iikoMatch = iikoEmployees.find(iikoEmp => namesMatch(sheetEmp.full_name, iikoEmp));

      if (iikoMatch) {
        console.log(`   ✅ ${sheetEmp.full_name} → ${iikoMatch.id}`);

        // Сохраняем iiko ID в таблицу
        await sheetsService.saveIikoId(sheetEmp.rowIndex, iikoMatch.id);
        matched++;
      } else {
        console.log(`   ❌ ${sheetEmp.full_name} - не найден в iiko`);
        notFound.push(sheetEmp.full_name);
      }
    }

    // 4. Итоги
    console.log('\n📋 Итоги синхронизации:');
    console.log(`   ✅ Сопоставлено: ${matched}`);
    console.log(`   ⏭️ Уже было: ${alreadyHasId}`);
    console.log(`   ❌ Не найдено: ${notFound.length}`);

    if (notFound.length > 0) {
      console.log('\n⚠️ Не найдены в iiko:');
      notFound.forEach(name => console.log(`   - ${name}`));
      console.log('\n💡 Возможные причины:');
      console.log('   - Сотрудник не является курьером в iiko');
      console.log('   - ФИО в таблице не совпадает с iiko');
      console.log('   - API-ключ не имеет доступа к полному списку сотрудников');
    }

    console.log('\n✅ Синхронизация завершена!');
  } catch (error) {
    console.error('\n❌ Ошибка синхронизации:', error.message);
    process.exit(1);
  }
}

// Запуск
syncIikoIds();
