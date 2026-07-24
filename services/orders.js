const fs = require('fs');
const path = require('path');
const { TONE_LABELS, wrapDeliveryMailBody, buildDeliverySmsBody } = require('./letter');
const {
  getOfficialEmailFrom,
  getOfficialEmailAddress,
  getOfficialSmsDisplay,
} = require('./privacy');
const { getTwilioFromNumber } = require('./twilio');

const ORDERS_PATH = path.join(__dirname, '..', 'orders.json');

function loadOrders() {
  try {
    if (!fs.existsSync(ORDERS_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
    return Array.isArray(raw.orders) ? raw.orders : [];
  } catch {
    return [];
  }
}

function saveOrders(orders) {
  fs.writeFileSync(ORDERS_PATH, JSON.stringify({ orders }, null, 2), 'utf8');
}

function findOrder(orderId) {
  return loadOrders().find((o) => o.id === orderId) || null;
}

function appendOrder(record) {
  const orders = loadOrders();
  orders.unshift(record);
  saveOrders(orders);
  return record;
}

function buildSmsBody(letter, senderNickname) {
  return buildDeliverySmsBody(letter, { senderNickname });
}

/**
 * 建立並寫入 orders.json 訂單紀錄
 */
function recordOrder({
  orderId,
  planId,
  plan,
  fields,
  letter,
  exEmail,
  exPhone,
  deliveries,
  sendEmail,
  sendSms,
  twilioLive,
  smsFromE164,
}) {
  const subject = fields.exName ? `A letter for ${fields.exName}` : 'A letter for you';
  const emailSent = sendEmail ?? deliveries?.some((d) => d.channel === 'email');
  const smsSent = sendSms ?? deliveries?.some((d) => d.channel === 'sms');

  const record = {
    id: orderId,
    createdAt: new Date().toISOString(),
    planId,
    planName: plan?.name || planId,
    amount: plan?.amount || null,
    exName: fields.exName || null,
    senderNickname: fields.senderNickname || null,
    exContact: fields.exContact,
    exEmail: exEmail || fields.exEmail || null,
    exPhone: exPhone || fields.exPhone || null,
    tone: fields.tone,
    toneLabel: TONE_LABELS[fields.tone],
    letter,
    /** 委託人聯絡方式：僅供後台 orders.json 內部紀錄，絕不對外發送 */
    delegateInternal: {
      anonEmail: fields.anonEmail || null,
    },
    email: emailSent && exEmail ? {
      from: getOfficialEmailFrom(),
      to: exEmail,
      subject,
      body: wrapDeliveryMailBody(letter, fields.senderNickname).text,
    } : null,
    sms: smsSent && exPhone ? {
      from: getOfficialSmsDisplay(),
      fromE164: smsFromE164 || getTwilioFromNumber() || getOfficialSmsDisplay(),
      to: exPhone,
      body: buildSmsBody(letter, fields.senderNickname),
    } : null,
    delegateConfirmation: deliveries?.find((d) => d.channel === 'delegate-confirmation') || null,
    deliveries,
    twilioLive: Boolean(twilioLive),
  };

  return appendOrder(record);
}

module.exports = {
  ORDERS_PATH,
  getOfficialSmsDisplay,
  getOfficialEmailAddress,
  loadOrders,
  findOrder,
  appendOrder,
  recordOrder,
};
