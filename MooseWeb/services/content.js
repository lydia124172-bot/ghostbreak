const fs = require('fs');
const path = require('path');
const accounts = require('./accounts');

/** 每次讀設定都重載 site.js，避免長跑進程卡在舊 require 快取（後台 content.json 仍會被程式碼預設覆蓋同名 id）。 */
function loadSiteDefaults() {
  delete require.cache[require.resolve('../data/site')];
  return require('../data/site');
}

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
  const defaults = loadSiteDefaults();
  return {
    name: defaults.name,
    tagline: defaults.tagline,
    email: defaults.email,
    lineUrl: defaults.lineUrl || '',
    heroTitle: '寫稿、出圖、短片、\n換裝與對嘴。',
    heroLead: '口播腳本、直播稿、個人 IP、熱問、提示詞、爆文鉤子可先試。商品短片、換裝、真人口播對嘴，以及還在做的劇本廣告與 AI 短劇，都從麋鹿工具包進去。',
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
    hire: mergeListsById(base.hire, saved.hire),
    faqs: Array.isArray(saved.faqs) ? saved.faqs : base.faqs,
  };
}

const DEPRECATED_WORK_IDS = new Set([
  'model-lock',
  'model',
  'fixed-model',
  'moose-model',
  'model-lock-fit',
  'mooseweb-saas',
]);

function isDeprecatedWork(w) {
  if (!w || !w.id) return true;
  const id = String(w.id || '').toLowerCase();
  const blob = `${w.name || ''}${w.summary || ''}${w.href || ''}`;
  if (DEPRECATED_WORK_IDS.has(w.id) || /model-lock|fixed-model/i.test(id)) return true;
  if (w.kind === '付費工具') return true;
  if (/固定模特/.test(blob)) return true;
  if (String(w.href || '').replace(/\/$/, '') === '/model') return true;
  if (/扣\s*2\s*點/.test(blob) && /模特/.test(blob)) return true;
  return false;
}

function stripWorkLegacyFields(w) {
  if (!w || typeof w !== 'object') return w;
  const { image, ...rest } = w;
  return rest;
}

function sanitizeWorks(works) {
  return (works || []).filter((w) => !isDeprecatedWork(w)).map(stripWorkLegacyFields);
}

/** 前台作品／委託項目以 site.js 為準，避免 content.json 舊資料蓋掉程式更新。 */
function canonicalWorks() {
  return sanitizeWorks(loadSiteDefaults().works || []);
}

function canonicalHire() {
  return clone(loadSiteDefaults().hire || []);
}

function stripDeprecatedFromSavedRaw(raw) {
  if (!raw || !Array.isArray(raw.works)) return false;
  const next = raw.works.filter((w) => !isDeprecatedWork(w));
  if (next.length === raw.works.length) return false;
  raw.works = next;
  return true;
}

function loadContent() {
  try {
    if (!fs.existsSync(FILE)) return applyContentHygiene(emptyContent());
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (stripDeprecatedFromSavedRaw(raw)) {
      fs.writeFileSync(FILE, JSON.stringify(raw, null, 2), 'utf8');
    }
    return applyContentHygiene(mergeContent(raw));
  } catch {
    return applyContentHygiene(emptyContent());
  }
}

function saveContent(next) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const merged = mergeContent(next);
  const data = applyContentHygiene(merged);
  const raw = typeof next === 'object' && next ? { ...next, works: data.works } : data;
  fs.writeFileSync(FILE, JSON.stringify(raw, null, 2), 'utf8');
  return data;
}

function applyContentHygiene(data) {
  const works = sanitizeWorks(data.works);
  return {
    ...data,
    works,
    workKinds: sanitizeWorkKinds(data.workKinds, works),
  };
}

function sanitizeWorkKinds(kinds, works) {
  const used = new Set((works || []).map((w) => w.kind).filter(Boolean));
  const preferred = ['品牌官網', 'SaaS', '智能體', '設計與自媒體'];
  const list = preferred.filter((k) => used.has(k));
  for (const k of kinds || []) {
    if (k && k !== '付費工具' && used.has(k) && !list.includes(k)) list.push(k);
  }
  return list;
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
    workKinds: sanitizeWorkKinds(data.workKinds, canonicalWorks()),
    products: data.products,
    works: canonicalWorks(),
    courses: (data.courses || [])
      .filter((row) => row.listed !== false)
      .map(({ notes, wave, ...row }) => row),
    hire: canonicalHire(),
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
