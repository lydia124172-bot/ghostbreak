const site = require('../data/site');

function getMinAdvanceHours() {
  const hours = Number(site.minAdvanceHours);
  return hours > 0 ? hours : 6;
}

function getSlotDateTime(dateStr, timeStr) {
  const date = String(dateStr || '').trim();
  const time = String(timeStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const slot = new Date(`${date}T${time}:00+08:00`);
  if (Number.isNaN(slot.getTime())) return null;
  return slot;
}

function hoursUntilSlot(dateStr, timeStr, now = new Date()) {
  const slot = getSlotDateTime(dateStr, timeStr);
  if (!slot) return null;
  return (slot.getTime() - now.getTime()) / (60 * 60 * 1000);
}

function isPastSlot(dateStr, timeStr, now = new Date()) {
  const hours = hoursUntilSlot(dateStr, timeStr, now);
  if (hours === null) return true;
  return hours < 0;
}

function isTooSoon(dateStr, timeStr, now = new Date()) {
  const hours = hoursUntilSlot(dateStr, timeStr, now);
  if (hours === null) return true;
  return hours < getMinAdvanceHours();
}

function getLeadTimeMessage(loc) {
  const hours = getMinAdvanceHours();
  const phone = loc?.phone ? ` ${loc.phone}` : '';
  return `線上訂位需至少提前 ${hours} 小時，因即時訂位時間不及，無法為您排位。請直接致電分店${phone}訂位。`;
}

function getMaxAdvanceDays(loc) {
  const days = Number(loc?.maxAdvanceDays);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
}

function taipeiToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addCalendarDays(dateStr, days) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

function latestBookableDate(loc, now = new Date()) {
  const days = getMaxAdvanceDays(loc);
  if (!days) return null;
  return addCalendarDays(taipeiToday(now), days);
}

function isBeyondBookingWindow(loc, dateStr, now = new Date()) {
  const latest = latestBookableDate(loc, now);
  if (!latest) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return true;
  return dateStr > latest;
}

function getBookingWindowMessage(loc) {
  const days = getMaxAdvanceDays(loc);
  const phone = loc?.phone ? ` ${loc.phone}` : '';
  const store = loc?.name || '此分店';
  const label = loc?.maxAdvanceLabel ? `（${loc.maxAdvanceLabel}）` : '';
  return `${store}線上訂位只開放今天起 ${days} 天內${label}，更遠的日期請改選，或直接致電分店${phone}。`;
}

module.exports = {
  getMinAdvanceHours,
  getSlotDateTime,
  hoursUntilSlot,
  isPastSlot,
  isTooSoon,
  getLeadTimeMessage,
  getMaxAdvanceDays,
  latestBookableDate,
  isBeyondBookingWindow,
  getBookingWindowMessage,
};
