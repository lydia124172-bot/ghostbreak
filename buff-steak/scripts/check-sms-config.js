require('dotenv').config();
const site = require('../data/site');
const {
  smsConfigured,
  getReservationNotifyPhones,
  getFranchiseNotifyPhone,
  normalizePhone,
  isSmsTestMode,
} = require('../services/sms');

console.log('');
console.log('========================================');
console.log('  八斧牛排 — 簡訊設定檢查');
console.log('========================================');

if (isSmsTestMode()) {
  console.log('');
  console.log('⚠️  目前為測試模式（SMS_TEST_MODE=true）');
  console.log('   訂位簡訊不會發給店長，只發總部。');
}

if (!smsConfigured()) {
  console.log('');
  console.log('❌ Twilio 未設定完整');
  console.log('   請在 .env 設定：');
  console.log('   TWILIO_ACCOUNT_SID');
  console.log('   TWILIO_AUTH_TOKEN');
  console.log('   TWILIO_FROM_NUMBER');
  process.exit(1);
}

console.log('');
console.log('✅ Twilio 已設定');
console.log('');
console.log('【訂位簡訊】有人線上訂位時通知：');
site.locations.forEach((loc) => {
  const phones = getReservationNotifyPhones(loc);
  console.log(`  ${loc.name}`);
  phones.forEach((p) => console.log(`    → ${p} (${normalizePhone(p)})`));
});

console.log('');
console.log('【加盟簡訊】有人加盟詢問時通知：');
const franchisePhone = getFranchiseNotifyPhone();
console.log(`  → ${franchisePhone} (${normalizePhone(franchisePhone)})`);
console.log('');
console.log('若號碼正確，重開 start.bat 後送一筆測試即可。');
console.log('');
