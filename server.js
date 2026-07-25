require('dotenv').config();
const fs = require('fs');
const express = require('express');
const path = require('path');
const { TONE_LABELS, generateLetter, parseContact, resolveExContacts, normalizePhone, resolveDeliveryChannels, hasMinimumContactFields, wrapDeliveryMailBody } = require('./services/letter');
const {
  emailConfigured,
  resendConfigured,
  sendAnonymousEmail,
  sendAnonymousSms,
  sendDelegateReceipt,
  initEmailTransport,
  getTwilioDiagnostics,
  verifyTwilioLiveAccount,
  twilioLive,
} = require('./services/messenger');
const {
  requireSenderNickname,
  assertOutboundPrivacy,
  sanitizeDeliveryForClient,
} = require('./services/privacy');
const { loadOrders, findOrder, recordOrder } = require('./services/orders');
const { PLANS, getPlan, resolvePlanDelivery, validatePlanDelivery, SURVIVAL_GUIDE_PATH } = require('./services/plans');
const { getRecaptchaSiteKey, recaptchaConfigured, isRecaptchaDevBypass, getRecaptchaMinScore, verifyRecaptcha } = require('./services/recaptcha');
const { isTwilioTrialAccount, getTwilioSmsMaxLength } = require('./services/twilio');
const { getDomainName, getOfficialEmailFrom } = require('./services/privacy');

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const PAYPAL_MODE = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_API = PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const app = express();
app.use(express.json());

/** 已驗證的 PayPal 訂單（付款成功後才允許發送） */
const verifiedOrders = new Set();

let paypalToken = null;
let paypalTokenExpiry = 0;

/** PayPal 金鑰是否已設定（未設定時不影響伺服器啟動與免費預覽） */
function isPayPalConfigured() {
  return Boolean(String(PAYPAL_CLIENT_ID).trim() && String(PAYPAL_CLIENT_SECRET).trim());
}

/**
 * 取得 PayPal OAuth token。
 * 未設定金鑰時回傳 null，不拋錯、不阻斷其他路由。
 */
async function getPayPalToken() {
  if (!isPayPalConfigured()) return null;

  if (paypalToken && Date.now() < paypalTokenExpiry) return paypalToken;

  try {
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) {
      console.warn('[PayPal] auth failed:', data.error_description || data.message || tokenRes.status);
      return null;
    }
    paypalToken = data.access_token;
    paypalTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return paypalToken;
  } catch (err) {
    console.warn('[PayPal] token error:', err.message);
    return null;
  }
}

function extractExName(body = {}) {
  // 優先讀取前端標準欄位 exName，並相容舊版別名
  const raw = body.exName ?? body['ex-name'] ?? body.ex_name ?? '';
  return String(raw).trim();
}

function extractSenderNickname(body = {}) {
  const raw = body.senderNickname ?? body.sender_nickname ?? body['sender-nickname'] ?? '';
  return String(raw).trim();
}

function validateFormFields(body, { previewOnly = false } = {}) {
  const anonEmail = String(body.anonEmail || '').trim();
  const exContact = String(body.exContact || '').trim();
  const exName = extractExName(body);
  const senderNickname = extractSenderNickname(body);
  const tone = body.tone;

  if (!tone || !TONE_LABELS[tone]) return { error: 'Please select a tone.' };

  let normalizedNickname;
  try {
    normalizedNickname = requireSenderNickname(senderNickname);
  } catch (err) {
    return { error: err.message };
  }

  if (!previewOnly) {
    const contact = hasMinimumContactFields({ anonEmail, exContact });
    if (!contact.ok) {
      return { error: 'Please enter your anonymous email or your ex\'s contact info (email or phone).' };
    }
    if (!contact.exEmail && !contact.exPhone) {
      return { error: 'Please enter a valid email or phone number for your ex to enable delivery.' };
    }
  }

  const { email: resolvedEmail, phone: resolvedPhone } = resolveExContacts({
    exContact,
    exEmail: body.exEmail,
    exPhone: body.exPhone,
  });

  return {
    anonEmail,
    exContact,
    exEmail: resolvedEmail,
    exPhone: resolvedPhone,
    exName,
    senderNickname: normalizedNickname,
    tone,
  };
}

