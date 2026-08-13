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

function isTooSoon(dateStr, timeStr, now = new Date()) {
  const hours = hoursUntilSlot(dateStr, timeStr, now);
  if (hours === null) return true;
  return hours < getMinAdvanceHours();
}

function getLeadTimeMessage(loc) {
  const hours = getMinAdvanceHours();
  const phone = loc?.phone ? ` ${loc.phone}` : '';
  return `線上訂位需至少提前 ${hours} 小時。此時段請直接致電分店${phone}訂位。`;
}

module.exports = {
  getMinAdvanceHours,
  getSlotDateTime,
  hoursUntilSlot,
  isTooSoon,
  getLeadTimeMessage,
};
