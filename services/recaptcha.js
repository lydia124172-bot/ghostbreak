/**
 * Google reCAPTCHA v3 伺服器端驗證
 * @see https://developers.google.com/recaptcha/docs/v3
 */
const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/** Google 控制台正式 Site Key（Cw 後必須是大寫 I ASCII 73，不是小寫 l ASCII 108） */
const RECAPTCHA_SITE_KEY_CANONICAL = `6Lf-Cw${String.fromCharCode(73)}tAAAAAKUhLFxHkY56erSnGTDTyd14SuWP`;

function envValue(key) {
  return String(process.env[key] || '').trim();
}

/** 一律回傳 Google 官方 Site Key */
function getRecaptchaSiteKey() {
  return RECAPTCHA_SITE_KEY_CANONICAL;
}

function isRecaptchaDevBypass() {
  return String(process.env.RECAPTCHA_DEV_BYPASS || '').trim().toLowerCase() === 'true';
}

function getRecaptchaSecretKey() {
  return envValue('RECAPTCHA_SECRET_KEY');
}

function isPlaceholderKey(value) {
  const v = String(value || '').trim();
  if (!v) return true;
  return /your[_-]?(recaptcha[_-]?)?(site|secret)[_-]?key|placeholder|^x+$/i.test(v);
}

function recaptchaConfigured() {
  if (isRecaptchaDevBypass()) return false;
  const site = getRecaptchaSiteKey();
  const secret = getRecaptchaSecretKey();
  if (!site || !secret) return false;
  if (isPlaceholderKey(site) || isPlaceholderKey(secret)) return false;
  return true;
}

function getRecaptchaMinScore() {
  const raw = Number(envValue('RECAPTCHA_MIN_SCORE') || '0.5');
  return Number.isFinite(raw) ? raw : 0.5;
}

/**
 * 向 Google 驗證 reCAPTCHA v3 Token
 * @returns {Promise<{ok:boolean, skipped?:boolean, score?:number, action?:string, error?:string}>}
 */
async function verifyRecaptcha(token, { remoteIp, minScore, expectedAction } = {}) {
  if (!recaptchaConfigured()) {
    console.warn('[reCAPTCHA] 未設定 RECAPTCHA_SITE_KEY / RECAPTCHA_SECRET_KEY，略過驗證（開發模式）');
    return { ok: true, skipped: true };
  }

  const responseToken = String(token || '').trim();
  if (!responseToken) {
    return { ok: false, error: '缺少 reCAPTCHA 驗證 Token，已拒絕發送' };
  }

  const threshold = minScore ?? getRecaptchaMinScore();
  const params = new URLSearchParams({
    secret: getRecaptchaSecretKey(),
    response: responseToken,
  });
  if (remoteIp) params.set('remoteip', remoteIp);

  const res = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    console.warn('[reCAPTCHA] 驗證失敗', data['error-codes'] || data);
    return {
      ok: false,
      error: 'reCAPTCHA 驗證失敗，已拒絕發送',
      codes: data['error-codes'] || [],
    };
  }

  if (expectedAction && data.action && data.action !== expectedAction) {
    return { ok: false, error: 'reCAPTCHA 動作不符，已拒絕發送', action: data.action };
  }

  if (typeof data.score === 'number' && data.score < threshold) {
    console.warn('[reCAPTCHA] 分數過低', { score: data.score, threshold });
    return {
      ok: false,
      error: '疑似機器人操作（reCAPTCHA 分數過低），已拒絕發送',
      score: data.score,
    };
  }

  return { ok: true, score: data.score, action: data.action };
}

module.exports = {
  getRecaptchaSiteKey,
  recaptchaConfigured,
  isRecaptchaDevBypass,
  getRecaptchaMinScore,
  verifyRecaptcha,
};
