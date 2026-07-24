/**
 * Twilio SMS — LIVE 帳戶憑證驗證與真實發送
 */
const twilio = require('twilio');
const crypto = require('crypto');
const { normalizePhone } = require('./letter');

const PLACEHOLDER_PHONES = new Set([
  '+1234567890',
  '+12345678901',
  '+10000000000',
  '+15551234567',
  '+15550000000',
]);

/** Twilio 官方神奇測試號碼（模擬發送成功，實機不會收到簡訊） */
const TWILIO_MAGIC_FROM_NUMBERS = new Set([
  '+15005550006', // SMS 模擬成功
  '+15005550001', // 模擬無效號碼
  '+15005550009', // 模擬無法路由
]);

let client = null;
let cachedAccountType = null;

/** Twilio Trial 帳戶僅允許 1 段簡訊（UCS-2 中文約 70 字） */
const TWILIO_TRIAL_SMS_MAX_CHARS = 70;

function envValue(key) {
  return String(process.env[key] || '').trim();
}

function getTwilioFromNumber() {
  // 僅讀取系統 .env，絕不使用表單欄位（委託人聯絡方式）
  return envValue('TWILIO_FROM_NUMBER')
    || envValue('TWILIO_PHONE_NUMBER')
    || envValue('TWILIO_FROM');
}

function isMagicTestFromNumber(phone) {
  return TWILIO_MAGIC_FROM_NUMBERS.has(String(phone || '').trim());
}

function isValidTwilioFromNumber(phone) {
  const p = String(phone || '').trim();
  if (isMagicTestFromNumber(p)) return true;
  if (!isValidTwilioPhone(p)) return false;
  if (p.startsWith('+886')) return false;
  return p.startsWith('+1');
}

function getTwilioTestToNumber() {
  return envValue('TWILIO_TEST_TO')
    || envValue('TWILIO_DEFAULT_TO')
    || envValue('SMS_TEST_TO')
    || '+886970205800';
}

function isValidTwilioSid(sid) {
  return /^AC[a-f0-9]{32}$/i.test(sid);
}

function isValidTwilioAuthToken(token) {
  return /^[a-f0-9]{32}$/i.test(token);
}

function isValidTwilioPhone(phone) {
  if (!phone || !phone.startsWith('+')) return false;
  if (PLACEHOLDER_PHONES.has(phone)) return false;
  return /^\+\d{10,15}$/.test(phone);
}

function isValidMessageSid(sid) {
  return /^SM[a-f0-9]{32}$/i.test(String(sid || ''));
}

function maskSecret(value, visible = 4) {
  if (!value) return '(empty)';
  if (value.length <= visible) return '*'.repeat(value.length);
  return `${'*'.repeat(Math.max(0, value.length - visible))}${value.slice(-visible)}`;
}

function getTwilioDiagnostics() {
  const accountSid = envValue('TWILIO_ACCOUNT_SID');
  const authToken = envValue('TWILIO_AUTH_TOKEN');
  const fromNumber = getTwilioFromNumber();
  const testTo = getTwilioTestToNumber();
  const issues = [];

  if (!accountSid) issues.push('缺少 TWILIO_ACCOUNT_SID');
  else if (!isValidTwilioSid(accountSid)) {
    issues.push('TWILIO_ACCOUNT_SID 格式錯誤（應為 AC 開頭 34 字元 LIVE 帳戶 SID）');
  }

  if (!authToken) issues.push('缺少 TWILIO_AUTH_TOKEN（LIVE Auth Token，32 字元 hex）');
  else if (!isValidTwilioAuthToken(authToken)) {
    issues.push(
      `TWILIO_AUTH_TOKEN 格式錯誤（應為 32 字元 hex LIVE Token）。`
      + ` 目前長度 ${authToken.length}，請勿使用 PayPal 密碼或 Test Credentials`,
    );
  }

  if (!fromNumber) issues.push('缺少 TWILIO_FROM_NUMBER 或 TWILIO_PHONE_NUMBER');
  else if (!isValidTwilioFromNumber(fromNumber)) {
    issues.push(`From 號碼無效（目前：${fromNumber}）。請使用 +1 虛擬號或 Twilio 神奇測試號 +15005550006`);
  }

  return {
    ok: issues.length === 0,
    issues,
    accountSid: accountSid || null,
    fromNumber: fromNumber || null,
    testTo: testTo || null,
    authTokenLoaded: Boolean(authToken),
    authTokenPreview: maskSecret(authToken),
    mode: 'live',
  };
}

function twilioLive() {
  return getTwilioDiagnostics().ok;
}

