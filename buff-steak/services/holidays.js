const { Solar } = require('lunar-javascript');

const FIXED_HOLIDAYS = [
  { month: 1, day: 1, name: '元旦' },
  { month: 2, day: 28, name: '和平紀念日' },
  { month: 4, day: 4, name: '兒童節' },
  { month: 4, day: 5, name: '清明節' },
  { month: 5, day: 1, name: '勞動節' },
  { month: 10, day: 10, name: '國慶日' },
];

function parseDateParts(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function isWeekend(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.getDay() === 0 || d.getDay() === 6;
}

function isFathersDay(dateStr) {
  const parts = parseDateParts(dateStr);
  if (!parts) return false;
  return parts.m === 8 && parts.d === 8;
}

function isMothersDay(dateStr) {
  const parts = parseDateParts(dateStr);
  if (!parts || parts.m !== 5) return false;

  let sundays = 0;
  for (let day = 1; day <= 31; day++) {
    const dt = new Date(parts.y, 4, day);
    if (dt.getMonth() !== 4) break;
    if (dt.getDay() === 0) {
      sundays += 1;
      if (sundays === 2) return day === parts.d;
    }
  }
  return false;
}

function getLunar(dateStr) {
  const parts = parseDateParts(dateStr);
  if (!parts) return null;
  try {
    return Solar.fromYmd(parts.y, parts.m, parts.d).getLunar();
  } catch {
    return null;
  }
}

function isLunarNewYearPeriod(dateStr) {
  const lunar = getLunar(dateStr);
  if (!lunar) return false;
  const month = lunar.getMonth();
  const day = lunar.getDay();
  return month === 1 && day >= 1 && day <= 5;
}

function isLunarFestival(dateStr) {
  const lunar = getLunar(dateStr);
  if (!lunar) return null;

  const month = lunar.getMonth();
  const day = lunar.getDay();

  if (month === 5 && day === 5) return '端午節';
  if (month === 8 && day === 15) return '中秋節';
  return null;
}

function getFixedHolidayName(dateStr) {
  const parts = parseDateParts(dateStr);
  if (!parts) return null;

  for (const h of FIXED_HOLIDAYS) {
    if (parts.m === h.month && parts.d === h.day) return h.name;
  }
  return null;
}

function getHolidayReason(dateStr) {
  if (isLunarNewYearPeriod(dateStr)) {
    const lunar = getLunar(dateStr);
    const dayLabel = lunar?.getDayInChinese?.() || '春節';
    return `春節${dayLabel}`;
  }

  const lunarName = isLunarFestival(dateStr);
  if (lunarName) return lunarName;

  const fixedName = getFixedHolidayName(dateStr);
  if (fixedName) return fixedName;

  if (isFathersDay(dateStr)) return '父親節';
  if (isMothersDay(dateStr)) return '母親節';
  if (isWeekend(dateStr)) return '週末';

  return null;
}

function isHolidayDate(dateStr) {
  return Boolean(getHolidayReason(dateStr));
}

module.exports = {
  isHolidayDate,
  getHolidayReason,
  isWeekend,
  isFathersDay,
  isMothersDay,
  isLunarNewYearPeriod,
};
