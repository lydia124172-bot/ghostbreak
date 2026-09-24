const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tree = require('../data/tree');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'accounts.json');
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function emptyStore() {
  return { accounts: [], sessions: {} };
}

function loadStore() {
  try {
    if (!fs.existsSync(FILE)) return emptyStore();
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      sessions: data.sessions && typeof data.sessions === 'object' ? data.sessions : {},
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const sessions = {};
  const now = Date.now();
  Object.entries(store.sessions || {}).forEach(([sid, row]) => {
    if (row && row.exp > now) sessions[sid] = row;
  });
  fs.writeFileSync(FILE, JSON.stringify({ accounts: store.accounts, sessions }, null, 2), 'utf8');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function planOf(id) {
  return tree.plans.find((p) => p.id === id) || tree.plans[0];
}

function isStoryPlan(plan) {
  return Boolean(plan && plan.product === 'storyclip');
}

function isDramaPlan(plan) {
  return Boolean(plan && plan.product === 'dramaclip');
}

function storyPlanOf(id) {
  return tree.plans.find((p) => p.id === id && p.product === 'storyclip') || null;
}

function dramaPlanOf(id) {
  return tree.plans.find((p) => p.id === id && p.product === 'dramaclip') || null;
}

function hashPass(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPass(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  try {
    const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32);
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== hash.length) return false;
    return crypto.timingSafeEqual(expected, hash);
  } catch {
    return false;
  }
}

function publicAccount(row) {
  if (!row) return { ok: false };
  const expired = Boolean(row.planExpires && Date.parse(row.planExpires) < Date.now());
  const plan = planOf(expired ? 'free' : row.plan || 'free');
  const storyExpired = Boolean(row.storyExpires && Date.parse(row.storyExpires) < Date.now());
  const story = storyExpired ? null : storyPlanOf(row.storyPlan);
  const dramaExpired = Boolean(row.dramaExpires && Date.parse(row.dramaExpires) < Date.now());
  const drama = dramaExpired ? null : dramaPlanOf(row.dramaPlan);
  return {
    ok: true,
    email: row.email,
    plan: plan.id,
    planName: plan.name,
    planLabel: plan.priceLabel,
    credits: expired || plan.id === 'free' ? 0 : Number(row.credits || 0),
    planExpires: expired ? null : row.planExpires || null,
    pendingPlan: row.pendingPlan || '',
    storyPlan: story ? story.id : '',
    storyPlanName: story ? story.name : '',
    storyPlanLabel: story ? story.priceLabel : '',
    storyCredits: story ? Number(row.storyCredits || 0) : 0,
    storyExpires: story ? row.storyExpires || null : null,
    pendingStoryPlan: row.pendingStoryPlan || '',
    dramaPlan: drama ? drama.id : '',
    dramaPlanName: drama ? drama.name : '',
    dramaPlanLabel: drama ? drama.priceLabel : '',
    dramaCredits: drama ? Number(row.dramaCredits || 0) : 0,
    dramaExpires: drama ? row.dramaExpires || null : null,
    pendingDramaPlan: row.pendingDramaPlan || '',
    createdAt: row.createdAt || '',
  };
}

function createSession(accountId) {
  const store = loadStore();
  const sid = crypto.randomBytes(24).toString('hex');
  store.sessions[sid] = { id: accountId, exp: Date.now() + 15552000 * 1000 };
  saveStore(store);
  return sid;
}

function clearSession(sid) {
  if (!sid) return;
  const store = loadStore();
  delete store.sessions[sid];
  saveStore(store);
}

function getBySid(sid) {
  if (!sid) return null;
  const store = loadStore();
  const session = store.sessions[sid];
  if (!session || session.exp < Date.now()) return null;
  return store.accounts.find((row) => row.id === session.id) || null;
}

function getByEmail(email) {
  const key = normalizeEmail(email);
  return loadStore().accounts.find((row) => row.email === key) || null;
}

function register(email, password) {
  const key = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) throw new Error('請填正確的 Email');
  if (String(password || '').length < 8) throw new Error('密碼至少 8 個字');
  const store = loadStore();
  if (store.accounts.some((row) => row.email === key)) throw new Error('此 Email 已註冊');
  const row = {
    id: crypto.randomBytes(8).toString('hex'),
    email: key,
    pass: hashPass(password),
    plan: 'free',
    credits: 0,
    planExpires: null,
    pendingPlan: '',
    storyPlan: '',
    storyCredits: 0,
    storyExpires: null,
    pendingStoryPlan: '',
    dramaPlan: '',
    dramaCredits: 0,
    dramaExpires: null,
    pendingDramaPlan: '',
    createdAt: new Date().toISOString(),
  };
  store.accounts.push(row);
  saveStore(store);
  return { account: publicAccount(row), sid: createSession(row.id) };
}

function login(email, password) {
  const row = getByEmail(email);
  if (!row || !verifyPass(password, row.pass)) throw new Error('Email 或密碼不正確');
  return { account: publicAccount(row), sid: createSession(row.id) };
}

