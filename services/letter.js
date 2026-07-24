/**
 * 分手信文案生成（含前任稱呼）
 */
const TONE_LABELS = {
  gentle: 'Gentle & Clear',
  cold: 'Firm & Final',
  grateful: 'Grateful Closure',
  honest: 'Honest & Direct',
  compassionate: 'Warm & Kind',
  brief: 'Short & Simple',
};

const VALID_TONES = Object.keys(TONE_LABELS);

const BRAND_SIGNATURE = 'GhostBreak Anonymous Delivery';
const SMS_OFFICIAL_STATEMENT = '[GhostBreak Official Closure Notice]';
const SMS_TRIAL_OFFICIAL_TAG = '[Official Closure]';
const DELIVERY_DISCLAIMER = 'This is an anonymous message from your ex, delivered on their behalf by GhostBreak.';
const SMS_A2P_BRAND_PREFIX = '[GhostBreak] ';
const TWILIO_DEFAULT_TO = '+886970205800';

const LETTER_BODIES = {
  gentle: `I want to tell you this in the calmest, most honest way I can: our relationship needs to end here. I've thought about this for a long time. This isn't a rash decision — it's the responsible choice for both of us.

You were an important part of my life, and I truly value the time we shared. But I also know that staying together would only leave us both more exhausted. I didn't want to hurt you with silence or ghosting, so I'm choosing to be clear.

From this point on, we're walking separate paths. Please take care of yourself, and please respect my decision — we're no longer right for each other as partners. You don't need to reply. A little space is the best goodbye we can give the past.

Wishing you well.`,

  cold: `Our relationship is over. This is final. There is no room for discussion, and it will not change.

Don't try to win me back, explain yourself, or ask why. I've already made my decision: we're not meant to continue.

Please do not contact me again. I will not respond to future messages. This is not a negotiation — it's a notice.

Take care. We go our separate ways from here.`,

  grateful: `As I write this, I'm filled with gratitude. Thank you for being part of my life and for the real, good moments we shared.

But our paths have diverged. Rather than force something that no longer fits, I'd rather be honest — we both deserve partners and futures that are right for us.

I'm saying goodbye with warmth and respect. I hope life brings you kindness and ease. Please treat this as a full stop: no reply needed, no further contact. I'll hold these memories with care and keep moving forward.

With thanks and good wishes.`,

  honest: `I'm not going to dress this up: I don't see us working out anymore, and I need to end this relationship.

This isn't about finding someone to blame. I've thought it through, and staying together wouldn't be fair to either of us. I owe you the truth instead of dragging things out.

I hope you can hear this without extra drama. I'm asking for space, and I won't be continuing this as your partner. Please don't try to change my mind — the decision is made.

I wish you well.`,

  compassionate: `I care about you, and that's exactly why this is so hard to write.

What we had mattered to me. I don't want you to think this comes from anger or indifference — it comes from knowing we're not building the same future anymore. That truth hurts, but pretending wouldn't be kind to either of us.

Please be gentle with yourself in the days ahead. You deserve love that feels steady and mutual. I'm stepping back so we can both find that.

With care and respect.`,

  brief: `I need to end our relationship. This is my final decision.

Please don't contact me to discuss it further. I won't be responding.

Thank you for understanding. Take care.`,
};

function buildOpening(exName, tone) {
  const name = String(exName || '').trim();
  if (name) return `Hi ${name},`;
  if (tone === 'cold' || tone === 'brief') return 'Hi, I need to say something:';
  return 'Hi,';
}

function formatSenderSignature(senderNickname) {
  const name = String(senderNickname || '').trim();
  if (!name) return '';
  return `—— Final notice from ${name}`;
}

function appendSenderSignature(letter, senderNickname) {
  const nickname = String(senderNickname || '').trim();
  if (!nickname) return String(letter || '').trim();
  const signature = formatSenderSignature(nickname);
  const core = String(letter || '').trim();
  if (core.includes(signature)) return core;
  return `${core}\n\n${signature}`;
}