function isTwilioTrialModeEnv() {
  const raw = String(process.env.TWILIO_TRIAL_MODE || '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

function isTwilioTrialAccount() {
  const envOverride = isTwilioTrialModeEnv();
  if (envOverride !== null) return envOverride;
  return cachedAccountType === 'Trial';
}

function getTwilioSmsMaxLength() {
  return isTwilioTrialAccount() ? TWILIO_TRIAL_SMS_MAX_CHARS : 1500;
}

function setTwilioAccountType(type) {
  cachedAccountType = type || null;
}

function getTwilioClient() {
  const diag = getTwilioDiagnostics();
  if (!diag.ok) return null;
  if (!client) {
    client = twilio(envValue('TWILIO_ACCOUNT_SID'), envValue('TWILIO_AUTH_TOKEN'));
  }
  return client;
}

function formatTwilioError(err) {
  return {
    status: err.status || err.statusCode || null,
    code: err.code || null,
    message: err.message || String(err),
    moreInfo: err.moreInfo || null,
  };
}

async function verifyTwilioLiveAccount() {
  const diag = getTwilioDiagnostics();
  if (!diag.ok) {
    return { ok: false, issues: diag.issues };
  }

  const twilioClient = getTwilioClient();
  const sid = envValue('TWILIO_ACCOUNT_SID');

  try {
    const account = await twilioClient.api.accounts(sid).fetch();
    setTwilioAccountType(account.type);
    console.log('[SMS][TWILIO] LIVE 帳戶驗證成功', {
      sid: account.sid,
      friendlyName: account.friendlyName,
      status: account.status,
      type: account.type,
    });
    return {
      ok: true,
      sid: account.sid,
      friendlyName: account.friendlyName,
      status: account.status,
      type: account.type,
    };
  } catch (err) {
    const detail = formatTwilioError(err);
    console.error('[SMS][TWILIO] LIVE 帳戶驗證失敗:', JSON.stringify(detail, null, 2));
    return {
      ok: false,
      issues: [
        `LIVE 帳戶驗證失敗（HTTP ${detail.status || 'n/a'}）：${detail.message}`,
        '請確認使用 console.twilio.com 主帳戶的 Account SID + Auth Token，而非 Test Credentials',
      ],
      error: detail,
    };
  }
}

async function sendTwilioSms({ to, body, orderId }) {
  const diag = getTwilioDiagnostics();
  if (!diag.ok) {
    const err = new Error(diag.issues.join('；'));
    err.twilioDiagnostics = diag;
    throw err;
  }

  const accountCheck = await verifyTwilioLiveAccount();
  if (!accountCheck.ok) {
    const err = new Error(accountCheck.issues.join('；'));
    err.twilioDiagnostics = accountCheck;
    throw err;
  }

  const twilioClient = getTwilioClient();
  const from = getTwilioFromNumber();
  const toE164 = normalizePhone(to);
  if (!toE164) throw new Error(`無效的收件手機號碼：${to}`);

  if (isMagicTestFromNumber(from)) {
    const mockSid = `SM${crypto.randomBytes(16).toString('hex')}`;
    console.log('[SMS][TWILIO][MAGIC] 模擬發送成功（神奇測試號 +15005550006，實機不會收到）', {
      sid: mockSid,
      status: 'queued',
      from,
      to: toE164,
      orderId: orderId || '(n/a)',
      bodyLength: String(body || '').length,
    });
    return {
      channel: 'sms',
      dryRun: false,
      virtual: false,
      magicTest: true,
      from,
      to: toE164,
      sid: mockSid,
      status: 'queued',
      accountSid: envValue('TWILIO_ACCOUNT_SID'),
    };
  }

  const maxLen = getTwilioSmsMaxLength();
  const smsBody = String(body).slice(0, maxLen);

  console.log('[SMS] Sending via Twilio LIVE API...', {
    from,
    to: toE164,
    orderId: orderId || '(n/a)',
    bodyLength: smsBody.length,
    trialMode: isTwilioTrialAccount(),
    maxLength: maxLen,
  });

  try {
    const msg = await twilioClient.messages.create({
      from,
      to: toE164,
      body: smsBody,
    });

    if (!isValidMessageSid(msg.sid)) {
      throw new Error(`Twilio 回傳異常 SID：${msg.sid}`);
    }

    console.log('[SMS][TWILIO] 發送成功 — Messaging Log 應已建立', {
      sid: msg.sid,
      status: msg.status,
      to: msg.to,
      from: msg.from,
      accountSid: envValue('TWILIO_ACCOUNT_SID'),
    });

    return {
      channel: 'sms',
      dryRun: false,
      virtual: false,
      from: msg.from,
      to: msg.to,
      sid: msg.sid,
      status: msg.status,
      accountSid: envValue('TWILIO_ACCOUNT_SID'),
    };
  } catch (err) {
    const detail = formatTwilioError(err);
    console.error('[SMS][TWILIO] 發送失敗 Response:', JSON.stringify(detail, null, 2));
    let message = detail.message || 'Twilio 發送失敗';
    if (detail.code === 21608 || /unverified/i.test(message)) {
      message = 'Twilio 試用帳戶無法發送至未驗證號碼。請至 twilio.com → Phone Numbers → Verified Caller IDs 驗證收件手機，或升級為付費帳戶。';
    } else if (detail.code === 30044 || /trial message length/i.test(message)) {
      message = 'Twilio 試用帳戶僅能發送 1 段簡訊（中文約 70 字）。系統已自動縮短內容；若仍失敗請升級為付費帳戶以發送完整分手信。';
    }
    const wrapped = new Error(message);
    wrapped.statusCode = detail.status;
    wrapped.twilioError = detail;
    throw wrapped;
  }
}

module.exports = {
  getTwilioDiagnostics,
  twilioLive,
  getTwilioClient,
  getTwilioFromNumber,
  getTwilioTestToNumber,
  verifyTwilioLiveAccount,
  sendTwilioSms,
  formatTwilioError,
  isValidMessageSid,
  isMagicTestFromNumber,
  isTwilioTrialAccount,
  getTwilioSmsMaxLength,
  TWILIO_TRIAL_SMS_MAX_CHARS,
};
