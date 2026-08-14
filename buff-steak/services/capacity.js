const { loadReservations } = require('./mail');
const site = require('../data/site');
const { isHolidayDate, getHolidayReason } = require('./holidays');
const { isLocationClosed, getClosedMessage } = require('./store-hours');
const { isTooSoon, getLeadTimeMessage } = require('./lead-time');
const { getTimeSlots } = require('./time-slots');

const WEEKDAY_MINUTES = 120;
const HOLIDAY_MINUTES = 90;

function isHolidayDateForDining(dateStr) {
  return isHolidayDate(dateStr);
}

function getDiningDurationMinutes(dateStr) {
  const weekday = site.diningDuration?.weekdayMinutes ?? WEEKDAY_MINUTES;
  const holiday = site.diningDuration?.holidayMinutes ?? HOLIDAY_MINUTES;
  return isHolidayDateForDining(dateStr) ? holiday : weekday;
}

function getDiningLabel(dateStr) {
  const minutes = getDiningDurationMinutes(dateStr);
  const hours = minutes / 60;
  const reason = getHolidayReason(dateStr);
  const dayType = isHolidayDateForDining(dateStr) ? '假日' : '平日';
  const suffix = reason && reason !== '週末' ? `（${reason}）` : '';
  return `${dayType}用餐 ${hours} 小時${suffix}`;
}

function getLocationCapacity(loc) {
  const cap = Number(loc.capacity);
  return cap > 0 ? cap : 0;
}

function isActiveReservation(r) {
  return r && r.status !== 'cancelled';
}

function slotBookedGuests(locationId, date, time, excludeId) {
  return loadReservations()
    .filter((r) => (
      isActiveReservation(r)
      && r.locationId === locationId
      && r.date === date
      && r.time === time
      && r.id !== excludeId
    ))
    .reduce((sum, r) => sum + (Number(r.guests) || 0), 0);
}

function maxAddableGuests(loc, date, time, excludeId) {
  const capacity = getLocationCapacity(loc);
  if (!capacity) return 0;
  return Math.max(0, capacity - slotBookedGuests(loc.id, date, time, excludeId));
}

function getAvailability(loc, date, time, opts = {}) {
  const excludeId = opts.excludeId;
  const skipLeadTime = Boolean(opts.skipLeadTime);

  if (isLocationClosed(loc, date)) {
    const capacity = getLocationCapacity(loc);
    return {
      locationId: loc.id,
      locationName: loc.name,
      date,
      time,
      capacity,
      booked: 0,
      remaining: 0,
      available: false,
      closed: true,
      closedMessage: getClosedMessage(loc, date),
      diningMinutes: getDiningDurationMinutes(date),
      diningLabel: getDiningLabel(date),
      holidayReason: getHolidayReason(date),
      isHoliday: isHolidayDateForDining(date),
    };
  }

  const capacity = getLocationCapacity(loc);
  const booked = slotBookedGuests(loc.id, date, time, excludeId);
  const remainingSeats = Math.max(0, capacity - booked);
  const tooSoon = skipLeadTime ? false : isTooSoon(date, time);
  const remaining = tooSoon ? 0 : remainingSeats;
  const duration = getDiningDurationMinutes(date);

  return {
    locationId: loc.id,
    locationName: loc.name,
    date,
    time,
    capacity,
    booked,
    remaining,
    available: remaining > 0,
    tooSoon,
    tooSoonMessage: tooSoon ? getLeadTimeMessage(loc) : null,
    diningMinutes: duration,
    diningLabel: getDiningLabel(date),
    holidayReason: getHolidayReason(date),
    isHoliday: isHolidayDateForDining(date),
  };
}

function checkReservationCapacity(loc, date, time, guests, opts = {}) {
  if (isLocationClosed(loc, date)) {
    return {
      ok: false,
      message: getClosedMessage(loc, date),
      code: 'STORE_CLOSED',
    };
  }

  if (!opts.skipLeadTime && isTooSoon(date, time)) {
    return {
      ok: false,
      message: getLeadTimeMessage(loc),
      code: 'TOO_SOON',
    };
  }

  const capacity = getLocationCapacity(loc);
  if (!capacity) return { ok: true };

  const guestsNum = Number(guests);
  const { booked, remaining, diningLabel } = getAvailability(loc, date, time, opts);

  if (remaining <= 0) {
    return {
      ok: false,
      message: '此訂位時段已滿，請選擇其他時段，或直接致電分店訂位。',
      code: 'SLOT_FULL',
      capacity,
      booked,
      remaining: 0,
    };
  }

  if (guestsNum > remaining) {
    return {
      ok: false,
      message: `此時段僅剩 ${remaining} 位，請減少人數或更換時段。`,
      code: 'OVER_CAPACITY',
      capacity,
      booked,
      remaining,
    };
  }

  return { ok: true, capacity, booked, remaining };
}

function getDayAvailability(loc, date, opts = {}) {
  const slots = getTimeSlots(loc, date);
  if (isLocationClosed(loc, date)) {
    const msg = getClosedMessage(loc, date);
    return slots.map((time) => ({
      time,
      capacity: getLocationCapacity(loc),
      booked: 0,
      remaining: 0,
      available: false,
      closed: true,
      closedMessage: msg,
      diningLabel: getDiningLabel(date),
    }));
  }
  return slots.map((time) => {
    const info = getAvailability(loc, date, time, opts);
    return {
      time,
      capacity: info.capacity,
      booked: info.booked,
      remaining: info.remaining,
      available: info.available,
      tooSoon: info.tooSoon,
      tooSoonMessage: info.tooSoonMessage,
      diningLabel: info.diningLabel,
    };
  });
}

module.exports = {
  getLocationCapacity,
  getAvailability,
  getDayAvailability,
  checkReservationCapacity,
  getDiningDurationMinutes,
  getDiningLabel,
  isHolidayDate: isHolidayDateForDining,
  isTooSoon,
  getLeadTimeMessage,
};
