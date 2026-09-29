const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'members.json');
const SECRET_FILE = path.join(DATA_DIR, 'member-secret');
const TOKEN_DAYS = 30;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

let cachedSecret = '';
function secret() {
  if (cachedSecret) return cachedSecret;
  const fromEnv = String(process.env.MEMBER_SECRET || '').trim();
  if (fromEnv) return (cachedSecret = fromEnv);
  ensureDir();
  if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), 'utf8');
  cachedSecret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  return cachedSecret;
}

function loadMembers() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveMembers(list) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function normEmail(raw) {
  return String(raw || '').trim().toLowerCase().slice(0, 120);
}

function publicMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone || '',
    city: row.city || '',
    address: row.address || '',
    createdAt: row.createdAt,
  };
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function issueToken(member) {
  const payload = Buffer.from(JSON.stringify({ id: member.id, v: member.tokenVersion || 0, exp: Date.now() + TOKEN_DAYS * 86400000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  const [payload, mac] = String(token || '').split('.');
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.id || Date.now() > Number(data.exp)) return null;
    const member = loadMembers().find((row) => row.id === data.id);
    if (!member || (member.tokenVersion || 0) !== data.v) return null;
    return member;
  } catch {
    return null;
  }
}

function register({ name, email, phone, password }) {
  const cleanName = String(name || '').trim().slice(0, 40);
  const cleanEmail = normEmail(email);
  const cleanPhone = String(phone || '').trim().slice(0, 30);
  const pass = String(password || '');
  if (!cleanName) fail('請填寫姓名');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) fail('請填寫正確的 Email');
  if (pass.length < 8) fail('密碼至少 8 個字');
  if (pass.length > 100) fail('密碼太長');
  const list = loadMembers();
  if (list.some((row) => row.email === cleanEmail)) fail('這個 Email 已經註冊過，請直接登入');
  const salt = crypto.randomBytes(16).toString('hex');
  const member = {
    id: `M-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    email: cleanEmail,
    name: cleanName,
    phone: cleanPhone,
    city: '',
    address: '',
    salt,
    passHash: hashPassword(pass, salt),
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
  };
  list.unshift(member);
  saveMembers(list);
  return { member: publicMember(member), token: issueToken(member) };
}

function login({ email, password }) {
  const member = loadMembers().find((row) => row.email === normEmail(email));
  const pass = String(password || '');
  if (!member) {
    hashPassword(pass, 'no-such-member');
    fail('Email 或密碼錯誤', 401);
  }
  const hash = hashPassword(pass, member.salt);
  if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(member.passHash, 'hex'))) fail('Email 或密碼錯誤', 401);
  return { member: publicMember(member), token: issueToken(member) };
}

function updateProfile(id, patch) {
  const list = loadMembers();
  const idx = list.findIndex((row) => row.id === id);
  if (idx < 0) fail('找不到會員', 404);
  const row = list[idx];
  if (patch.name !== undefined) {
    const name = String(patch.name || '').trim().slice(0, 40);
    if (!name) fail('請填寫姓名');
    row.name = name;
  }
  if (patch.phone !== undefined) row.phone = String(patch.phone || '').trim().slice(0, 30);
  if (patch.city !== undefined) row.city = String(patch.city || '').trim().slice(0, 40);
  if (patch.address !== undefined) row.address = String(patch.address || '').trim().slice(0, 200);
  if (patch.newPassword) {
    const pass = String(patch.newPassword);
    if (pass.length < 8) fail('新密碼至少 8 個字');
    if (pass.length > 100) fail('密碼太長');
    row.salt = crypto.randomBytes(16).toString('hex');
    row.passHash = hashPassword(pass, row.salt);
    row.tokenVersion = (row.tokenVersion || 0) + 1;
  }
  list[idx] = row;
  saveMembers(list);
  return { member: publicMember(row), token: patch.newPassword ? issueToken(row) : undefined };
}

function resetPassword(id) {
  const list = loadMembers();
  const idx = list.findIndex((row) => row.id === id);
  if (idx < 0) fail('找不到會員', 404);
  const temp = crypto.randomBytes(6).toString('base64url');
  list[idx].salt = crypto.randomBytes(16).toString('hex');
  list[idx].passHash = hashPassword(temp, list[idx].salt);
  list[idx].tokenVersion = (list[idx].tokenVersion || 0) + 1;
  saveMembers(list);
  return temp;
}

function removeMember(id) {
  saveMembers(loadMembers().filter((row) => row.id !== id));
}

function readMemberToken(req) {
  const header = String(req.headers['x-member-token'] || '');
  return header.trim();
}

module.exports = {
  loadMembers,
  publicMember,
  register,
  login,
  verifyToken,
  updateProfile,
  resetPassword,
  removeMember,
  readMemberToken,
};
