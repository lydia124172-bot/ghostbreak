const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { initMail, sendMail, mailConfigured } = require('../services/mail');
const { smsConfigured, sendSms } = require('../services/sms');

const TEST_PHONE = process.env.TEST_NOTIFY_PHONE || '0970205800';
const TEST_EMAIL = process.env.RESTAURANT_EMAIL || 'lydia3530@gmail.com';

async function main() {
  console.log('');
  console.log('=== 八斧牛排 通知測試 ===');
  console.log('Mail 設定:', mailConfigured() ? 'OK' : '未設定');
  console.log('SMS 設定:', smsConfigured() ? 'OK' : '未設定');
  console.log('測試手機:', TEST_PHONE);
  console.log('測試 Email:', TEST_EMAIL);
  console.log('');

  await initMail();

  try {
    const mailResult = await sendMail({
      to: TEST_EMAIL,
      subject: '八斧牛排測試信',
      text: '這是測試信。若收到代表 Email 設定正常。',
    });
    console.log('Email 結果:', mailResult);
  } catch (err) {
    console.error('Email 失敗:', err.message);
  }

  try {
    const smsResult = await sendSms({
      to: TEST_PHONE,
      body: '【八斧牛排】測試簡訊，若收到代表簡訊設定正常。',
      referenceId: 'TEST',
    });
    console.log('SMS 結果:', smsResult);
  } catch (err) {
    console.error('SMS 失敗:', err.message);
  }

  console.log('');
  console.log('測試完成。請檢查手機與信箱（含垃圾郵件）。');
  console.log('（省錢模式：不會發客人確認簡訊）');
}

main();
