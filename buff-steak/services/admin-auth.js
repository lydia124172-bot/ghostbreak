const crypto = require('crypto');

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

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  return token;
}

function isValidToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return false;
  const exp = sessions.get(raw);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(raw);
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
};