/** 免費預覽：零依賴 PayPal / Email / Twilio */
function handleGenerateLetter(req, res) {
  try {
    const body = req.body || {};
    const exName = extractExName(body);
    const fields = validateFormFields({ ...body, exName }, { previewOnly: true });
    if (fields.error) {
      return res.status(400).json({ success: false, error: fields.error });
    }

    const result = generateLetter({
      tone: fields.tone,
      exName: fields.exName,
      senderNickname: fields.senderNickname,
    });
    console.log('[Preview]', fields.tone, `req.body.exName=${JSON.stringify(body.exName)}`, `resolved=${exName || '(空)'}`, `senderNickname=${fields.senderNickname || '(空)'}`);
    return res.json({ ...result, exName: exName || null, senderNickname: fields.senderNickname || null });
  } catch (err) {
    console.error('[Preview] error:', err.message);
    return res.status(500).json({ success: false, error: 'Preview generation failed. Please try again.' });
  }
}

// ── API 路由（必須在 express.static 之前）────────────────────────────
app.post('/api/generate-letter', handleGenerateLetter);
app.post('/api/preview-letter', handleGenerateLetter);
app.post('/api/generate-preview', handleGenerateLetter);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    preview: true,
    paypalConfigured: isPayPalConfigured(),
    routes: [
      '/api/generate-letter',
      '/api/preview-letter',
      '/api/generate-preview',
      '/api/send-message',
      '/api/paypal/create-order',
      '/api/paypal/capture-order',
      '/api/paypal/register-capture',
    ],
    email: emailConfigured() ? 'live (ethereal/maildrop)' : 'starting',
    sms: twilioLive() ? 'live' : 'needs-token',
  });
});

app.get('/api/recaptcha-health', (_req, res) => {
  const siteKey = getRecaptchaSiteKey();
  res.json({
    ok: siteKey.charCodeAt(6) === 73,
    keyChar6: siteKey.charCodeAt(6),
    keyPrefix: siteKey.slice(0, 8),
    recaptchaEnabled: recaptchaConfigured(),
    hint: '金鑰已確認 CwIt(73)。若仍 Invalid site key，通常是網域未放行：請用 http://localhost:3000，並在 Google 後台加入 localhost 與 127.0.0.1',
  });
});

app.get('/api/config', (_req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.json({
    paypalClientId: PAYPAL_CLIENT_ID || null,
    paypalConfigured: isPayPalConfigured(),
    paypalMode: PAYPAL_MODE,
    paypalSandbox: PAYPAL_MODE !== 'live',
    devBypass: !isProduction && process.env.ALLOW_MOCK_PAY !== 'false',
    mockPayEnabled: !isProduction && process.env.ALLOW_MOCK_PAY !== 'false',
    plans: PLANS,
    messaging: {
      email: emailConfigured(),
      sms: twilioLive(),
    },
    twilioTrialMode: isTwilioTrialAccount(),
    twilioSmsMaxLength: getTwilioSmsMaxLength(),
    recaptchaSiteKey: getRecaptchaSiteKey() || null,
    recaptchaEnabled: recaptchaConfigured(),
    recaptchaDevBypass: isRecaptchaDevBypass(),
    setupHint: isPayPalConfigured()
      ? null
      : '請至 developer.paypal.com → Apps & Credentials → Sandbox → 建立 App，將 Client ID / Secret 填入 .env',
  });
});

/**
 * 付款成功後：匿名發送 Email / SMS
 * body: { orderId, planId, anonEmail, exContact, exName, tone, letter? }
 */
