const fs = require('fs');
const path = require('path');
const defaults = require('../data/site');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'content.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLineUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (/^lin\.ee\//i.test(value)) return `https://${value}`;
  const id = value.startsWith('@') ? value : `@${value.replace(/^@/, '')}`;
  return `https://line.me/R/ti/p/${encodeURIComponent(id)}`;
}

function emptyContent() {
  return {
    name: defaults.name,
    tagline: defaults.tagline,
    email: defaults.email,
    lineUrl: defaults.lineUrl || '',
    heroTitle: '網站作品、專業課程與專案委託。\n直播、剪輯與視覺設計一併呈現。',
    heroLead: '從可上線的品牌官網、AI 工具，到教學與影像設計，皆可在此查看與洽詢。',
    workKinds: clone(defaults.workKinds || []),
    products: clone(defaults.products || []),
    works: clone(defaults.works || []),
    courses: clone(defaults.courses || []),
    hire: clone(defaults.hire || []),
    faqs: clone(defaults.faqs || []),
  };
}

function mergeContent(saved) {
  const base = emptyContent();
  if (!saved || typeof saved !== 'object') return base;
  return {
    ...base,
    ...saved,
    lineUrl: normalizeLineUrl(saved.lineUrl !== undefined ? saved.lineUrl : base.lineUrl),
    workKinds: Array.isArray(saved.workKinds) ? saved.workKinds : base.workKinds,
    products: Array.isArray(saved.products) ? saved.products : base.products,
    works: Array.isArray(saved.works) ? saved.works : base.works,
    courses: Array.isArray(saved.courses) ? saved.courses : base.courses,
    hire: Array.isArray(saved.hire) ? saved.hire : base.hire,
    faqs: Array.isArray(saved.faqs) ? saved.faqs : base.faqs,
  };
}

function loadContent() {
  try {
    if (!fs.existsSync(FILE)) return emptyContent();
    return mergeContent(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    return emptyContent();
  }
}

function saveContent(next) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const data = mergeContent(next);
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function publicConfig() {
  const data = loadContent();
  return {
    name: data.name,
    tagline: data.tagline,
    email: data.email,
    lineUrl: normalizeLineUrl(data.lineUrl),
    heroTitle: data.heroTitle,
    heroLead: data.heroLead,
    workKinds: data.workKinds,
    products: data.products,
    works: data.works,
    courses: (data.courses || []).map(({ notes, ...row }) => row),
    hire: data.hire,
    faqs: data.faqs,
  };
}

function newId(prefix) {
  return `${prefix}-${Date.now()}`;
}

function upsertItem(listKey, item) {
  const data = loadContent();
  const list = Array.isArray(data[listKey]) ? data[listKey] : [];
  if (!item.id) item.id = newId(listKey.slice(0, 1));
  if (typeof item.features === 'string') {
    item.features = item.features.split(/\n/).map((s) => s.trim()).filter(Boolean);
  }
  const idx = list.findIndex((row) => row.id === item.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...item };
  else list.push(item);
  data[listKey] = list;
  return saveContent(data);
}

function removeItem(listKey, id) {
  const data = loadContent();
  data[listKey] = (data[listKey] || []).filter((row) => row.id !== id);
  return saveContent(data);
}

module.exports = {
  loadContent,
  saveContent,
  publicConfig,
  upsertItem,
  removeItem,
};
