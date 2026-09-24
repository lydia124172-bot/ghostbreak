const { Resend } = require('resend');
const nodemailer = require('nodemailer');

function env(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

const INQUIRE_EMAIL = env('INQUIRE_EMAIL', 'lydia3530@gmail.com');
const RESEND_API_KEY = getResendApiKey();
let resendClient = null;
let smtpTransport = null;

function getResendApiKey() {
  const raw = env('RESEND_API_KEY');
  if (!raw) return '';
  if (/^re_[A-Za-z0-9_]+$/.test(raw)) return raw;
  console.error('[Mail] RESEND_API_KEY 格式錯誤：應只有 re_ 開頭的英文 key');
  return '';
}

function getMailFrom() {
  const raw = env('RESEND_FROM') || env('EMAIL_FROM');
  if (raw && /^[\x00-\x7F]+$/.test(raw)) return raw;
  if (raw) console.warn('[Mail] RESEND_FROM 含非 ASCII，改用英文寄件名');
  return 'MooseWeb <noreply@bafuholdings.com>';
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

async function sendMail({ to, subject, text, html, replyTo }) {
  const from = getMailFrom();
  if (!to) throw new Error('Missing recipient email.');

  if (resendClient) {
    const payload = { from, to, subject, text, html };
    if (replyTo) payload.replyTo = replyTo;
    const result = await resendClient.emails.send(payload);
    if (result.error) {
      console.error('[Mail] Resend 失敗', result.error);
      throw new Error(result.error.message || 'Resend failed');
    }
    console.log('[Mail] 已發送', { to, subject, via: 'resend' });
    return { via: 'resend' };
  }

  if (smtpTransport) {
    await smtpTransport.sendMail({ from, to, subject, text, html, replyTo });
    console.log('[Mail] 已發送', { to, subject, via: 'smtp' });
    return { via: 'smtp' };
  }

  console.warn('[Mail] dry-run — 未設定 RESEND 或 SMTP', { to, subject });
  return { via: 'dry-run' };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inquiryMail(entry) {
  const subject = `[麋鹿網] 新諮詢 — ${entry.name}${entry.service ? `（${entry.service}）` : ''}`;
  const lines = [
    '麋鹿網收到一則諮詢',
    '──────────────',
    `姓名：${entry.name}`,
    entry.phone ? `電話：${entry.phone}` : null,
    entry.email ? `Email：${entry.email}` : null,
    entry.service ? `項目：${entry.service}` : null,
    '',
    '需求說明：',
    entry.message,
    '',
    `單號：${entry.id}`,
    `時間：${entry.createdAt}`,
  ].filter((line) => line !== null);
  const text = lines.join('\n');
  const html = `
    <p>麋鹿網收到一則諮詢</p>
    <p>
      姓名：${escapeHtml(entry.name)}<br/>
      ${entry.phone ? `電話：${escapeHtml(entry.phone)}<br/>` : ''}
      ${entry.email ? `Email：${escapeHtml(entry.email)}<br/>` : ''}
      ${entry.service ? `項目：${escapeHtml(entry.service)}<br/>` : ''}
    </p>
    <p>需求說明：</p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(entry.message)}</pre>
    <p style="color:#666;font-size:13px;">單號：${escapeHtml(entry.id)}<br/>時間：${escapeHtml(entry.createdAt)}</p>
  `;
  return {
    to: INQUIRE_EMAIL,
    subject,
    text,
    html,
    replyTo: entry.email || undefined,
  };
}

function resetMail({ email, link }) {
  const subject = '[麋鹿網] 重設密碼';
  const text = [
    '你申請重設麋鹿網帳號密碼。',
    '',
    '請在一小時內開啟此連結，並設定新密碼：',
    link,
    '',
    '若不是你本人操作，請忽略此信。密碼不會變更。',
  ].join('\n');
  const html = `
    <p>你申請重設麋鹿網帳號密碼。</p>
    <p>請在一小時內開啟此連結，並設定新密碼：</p>
    <p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
    <p style="color:#666;font-size:13px;">若不是你本人操作，請忽略此信。密碼不會變更。</p>
  `;
  return { to: email, subject, text, html };
}

module.exports = {
  INQUIRE_EMAIL,
  initMail,
  sendMail,
  inquiryMail,
  resetMail,
  mailConfigured: () => resendReady() || smtpReady(),
};
