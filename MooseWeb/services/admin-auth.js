const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function env(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

function getAdminPassword() {
  return env('ADMIN_PASSWORD');
}

function adminConfigured() {
  return Boolean(getAdminPassword());
}

const sessions = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;

function sessionFile() {
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dir, 'admin-sessions.json');
}

function loadSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
    const now = Date.now();
    for (const [token, exp] of Object.entries(raw || {})) {
      if (Number(exp) > now) sessions.set(token, Number(exp));
    }
  } catch {
    /* 尚無登入紀錄 */
  }
}

function saveSessions() {
  const file = sessionFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const now = Date.now();
  const out = {};
  for (const [token, exp] of sessions) {
    if (exp > now) out[token] = exp;
  }
  fs.writeFileSync(file, JSON.stringify(out));
}

loadSessions();

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  saveSessions();
  return token;
}

function isValidToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return false;
  let exp = sessions.get(raw);
  if (!exp) {
    loadSessions();
    exp = sessions.get(raw);
  }
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(raw);
    saveSessions();
    return false;
  }
  return true;
}

function login(password) {
  if (!adminConfigured()) return { ok: false, error: '尚未設定後台密碼（ADMIN_PASSWORD）' };
  if (!safeEqual(password, getAdminPassword())) return { ok: false, error: '密碼錯誤' };
  return { ok: true, token: createSession() };
}

function readToken(req) {
  const header = String(req.headers.authorization || '');
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return String(req.query.token || req.body?.token || '').trim();
}

function requireAdmin(req, res, next) {
  if (!adminConfigured()) {
    return res.status(503).json({ error: '尚未設定後台密碼' });
  }
  if (!isValidToken(readToken(req))) {
    return res.status(401).json({ error: '請先登入後台' });
  }
  next();
}

module.exports = {
  adminConfigured,
  login,
  requireAdmin,
  isValidToken,
  readToken,
};
