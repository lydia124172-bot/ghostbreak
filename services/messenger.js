/**
 * 匿名 Email（Resend 營運級 / Nodemailer 備援）與 SMS
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const {
  normalizePhone,
  resolveDeliveryChannels,
  wrapDeliveryMailBody,
  buildDeliverySmsBody,
  buildBundleDelegateConfirmationMail,
  buildDelegateReceiptMail,
} = require('./letter');
const {
  getOfficialEmailFrom,
  getOfficialSmsDisplay,
} = require('./privacy');
const {
  getTwilioDiagnostics,
  getTwilioFromNumber,
  twilioLive,
  sendTwilioSms,
  verifyTwilioLiveAccount,
  isTwilioTrialAccount,
  getTwilioSmsMaxLength,
} = require('./twilio');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const SENT_LOG_PATH = path.join(__dirname, '..', 'sent_logs.txt');
const MAILDROP_MX_HOST = 'mx.maildrop.cc';

function getResendFrom() {
  return getOfficialEmailFrom();
}

let resendClient = null;
let etherealAccount = null;
let etherealTransport = null;
let emailReady = false;

function envValue(key) {
  return String(process.env[key] || '').trim();
}

function appendSentLog(block) {
  const timestamp = block.TIMESTAMP || new Date().toISOString();
  const { BODY, TIMESTAMP, ...fields } = block;
  const lines = [
    '',
    `========== ${timestamp} ==========`,
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
  ];
  if (BODY !== undefined) {
    lines.push('BODY:');
    lines.push(String(BODY));
  }
  lines.push('----------------------------------------');
  fs.appendFileSync(SENT_LOG_PATH, `${lines.join('\n')}\n`, 'utf8');
}

function logVirtualSms({
  orderId,
  to,
  body,
  from,
  sid,
  status,
  mode,
  timestamp,
}) {
  appendSentLog({
    TIMESTAMP: timestamp || new Date().toISOString(),
    TYPE: 'SMS',
    ORDER: orderId || '(n/a)',
    MODE: mode || 'unknown',
    FROM: from || getOfficialSmsDisplay(),
    TO: to,
    SID: sid || '(n/a)',
    STATUS: status || '(n/a)',
    BODY: body,
  });
  console.log('[SMS][LOG]', SENT_LOG_PATH, '→', to, sid ? `(SID: ${sid})` : '');
}

function logEmailSend({ orderId, to, subject, via, previewUrl }) {
  appendSentLog({
    TYPE: 'EMAIL',
    ORDER: orderId || '(n/a)',
    FROM: getResendFrom(),
    TO: to,
    SUBJECT: subject,
    VIA: via,
    PREVIEW: previewUrl || '(direct)',
  });
}

function formatResendError(error) {
  if (!error) return { statusCode: null, name: null, message: 'Unknown Resend error', raw: null };
  return {
    statusCode: error.statusCode || error.status || null,
    name: error.name || null,
    message: error.message || String(error),
    raw: error,
  };
}

function resendConfigured() {
  return Boolean(envValue('RESEND_API_KEY'));
}

function getResend() {
  if (!resendConfigured()) return null;
  if (!resendClient) resendClient = new Resend(envValue('RESEND_API_KEY'));
  return resendClient;
}

async function sendViaResend({ to, subject, html, text, orderId }) {
  const client = getResend();
  if (!client) throw new Error('Resend 尚未設定 RESEND_API_KEY');

  const from = getResendFrom();
  const mailSubject = subject || 'A letter for you';
  console.log('Sending email via Resend...', {
    to,
    subject: mailSubject,
    from,
    orderId: orderId || '(n/a)',
    hasHtml: Boolean(html),
    hasText: Boolean(text),
  });

  const { data, error } = await client.emails.send({
    from,
    to: [to],
    subject: mailSubject,
    html,
    text,
  });

  if (error) {
    const detail = formatResendError(error);
    console.error('[Email][RESEND] 發送失敗 Response:', JSON.stringify(detail, null, 2));
    const err = new Error(detail.message || 'Resend 發送失敗');
    err.statusCode = detail.statusCode;
    err.resendError = detail;
    throw err;
  }

  console.log('[Email][RESEND] 發送成功', { id: data?.id, to });
  return data;
}

async function initEmailTransport() {
  if (resendConfigured()) {
    getResend();
    emailReady = true;
    console.log('[Email] Resend 營運級發信已就緒 →', getResendFrom());
    return null;
  }

  if (etherealTransport) return etherealTransport;

  if (envValue('EMAIL_USER') && envValue('EMAIL_PASS')) {
    etherealTransport = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: Number(process.env.EMAIL_PORT || 587),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    emailReady = true;
    console.log('[Email] 使用 .env 自訂 SMTP（可選）');
    return etherealTransport;
  }

  etherealAccount = await nodemailer.createTestAccount();
  etherealTransport = nodemailer.createTransport({
    host: etherealAccount.smtp.host,
    port: etherealAccount.smtp.port,
    secure: etherealAccount.smtp.secure,
    auth: { user: etherealAccount.user, pass: etherealAccount.pass },
  });
  emailReady = true;
  console.log('[Email] Ethereal 測試閘道已就緒 →', etherealAccount.user);
  console.log('[Email] @maildrop.cc 將嘗試 MX 直送');
  return etherealTransport;
}

function emailConfigured() {
  return emailReady || resendConfigured();
}

function twilioConfigured() {
  return twilioLive();
}

async function resolveMaildropMxHost() {
  try {
    const mxRecords = await dns.promises.resolveMx('maildrop.cc');
    if (mxRecords?.length) {
      mxRecords.sort((a, b) => a.priority - b.priority);
      return mxRecords[0].exchange;
    }
  } catch (err) {
    console.warn('[Email][MAILDROP] DNS MX 查詢失敗:', err.message, '→ 使用', MAILDROP_MX_HOST);
  }
  return MAILDROP_MX_HOST;
}

async function sendViaMaildropMx({ to, subject, text }) {
  const mxHost = await resolveMaildropMxHost();
  const heloName = (process.env.SMTP_HELO || os.hostname() || 'localhost').replace(/[^\w.-]/g, '');

  const transport = nodemailer.createTransport({
    host: mxHost,
    port: 25,
    secure: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
    name: heloName,
  });

  const mail = {
    from: getOfficialEmailFrom(),
    to,
    subject: subject || '有一封信想交給你',
    text,
  };

  const delays = [0, 12000, 30000];
  let lastErr;
  for (let i = 0; i < delays.length; i += 1) {
    if (delays[i] > 0) {
      console.log(`[Email][MAILDROP] greylist 重試 ${i}/${delays.length - 1}，等待 ${delays[i] / 1000}s…`);
      await new Promise((r) => { setTimeout(r, delays[i]); });
    }
    try {
      const info = await transport.sendMail(mail);
      return { ...info, mxHost };
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      const greylisted = /421|greylist/i.test(msg);
      console.warn(`[Email][MAILDROP] 嘗試 ${i + 1} 失敗:`, msg);
      if (!greylisted || i === delays.length - 1) throw err;
    }
  }
  throw lastErr || new Error('Maildrop 投遞失敗');
}

async function sendAnonymousEmail({ to, subject, text, orderId, senderNickname }) {
  await initEmailTransport();
  const mailSubject = subject || 'A letter for you';
  const { html, text: deliveryText } = wrapDeliveryMailBody(text, senderNickname);

  if (resendConfigured()) {
    const data = await sendViaResend({
      to,
      subject: mailSubject,
      html,
      text: deliveryText,
      orderId,
    });
    logEmailSend({ orderId, to, subject: mailSubject, via: 'resend', previewUrl: data?.id });
    return {
      channel: 'email',
      dryRun: false,
      to,
      messageId: data?.id || null,
      via: 'resend',
    };
  }

  const domain = String(to).split('@')[1]?.toLowerCase();

  if (domain === 'maildrop.cc') {
    try {
      const info = await sendViaMaildropMx({ to, subject: mailSubject, text: deliveryText });
      console.log('[Email][MAILDROP] 真槍實彈投遞 →', to, 'via', info.mxHost, info.messageId);
      logEmailSend({ orderId, to, subject: mailSubject, via: `maildrop-mx:${info.mxHost}` });
      return {
        channel: 'email', dryRun: false, to, messageId: info.messageId, via: 'maildrop-mx',
      };
    } catch (err) {
      console.warn('[Email][MAILDROP] MX 直送失敗:', err.message, '→ 改走 Ethereal 閘道');
    }
  }

  const info = await etherealTransport.sendMail({
    from: getOfficialEmailFrom(),
    to,
    subject: mailSubject,
    html,
    text: deliveryText,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info);
  console.log('[Email][SENT]', to, previewUrl || info.messageId);
  logEmailSend({ orderId, to, subject: mailSubject, via: 'ethereal', previewUrl });

  return {
    channel: 'email',
    dryRun: false,
    to,
    messageId: info.messageId,
    previewUrl: previewUrl || null,
    via: 'ethereal',
  };
}

async function sendAnonymousSms({ to, text, orderId, senderNickname }) {
  const toE164 = normalizePhone(to);
  if (!toE164) throw new Error('Invalid phone number format.');
  const trialMode = isTwilioTrialAccount();
  const maxLength = getTwilioSmsMaxLength();
  const body = buildDeliverySmsBody(text, { senderNickname, trialMode, maxLength });
  const officialFrom = getTwilioFromNumber() || getOfficialSmsDisplay();

  if (!twilioConfigured()) {
    const diag = getTwilioDiagnostics();
    console.warn('[SMS] Twilio 未就緒，僅寫入 sent_logs.txt:', diag.issues.join('；'));
    const sid = `log-${Date.now()}`;
    logVirtualSms({
      orderId,
      to: toE164,
      body,
      from: officialFrom,
      sid,
      status: 'virtual',
      mode: 'virtual-only',
    });
    return {
      channel: 'sms',
      dryRun: false,
      virtual: true,
      from: officialFrom,
      to: toE164,
      sid,
      logged: true,
      twilioIssues: diag.issues,
      smsBody: body,
    };
  }

  const result = await sendTwilioSms({ to: toE164, body, orderId });
  logVirtualSms({
    orderId,
    to: result.to,
    body,
    from: officialFrom,
    sid: result.sid,
    status: result.status,
    mode: result.magicTest ? 'magic-test' : 'live',
  });
  return { ...result, from: officialFrom, smsBody: body };
}

/**
 * Send delegate receipt with copies of all deliveries (+ optional PDF for bundle).
 */
