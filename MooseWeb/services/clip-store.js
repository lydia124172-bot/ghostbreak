const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'clip.json');
const MEDIA = path.join(DATA_DIR, 'clip-media');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEDIA)) fs.mkdirSync(MEDIA, { recursive: true });
}

function empty() {
  return { sessions: {}, oauth: {}, media: {}, queue: [] };
}

function load() {
  ensure();
  try {
    if (!fs.existsSync(FILE)) return empty();
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data.sessions = data.sessions || {};
    data.oauth = data.oauth || {};
    data.media = data.media || {};
    data.queue = data.queue || [];
    return data;
  } catch {
    return empty();
  }
}

function save(data) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

function session(sid) {
  const data = load();
  if (!data.sessions[sid]) data.sessions[sid] = { accounts: {}, createdAt: new Date().toISOString() };
  save(data);
  return data.sessions[sid];
}

function putShop(sid, shop) {
  const data = load();
  if (!data.sessions[sid]) data.sessions[sid] = { accounts: {}, createdAt: new Date().toISOString() };
  if (!shop) {
    delete data.sessions[sid].shop;
    delete data.sessions[sid].shopProducts;
  } else {
    data.sessions[sid].shop = shop;
  }
  save(data);
}

function getShop(sid) {
  return session(sid).shop || null;
}

function putShopProducts(sid, products) {
  const data = load();
  if (!data.sessions[sid]) data.sessions[sid] = { accounts: {}, createdAt: new Date().toISOString() };
  data.sessions[sid].shopProducts = products;
  save(data);
}

function getShopProducts(sid) {
  return session(sid).shopProducts || [];
}

function putAccount(sid, platform, payload) {
  const data = load();
  if (!data.sessions[sid]) data.sessions[sid] = { accounts: {}, createdAt: new Date().toISOString() };
  data.sessions[sid].accounts[platform] = { ...payload, connectedAt: new Date().toISOString() };
  save(data);
}

function accounts(sid) {
  return session(sid).accounts || {};
}

function putOauth(state, row) {
  const data = load();
  data.oauth[state] = { ...row, createdAt: Date.now() };
  save(data);
}

function takeOauth(state) {
  const data = load();
  const row = data.oauth[state];
  delete data.oauth[state];
  save(data);
  return row;
}

function saveMedia(sid, kind, buffer, mime) {
  ensure();
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ext = /mp4/i.test(mime) ? 'mp4'
    : /webm/i.test(mime) ? 'webm'
    : /mpeg|mp3/i.test(mime) ? 'mp3'
    : /wav/i.test(mime) ? 'wav'
    : /png/i.test(mime) ? 'png'
    : /webp/i.test(mime) ? 'webp'
    : 'jpg';
  const filename = `${id}.${ext}`;
  fs.writeFileSync(path.join(MEDIA, filename), buffer);
  const data = load();
  data.media[id] = { id, sid, kind, mime, filename, createdAt: new Date().toISOString() };
  save(data);
  return data.media[id];
}

function getMedia(id) {
  const row = load().media[id];
  if (!row) return null;
  const full = path.join(MEDIA, row.filename);
  if (!fs.existsSync(full)) return null;
  return { ...row, full };
}

function mediaOwned(id, sid) {
  const row = load().media[id];
  return row && row.sid === sid ? row : null;
}

function putLastDress(sid, mediaId) {
  const data = load();
  if (!data.sessions[sid]) data.sessions[sid] = { accounts: {}, createdAt: new Date().toISOString() };
  data.sessions[sid].lastDressId = mediaId || '';
  save(data);
}

function getLastDress(sid) {
  const data = load();
  const id = data.sessions[sid] && data.sessions[sid].lastDressId;
  if (!id) return null;
  return getMedia(id);
}

function putLinks(sid, links) {
  const data = load();
  if (!data.sessions[sid]) data.sessions[sid] = { accounts: {}, createdAt: new Date().toISOString() };
  data.sessions[sid].links = links || {};
  save(data);
}

function getLinks(sid) {
  return session(sid).links || {};
}

function addJob(job) {
  const data = load();
  data.queue = data.queue || [];
  data.queue.push(job);
  save(data);
  return job;
}

function listQueue(sid) {
  return (load().queue || []).filter((row) => row.sid === sid).slice(-20).reverse().map((row) => ({
    id: row.id,
    at: row.at,
    status: row.status,
    platforms: row.platforms,
    error: row.error || '',
    results: row.results || [],
  }));
}

function dueJobs(now = Date.now()) {
  return (load().queue || []).filter((row) => row.status === 'queued' && Date.parse(row.at) <= now);
}

function getJob(id) {
  return (load().queue || []).find((row) => row.id === id) || null;
}

function updateJob(id, patch) {
  const data = load();
  const row = (data.queue || []).find((item) => item.id === id);
  if (!row) return null;
  Object.assign(row, patch);
  save(data);
  return row;
}

function guestEnhanceLimit() {
  const n = Number(process.env.GUEST_ENHANCE_DAILY || 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function todayTaipei() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

function guestEnhanceState(sid) {
  const data = load();
  if (!data.sessions[sid]) data.sessions[sid] = { accounts: {}, createdAt: new Date().toISOString() };
  const row = data.sessions[sid];
  const day = todayTaipei();
  if (row.enhanceDay !== day) {
    row.enhanceDay = day;
    row.enhanceUsed = 0;
    save(data);
  }
  const limit = guestEnhanceLimit();
  const used = Number(row.enhanceUsed || 0);
  return { limit, used, left: Math.max(0, limit - used) };
}

function consumeGuestEnhance(sid) {
  const state = guestEnhanceState(sid);
  if (state.left <= 0) return { ok: false, ...state };
  const data = load();
  const row = data.sessions[sid];
  row.enhanceUsed = Number(row.enhanceUsed || 0) + 1;
  save(data);
  return { ok: true, ...guestEnhanceState(sid) };
}

function guestScriptLimit() {
  const n = Number(process.env.GUEST_SCRIPT_DAILY || 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function guestScriptState(sid) {
  const data = load();
  if (!data.sessions[sid]) data.sessions[sid] = { accounts: {}, createdAt: new Date().toISOString() };
  const row = data.sessions[sid];
  const day = todayTaipei();
  if (row.scriptDay !== day) {
    row.scriptDay = day;
    row.scriptUsed = 0;
    save(data);
  }
  const limit = guestScriptLimit();
  const used = Number(row.scriptUsed || 0);
  return { limit, used, left: Math.max(0, limit - used) };
}

function consumeGuestScript(sid) {
  const state = guestScriptState(sid);
  if (state.left <= 0) return { ok: false, ...state };
  const data = load();
  const row = data.sessions[sid];
  row.scriptUsed = Number(row.scriptUsed || 0) + 1;
  save(data);
  return { ok: true, ...guestScriptState(sid) };
}

module.exports = {
  MEDIA,
  session,
  putAccount,
  accounts,
  putOauth,
  takeOauth,
  saveMedia,
  getMedia,
  mediaOwned,
  putLastDress,
  getLastDress,
  putShop,
  getShop,
  putShopProducts,
  getShopProducts,
  putLinks,
  getLinks,
  addJob,
  listQueue,
  dueJobs,
  getJob,
  updateJob,
  guestEnhanceLimit,
  guestEnhanceState,
  consumeGuestEnhance,
  guestScriptLimit,
  guestScriptState,
  consumeGuestScript,
};