function applyPlan(row, plan) {
  if (isStoryPlan(plan)) {
    row.storyPlan = plan.id;
    row.storyCredits = Number(plan.credits || 0);
    row.storyExpires = new Date(Date.now() + PERIOD_MS).toISOString();
    row.pendingStoryPlan = '';
    return;
  }
  if (isDramaPlan(plan)) {
    row.dramaPlan = plan.id;
    row.dramaCredits = Number(plan.credits || 0);
    row.dramaExpires = new Date(Date.now() + PERIOD_MS).toISOString();
    row.pendingDramaPlan = '';
    return;
  }
  row.plan = plan.id;
  row.credits = plan.credits;
  row.planExpires = plan.id === 'free' ? null : new Date(Date.now() + PERIOD_MS).toISOString();
  row.pendingPlan = '';
}

function requestPlan(account, planId) {
  const plan = tree.plans.find((p) => p.id === planId);
  if (!plan) throw new Error('沒有這個方案');
  const store = loadStore();
  const row = store.accounts.find((item) => item.id === account.id);
  if (!row) throw new Error('請先登入');
  if (plan.id === 'free') {
    applyPlan(row, plan);
    saveStore(store);
    return { account: publicAccount(row), granted: true, message: '已改為免費方案。' };
  }
  if (isDramaPlan(plan)) throw new Error('AI短劇建置中，尚未開放申請。');
  if (isStoryPlan(plan)) throw new Error('劇本廣告建置中，尚未開放申請。');
  else row.pendingPlan = plan.id;
  saveStore(store);
  return {
    account: publicAccount(row),
    granted: false,
    plan,
    message: `已送出「${plan.name}」申請。請透過 LINE 聯繫確認後即可使用。`,
  };
}

function grantPlan(email, planId) {
  const plan = tree.plans.find((p) => p.id === planId);
  if (!plan) throw new Error('沒有這個方案');
  const store = loadStore();
  const row = store.accounts.find((item) => item.email === normalizeEmail(email));
  if (!row) throw new Error('找不到這個帳號');
  applyPlan(row, plan);
  saveStore(store);
  return publicAccount(row);
}

function grantPlanById(accountId, planId) {
  const plan = tree.plans.find((p) => p.id === planId);
  if (!plan) throw new Error('沒有這個方案');
  const store = loadStore();
  const row = store.accounts.find((item) => item.id === accountId);
  if (!row) throw new Error('找不到這個帳號');
  applyPlan(row, plan);
  saveStore(store);
  return publicAccount(row);
}

function consumeCredit(accountId, amount = 1) {
  const n = Number(amount) || 1;
  const store = loadStore();
  const row = store.accounts.find((item) => item.id === accountId);
  if (!row) throw new Error('請先登入');
  const expired = Boolean(row.planExpires && Date.parse(row.planExpires) < Date.now());
  if (expired || row.plan === 'free') throw new Error('進階生圖需有效方案。請先選擇方案。');
  if (Number(row.credits || 0) < n) throw new Error('點數不足。每張進階生圖扣 1 點。');
  row.credits = Number(row.credits || 0) - n;
  saveStore(store);
  return publicAccount(row);
}

function consumeStoryCredit(accountId, amount = 1) {
  const n = Number(amount) || 1;
  const store = loadStore();
  const row = store.accounts.find((item) => item.id === accountId);
  if (!row) throw new Error('請先登入');
  const expired = Boolean(row.storyExpires && Date.parse(row.storyExpires) < Date.now());
  const story = storyPlanOf(row.storyPlan);
  if (expired || !story) throw new Error('劇本廣告需有效方案。請先看示範，再選擇方案。');
  if (Number(row.storyCredits || 0) < n) throw new Error('劇本廣告次數不足。請改選方案或等下一期。');
  row.storyCredits = Number(row.storyCredits || 0) - n;
  saveStore(store);
  return publicAccount(row);
}

function consumeDramaCredit(accountId, amount = 1) {
  const n = Number(amount) || 1;
  const store = loadStore();
  const row = store.accounts.find((item) => item.id === accountId);
  if (!row) throw new Error('請先登入');
  const expired = Boolean(row.dramaExpires && Date.parse(row.dramaExpires) < Date.now());
  const drama = dramaPlanOf(row.dramaPlan);
  if (expired || !drama) throw new Error('AI短劇需有效方案。請先看示範劇本，再選擇方案。');
  if (Number(row.dramaCredits || 0) < n) throw new Error('AI短劇次數不足。請改選方案或等下一期。');
  row.dramaCredits = Number(row.dramaCredits || 0) - n;
  saveStore(store);
  return publicAccount(row);
}

function listAccounts() {
  return loadStore().accounts
    .map((row) => publicAccount(row))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function publicTree() {
  return {
    family: tree.family,
    products: tree.products,
    plans: tree.plans.map(({ id, product, name, price, priceLabel, period, credits, features, images, videos, quota, scope }) => ({
      id, product: product || 'mooseclip', name, price, priceLabel, period, credits, features, images, videos, quota, scope,
    })),
    billingNote: tree.billingNote,
  };
}

function adminNotes() {
  return Array.isArray(tree.adminNotes) ? tree.adminNotes.slice() : [];
}

module.exports = {
  publicTree,
  adminNotes,
  getBySid,
  getByEmail,
  register,
  login,
  clearSession,
  requestPlan,
  grantPlan,
  grantPlanById,
  consumeCredit,
  consumeStoryCredit,
  consumeDramaCredit,
  listAccounts,
  publicAccount,
};