app.post('/api/send-message', async (req, res) => {
  try {
    const {
      orderId, planId, letter: clientLetter,
    } = req.body || {};

    console.log('[Send] 收到發信請求', { orderId, planId });

    if (!orderId || !verifiedOrders.has(orderId)) {
      console.warn('[Send] 未驗證訂單', { orderId, verified: verifiedOrders.has(orderId) });
      return res.status(402).json({
        success: false,
        error: 'Please complete PayPal payment verification before sending.',
      });
    }

    const plan = getPlan(planId);
    if (!plan?.paid) return res.status(400).json({ success: false, error: 'Invalid paid plan.' });

    const fields = validateFormFields(req.body);
    if (fields.error) return res.status(400).json({ success: false, error: fields.error });

    const { email: exEmail, phone: exPhone } = resolveExContacts(fields);
    const planError = validatePlanDelivery(planId, { exEmail, exPhone });
    if (planError) return res.status(400).json({ success: false, error: planError });

    if (!fields.anonEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.anonEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter your Anonymous Email to receive copies of the breakup email and/or SMS we send to your ex.',
      });
    }

    const letter = generateLetter({
      tone: fields.tone,
      exName: fields.exName,
      senderNickname: fields.senderNickname,
    }).letter;

    assertOutboundPrivacy({
      letter,
      anonEmail: fields.anonEmail,
    });

    if (recaptchaConfigured()) {
      const captcha = await verifyRecaptcha(req.body.recaptchaToken, {
        remoteIp: req.ip,
        expectedAction: 'submit',
      });
      if (!captcha.ok) {
        console.warn('[Send] reCAPTCHA 拒絕', captcha);
        return res.status(400).json({
          success: false,
          error: captcha.error || 'Bot verification failed. Send rejected.',
        });
      }
      console.log('[Send] reCAPTCHA 通過', { score: captcha.score ?? '(n/a)', action: captcha.action });
    }

    const { sendEmail, sendSms } = resolvePlanDelivery({ planId, exEmail, exPhone });
    const deliveries = [];
    let emailDelivery = null;
    let smsDelivery = null;
    let mailSubject = null;

    console.log('[Send] 發送管道', { planId, planAmount: plan.amount, sendEmail, sendSms, exEmail, exPhone });

    if (sendEmail) {
      if (!exEmail) {
        return res.status(400).json({
          success: false,
          error: 'Email plan: please enter your ex\'s email address.',
        });
      }
      mailSubject = fields.exName ? `A letter for ${fields.exName}` : 'A letter for you';
      console.log('[Send] Sending email via Resend...', { to: exEmail, orderId, subject: mailSubject });
      emailDelivery = await sendAnonymousEmail({
        to: exEmail,
        subject: mailSubject,
        text: letter,
        senderNickname: fields.senderNickname,
        orderId,
      });
      deliveries.push(emailDelivery);
    }

    if (sendSms) {
      if (!exPhone) {
        return res.status(400).json({
          success: false,
          error: 'SMS plan: please enter your ex\'s phone number.',
        });
      }

      console.log('[Send] Sending SMS via Twilio...', {
        to: exPhone,
        orderId,
        twilioLive: twilioLive(),
      });
      smsDelivery = await sendAnonymousSms({
        to: exPhone,
        text: letter,
        senderNickname: fields.senderNickname,
        orderId,
      });
      deliveries.push(smsDelivery);
    }

    const emailCopy = emailDelivery ? {
      to: exEmail,
      subject: mailSubject,
      body: wrapDeliveryMailBody(letter, fields.senderNickname).text,
    } : null;
    const smsCopy = smsDelivery?.smsBody ? {
      to: smsDelivery.to || normalizePhone(exPhone),
      body: smsDelivery.smsBody,
    } : null;

    console.log('[Send] Delegate receipt →', fields.anonEmail);
    try {
      deliveries.push(await sendDelegateReceipt({
        to: fields.anonEmail,
        orderId,
        senderNickname: fields.senderNickname,
        planName: plan.name,
        baseUrl: BASE_URL,
        includesPdf: Boolean(plan.includesPdf),
        emailCopy,
        smsCopy,
      }));
    } catch (err) {
      console.error('[Send] Delegate receipt failed:', err.message);
      deliveries.push({
        channel: 'delegate-confirmation',
        dryRun: true,
        failed: true,
        error: err.message,
      });
    }

    if (!deliveries.length) {
      return res.status(400).json({ success: false, error: 'No delivery channel available. Please check your plan and contact info.' });
    }

    verifiedOrders.delete(orderId);
    const sentViaTwilio = deliveries.some((d) => d.channel === 'sms' && d.sid && !d.virtual);
    const sentViaEmail = deliveries.some((d) => d.channel === 'email' && !d.dryRun);

    console.log('[Send]', planId, 'order', orderId, deliveries.map((d) => {
      if (d.channel === 'sms' && d.sid) return `sms:${d.virtual ? 'virtual-log' : d.sid}`;
      if (d.channel === 'email') return `email:${d.via || 'sent'}`;
      return d.channel;
    }));

    const savedOrder = recordOrder({
      orderId,
      planId,
      plan,
      fields,
      letter,
      exEmail,
      exPhone: exPhone ? normalizePhone(exPhone) : null,
      deliveries,
      sendEmail,
      sendSms,
      twilioLive: sentViaTwilio,
      smsFromE164: getTwilioDiagnostics().fromNumber || '+18559142394',
    });
    console.log('[Orders] saved → orders.json', savedOrder.id);

    const delegateDelivery = deliveries.find((d) => d.channel === 'delegate-confirmation');
    const delegateSent = delegateDelivery && !delegateDelivery.failed && !delegateDelivery.dryRun;

    let message;
    if (planId === 'bundle') {
      const parts = [];
      if (sentViaTwilio) parts.push('SMS sent to your ex via Twilio.');
      if (sentViaEmail) parts.push('Email sent to your ex via Resend.');
      if (delegateSent) {
        parts.push(`Delivery copies${plan.includesPdf ? ' + PDF' : ''} emailed to ${fields.anonEmail}. Check inbox and spam.`);
      } else if (delegateDelivery?.failed) {
        parts.push('Delivery copy email failed — contact support with your order ID.');
      }
      message = parts.join(' ') || 'Bundle order processed.';
    } else if (delegateSent) {
      const parts = [];
      if (sentViaTwilio) parts.push('SMS sent to your ex.');
      if (sentViaEmail) parts.push('Email sent to your ex.');
      parts.push(`Copies emailed to ${fields.anonEmail}. Check inbox and spam.`);
      message = parts.join(' ');
    } else if (sentViaTwilio) {
      message = 'SMS sent successfully via Twilio';
    } else if (sentViaEmail) {
      message = 'Email sent successfully via Resend';
    } else {
      message = 'Message delivered and logged to sent_logs.txt';
    }

    res.json({
      success: true,
      orderId,
      planId,
      deliveries: deliveries.map(sanitizeDeliveryForClient),
      dryRun: false,
      twilioLive: sentViaTwilio,
      emailLive: sentViaEmail,
      adminOrderId: savedOrder.id,
      message,
      pdfDownloadUrl: plan.includesPdf ? SURVIVAL_GUIDE_PATH : null,
      delegateEmailSent: Boolean(delegateSent),
    });
  } catch (err) {
    const errorDetail = {
      message: err.message,
      statusCode: err.statusCode || err.resendError?.statusCode || null,
      resendError: err.resendError || null,
    };
    console.error('[Send] error Response:', JSON.stringify(errorDetail, null, 2));
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      statusCode: errorDetail.statusCode,
    });
  }
});

