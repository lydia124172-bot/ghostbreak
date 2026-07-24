#!/usr/bin/env node
/**
 * 1. 從 Twilio API 抓取 Active From 號碼
 * 2. 寫入 .env 的 TWILIO_PHONE_NUMBER
 * 3. 對 TWILIO_TEST_TO 發送含品牌模板的測試簡訊
 *
 * 用法：npm run twilio:setup
 * 需先在 .env 填入 TWILIO_AUTH_TOKEN（32 字元 LIVE Token）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const twilio = require('twilio');
const { generateLetter } = require('../services/letter');
const { sendAnonymousSms } = require('../services/messenger');
const { isValidMessageSid } = require('../services/twilio');

const ENV_PATH = path.join(__dirname, '..', '.env');

function upsertEnvValue(key, value) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, 'm');
  content = regex.test(content)
    ? content.replace(regex, line)
    : `${content.trimEnd()}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  process.env[key] = value;
}

async function fetchActiveFromNumber(client) {
  const incoming = await client.incomingPhoneNumbers.list({ limit: 20 });
  const usNumbers = incoming.filter((n) => String(n.phoneNumber).startsWith('+1'));
  if (usNumbers.length) {
    console.log('[Twilio] Active +1 Incoming Numbers（SMS From）:');
    usNumbers.forEach((n) => console.log(`  - ${n.phoneNumber} (${n.friendlyName || 'n/a'})`));
    return usNumbers[0].phoneNumber;
  }

  if (incoming.length) {
    console.warn('[Twilio] 有號碼但非 +1，略過:', incoming.map((n) => n.phoneNumber).join(', '));
  }

  console.warn('[Twilio] 帳戶內沒有 +1 Incoming Phone Number。');
  const verified = await client.outgoingCallerIds.list({ limit: 20 });
  if (verified.length) {
    console.log('[Twilio] 已驗證的 Caller ID（僅能當收件測試，不能當 SMS From）:');
    verified.forEach((n) => console.log(`  - ${n.phoneNumber}`));
  }

  return null;
}

async function main() {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  const testTo = String(process.env.TWILIO_TEST_TO || '+886970205800').trim();
  upsertEnvValue('TWILIO_TEST_TO', testTo);

  console.log('\n=== Twilio 自動設定與發送 ===');
  console.log('ACCOUNT_SID:', accountSid || '(未設定)');
  console.log('AUTH_TOKEN :', authToken ? `****${authToken.slice(-4)}` : '(未設定)');
  console.log('TEST_TO    :', testTo);

  if (!accountSid || !authToken) {
    console.error('\n❌ 請先在 .env 填入 TWILIO_ACCOUNT_SID 與 TWILIO_AUTH_TOKEN（Show 後複製的 32 字元 Token）');
    process.exit(1);
  }

  if (!/^[a-f0-9]{32}$/i.test(authToken)) {
    console.error('\n❌ TWILIO_AUTH_TOKEN 格式錯誤（應為 32 字元 hex）。請勿貼入說明文字或 PayPal 密碼。');
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);
  const account = await client.api.accounts(accountSid).fetch();
  console.log('\n✅ LIVE 帳戶驗證成功:', account.friendlyName, `(${account.type})`);

  let fromNumber = String(process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || '').trim();
  if (fromNumber) {
    console.log('\n✅ 使用 .env From 號碼:', fromNumber);
  } else {
    fromNumber = await fetchActiveFromNumber(client);
  }
  if (!fromNumber) {
    console.error('\n❌ 找不到可用的 SMS From 號碼。');
    console.error('   Trial 帳戶需先購買 Twilio 號碼：console.twilio.com → Phone Numbers → Buy a number');
    console.error('   建議選擇美國 +1 號碼（含 SMS 功能）。已驗證的 +886 號碼只能當收件方，不能當發送方。');
    process.exit(1);
  }

  upsertEnvValue('TWILIO_PHONE_NUMBER', fromNumber);
  console.log('\n✅ 已寫入 .env → TWILIO_PHONE_NUMBER=' + fromNumber);

  const { letter } = generateLetter({ tone: 'gentle', exName: '小美' });
  console.log('\n=== 發送測試簡訊（含 GhostBreak 模板）===');
  console.log('From:', fromNumber);
  console.log('To  :', testTo);

  const result = await sendAnonymousSms({
    to: testTo,
    text: letter,
    orderId: `SETUP-${Date.now()}`,
  });

  if (result.virtual) {
    console.error('\n❌ 發送失敗（虛擬模式）:', result.twilioIssues);
    process.exit(1);
  }

  if (!isValidMessageSid(result.sid)) {
    console.error('\n❌ 無有效 Message SID:', result.sid);
    process.exit(1);
  }

  console.log('\n✅ 簡訊發送成功！');
  console.log('Message SID:', result.sid);
  console.log('Status     :', result.status);
  console.log(JSON.stringify({ sid: result.sid, status: result.status, from: result.from, to: result.to }, null, 2));
}

main().catch((err) => {
  console.error('\n❌ 失敗:', err.message);
  if (err.twilioError) console.error(JSON.stringify(err.twilioError, null, 2));
  process.exit(1);
});
