const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function parseLocalDate(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
}

function weekdayChar(dateStr) {
  const dt = parseLocalDate(dateStr);
  if (!dt || Number.isNaN(dt.getTime())) return '';
  return WEEKDAYS[dt.getDay()] || '';
}

function formatDateWithWeekday(dateStr) {
  const w = weekdayChar(dateStr);
  return w ? `${dateStr}（星期${w}）` : String(dateStr || '');
}

function formatDateShortWithWeekday(dateStr) {
  const parts = String(dateStr || '').split('-');
  const w = weekdayChar(dateStr);
  if (parts.length !== 3) return formatDateWithWeekday(dateStr);
  const short = `${Number(parts[1])}/${Number(parts[2])}`;
  return w ? `${short}(${w})` : short;
}

module.exports = {
  weekdayChar,
  formatDateWithWeekday,
  formatDateShortWithWeekday,
};