app.get('/api/admin/orders', (_req, res) => {
  res.json({ success: true, orders: loadOrders() });
});

app.get('/api/admin/orders/:id', (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
  res.json({ success: true, order });
});

app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const fields = validateFormFields(req.body);
    if (fields.error) return res.status(400).json({ error: fields.error });
    const { planId } = req.body || {};
    const plan = getPlan(planId);
    if (!plan?.paid) return res.status(400).json({ error: 'Invalid paid plan.' });

    const token = await getPayPalToken();
    if (!token) {
      return res.status(503).json({
        error: 'PayPal is not configured or connection failed. Free preview still works.',
        paypalConfigured: isPayPalConfigured(),
      });
    }

    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: plan.amount },
          description: plan.name,
          custom_id: JSON.stringify({
            planId,
            exContact: fields.exContact,
            exName: fields.exName,
            senderNickname: fields.senderNickname,
            tone: fields.tone,
          }),
        }],
        application_context: {
          return_url: `${BASE_URL}/success.html`,
          cancel_url: `${BASE_URL}/?canceled=1`,
          brand_name: 'GhostBreak',
          user_action: 'PAY_NOW',
        },
      }),
    });
    const order = await orderRes.json();
    if (!orderRes.ok) throw new Error(order.message || '建立訂單失敗');
    res.json({ orderId: order.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 測試後門：略過 PayPal，直接觸發發送（僅開發環境） */
app.post('/api/paypal/mock-pay', async (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_MOCK_PAY === 'false') {
    return res.status(403).json({ error: 'Mock payment is disabled in production.' });
  }
  try {
    const fields = validateFormFields(req.body);
    if (fields.error) return res.status(400).json({ error: fields.error });
    const { planId } = req.body || {};
    const plan = getPlan(planId);
    if (!plan?.paid) return res.status(400).json({ error: 'Invalid paid plan.' });

    const { email: exEmail, phone: exPhone } = resolveExContacts(fields);
    const planError = validatePlanDelivery(planId, { exEmail, exPhone });
    if (planError) return res.status(400).json({ error: planError });
    if (!fields.anonEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.anonEmail)) {
      return res.status(400).json({
        error: 'Please enter your Anonymous Email to receive copies of the breakup email and/or SMS we send to your ex.',
      });
    }

    const orderId = `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    verifiedOrders.add(orderId);
    setTimeout(() => verifiedOrders.delete(orderId), 30 * 60 * 1000);

    console.log('[PayPal Mock] order', orderId, planId);
    res.json({ success: true, orderId, mock: true, verified: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/paypal/register-capture', (req, res) => {
  try {
    const { orderId, status } = req.body || {};
    if (!orderId) return res.status(400).json({ success: false, error: 'Missing orderId.' });
    if (status && status !== 'COMPLETED') {
      return res.status(400).json({ success: false, error: `Invalid payment status: ${status}` });
    }

    verifiedOrders.add(orderId);
    setTimeout(() => verifiedOrders.delete(orderId), 30 * 60 * 1000);

    console.log('[PayPal] client capture registered →', orderId, status || 'COMPLETED');
    res.json({ success: true, orderId, verified: true });
  } catch (err) {
    console.error('[PayPal] register-capture error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing orderId.' });

    const token = await getPayPalToken();
    if (!token) {
      return res.status(503).json({
        error: 'PayPal is not configured or connection failed. Free preview still works.',
        paypalConfigured: isPayPalConfigured(),
      });
    }

    const capRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const result = await capRes.json();
    if (!capRes.ok) throw new Error(result.message || '扣款失敗');

    verifiedOrders.add(orderId);
    setTimeout(() => verifiedOrders.delete(orderId), 30 * 60 * 1000);

    res.json({ success: true, orderId, status: result.status, verified: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function renderIndexHtml() {
  const template = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const siteKey = getRecaptchaSiteKey() || '';
  const buildId = String(Date.now());
  const sandboxBadgeClass = PAYPAL_MODE === 'live' ? 'hidden' : 'inline';
  return template
    .replaceAll('__RECAPTCHA_SITE_KEY__', siteKey)
    .replace('__BUILD_ID__', buildId)
    .replace('__SANDBOX_BADGE_CLASS__', sandboxBadgeClass);
}

app.get(['/', '/index.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(renderIndexHtml());
});

app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const siteKey = getRecaptchaSiteKey();
  if (siteKey.charCodeAt(6) !== 73) {
    console.error('[reCAPTCHA] 啟動檢查失敗：Site Key 第 7 字元不是大寫 I');
  } else {
    console.log('[reCAPTCHA] Site Key 字元檢查通過（CwIt 大寫 I）');
  }
  try {
    await initEmailTransport();
  } catch (err) {
    console.warn('[Email] 初始化失敗:', err.message);
  }

  const twilioDiag = getTwilioDiagnostics();
  if (twilioDiag.ok) {
    const account = await verifyTwilioLiveAccount();
    if (account.ok) {
      const trialNote = isTwilioTrialAccount() ? '｜單段簡訊（≤70字）' : '｜完整簡訊';
      console.log(`[SMS] Twilio LIVE 就緒 → From ${twilioDiag.fromNumber} (${account.type}${trialNote})`);
    } else {
      console.warn('[SMS] Twilio 憑證格式正確但 LIVE 驗證失敗:', account.issues?.[0]);
    }
  }

  console.log('\n======================================================');
  console.log('💜 GhostBreak — Email & SMS 匿名分手服務');
  console.log(`🔗 ${BASE_URL}`);
  console.log('📝 POST /api/generate-letter  （免費預覽，無需 PayPal）');
  console.log('📤 POST /api/send-message');
  console.log('📋 GET  /api/admin/orders  ·  /admin.html');
  console.log(`💳 PayPal: ${isPayPalConfigured() ? PAYPAL_MODE.toUpperCase() : '未設定（不影響預覽）'}`);
  console.log(`🌐 營運網域: ${getDomainName()}`);
  console.log(`📧 Email From: ${getOfficialEmailFrom()}`);
  console.log(`📧 Email: ${resendConfigured() ? 'LIVE（Resend 營運級）' : emailConfigured() ? 'LIVE（Ethereal / Maildrop MX）' : '初始化中…'}`);
  console.log(`📱 Twilio: ${twilioDiag.ok ? 'LIVE（真實發送）' : `未就緒 — ${twilioDiag.issues[0]}`}`);
  if (twilioDiag.ok) {
    const trialEnv = String(process.env.TWILIO_TRIAL_MODE || '(unset)').trim();
    console.log(`📱 Twilio SMS 模式: ${isTwilioTrialAccount() ? 'Trial 短簡訊（≤70字）' : '完整簡訊（≤1500字）'} | TWILIO_TRIAL_MODE=${trialEnv}`);
  }
  console.log(`🛡️  reCAPTCHA v3: ${isRecaptchaDevBypass() ? '本機略過（RECAPTCHA_DEV_BYPASS=true）' : recaptchaConfigured() ? `LIVE（min score ${getRecaptchaMinScore()}）` : '未設定（開發模式略過）'}`);
  if (!twilioDiag.ok) {
    console.log('   ↳ 填入 LIVE Auth Token、FROM (+1 虛擬號)、TO (Verified Caller ID) 後執行 npm run test:sms');
  }
  const survivalPdf = path.join(__dirname, 'public', SURVIVAL_GUIDE_PATH.replace(/^\//, ''));
  if (fs.existsSync(survivalPdf)) {
    console.log(`📕 生存指南 PDF: ${BASE_URL}${SURVIVAL_GUIDE_PATH}`);
  } else {
    console.warn(`📕 生存指南 PDF 尚未生成 → 執行 npm run generate:pdf（全套包確認信需要）`);
  }
  console.log('📄 sent_logs.txt · orders.json · /admin.html');
  console.log('======================================================\n');
});
