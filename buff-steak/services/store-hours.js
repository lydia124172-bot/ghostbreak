const { loadSettings } = require('./store-settings');

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function getWeekday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getDay();
}

function formatClosedWeekdays(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (!sorted.length) return '';
  const labels = sorted.map((d) => `週${WEEKDAY_LABELS[d]}`);
  if (labels.length === 1) return `每${labels[0]}`;
  return `每${labels.join('、')}`;
}

function isWeeklyClosed(loc, dateStr) {
  const closed = loc?.closedWeekdays;
  if (!closed?.length) return false;
  const weekday = getWeekday(dateStr);
  if (weekday === null) return false;
  return closed.includes(weekday);
}

function isLocationClosed(loc, dateStr) {
  const locId = loc?.id;
  const date = String(dateStr || '').trim();
  if (locId && date) {
    const schedule = loadSettings().schedule;
    if ((schedule.extraClosed[locId] || []).includes(date)) return true;
    if ((schedule.extraOpen[locId] || []).includes(date)) return false;
  }
  return isWeeklyClosed(loc, dateStr);
}

function getClosedMessage(loc, dateStr) {
  if (!isLocationClosed(loc, dateStr)) return null;
  const locId = loc?.id;
  const date = String(dateStr || '').trim();
  const schedule = locId ? loadSettings().schedule : null;
  if (schedule && (schedule.extraClosed[locId] || []).includes(date)) {
    const note = schedule.notes?.[locId]?.[date];
    return `${loc.name} ${date} 暫停線上訂位${note ? `（${note}）` : ''}，請選擇其他日期或直接致電分店。`;
  }
  const label = loc.closedLabel || formatClosedWeekdays(loc.closedWeekdays);
  return `${loc.name}${label}公休，請選擇其他日期或直接致電分店。`;
}

function getLocationClosedInfo(loc, dateStr) {
  const closed = isLocationClosed(loc, dateStr);
  return {
    closed,
    message: closed ? getClosedMessage(loc, dateStr) : null,
  };
}

module.exports = {
  isLocationClosed,
  isWeeklyClosed,
  getClosedMessage,
  getLocationClosedInfo,
  formatClosedWeekdays,
};
