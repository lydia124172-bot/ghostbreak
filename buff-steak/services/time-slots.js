const site = require('../data/site');
const { isHolidayDate } = require('./holidays');

const DEFAULT_SLOTS = ['11:00', '11:30', '12:00', '12:30', '13:00', '17:00', '17:30', '18:00', '18:30', '19:00'];

function uniqueSorted(slots) {
  return [...new Set(slots.filter(Boolean))].sort();
}

function getLocationSlotConfig(loc) {
  const id = loc?.id || loc;
  return site.timeSlotsByLocation?.[id] || null;
}

function getTimeSlots(loc, date) {
  const cfg = getLocationSlotConfig(loc);
  if (!cfg) return [...(site.timeSlots || DEFAULT_SLOTS)];
  const holiday = date ? isHolidayDate(date) : false;
  const slots = holiday ? (cfg.holiday || cfg.weekday) : (cfg.weekday || cfg.holiday);
  return uniqueSorted(slots || site.timeSlots || DEFAULT_SLOTS);
}

function isValidTimeSlot(loc, date, time) {
  return getTimeSlots(loc, date).includes(String(time || '').trim());
}

function groupTimeSlots(slots) {
  const lunch = [];
  const dinner = [];
  for (const slot of slots) {
    const hour = Number(String(slot).split(':')[0]);
    if (hour < 15) lunch.push(slot);
    else dinner.push(slot);
  }
  const groups = [];
  if (lunch.length) groups.push({ label: '中午時段', slots: lunch });
  if (dinner.length) groups.push({ label: '晚上時段', slots: dinner });
  return groups;
}

function getAllPossibleTimeSlots() {
  const fromLocations = Object.values(site.timeSlotsByLocation || {}).flatMap((cfg) => [
    ...(cfg.weekday || []),
    ...(cfg.holiday || []),
  ]);
  return uniqueSorted([...(site.timeSlots || []), ...fromLocations]);
}

module.exports = {
  getTimeSlots,
  isValidTimeSlot,
  groupTimeSlots,
  getAllPossibleTimeSlots,
};
