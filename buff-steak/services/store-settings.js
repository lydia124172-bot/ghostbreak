const fs = require('fs');
const path = require('path');
const site = require('../data/site');

function env(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

const DATA_DIR = env('DATA_DIR') || path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'store-settings.json');

const ONLINE_FULL_MESSAGE = '線上訂位已滿，請致電各店詢問現場保留位';

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const NOTICE_MAX = 300;

function isYmd(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [y, m, d] = String(value).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function defaultSchedule() {
  const extraClosed = {};
  const extraOpen = {};
  const closedSlots = {};
  const notes = {};
  for (const loc of site.locations) {
    extraClosed[loc.id] = [];
    extraOpen[loc.id] = [];
    closedSlots[loc.id] = {};
    notes[loc.id] = {};
  }
  return { extraClosed, extraOpen, closedSlots, notes };
}

function mergeSchedule(raw) {
  const base = defaultSchedule();
  if (!raw || typeof raw !== 'object') return base;
  for (const loc of site.locations) {
    const id = loc.id;
    if (Array.isArray(raw.extraClosed?.[id])) {
      base.extraClosed[id] = [...new Set(raw.extraClosed[id].filter(isYmd))];
    }
    if (Array.isArray(raw.extraOpen?.[id])) {
      base.extraOpen[id] = [...new Set(raw.extraOpen[id].filter(isYmd))];
    }
    if (raw.closedSlots?.[id] && typeof raw.closedSlots[id] === 'object') {
      const map = {};
      for (const [date, times] of Object.entries(raw.closedSlots[id])) {
        if (!isYmd(date) || !Array.isArray(times)) continue;
        map[date] = [...new Set(times.map((t) => String(t || '').trim()).filter(Boolean))];
      }
      base.closedSlots[id] = map;
    }
    if (raw.notes?.[id] && typeof raw.notes[id] === 'object') {
      const map = {};
      for (const [date, note] of Object.entries(raw.notes[id])) {
        if (!isYmd(date)) continue;
        const text = String(note || '').trim().slice(0, 80);
        if (text) map[date] = text;
      }
      base.notes[id] = map;
    }
  }
  return base;
}

function defaultSettings() {
  const onlineFull = {};
  for (const loc of site.locations) onlineFull[loc.id] = false;
  return { onlineFull, homepageNotice: '', schedule: defaultSchedule() };
}

function cleanNotice(value) {
  return String(value || '').trim().slice(0, NOTICE_MAX);
}

function loadSettings() {
  ensureDataDir();
  const base = defaultSettings();
  if (!fs.existsSync(SETTINGS_FILE)) return base;
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      onlineFull: { ...base.onlineFull, ...(raw.onlineFull || {}) },
      homepageNotice: cleanNotice(raw.homepageNotice),
      schedule: mergeSchedule(raw.schedule),
    };
  } catch {
    return base;
  }
}

function saveSettings(settings) {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

function isOnlineFull(locationId) {
  return Boolean(loadSettings().onlineFull[locationId]);
}

function setOnlineFull(locationId, value) {
  const settings = loadSettings();
  if (!site.locations.some((l) => l.id === locationId)) return null;
  settings.onlineFull[locationId] = Boolean(value);
  saveSettings(settings);
  return settings;
}

function getOnlineFullMessage(loc) {
  if (!loc) return ONLINE_FULL_MESSAGE;
  return `${ONLINE_FULL_MESSAGE}（${loc.name} ${loc.phone}）`;
}

function setHomepageNotice(text) {
  const settings = loadSettings();
  settings.homepageNotice = cleanNotice(text);
  saveSettings(settings);
  return settings;
}

function listScheduleOverrides() {
  const schedule = loadSettings().schedule;
  const rows = [];
  for (const loc of site.locations) {
    const notes = schedule.notes[loc.id] || {};
    for (const date of schedule.extraClosed[loc.id] || []) {
      rows.push({
        locationId: loc.id,
        locationName: loc.name,
        date,
        type: 'closed',
        typeLabel: '臨時公休',
        times: [],
        note: notes[date] || '',
      });
    }
    for (const date of schedule.extraOpen[loc.id] || []) {
      rows.push({
        locationId: loc.id,
        locationName: loc.name,
        date,
        type: 'open',
        typeLabel: '臨時營業',
        times: [],
        note: notes[date] || '',
      });
    }
    for (const [date, times] of Object.entries(schedule.closedSlots[loc.id] || {})) {
      if (!times.length) continue;
      rows.push({
        locationId: loc.id,
        locationName: loc.name,
        date,
        type: 'slots',
        typeLabel: '關閉時段',
        times,
        note: notes[date] || '',
      });
    }
  }
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.locationName.localeCompare(b.locationName, 'zh-Hant');
  });
  return rows;
}

function clearDateOverride(schedule, locationId, date) {
  schedule.extraClosed[locationId] = (schedule.extraClosed[locationId] || []).filter((d) => d !== date);
  schedule.extraOpen[locationId] = (schedule.extraOpen[locationId] || []).filter((d) => d !== date);
  if (schedule.closedSlots[locationId]) delete schedule.closedSlots[locationId][date];
  if (schedule.notes[locationId]) delete schedule.notes[locationId][date];
}

function setScheduleOverride({ locationId, date, type, times, note }) {
  if (!site.locations.some((l) => l.id === locationId)) {
    return { ok: false, error: '請選擇分店' };
  }
  if (!isYmd(date)) return { ok: false, error: '請選擇有效日期' };
  const settings = loadSettings();
  const schedule = settings.schedule;
  const text = String(note || '').trim().slice(0, 80);
  clearDateOverride(schedule, locationId, date);

  if (type === 'clear') {
    saveSettings(settings);
    return { ok: true, settings, overrides: listScheduleOverrides() };
  }
  if (type === 'closed') {
    schedule.extraClosed[locationId].push(date);
  } else if (type === 'open') {
    schedule.extraOpen[locationId].push(date);
  } else if (type === 'slots') {
    const slotList = [...new Set((times || []).map((t) => String(t || '').trim()).filter(Boolean))];
    if (!slotList.length) return { ok: false, error: '請至少勾選一個要關閉的時段' };
    schedule.closedSlots[locationId][date] = slotList;
  } else {
    return { ok: false, error: '請選擇調整類型' };
  }
  if (text) schedule.notes[locationId][date] = text;
  saveSettings(settings);
  return { ok: true, settings, overrides: listScheduleOverrides() };
}

function getClosedSlots(locationId, date) {
  const schedule = loadSettings().schedule;
  return schedule.closedSlots?.[locationId]?.[date] || [];
}

module.exports = {
  ONLINE_FULL_MESSAGE,
  NOTICE_MAX,
  loadSettings,
  isOnlineFull,
  setOnlineFull,
  getOnlineFullMessage,
  setHomepageNotice,
  listScheduleOverrides,
  setScheduleOverride,
  getClosedSlots,
  isYmd,
};