async function sendDelegateReceipt({
  to,
  orderId,
  senderNickname,
  planName,
  baseUrl,
  includesPdf = false,
  emailCopy = null,
  smsCopy = null,
}) {
  await initEmailTransport();
  const delegateEmail = String(to || '').trim();
  if (!delegateEmail) {
    throw new Error('Please enter your Anonymous Email to receive delivery copies.');
  }

  const { subject, text, html, pdfUrl } = buildDelegateReceiptMail({
    orderId,
    senderNickname,
    planName,
    baseUrl,
    includesPdf,
    emailCopy,
    smsCopy,
  });

  if (resendConfigured()) {
    const data = await sendViaResend({ to: delegateEmail, subject, html, text, orderId });
    logEmailSend({ orderId, to: delegateEmail, subject, via: 'resend-delegate', previewUrl: data?.id });
    return {
      channel: 'delegate-confirmation',
      dryRun: false,
      to: delegateEmail,
      messageId: data?.id || null,
      via: 'resend',
      pdfUrl: pdfUrl || null,
    };
  }

  const info = await etherealTransport.sendMail({
    from: getOfficialEmailFrom(),
    to: delegateEmail,
    subject,
    html,
    text,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info);
  logEmailSend({ orderId, to: delegateEmail, subject, via: 'ethereal-delegate', previewUrl });
  return {
    channel: 'delegate-confirmation',
    dryRun: false,
    to: delegateEmail,
    messageId: info.messageId,
    previewUrl: previewUrl || null,
    via: 'ethereal',
    pdfUrl: pdfUrl || null,
  };
}

/** @deprecated Use sendDelegateReceipt */
async function sendBundleDelegateConfirmation({
  to, orderId, senderNickname, baseUrl,
}) {
  return sendDelegateReceipt({
    to,
    orderId,
    senderNickname,
    planName: 'Premium Bundle — SMS + Email',
    baseUrl,
    includesPdf: true,
  });
}

async function dispatchMessage({ planId, exEmail, exPhone, letter, exName, orderId, exContact }) {
  const results = [];
  const subject = exName ? `A letter for ${exName}` : 'A letter for you';
  const contact = exContact || exEmail || exPhone || '';
  const { sendEmail, sendSms } = resolveDeliveryChannels({ exContact: contact, planId });

  if (sendEmail) {
    if (!exEmail) throw new Error('This plan requires your ex\'s email address.');
    results.push(await sendAnonymousEmail({
      to: exEmail, subject, text: letter, orderId,
    }));
  }

  if (sendSms) {
    if (!exPhone) throw new Error('SMS plan requires your ex\'s phone number.');
    results.push(await sendAnonymousSms({ to: exPhone, text: letter, orderId }));
  }

  return results;
}

module.exports = {
  SENT_LOG_PATH,
  getOfficialSmsDisplay,
  initEmailTransport,
  emailConfigured,
  resendConfigured,
  twilioConfigured,
  twilioLive,
  getTwilioDiagnostics,
  verifyTwilioLiveAccount,
  sendAnonymousEmail,
  sendAnonymousSms,
  sendBundleDelegateConfirmation,
  sendDelegateReceipt,
  dispatchMessage,
  appendSentLog,
  logVirtualSms,
};