function generateLetter({ tone, exName, senderNickname }) {
  const key = VALID_TONES.includes(tone) ? tone : 'gentle';
  const opening = buildOpening(exName, key);
  const body = LETTER_BODIES[key];
  const nickname = String(senderNickname || '').trim();
  const letterCore = `${opening}\n\n${body}`;
  const letter = nickname ? appendSenderSignature(letterCore, nickname) : letterCore;

  return {
    success: true,
    provider: 'local',
    tone: key,
    toneLabel: TONE_LABELS[key],
    exName: String(exName || '').trim() || null,
    senderNickname: nickname || null,
    letter,
  };
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/** 正規化為 Twilio E.164 格式（支援台灣 09xx、+886、美國 +1） */
function normalizePhone(raw) {
  let p = String(raw || '').trim().replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return `+${p.slice(2)}`;
  if (p.startsWith('886')) return `+${p}`;
  if (/^09\d{8}$/.test(p)) return `+886${p.slice(1)}`;
  if (/^9\d{8}$/.test(p)) return `+886${p}`;
  if (/^1\d{10}$/.test(p)) return `+${p}`;
  if (/^\d{10}$/.test(p)) return `+1${p}`;
  return `+${p}`;
}

/**
 * 將國碼與本地號碼組成 E.164（前端表單用）
 */
function composeE164(countryCode, localNumber) {
  const cc = String(countryCode || '').trim();
  let local = String(localNumber || '').trim().replace(/[\s\-()]/g, '');
  if (!local) return null;
  if (local.startsWith('+')) return normalizePhone(local);
  if (!cc.startsWith('+')) return normalizePhone(`${cc}${local}`);
  if (cc === '+886' && local.startsWith('0')) local = local.slice(1);
  if (cc === '+1' && local.startsWith('1') && local.length === 11) local = local.slice(1);
  return normalizePhone(`${cc}${local}`);
}

function parseContact(exContact) {
  const raw = String(exContact || '').trim();
  if (!raw) return { email: null, phone: null };
  if (raw.includes('|')) {
    const [emailPart, phonePart] = raw.split('|').map((s) => s.trim());
    return {
      email: isEmail(emailPart) ? emailPart : null,
      phone: normalizePhone(phonePart),
    };
  }
  if (isEmail(raw)) return { email: raw, phone: null };
  return { email: null, phone: normalizePhone(raw) };
}

/** Resolve ex email + phone from explicit fields or legacy exContact string. */
function resolveExContacts({ exContact, exEmail, exPhone } = {}) {
  const directEmail = String(exEmail || '').trim();
  const directPhone = normalizePhone(exPhone);
  if (directEmail || directPhone) {
    return {
      email: isEmail(directEmail) ? directEmail : null,
      phone: directPhone,
    };
  }
  return parseContact(exContact);
}

/**
 * 依付費方案決定發送管道（planId 優先；詳見 services/plans.js）
 * @deprecated 請改用 resolvePlanDelivery from services/plans
 */
function resolveDeliveryChannels({ exContact, planId }) {
  const { email: exEmail, phone: exPhone } = parseContact(exContact);
  const { resolvePlanDelivery } = require('./plans');
  const { sendEmail, sendSms } = resolvePlanDelivery({ planId, exEmail, exPhone });
  return { sendEmail, sendSms, exEmail, exPhone };
}

function hasMinimumContactFields({ anonEmail, exContact }) {
  const hasAnonEmail = isEmail(anonEmail);
  const { email: exEmail, phone: exPhone } = parseContact(exContact);
  return {
    ok: hasAnonEmail || Boolean(exEmail) || Boolean(exPhone),
    hasAnonEmail,
    exEmail,
    exPhone,
  };
}

/** 正式發送 Email 純文字模板（含品牌署名與說明） */
function wrapDeliveryEmailBody(letter) {
  const core = String(letter || '').trim();
  return [
    BRAND_SIGNATURE,
    '',
    DELIVERY_DISCLAIMER,
    '',
    core,
    '',
    '——',
    BRAND_SIGNATURE,
  ].join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 正式發送 Email HTML + 純文字模板（含品牌包裝與使用者署名）
 * @param {string} content 信件正文（可已含「來自 XX 的最終通知」）
 * @param {string} [signature] 使用者署名／綽號（選填，若正文尚未包含則自動附加）
 */
function wrapDeliveryMailBody(content, signature) {
  let core = String(content || '').trim();
  const nickname = String(signature || '').trim();
  if (!nickname) {
    throw new Error('Signature is required (shown at the end of the message; your contact info stays private).');
  }
  if (!core.includes(`from ${nickname}`) && !core.includes(`Final notice from ${nickname}`)) {
    core = appendSenderSignature(core, nickname);
  }

  const text = wrapDeliveryEmailBody(core);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(BRAND_SIGNATURE)}</title>
</head>
<body style="margin:0;padding:0;background:#0c0a14;font-family:'Segoe UI',PingFang TC,'Microsoft JhengHei',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0c0a14;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#16141f;border:1px solid #2d2640;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 12px;background:linear-gradient(135deg,#5b21b6 0%,#312e81 100%);">
              <p style="margin:0;color:#e9d5ff;font-size:13px;letter-spacing:0.18em;">${escapeHtml(BRAND_SIGNATURE)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 8px;">
              <p style="margin:0 0 20px;color:#a1a1aa;font-size:14px;line-height:1.6;">${escapeHtml(DELIVERY_DISCLAIMER)}</p>
              <div style="color:#f4f4f5;font-size:15px;line-height:1.85;white-space:pre-wrap;">${escapeHtml(core)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 28px;border-top:1px solid #2d2640;">
              <p style="margin:16px 0 0;color:#a78bfa;font-size:12px;letter-spacing:0.1em;">—— ${escapeHtml(BRAND_SIGNATURE)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { html, text };
}

const { SURVIVAL_GUIDE_PATH } = require('./plans');

function buildDelegateReceiptMail({
  orderId,
  senderNickname,
  planName,
  baseUrl,
  includesPdf = false,
  emailCopy = null,
  smsCopy = null,
}) {
  const nickname = String(senderNickname || '').trim() || 'there';
  const pdfUrl = includesPdf
    ? `${String(baseUrl || '').replace(/\/$/, '')}${SURVIVAL_GUIDE_PATH}`
    : null;
  const subject = includesPdf
    ? '[GhostBreak] Order Confirmed — Delivery Copies + Survival Guide'
    : '[GhostBreak] Order Confirmed — Delivery Copies';

  const sections = [
    BRAND_SIGNATURE,
    '',
    `Hi ${nickname},`,
    '',
    `Your GhostBreak order (${planName}) has been processed. Below are exact copies of what we delivered to your ex. Your contact information was never shared with the recipient.`,
    '',
    `Order ID: ${orderId}`,
    '',
  ];

  if (emailCopy?.body) {
    sections.push(
      '—— EMAIL SENT TO YOUR EX ——',
      `To: ${emailCopy.to || '(recipient email)'}`,
      `Subject: ${emailCopy.subject || 'A letter for you'}`,
      '',
      emailCopy.body,
      '',
    );
  }

  if (smsCopy?.body) {
    sections.push(
      '—— SMS SENT TO YOUR EX ——',
      `To: ${smsCopy.to || '(recipient phone)'}`,
      '',
      smsCopy.body,
      '',
    );
  }

  if (pdfUrl) {
    sections.push(
      '—— YOUR SURVIVAL GUIDE (PDF) ——',
      pdfUrl,
      '',
    );
  }

  sections.push('——', BRAND_SIGNATURE);
  const text = sections.join('\n');

  const emailBlock = emailCopy?.body ? `
    <div style="margin:24px 0;padding:20px;border:1px solid #2d2640;border-radius:12px;">
      <p style="color:#a78bfa;font-size:12px;letter-spacing:0.1em;margin:0 0 12px;">EMAIL SENT TO YOUR EX</p>
      <p style="color:#71717a;font-size:12px;margin:0 0 12px;">To: ${escapeHtml(emailCopy.to || '')}<br/>Subject: ${escapeHtml(emailCopy.subject || '')}</p>
      <div style="color:#e4e4e7;font-size:14px;line-height:1.8;white-space:pre-wrap;">${escapeHtml(emailCopy.body)}</div>
    </div>` : '';

  const smsBlock = smsCopy?.body ? `
    <div style="margin:24px 0;padding:20px;border:1px solid #2d2640;border-radius:12px;">
      <p style="color:#a78bfa;font-size:12px;letter-spacing:0.1em;margin:0 0 12px;">SMS SENT TO YOUR EX</p>
      <p style="color:#71717a;font-size:12px;margin:0 0 12px;">To: ${escapeHtml(smsCopy.to || '')}</p>
      <div style="color:#e4e4e7;font-size:14px;line-height:1.8;white-space:pre-wrap;">${escapeHtml(smsCopy.body)}</div>
    </div>` : '';

  const pdfBlock = pdfUrl ? `
    <p style="color:#a1a1aa;line-height:1.7;margin-top:24px;">Your Emotional Detox Survival Guide:</p>
    <p style="margin:16px 0;">
      <a href="${escapeHtml(pdfUrl)}" style="display:inline-block;background:linear-gradient(135deg,#5b21b6,#312e81);color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">Download Survival Guide PDF</a>
    </p>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#0c0a14;font-family:'Segoe UI',system-ui,sans-serif;color:#f4f4f5;">
  <div style="max-width:560px;margin:0 auto;background:#16141f;border:1px solid #2d2640;border-radius:16px;padding:32px;">
    <p style="color:#a78bfa;font-size:13px;letter-spacing:0.12em;">${escapeHtml(BRAND_SIGNATURE)}</p>
    <h1 style="font-size:20px;margin:16px 0;">Order Confirmed</h1>
    <p style="color:#a1a1aa;line-height:1.7;">Hi ${escapeHtml(nickname)}, thank you for using GhostBreak. Here are the exact copies of your delivery:</p>
    ${emailBlock}
    ${smsBlock}
    ${pdfBlock}
    <p style="color:#71717a;font-size:12px;margin-top:24px;">Order ID: ${escapeHtml(orderId)}</p>
    <p style="color:#71717a;font-size:12px;">For your eyes only — your contact info was never shared with the recipient.</p>
    <p style="color:#a78bfa;font-size:12px;margin-top:24px;">—— ${escapeHtml(BRAND_SIGNATURE)}</p>
  </div>
</body>
</html>`;

  return { subject, text, html, pdfUrl };
}

/** @deprecated Use buildDelegateReceiptMail */
function buildBundleDelegateConfirmationMail({ orderId, senderNickname, baseUrl }) {
  return buildDelegateReceiptMail({
    orderId,
    senderNickname,
    planName: 'Premium Bundle — SMS + Email',
    baseUrl,
    includesPdf: true,
  });
}

/** 正式發送 SMS 正文模板（A2P 前綴 + 品牌署名 + 強制使用者署名） */
function estimateSmsSegments(body) {
  const text = String(body || '');
  const isUcs2 = /[^\x00-\x7F]/.test(text);
  const singleLimit = isUcs2 ? 70 : 160;
  const multiLimit = isUcs2 ? 67 : 153;
  if (text.length <= singleLimit) return 1;
  return Math.ceil(text.length / multiLimit);
}

/** Trial 帳戶：單段 UCS-2 上限 70 字，精簡版仍保留品牌前綴與署名 */
function buildTrialSmsBody(letter, { senderNickname, maxLength = 70 } = {}) {
  const nickname = String(senderNickname || '').trim();
  if (!nickname) {
    throw new Error('Signature is required (shown at the end of the SMS).');
  }

  const prefix = `${SMS_A2P_BRAND_PREFIX}${SMS_TRIAL_OFFICIAL_TAG}`;
  const suffix = `—${nickname}`;
  const overhead = prefix.length + suffix.length + 1;
  const budget = Math.max(0, maxLength - overhead);
  let core = String(letter || '').trim().replace(/\s+/g, ' ');
  if (core.length > budget) {
    core = `${core.slice(0, Math.max(0, budget - 1))}…`;
  }
  return `${prefix}${core}${suffix}`.slice(0, maxLength);
}

function buildDeliverySmsBody(letter, { senderNickname, maxLength = 1500, trialMode = false } = {}) {
  const nickname = String(senderNickname || '').trim();
  if (!nickname) {
    throw new Error('Signature is required (shown at the end of the SMS).');
  }

  if (trialMode || maxLength <= 70) {
    return buildTrialSmsBody(letter, { senderNickname: nickname, maxLength: Math.min(maxLength, 70) });
  }

  let core = appendSenderSignature(String(letter || '').trim(), nickname);
  const prefix = `${SMS_A2P_BRAND_PREFIX}${SMS_OFFICIAL_STATEMENT}\n${DELIVERY_DISCLAIMER}\n\n`;
  const suffix = `\n\n——\n${SMS_OFFICIAL_STATEMENT}`;
  const budget = maxLength - prefix.length - suffix.length;
  if (budget > 0 && core.length > budget) {
    core = `${core.slice(0, Math.max(0, budget - 1))}…`;
  } else if (budget <= 0) {
    core = core.slice(0, Math.max(0, maxLength - 1));
  }
  return `${prefix}${core}${suffix}`.slice(0, maxLength);
}

module.exports = {
  TONE_LABELS,
  VALID_TONES,
  BRAND_SIGNATURE,
  SMS_OFFICIAL_STATEMENT,
  SMS_TRIAL_OFFICIAL_TAG,
  DELIVERY_DISCLAIMER,
  SMS_A2P_BRAND_PREFIX,
  TWILIO_DEFAULT_TO,
  generateLetter,
  formatSenderSignature,
  appendSenderSignature,
  isEmail,
  normalizePhone,
  composeE164,
  parseContact,
  resolveExContacts,
  resolveDeliveryChannels,
  hasMinimumContactFields,
  wrapDeliveryEmailBody,
  wrapDeliveryMailBody,
  buildDeliverySmsBody,
  buildTrialSmsBody,
  estimateSmsSegments,
  buildBundleDelegateConfirmationMail,
  buildDelegateReceiptMail,
};
