const { loadReservations } = require('./mail');
const site = require('../data/site');
const { isHolidayDate, getHolidayReason } = require('./holidays');
const { isLocationClosed, getClosedMessage } = require('./store-hours');

const WEEKDAY_MINUTES = 120;
const HOLIDAY_MINUTES = 90;

function parseTime(timeStr) {
  const [h, m] = String(timeStr).split(':').map(Number);
  return h * 60 + m;
}

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

function buildWindows(reservations, locationId, date) {
  return reservations
    .filter((r) => r.locationId === locationId && r.date === date)
    .map((r) => {
      const duration = getDiningDurationMinutes(r.date);
      return {
        start: parseTime(r.time),
        end: parseTime(r.time) + duration,
        guests: Number(r.guests) || 0,
      };
    });
}

function getPeakOccupancy(windows) {
  if (!windows.length) return 0;

  const points = new Set();
  windows.forEach((w) => {
    points.add(w.start);
    points.add(w.end);
  });

  const sorted = [...points].sort((a, b) => a - b);
  let max = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    const t = sorted[i];
    const tNext = sorted[i + 1];
    if (tNext <= t) continue;

    let occupancy = 0;
    for (const w of windows) {
      if (w.start <= t && w.end > t) occupancy += w.guests;
    }
    max = Math.max(max, occupancy);
  }

  return max;
}

function peakDuringWindow(existingWindows, start, end) {
  const points = new Set([start, end]);
  existingWindows.forEach((w) => {
    if (w.start >= start && w.start <= end) points.add(w.start);
    if (w.end >= start && w.end <= end) points.add(w.end);
  });

  const sorted = [...points].sort((a, b) => a - b);
  let peak = 0;

  for (const t of sorted) {
    let occupancy = 0;
    for (const w of existingWindows) {
      if (w.start <= t && w.end > t) occupancy += w.guests;
    }
    peak = Math.max(peak, occupancy);
  }

  return peak;
}

function maxAddableGuests(loc, date, time) {
  const capacity = getLocationCapacity(loc);
  if (!capacity) return 20;

  const existing = buildWindows(loadReservations(), loc.id, date);
  const start = parseTime(time);
  const duration = getDiningDurationMinutes(date);
  let max = 0;

  for (let guests = 1; guests <= 20; guests++) {
    const windows = [...existing, { start, end: start + duration, guests }];
    if (getPeakOccupancy(windows) <= capacity) max = guests;
    else break;
  }

  return max;
}

function getAvailability(loc, date, time) {
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
  const existing = buildWindows(loadReservations(), loc.id, date);
  const start = parseTime(time);
  const duration = getDiningDurationMinutes(date);
  const end = start + duration;
  const booked = peakDuringWindow(existing, start, end);
  const remaining = maxAddableGuests(loc, date, time);

  return {
    locationId: loc.id,
    locationName: loc.name,
    date,
    time,
    capacity,
    booked,
    remaining,
    available: remaining > 0,
    diningMinutes: duration,
    diningLabel: getDiningLabel(date),
    holidayReason: getHolidayReason(date),
    isHoliday: isHolidayDateForDining(date),
  };
}

function checkReservationCapacity(loc, date, time, guests) {
  if (isLocationClosed(loc, date)) {
    return {
      ok: false,
      message: getClosedMessage(loc, date),
      code: 'STORE_CLOSED',
    };
  }

  const capacity = getLocationCapacity(loc);
  if (!capacity) return { ok: true };

  const guestsNum = Number(guests);
  const { booked, remaining, diningLabel } = getAvailability(loc, date, time);

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

function getDayAvailability(loc, date) {
  const site = require('../data/site');
  if (isLocationClosed(loc, date)) {
    const msg = getClosedMessage(loc, date);
    return site.timeSlots.map((time) => ({
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
  return site.timeSlots.map((time) => {
    const info = getAvailability(loc, date, time);
    return {
      time,
      capacity: info.capacity,
      booked: info.booked,
      remaining: info.remaining,
      available: info.available,
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
};
