const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');

function env(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

const RESTAURANT_EMAIL = env('RESTAURANT_EMAIL');
const RESEND_API_KEY = getResendApiKey();
let resendClient = null;
let smtpTransport = null;

/** Resend API key 只能是 ASCII（re_ 開頭）；含中文會讓 Node fetch 崩潰 */
function getResendApiKey() {
  const raw = env('RESEND_API_KEY');
  if (!raw) return '';
  if (/^re_[A-Za-z0-9_]+$/.test(raw)) return raw;
  console.error(
    '[Mail] RESEND_API_KEY 格式錯誤：應只有 re_ 開頭的英文 key，勿貼 RESEND_FROM 或中文'
  );
  return '';
}

function getMailFrom() {
  const raw = env('RESEND_FROM') || env('EMAIL_FROM');
  if (raw && /^[\x00-\x7F]+$/.test(raw)) return raw;
  if (raw) {
    console.warn('[Mail] RESEND_FROM 含非 ASCII，改用英文寄件名');
  }
  return 'BUFF STEAK <noreply@bafuholdings.com>';
}

function resendReady() {
  return Boolean(RESEND_API_KEY);
}

function smtpReady() {
  return Boolean(env('EMAIL_HOST') && env('EMAIL_USER') && env('EMAIL_PASS'));
}

async function initMail() {
  if (resendReady()) {
    try {
      resendClient = new Resend(RESEND_API_KEY);
    } catch (err) {
      console.error('[Mail] Resend 初始化失敗', err.message);
      resendClient = null;
    }
    return;
  }
  if (smtpReady()) {
    smtpTransport = nodemailer.createTransport({
      host: env('EMAIL_HOST'),
      port: Number(env('EMAIL_PORT', '587')),
      secure: env('EMAIL_SECURE') === 'true',
      auth: { user: env('EMAIL_USER'), pass: env('EMAIL_PASS') },
    });
  }
}

async function sendMail({ to, subject, text, html }) {
  const from = getMailFrom();
  if (!to) throw new Error('Missing recipient email.');

  if (resendClient) {
    const result = await resendClient.emails.send({ from, to, subject, text, html });
    if (result.error) {
      console.error('[Mail] Resend 失敗', result.error);
      throw new Error(result.error.message || 'Resend failed');
    }
    console.log('[Mail] 已發送', { to, subject, via: 'resend' });
    return { via: 'resend' };
  }

  if (smtpTransport) {
    await smtpTransport.sendMail({ from, to, subject, text, html });
    console.log('[Mail] 已發送', { to, subject, via: 'smtp' });
    return { via: 'smtp' };
  }

  console.warn('[Mail] dry-run — 未設定 RESEND 或 SMTP', { to, subject });
  return { via: 'dry-run' };
}

const DATA_DIR = env('DATA_DIR') || path.join(__dirname, 'data');
const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadReservations() {
  ensureDataDir();
  if (!fs.existsSync(RESERVATIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveReservation(entry) {
  const list = loadReservations();
  list.push(entry);
  ensureDataDir();
  fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

module.exports = {
  RESTAURANT_EMAIL,
  initMail,
  sendMail,
  loadReservations,
  saveReservation,
  mailConfigured: () => resendReady() || smtpReady(),
};
