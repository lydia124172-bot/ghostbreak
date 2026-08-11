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

function isLocationClosed(loc, dateStr) {
  const closed = loc?.closedWeekdays;
  if (!closed?.length) return false;
  const weekday = getWeekday(dateStr);
  if (weekday === null) return false;
  return closed.includes(weekday);
}

function getClosedMessage(loc, dateStr) {
  if (!isLocationClosed(loc, dateStr)) return null;
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
  getClosedMessage,
  getLocationClosedInfo,
  formatClosedWeekdays,
};
