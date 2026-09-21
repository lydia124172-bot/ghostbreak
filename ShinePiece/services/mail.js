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
  return 'Shine Piece <noreply@bafuholdings.com>';
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

function orderMail(entry) {
  const items = (entry.items || [])
    .map((row) => `${row.name} × ${row.qty}${row.price ? `（${row.price}）` : ''}`)
    .join('\n');
  const shipLine = entry.shipping === '超商取貨'
    ? `${entry.storeBrand || ''} ${entry.store || ''} ${entry.storeId || ''}`.trim()
    : `${entry.city || ''} ${entry.address || ''}`.trim();
  const subject = `[Shine Piece] 新訂單 — ${entry.name}`;
  const text = [
    'Shine Piece 收到一筆訂單',
    '──────────────',
    `姓名：${entry.name}`,
    entry.phone ? `電話：${entry.phone}` : null,
    entry.email ? `Email：${entry.email}` : null,
    `付款：${entry.payment || ''}（${entry.status || ''}）`,
    `物流：${entry.shipping || ''}`,
    shipLine ? `收件：${shipLine}` : null,
    '',
    '商品：',
    items || '（未列商品）',
    '',
    '備註：',
    entry.message || '無',
    '',
    `單號：${entry.id}`,
    `時間：${entry.createdAt}`,
  ].filter((line) => line !== null).join('\n');
  const html = `
    <p>Shine Piece 收到一筆訂單</p>
    <p>
      姓名：${escapeHtml(entry.name)}<br/>
      ${entry.phone ? `電話：${escapeHtml(entry.phone)}<br/>` : ''}
      ${entry.email ? `Email：${escapeHtml(entry.email)}<br/>` : ''}
      付款：${escapeHtml(entry.payment || '')}（${escapeHtml(entry.status || '')}）<br/>
      物流：${escapeHtml(entry.shipping || '')}<br/>
      ${shipLine ? `收件：${escapeHtml(shipLine)}<br/>` : ''}
    </p>
    <p>商品：</p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(items || '（未列商品）')}</pre>
    <p>備註：</p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(entry.message || '無')}</pre>
    <p style="color:#666;font-size:13px;">單號：${escapeHtml(entry.id)}<br/>時間：${escapeHtml(entry.createdAt)}</p>
  `;
  return { to: INQUIRE_EMAIL, subject, text, html, replyTo: entry.email || undefined };
}

function partnerMail(entry) {
  const subject = `[Shine Piece] 帶貨申請 — ${entry.name}`;
  const text = [
    'Shine Piece 收到一則帶貨申請',
    '──────────────',
    `姓名：${entry.name}`,
    entry.phone ? `電話：${entry.phone}` : null,
    entry.email ? `Email：${entry.email}` : null,
    entry.area ? `地區：${entry.area}` : null,
    '',
    entry.message || '',
    '',
    `單號：${entry.id}`,
    `時間：${entry.createdAt}`,
  ].filter((line) => line !== null).join('\n');
  const html = `
    <p>Shine Piece 收到一則帶貨申請</p>
    <p>
      姓名：${escapeHtml(entry.name)}<br/>
      ${entry.phone ? `電話：${escapeHtml(entry.phone)}<br/>` : ''}
      ${entry.email ? `Email：${escapeHtml(entry.email)}<br/>` : ''}
      ${entry.area ? `地區：${escapeHtml(entry.area)}<br/>` : ''}
    </p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(entry.message || '')}</pre>
    <p style="color:#666;font-size:13px;">單號：${escapeHtml(entry.id)}<br/>時間：${escapeHtml(entry.createdAt)}</p>
  `;
  return { to: INQUIRE_EMAIL, subject, text, html, replyTo: entry.email || undefined };
}

function wishMail(entry) {
  const subject = `[Shine Piece] 許願預購 — ${entry.name}`;
  const item = (entry.items || [])[0];
  const text = [
    'Shine Piece 收到一則許願預購',
    '──────────────',
    `姓名：${entry.name}`,
    entry.phone ? `電話：${entry.phone}` : null,
    entry.email ? `Email：${entry.email}` : null,
    item && item.name ? `商品：${item.name}` : null,
    '',
    entry.message || '',
    '',
    `單號：${entry.id}`,
    `時間：${entry.createdAt}`,
    `狀態：${entry.status || ''}`,
  ].filter((line) => line !== null).join('\n');
  const html = `
    <p>Shine Piece 收到一則許願預購</p>
    <p>
      姓名：${escapeHtml(entry.name)}<br/>
      ${entry.phone ? `電話：${escapeHtml(entry.phone)}<br/>` : ''}
      ${entry.email ? `Email：${escapeHtml(entry.email)}<br/>` : ''}
      ${item && item.name ? `商品：${escapeHtml(item.name)}<br/>` : ''}
      狀態：${escapeHtml(entry.status || '')}
    </p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(entry.message || '')}</pre>
    <p style="color:#666;font-size:13px;">單號：${escapeHtml(entry.id)}<br/>時間：${escapeHtml(entry.createdAt)}</p>
  `;
  return { to: INQUIRE_EMAIL, subject, text, html, replyTo: entry.email || undefined };
}

module.exports = {
  INQUIRE_EMAIL,
  initMail,
  sendMail,
  orderMail,
  partnerMail,
  wishMail,
  mailConfigured: () => resendReady() || smtpReady(),
};
