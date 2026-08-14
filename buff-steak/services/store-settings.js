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

function defaultSettings() {
  const onlineFull = {};
  for (const loc of site.locations) onlineFull[loc.id] = false;
  return { onlineFull };
}

function loadSettings() {
  ensureDataDir();
  const base = defaultSettings();
  if (!fs.existsSync(SETTINGS_FILE)) return base;
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      onlineFull: { ...base.onlineFull, ...(raw.onlineFull || {}) },
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

module.exports = {
  ONLINE_FULL_MESSAGE,
  loadSettings,
  isOnlineFull,
  setOnlineFull,
  getOnlineFullMessage,
};
