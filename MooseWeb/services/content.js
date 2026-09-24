const fs = require('fs');
const path = require('path');
const defaults = require('../data/site');
const accounts = require('./accounts');

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
    heroTitle: '店家官網、專業課程，\n與可直接使用的付費工具。',
    heroLead: '歡迎委託製作官網、報名課程，或使用我做的付費工具。商品短片可直接用。劇本廣告與 AI短劇建置中。',
    workKinds: clone(defaults.workKinds || []),
    products: clone(defaults.products || []),
    works: clone(defaults.works || []),
    courses: clone(defaults.courses || []),
    hire: clone(defaults.hire || []),
    faqs: clone(defaults.faqs || []),
  };
}

function mergeListsById(baseList, savedList) {
  if (!Array.isArray(savedList)) return clone(baseList);
  const baseById = new Map((baseList || []).filter((row) => row && row.id).map((row) => [row.id, row]));
  const used = new Set();
  const out = [];
  for (const row of savedList) {
    if (!row || !row.id) continue;
    used.add(row.id);
    const base = baseById.get(row.id);
    out.push(base ? { ...row, ...base } : row);
  }
  for (const row of baseList || []) {
    if (row && row.id && !used.has(row.id)) out.push(clone(row));
  }
  return out;
}

function mergeContent(saved) {
  const base = emptyContent();
  if (!saved || typeof saved !== 'object') return base;
  return {
    ...base,
    ...saved,
    lineUrl: normalizeLineUrl(saved.lineUrl !== undefined ? saved.lineUrl : base.lineUrl),
    workKinds: base.workKinds,
    products: mergeListsById(base.products, saved.products),
    works: mergeListsById(base.works, saved.works),
    courses: mergeListsById(base.courses, saved.courses),
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
    courses: (data.courses || []).map(({ notes, wave, status, ...row }) => row),
    hire: data.hire,
    faqs: data.faqs,
    tree: accounts.publicTree(),
    pay: { ecpay: Boolean(process.env.ECPAY_MERCHANT_ID && process.env.ECPAY_HASH_KEY && process.env.ECPAY_HASH_IV) },
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
