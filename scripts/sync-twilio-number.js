#!/usr/bin/env node
/**
 * 從 Twilio API 抓取真實 +1 Incoming 號碼並寫入 .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

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

async function main() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    console.error('缺少 TWILIO_ACCOUNT_SID 或 TWILIO_AUTH_TOKEN');
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);
  const incoming = await client.incomingPhoneNumbers.list({ limit: 20 });
  const usNumbers = incoming
    .map((n) => n.phoneNumber)
    .filter((p) => String(p).startsWith('+1') && !String(p).includes('500555'));

  if (!usNumbers.length) {
    console.error('❌ 帳戶內找不到真實 +1 Incoming Phone Number');
    console.error('   請至 Twilio Console → Phone Numbers → Manage → Active numbers 確認');
    process.exit(1);
  }

  const fromNumber = usNumbers[0];
  upsertEnvValue('TWILIO_PHONE_NUMBER', fromNumber);
  upsertEnvValue('TWILIO_FROM_NUMBER', fromNumber);

  console.log('✅ 已切換為 Twilio 真實美國號碼');
  console.log('   TWILIO_PHONE_NUMBER =', fromNumber);
  console.log('   TWILIO_FROM_NUMBER  =', fromNumber);
  if (usNumbers.length > 1) {
    console.log('   其他可用號碼:', usNumbers.slice(1).join(', '));
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
