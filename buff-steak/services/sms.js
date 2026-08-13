const twilio = require('twilio');

function env(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

function normalizePhone(raw) {
  let p = String(raw || '').trim().replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return `+${p.slice(2)}`;
  if (p.startsWith('886')) return `+${p}`;
  if (/^09\d{8}$/.test(p)) return `+886${p.slice(1)}`;
  if (/^9\d{8}$/.test(p)) return `+886${p}`;
  if (/^1\d{10}$/.test(p)) return `+${p}`;
  return `+${p}`;
}

function getFromNumber() {
  return env('TWILIO_FROM_NUMBER') || env('TWILIO_PHONE_NUMBER') || env('TWILIO_FROM');
}

function smsConfigured() {
  return Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && getFromNumber());
}

function isTrialMode() {
  const raw = env('TWILIO_TRIAL_MODE').toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return env('NODE_ENV').toLowerCase() !== 'production';
}

function getMaxLength() {
  return isTrialMode() ? 70 : 1500;
}

let client = null;

function getClient() {
  if (!smsConfigured()) return null;
  if (!client) {
    client = twilio(env('TWILIO_ACCOUNT_SID'), env('TWILIO_AUTH_TOKEN'));
  }
  return client;
}

function splitPhones(raw) {
  return String(raw || '').split(/[,;|\s]+/).map((s) => s.trim()).filter(Boolean);
}

function getManagerPhones(locationId) {
  const site = require('../data/site');
  const loc = site.locations.find((l) => String(l.id) === String(locationId || '').trim());
  if (loc?.managerPhone) return splitPhones(loc.managerPhone);

  const id = String(locationId || '').trim();
  if (!id) return [];
  const upper = id.toUpperCase();
  const raw = env(`${upper}_MANAGER_PHONE`) || env(`MANAGER_PHONE_${upper}`);
  return splitPhones(raw);
}

function getManagerPhone(locationId) {
  return getManagerPhones(locationId)[0] || '';
}

function getGlobalNotifyPhones() {
  const raw = env('RESERVE_NOTIFY_PHONES') || env('ALL_STORES_NOTIFY_PHONE');
  if (!raw) return [];
  return raw.split(/[,;|\s]+/).map((s) => s.trim()).filter(Boolean);
}

function isSmsTestMode() {
  return env('SMS_TEST_MODE').toLowerCase() === 'true';
}

function dedupePhones(phones) {
  const seen = new Set();
  return phones.filter((phone) => {
    const normalized = normalizePhone(phone);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function getReservationNotifyPhones(loc) {
  // 總部改收 Email，簡訊只發給店長
  if (isSmsTestMode()) return [];

  return dedupePhones(getManagerPhones(loc.id));
}

function shortLocationName(name) {
  if (name.includes('深坑')) return '深坑';
  if (name.includes('士林')) return '士林';
  return String(name).replace(/^八斧/, '').replace(/店$/, '');
}

function formatDateShort(date) {
  const parts = String(date).split('-');
  if (parts.length !== 3) return date;
  return `${parts[1]}/${parts[2]}`;
}

function buildReservationSms(entry, loc) {
  const shortLoc = shortLocationName(loc.name);
  const dateShort = formatDateShort(entry.date);
  const notes = entry.notes ? ` 備註:${entry.notes.slice(0, 16)}` : '';
  const body = `【八斧訂位】${shortLoc} ${dateShort} ${entry.time} ${entry.guests}人 ${entry.name} ${entry.phone}${notes}`;
  return body.slice(0, getMaxLength());
}

async function sendSms({ to, body, referenceId }) {
  const toE164 = normalizePhone(to);
  if (!toE164) throw new Error(`無效手機號碼：${to}`);

  const smsBody = String(body || '').slice(0, getMaxLength());
  const twilioClient = getClient();
  const from = getFromNumber();

  if (!twilioClient) {
    console.log('[SMS] dry-run — Twilio 未設定', { to: toE164, referenceId, body: smsBody });
    return { via: 'dry-run', to: toE164 };
  }

  const msg = await twilioClient.messages.create({
    from,
    to: toE164,
    body: smsBody,
  });

  console.log('[SMS] 簡訊已發送', { sid: msg.sid, to: msg.to, referenceId });
  return { via: 'twilio', sid: msg.sid, to: msg.to };
}

function getFranchiseNotifyPhone() {
  // 加盟詢問改由總部 Email 接收，不再發簡訊
  return '';
}

function buildFranchiseSms(entry) {
  const parts = [
    '【八斧加盟】',
    entry.name,
    entry.phone,
    entry.city,
  ];
  if (entry.budget) parts.push(`預算${entry.budget}`);
  if (entry.experience) parts.push(entry.experience);
  const body = parts.join(' ');
  return body.slice(0, getMaxLength());
}

function buildGuestReserveSms(entry, loc) {
  const shortLoc = shortLocationName(loc.name);
  const dateShort = formatDateShort(entry.date);
  const body = `【八斧牛排】${entry.name}您好，已收到訂位（待確認）${shortLoc} ${dateShort} ${entry.time} ${entry.guests}人 單號${entry.id} 我們將電話確認`;
  return body.slice(0, getMaxLength());
}

function buildGuestFranchiseSms(entry) {
  const body = `【八斧牛排】${entry.name}您好，已收到加盟詢問 單號${entry.id} 我們將盡快與您聯繫`;
  return body.slice(0, getMaxLength());
}

async function sendGuestReserveSms(entry, loc) {
  if (!entry.phone) return null;
  try {
    return await sendSms({
      to: entry.phone,
      body: buildGuestReserveSms(entry, loc),
      referenceId: `${entry.id}-guest`,
    });
  } catch (err) {
    console.error('[Reserve][Guest SMS]', err.message);
    return { via: 'error', error: err.message };
  }
}

async function sendGuestFranchiseSms(entry) {
  if (!entry.phone) return null;
  try {
    return await sendSms({
      to: entry.phone,
      body: buildGuestFranchiseSms(entry),
      referenceId: `${entry.id}-guest`,
    });
  } catch (err) {
    console.error('[Franchise][Guest SMS]', err.message);
    return { via: 'error', error: err.message };
  }
}

async function sendFranchiseSms(entry) {
  const phone = getFranchiseNotifyPhone();
  if (!phone) {
    return null;
  }

  const body = buildFranchiseSms(entry);
  try {
    return await sendSms({ to: phone, body, referenceId: entry.id });
  } catch (err) {
    console.error('[Franchise][SMS] 發送失敗', { phone, referenceId: entry.id, error: err.message });
    return { via: 'error', to: phone, error: err.message };
  }
}

async function sendReservationSms(entry, loc) {
  const body = buildReservationSms(entry, loc);
  const phones = getReservationNotifyPhones(loc);
  const results = [];

  for (const phone of phones) {
    try {
      results.push(await sendSms({ to: phone, body, referenceId: entry.id }));
    } catch (err) {
      console.error('[SMS] 發送失敗', { phone, referenceId: entry.id, error: err.message });
      results.push({ via: 'error', to: phone, error: err.message });
    }
  }

  return results;
}

module.exports = {
  normalizePhone,
  smsConfigured,
  sendSms,
  sendFranchiseSms,
  sendReservationSms,
  sendGuestReserveSms,
  sendGuestFranchiseSms,
  getManagerPhone,
  getManagerPhones,
  getFranchiseNotifyPhone,
  getReservationNotifyPhones,
  buildReservationSms,
  buildFranchiseSms,
  buildGuestReserveSms,
  buildGuestFranchiseSms,
  getMaxLength,
  isTrialMode,
  isSmsTestMode,
  getFromNumber,
};
