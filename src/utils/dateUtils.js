/**
 * Утилиты для работы с датами в таймзоне Asia/Novosibirsk.
 *
 * Проблема: toLocaleDateString('ru-RU') зависит от серверной локали.
 * На Railway (Linux) локаль ru-RU может отсутствовать, и вместо "10.02.2026"
 * вернётся "2/10/2026" (US формат). Google Sheets тоже может переформатировать
 * даты в зависимости от локали таблицы.
 *
 * Решение: formatToParts() для детерминистичного вывода DD.MM.YYYY,
 * dateMatchesRef() для устойчивого сравнения при чтении.
 */

const TZ = 'Asia/Novosibirsk';

/**
 * Получить компоненты даты {day, month, year} в часовом поясе NSK.
 * @param {Date} [date] - Дата (по умолчанию — сейчас)
 * @returns {{day: number, month: number, year: number}}
 */
function getDatePartsNSK(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  }).formatToParts(date);

  return {
    day: parseInt(parts.find(p => p.type === 'day').value, 10),
    month: parseInt(parts.find(p => p.type === 'month').value, 10),
    year: parseInt(parts.find(p => p.type === 'year').value, 10)
  };
}

/**
 * Форматировать дату как DD.MM.YYYY в часовом поясе NSK.
 * Использует formatToParts — гарантированный формат вне зависимости от локали сервера.
 * @param {Date} [date] - Дата (по умолчанию — сейчас)
 * @returns {string} "10.02.2026"
 */
function formatDateNSK(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).formatToParts(date);

  const day = parts.find(p => p.type === 'day').value;
  const month = parts.find(p => p.type === 'month').value;
  const year = parts.find(p => p.type === 'year').value;

  return `${day}.${month}.${year}`;
}

/**
 * Проверить, совпадает ли строка даты из Google Sheets с эталонной датой.
 *
 * Приоритет: DD.MM.YYYY (русский формат).
 * Fallback на MM/DD/YYYY только если DD.MM невозможен (месяц > 12).
 * Это исключает false positives (например, "02.10.2026" ≠ Feb 10).
 *
 * @param {string} sheetDate - Строка даты из таблицы ("10.02.2026" или "2/10/2026")
 * @param {{day: number, month: number, year: number}} ref - Эталонная дата (из getDatePartsNSK)
 * @returns {boolean}
 */
function dateMatchesRef(sheetDate, ref) {
  if (!sheetDate) return false;

  const nums = sheetDate.replace(/\//g, '.').split('.').map(n => parseInt(n, 10));
  if (nums.length !== 3 || nums.some(isNaN)) return false;

  const [p1, p2, p3] = nums;

  // DD.MM.YYYY (русский формат — приоритетный)
  if (p1 === ref.day && p2 === ref.month && p3 === ref.year) return true;

  // MM/DD/YYYY fallback — только если DD.MM невозможен (p2 > 12, значит p2 не месяц)
  if (p2 > 12 && p1 === ref.month && p2 === ref.day && p3 === ref.year) return true;

  return false;
}

/**
 * Маппинг сокращённых русских месяцев (как их выводит Google Sheets) → номер месяца.
 * Ключи без точки, в нижнем регистре.
 */
const MONTH_MAP = {
  'янв': 1, 'февр': 2, 'мар': 3, 'апр': 4,
  'мая': 5, 'май': 5, 'июн': 6, 'июл': 7, 'авг': 8,
  'сент': 9, 'окт': 10, 'нояб': 11, 'дек': 12
};

/**
 * Разобрать строку даты из заголовка матричного расписания.
 *
 * Поддерживаемые форматы:
 *   "10.февр."  → { day: 10, month: 2, year: <текущий> }
 *   "10.02.2026" → { day: 10, month: 2, year: 2026 }
 *
 * @param {string} str — строка из ячейки заголовка
 * @returns {{day: number, month: number, year: number} | null}
 */
function parseSheetDate(str) {
  if (!str || typeof str !== 'string') return null;

  const s = str.trim();

  // Формат "DD.MM.YYYY"
  const fullMatch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (fullMatch) {
    return {
      day: parseInt(fullMatch[1], 10),
      month: parseInt(fullMatch[2], 10),
      year: parseInt(fullMatch[3], 10)
    };
  }

  // Формат "10.февр." — число + точка + сокращённый месяц (возможно с точкой)
  const shortMatch = s.match(/^(\d{1,2})[.\s]+([а-яё]+)\.?$/i);
  if (shortMatch) {
    const day = parseInt(shortMatch[1], 10);
    const monthStr = shortMatch[2].toLowerCase();
    const month = MONTH_MAP[monthStr];
    if (month) {
      const year = getDatePartsNSK().year;
      return { day, month, year };
    }
  }

  return null;
}

/**
 * Сравнить два объекта {day, month, year}.
 * @param {{day: number, month: number, year: number}} a
 * @param {{day: number, month: number, year: number}} b
 * @returns {boolean}
 */
function datePartsEqual(a, b) {
  if (!a || !b) return false;
  return a.day === b.day && a.month === b.month && a.year === b.year;
}

module.exports = { getDatePartsNSK, formatDateNSK, dateMatchesRef, parseSheetDate, datePartsEqual };
