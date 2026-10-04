const fs = require('fs');
const path = require('path');
const defaults = require('../data/site');
const { parseListing, displayName, parseVideo } = require('./listing');

function fail(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

function collectImages(src) {
  const images = [];
  const extra = Array.isArray(src.images) ? src.images : [];
  extra.concat([src.image, src.coverImage]).forEach((url) => {
    const u = String(url || '').trim();
    if (!u || u.length > 300 || u.includes('..')) return;
    const ok = /^https?:\/\//i.test(u)
      || /^\/uploads\/products\/[A-Za-z0-9._-]+$/.test(u)
      || /^\/images\/[A-Za-z0-9._-]+$/.test(u);
    if (ok && !images.includes(u) && images.length < 12) images.push(u);
  });
  return images;
}

function safeProductImage(raw, fallback = '') {
  const u = String(raw || '').trim();
  if (!u || u.length > 300 || u.includes('..')) return fallback;
  if (/^https?:\/\//i.test(u) || /^\/uploads\/products\/[A-Za-z0-9._-]+$/.test(u) || /^\/images\/[A-Za-z0-9._-]+$/.test(u)) return u;
  return fallback;
}

function finalizeProductImages(images, { coverImage = '', coverIndex = -1, fallbackCover = '' } = {}) {
  const list = images.filter(Boolean);
  if (!list.length) return { images: [], coverImage: '', image: '' };
  let idx = Number.isFinite(Number(coverIndex)) ? Math.floor(Number(coverIndex)) : -1;
  let cover = safeProductImage(coverImage, '');
  if (!cover && idx >= 0 && idx < list.length) cover = list[idx];
  if (!cover) cover = safeProductImage(fallbackCover, list[0]);
  const ordered = list[0] === cover ? list.slice() : [cover, ...list.filter((u) => u !== cover)];
  return { images: ordered, coverImage: cover, image: cover };
}

function pickImages(item, fallback) {
  if (Array.isArray(item.images) || item.image) return collectImages(item);
  return collectImages(fallback);
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'content.json');
const DEMO_IDS = new Set([
  'home-clean', 'skin-care', 'snack-box',
  'jp-cream', 'jp-aroma', 'kr-makeup', 'kr-serum', 'cn-tea', 'th-spa', 'th-snack',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLiveUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    return url.toString().slice(0, 300);
  } catch {
    return '';
  }
}

function normalizeLineUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (/^lin\.ee\//i.test(value)) return `https://${value}`;
  const id = value.startsWith('@') ? value : `@${value.replace(/^@/, '')}`;
  return `https://line.me/R/ti/p/${encodeURIComponent(id)}`;
}

function currentMonthLabel() {
  const now = new Date();
  return `${now.getFullYear()}年${now.getMonth() + 1}月集選`;
}

const CANON_ORIGINS = ['日本', '韓國', '中國', '泰國', '台灣'];
const COPY_KEYS = [
  'coverLabel', 'coverEnglish', 'pullQuote', 'countryHead', 'countryLead',
  'shopLead', 'shopEmpty', 'col1Title', 'col1Body', 'col2Title', 'col2Body',
  'col3Title', 'col3Body', 'liveTitle', 'archiveNote', 'wishLead', 'coverVol',
];
const COPY_MAX = {
  coverLabel: 40, coverEnglish: 80, pullQuote: 120, countryHead: 40, countryLead: 300,
  shopLead: 200, shopEmpty: 120, col1Title: 20, col1Body: 200, col2Title: 20, col2Body: 200,
  col3Title: 20, col3Body: 200, liveTitle: 40, archiveNote: 200, wishLead: 200, coverVol: 40,
};

function pickCopy(saved, key) {
  const fallback = defaults[key] || '';
  const max = COPY_MAX[key] || 300;
  const raw = saved && saved[key] !== undefined ? saved[key] : fallback;
  return String(raw || '').trim().slice(0, max);
}

function mergeOrigins(saved) {
  const extra = Array.isArray(saved)
    ? saved.map((row) => String(row || '').trim()).filter((row) => row && !CANON_ORIGINS.includes(row))
    : [];
  return CANON_ORIGINS.concat(extra);
}

function emptyContent() {
  const base = {
    name: defaults.name,
    tagline: defaults.tagline,
    email: defaults.email,
    lineUrl: defaults.lineUrl || '',
    heroTitle: defaults.heroTitle,
    heroLead: defaults.heroLead,
    origins: clone(CANON_ORIGINS),
    categories: clone(defaults.categories || []),
    products: clone(defaults.products || []),
    monthLabel: defaults.monthLabel || '',
    liveWhen: defaults.liveWhen || '',
    liveNote: defaults.liveNote || '',
    liveUrl: defaults.liveUrl || '',
    themeTitle: defaults.themeTitle || '',
    themeOrigin: defaults.themeOrigin || '',
    themeVisual: defaults.themeVisual || '/images/hero-tea.jpg',
    nextTitle: defaults.nextTitle || '',
    nextNote: defaults.nextNote || '',
    archive: [],
    wishKeys: [],
  };
  COPY_KEYS.forEach((key) => {
    base[key] = defaults[key] || '';
  });
  return base;
}

function normQty(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, 99999);
}

function cleanProduct(item, fallback = {}) {
  const src = item || {};
  const parsed = parseListing(src.description || src.summary, src.filename);
  const rawImages = pickImages(src, fallback);
  const coverIndex = src.coverIndex !== undefined && src.coverIndex !== null && String(src.coverIndex).trim() !== ''
    ? Math.floor(Number(src.coverIndex))
    : -1;
  const finalized = finalizeProductImages(rawImages, {
    coverImage: src.coverImage,
    coverIndex,
    fallbackCover: fallback.coverImage || fallback.image || '',
  });
  const images = finalized.images;
  const coverImage = finalized.coverImage;
  const qty = src.qty !== undefined ? normQty(src.qty) : normQty(fallback.qty);
  const baseStock = String(src.stock || '').trim() || parsed.stock || String(fallback.stock || '').trim() || '有貨';
  let name = String(src.name || '').trim() || parsed.name || String(fallback.name || '').trim();
  if (/^【[^】]{1,24}】\s*$/.test(name) && parsed.name && !/^【[^】]+】\s*$/.test(parsed.name)) {
    name = parsed.name;
  }
  const badge = String(src.badge || '').trim() || parsed.badge || String(fallback.badge || '').trim();
  const perk = String(src.perk || '').trim() || parsed.perk || String(fallback.perk || '').trim();
  const video = String(src.video || '').trim() || parsed.video || String(fallback.video || '').trim();
  const videoNorm = parseVideo(video) || parseVideo(String(src.description || src.summary || '')) || video;
  return {
    id: String(src.id || fallback.id || '').trim(),
    origin: String(src.origin || '').trim() || parsed.origin || String(fallback.origin || '').trim(),
    category: String(src.category || '').trim() || parsed.category || String(fallback.category || '').trim(),
    name,
    badge,
    perk,
    video: videoNorm,
    videoCaption: String(src.videoCaption || '').trim().slice(0, 48) || '親測／廠商短片',
    displayName: displayName({ name, badge, perk }),
    price: String(src.price || '').trim() || parsed.price || String(fallback.price || '').trim(),
    qty,
    stock: qty === 0 ? '售完' : (baseStock === '售完' ? '有貨' : baseStock),
    summary: String(src.summary || src.description || fallback.summary || '').trim() || parsed.summary,
    image: finalized.image || images[0] || '',
    coverImage: coverImage || finalized.image || images[0] || '',
    images,
    flash: Boolean(src.flash),
  };
}

function cleanArchiveProduct(item) {
  const row = cleanProduct(item);
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName || row.name,
    badge: row.badge || '',
    perk: row.perk || '',
    video: row.video || '',
    origin: row.origin,
    price: row.price,
    summary: row.summary,
    image: row.image,
    coverImage: row.coverImage || row.image,
    images: row.images,
    qty: row.qty,
    wishCount: Math.max(0, Number(item && item.wishCount) || 0),
  };
}

