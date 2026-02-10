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

module.exports = { getDatePartsNSK, formatDateNSK, dateMatchesRef };
