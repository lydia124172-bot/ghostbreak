const fs = require('fs');
const path = require('path');

function env(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

const DATA_DIR = env('DATA_DIR') || path.join(__dirname, '..', 'data');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const DEFAULT_NEWS = path.join(__dirname, '..', 'public', 'data', 'news.json');

const TITLE_MAX = 80;
const BODY_MAX = 1200;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultNews() {
  return { items: [] };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || '').trim();
  const title = String(item.title || '').trim();
  const body = String(item.body || '').trim();
  const date = String(item.date || '').trim();
  if (!id || !title || !body || !isValidDate(date)) return null;
  return {
    id,
    date,
    title,
    body,
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: String(item.updatedAt || item.createdAt || new Date().toISOString()),
  };
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function loadNews() {
  ensureDataDir();
  if (fs.existsSync(NEWS_FILE)) {
    const data = readJson(NEWS_FILE);
    if (data && typeof data === 'object') {
      const items = Array.isArray(data.items)
        ? data.items.map(normalizeItem).filter(Boolean)
        : [];
      return { items: sortItems(items) };
    }
  }

  const seeded = readJson(DEFAULT_NEWS) || defaultNews();
  const news = {
    items: Array.isArray(seeded.items)
      ? seeded.items.map(normalizeItem).filter(Boolean)
      : [],
  };
  saveNews(news);
  return { items: sortItems(news.items) };
}

function saveNews(news) {
  ensureDataDir();
  fs.writeFileSync(
    NEWS_FILE,
    JSON.stringify({ items: sortItems(news.items || []) }, null, 2),
    'utf8'
  );
}

function validatePayload({ title, body, date }) {
  const cleanTitle = String(title || '').trim();
  const cleanBody = String(body || '').trim();
  const cleanDate = String(date || '').trim();
  if (!cleanTitle) return { ok: false, error: '請填寫標題' };
  if (cleanTitle.length > TITLE_MAX) return { ok: false, error: `標題請在 ${TITLE_MAX} 字以內` };
  if (!cleanBody) return { ok: false, error: '請填寫內容' };
  if (cleanBody.length > BODY_MAX) return { ok: false, error: `內容請在 ${BODY_MAX} 字以內` };
  if (!isValidDate(cleanDate)) return { ok: false, error: '請選擇有效日期' };
  return { ok: true, title: cleanTitle, body: cleanBody, date: cleanDate };
}

function addNews({ title, body, date }) {
  const check = validatePayload({ title, body, date });
  if (!check.ok) return check;
  const news = loadNews();
  const now = new Date().toISOString();
  const entry = {
    id: `N-${Date.now()}`,
    date: check.date,
    title: check.title,
    body: check.body,
    createdAt: now,
    updatedAt: now,
  };
  news.items.unshift(entry);
  saveNews(news);
  return { ok: true, item: entry, news: loadNews() };
}

function updateNews(id, { title, body, date }) {
  const news = loadNews();
  const idx = news.items.findIndex((item) => item.id === id);
  if (idx < 0) return { ok: false, error: '找不到這則消息' };
  const check = validatePayload({ title, body, date });
  if (!check.ok) return check;
  news.items[idx] = {
    ...news.items[idx],
    date: check.date,
    title: check.title,
    body: check.body,
    updatedAt: new Date().toISOString(),
  };
  saveNews(news);
  return { ok: true, item: news.items[idx], news: loadNews() };
}

function removeNews(id) {
  const news = loadNews();
  const before = news.items.length;
  news.items = news.items.filter((item) => item.id !== id);
  if (news.items.length === before) return { ok: false, error: '找不到這則消息' };
  saveNews(news);
  return { ok: true, news };
}

module.exports = {
  loadNews,
  addNews,
  updateNews,
  removeNews,
};
