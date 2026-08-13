require('dotenv').config();
const site = require('../data/site');
const {
  smsConfigured,
  getReservationNotifyPhones,
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
  console.log('   不會發店長簡訊；總部改收 Email。');
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
console.log('【總部】改收 Email（不發簡訊）');
console.log(`  → ${process.env.RESTAURANT_EMAIL || '未設定 RESTAURANT_EMAIL'}`);
console.log('');
console.log('【加盟】只寄總部 Email，不發簡訊');
console.log('');
console.log('若店長號碼正確，重開 start.bat 後送一筆測試即可。');
console.log('');