function cleanArchiveMonth(item) {
  const src = item || {};
  return {
    id: String(src.id || '').trim(),
    label: String(src.label || '').trim(),
    themeTitle: String(src.themeTitle || '').trim(),
    themeOrigin: String(src.themeOrigin || '').trim(),
    closedAt: String(src.closedAt || '').trim(),
    products: (Array.isArray(src.products) ? src.products : []).map(cleanArchiveProduct).filter((row) => row.id && row.name),
  };
}

function safeThemeVisual(raw, fallback) {
  const u = String(raw || '').trim();
  if (!u || u.includes('..') || u.length > 300) return fallback;
  if (/^https?:\/\//i.test(u) || /^\/uploads\/products\/[A-Za-z0-9._-]+$/.test(u) || /^\/images\/[A-Za-z0-9._-]+$/.test(u)) return u;
  return fallback;
}

function mergeContent(saved) {
  const base = emptyContent();
  if (!saved || typeof saved !== 'object') return base;
  const savedProducts = Array.isArray(saved.products) ? saved.products : [];
  const demoOnly = savedProducts.length > 0 && savedProducts.every((row) => DEMO_IDS.has(row && row.id));
  const defsById = Object.fromEntries(base.products.map((row) => [row.id, row]));
  const source = demoOnly ? [] : savedProducts.filter((row) => !DEMO_IDS.has(row && row.id));
  const products = source.map((row) => cleanProduct(row, defsById[row && row.id] || {}));
  const origins = mergeOrigins(saved.origins);
  const archive = Array.isArray(saved.archive)
    ? saved.archive.map(cleanArchiveMonth).filter((row) => row.id)
    : [];
  const merged = {
    ...base,
    ...saved,
    lineUrl: normalizeLineUrl(saved.lineUrl !== undefined ? saved.lineUrl : base.lineUrl),
    monthLabel: String(saved.monthLabel !== undefined ? saved.monthLabel : base.monthLabel).trim(),
    liveWhen: String(saved.liveWhen !== undefined ? saved.liveWhen : '').trim(),
    liveNote: String(saved.liveNote !== undefined ? saved.liveNote : base.liveNote).trim(),
    liveUrl: normalizeLiveUrl(saved.liveUrl) || normalizeLiveUrl(base.liveUrl),
    themeTitle: String(saved.themeTitle !== undefined ? saved.themeTitle : base.themeTitle).trim(),
    themeOrigin: String(saved.themeOrigin !== undefined ? saved.themeOrigin : base.themeOrigin).trim(),
    themeVisual: safeThemeVisual(saved.themeVisual, base.themeVisual),
    nextTitle: String(saved.nextTitle !== undefined ? saved.nextTitle : base.nextTitle).trim(),
    nextNote: String(saved.nextNote !== undefined ? saved.nextNote : base.nextNote).trim(),
    origins,
    categories: Array.isArray(saved.categories) ? saved.categories : base.categories,
    products,
    archive: archive.slice(0, 24),
    wishKeys: Array.isArray(saved.wishKeys) ? saved.wishKeys.map((row) => String(row || '').slice(0, 120)).filter(Boolean).slice(0, 2000) : [],
  };
  COPY_KEYS.forEach((key) => {
    merged[key] = pickCopy(saved, key);
  });
  if (merged.liveTitle === '客廳裡的兩場閒聊') merged.liveTitle = '蝦皮賣場直播間';
  if (merged.liveWhen === '每週兩場，每場一次' || merged.liveWhen === '開播時間以蝦皮賣場為準') merged.liveWhen = '';
  if (merged.heroTitle === '月刊生活指南。') merged.heroTitle = '主編部落格。';
  if (merged.tagline === '月刊生活指南') merged.tagline = '本月精選商品';
  return merged;
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
  const copy = {};
  COPY_KEYS.forEach((key) => {
    copy[key] = data[key];
  });
  return {
    name: data.name,
    tagline: data.tagline,
    email: data.email,
    lineUrl: normalizeLineUrl(data.lineUrl),
    heroTitle: data.heroTitle,
    heroLead: data.heroLead,
    origins: data.origins,
    categories: data.categories,
    monthLabel: data.monthLabel || currentMonthLabel(),
    liveWhen: data.liveWhen,
    liveNote: data.liveNote,
    liveUrl: data.liveUrl || '',
    themeTitle: data.themeTitle,
    themeOrigin: data.themeOrigin,
    themeVisual: data.themeVisual || '/images/hero-tea.jpg',
    nextTitle: data.nextTitle,
    nextNote: data.nextNote,
    ...copy,
    pay: require('./pay').publicPay(),
    issueUrl: '/issue',
    products: data.products,
    archive: (data.archive || []).map((month) => ({
      id: month.id,
      label: month.label,
      themeTitle: month.themeTitle,
      themeOrigin: month.themeOrigin,
      closedAt: month.closedAt,
      products: (month.products || []).map((row) => ({
        id: row.id,
        name: row.name,
        origin: row.origin,
        price: row.price,
        summary: row.summary,
        image: row.image,
        wishCount: row.wishCount || 0,
      })),
    })),
  };
}

function newId(prefix) {
  return `${prefix}-${Date.now()}`;
}

function upsertItem(listKey, item) {
  const data = loadContent();
  const list = Array.isArray(data[listKey]) ? data[listKey] : [];
  if (listKey === 'products') {
    const idx = item && item.id ? list.findIndex((entry) => entry.id === item.id) : -1;
    const row = cleanProduct(item, idx >= 0 ? list[idx] : {});
    if (!row.image) fail('請上傳商品照片');
    if (!row.name) fail('請在說明第一行寫商品名稱');
    if (!row.id) row.id = newId('p');
    if (idx >= 0) list[idx] = { ...list[idx], ...row };
    else list.push(row);
    data.products = list;
    return saveContent(data);
  }
  const row = { ...(item || {}) };
  if (!row.id) row.id = newId(listKey.slice(0, 1));
  const idx = list.findIndex((entry) => entry.id === row.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...row };
  else list.push(row);
  data[listKey] = list;
  return saveContent(data);
}

function removeItem(listKey, id) {
  const data = loadContent();
  data[listKey] = (data[listKey] || []).filter((row) => row.id !== id);
  return saveContent(data);
}

function archiveCurrentMonth() {
  const data = loadContent();
  if (!(data.products || []).length) fail('目前沒有本月商品可封存');
  const month = {
    id: newId('a'),
    label: data.monthLabel || currentMonthLabel(),
    themeTitle: data.themeTitle || '',
    themeOrigin: data.themeOrigin || '',
    closedAt: new Date().toISOString(),
    products: data.products.map((row) => cleanArchiveProduct(row)),
  };
  data.archive = [month, ...(data.archive || [])].slice(0, 24);
  data.products = [];
  return saveContent(data);
}

function archiveItem(id) {
  const data = loadContent();
  const idx = (data.products || []).findIndex((row) => row.id === id);
  if (idx < 0) fail('找不到商品');
  const product = cleanArchiveProduct(data.products[idx]);
  data.products.splice(idx, 1);
  const label = data.monthLabel || currentMonthLabel();
  let month = (data.archive || []).find((row) => row.label === label);
  if (!month) {
    month = {
      id: newId('a'),
      label,
      themeTitle: data.themeTitle || '',
      themeOrigin: data.themeOrigin || '',
      closedAt: new Date().toISOString(),
      products: [],
    };
    data.archive = [month, ...(data.archive || [])];
  }
  month.products = [product, ...(month.products || [])];
  return saveContent(data);
}

function findArchiveProduct(data, id) {
  for (const month of data.archive || []) {
    const row = (month.products || []).find((item) => item.id === id);
    if (row) return { month, product: row };
  }
  return null;
}

function flashItem(id) {
  const data = loadContent();
  const found = findArchiveProduct(data, id);
  if (!found) fail('過往商品不存在');
  const row = cleanProduct({ ...found.product, flash: true, stock: '回鍋快閃' });
  const idx = data.products.findIndex((item) => item.id === row.id);
  if (idx >= 0) data.products[idx] = { ...data.products[idx], ...row, flash: true, stock: '回鍋快閃' };
  else data.products.unshift(row);
  return saveContent(data);
}

function relistItem(id) {
  const data = loadContent();
  const found = findArchiveProduct(data, id);
  if (!found) fail('下架商品不存在');
  if ((data.products || []).some((item) => item.id === id)) fail('這個商品已經在本月集選');
  found.month.products = found.month.products.filter((item) => item.id !== id);
  data.products = [cleanProduct({ ...found.product, flash: false, stock: '' }), ...(data.products || [])];
  data.archive = (data.archive || []).filter((month) => month.products.length);
  return saveContent(data);
}

function deleteArchived(id) {
  const data = loadContent();
  data.archive = (data.archive || [])
    .map((month) => ({ ...month, products: (month.products || []).filter((item) => item.id !== id) }))
    .filter((month) => month.products.length);
  return saveContent(data);
}

function setQty(id, raw) {
  const data = loadContent();
  const idx = (data.products || []).findIndex((row) => row.id === id);
  if (idx < 0) fail('找不到商品');
  data.products[idx] = cleanProduct({ ...data.products[idx], qty: normQty(raw) });
  return saveContent(data);
}

function deductStock(items) {
  const data = loadContent();
  const byId = Object.fromEntries((data.products || []).map((row) => [row.id, row]));
  const need = {};
  (items || []).forEach((row) => {
    if (row.id) need[row.id] = (need[row.id] || 0) + (Number(row.qty) || 1);
  });
  for (const [id, qty] of Object.entries(need)) {
    const product = byId[id];
    if (!product) continue;
    if (/缺貨|售完/.test(product.stock || '')) fail(`「${product.name}」目前${product.stock}，請從購物車移除`);
    if (product.qty !== null && product.qty !== undefined && product.qty < qty) {
      fail(product.qty > 0 ? `「${product.name}」只剩 ${product.qty} 件，請調整數量` : `「${product.name}」已售完，請從購物車移除`);
    }
  }
  let changed = false;
  data.products = (data.products || []).map((row) => {
    if (!need[row.id] || row.qty === null || row.qty === undefined) return row;
    changed = true;
    return cleanProduct({ ...row, qty: Math.max(0, row.qty - need[row.id]) });
  });
  if (changed) saveContent(data);
}

function restock(items) {
  const data = loadContent();
  const back = {};
  (items || []).forEach((row) => {
    if (row.id) back[row.id] = (back[row.id] || 0) + (Number(row.qty) || 1);
  });
  let changed = false;
  data.products = (data.products || []).map((row) => {
    if (!back[row.id] || row.qty === null || row.qty === undefined) return row;
    changed = true;
    return cleanProduct({ ...row, qty: row.qty + back[row.id], stock: '' });
  });
  if (changed) saveContent(data);
}

function addWishCount(productId, key) {
  const data = loadContent();
  const found = findArchiveProduct(data, productId);
  if (!found) fail('此商品目前不在過往回顧');
  const wishKey = String(key || '').trim().slice(0, 120);
  if (wishKey && (data.wishKeys || []).includes(wishKey)) {
    return { content: data, duplicate: true, product: found.product, month: found.month };
  }
  found.product.wishCount = (found.product.wishCount || 0) + 1;
  if (wishKey) data.wishKeys = [wishKey, ...(data.wishKeys || [])].slice(0, 2000);
  return { content: saveContent(data), duplicate: false, product: found.product, month: found.month };
}

module.exports = {
  loadContent,
  saveContent,
  publicConfig,
  upsertItem,
  removeItem,
  archiveCurrentMonth,
  archiveItem,
  flashItem,
  relistItem,
  deleteArchived,
  setQty,
  deductStock,
  restock,
  addWishCount,
};
