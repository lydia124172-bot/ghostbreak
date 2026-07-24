/**
 * Privacy mode: signature required; delegate contact info never exposed.
 */
const OFFICIAL_SMS_DISPLAY = '+1 (855) 914-2394';

function getDomainName() {
  return String(process.env.DOMAIN_NAME || 'bafuholdings.com')
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '');
}

function getOfficialEmailAddress() {
  return `noreply@${getDomainName()}`;
}

function getOfficialEmailFrom() {
  return `GhostBreak Anonymous Delivery <${getOfficialEmailAddress()}>`;
}

function getOfficialSmsDisplay() {
  return OFFICIAL_SMS_DISPLAY;
}

function requireSenderNickname(senderNickname) {
  const nickname = String(senderNickname || '').trim();
  if (!nickname) {
    throw new Error('Please enter your signature (shown at the end of the message; recipients cannot see your real contact info).');
  }
  if (nickname.length > 32) {
    throw new Error('Signature must be 32 characters or fewer.');
  }
  return nickname;
}

function assertOutboundPrivacy({ letter, anonEmail }) {
  const body = String(letter || '');
  const delegateEmail = String(anonEmail || '').trim();

  if (delegateEmail && body.includes(delegateEmail)) {
    throw new Error('Privacy check failed: the message body must not include your email address.');
  }
}

function sanitizeDeliveryForClient(delivery) {
  if (!delivery) return delivery;
  const safe = {
    channel: delivery.channel,
    status: delivery.status || null,
    via: delivery.via || null,
    dryRun: Boolean(delivery.dryRun),
    virtual: Boolean(delivery.virtual),
    magicTest: Boolean(delivery.magicTest),
  };
  if (delivery.sid) safe.sid = delivery.sid;
  if (delivery.messageId) safe.messageId = delivery.messageId;
  if (delivery.pdfUrl) safe.pdfUrl = delivery.pdfUrl;
  if (delivery.failed) safe.failed = true;
  if (delivery.channel === 'delegate-confirmation' && delivery.to) {
    safe.to = delivery.to;
  }
  return safe;
}

module.exports = {
  getDomainName,
  getOfficialEmailFrom,
  getOfficialEmailAddress,
  OFFICIAL_SMS_DISPLAY,
  getOfficialSmsDisplay,
  requireSenderNickname,
  assertOutboundPrivacy,
  sanitizeDeliveryForClient,
};
