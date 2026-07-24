#!/usr/bin/env node
/**
 * Twilio LIVE 簡訊發送測試（含 GhostBreak 品牌模板）
 * 用法：npm run test:sms
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const {
  getTwilioDiagnostics,
  verifyTwilioLiveAccount,
  isValidMessageSid,
  isTwilioTrialAccount,
  getTwilioSmsMaxLength,
} = require('../services/twilio');
const { generateLetter, buildDeliverySmsBody, estimateSmsSegments, normalizePhone } = require('../services/letter');
const { sendAnonymousSms } = require('../services/messenger');

async function main() {
  const diag = getTwilioDiagnostics();

  console.log('\n=== Twilio LIVE 環境變數診斷 ===');
  console.log('ACCOUNT_SID :', diag.accountSid || '(未設定)');
  console.log('AUTH_TOKEN  :', diag.authTokenPreview);
  console.log('FROM (發送) :', diag.fromNumber || '(未設定)');
  console.log('TO (測試)   :', diag.testTo || '(未設定)');
  console.log('狀態        :', diag.ok ? '✅ 欄位完整' : '❌ 設定不完整');

  if (!diag.ok) {
    diag.issues.forEach((issue) => console.log('  -', issue));
    process.exit(1);
  }

  const account = await verifyTwilioLiveAccount();
  if (!account.ok) {
    account.issues.forEach((issue) => console.log('  -', issue));
    process.exit(1);
  }
  console.log('帳戶類型    :', account.type, `(${account.friendlyName})`);

  const trialMode = isTwilioTrialAccount();
  const maxLength = getTwilioSmsMaxLength();
  console.log('Trial 模式  :', trialMode ? `是（單段上限 ${maxLength} 字）` : '否（完整簡訊）');

  const testTo = normalizePhone(diag.testTo);
  if (!testTo) {
    console.error('\n❌ TWILIO_TEST_TO 無效');
    process.exit(1);
  }

  const { letter } = generateLetter({ tone: 'gentle', exName: '小美' });
  const wrappedBody = buildDeliverySmsBody(letter, { senderNickname: '測試署名', trialMode, maxLength });

  console.log('\n=== 簡訊內文（含品牌模板）===');
  console.log(wrappedBody);
  console.log('---');
  console.log('字數        :', wrappedBody.length);
  console.log('預估段數    :', estimateSmsSegments(wrappedBody));
  console.log('含品牌前綴  :', wrappedBody.includes('[GhostBreak]') ? '✅' : '❌');
  console.log('含官方聲明    :', wrappedBody.includes('斷捨離官方聲明') ? '✅' : '❌');
  console.log('含署名      :', wrappedBody.includes('測試署名') ? '✅' : '❌');

  console.log('\n=== 開始 LIVE 發送 ===');
  console.log('From:', diag.fromNumber);
  console.log('To  :', testTo);

  const result = await sendAnonymousSms({
    to: testTo,
    text: letter,
    orderId: `TEST-${Date.now()}`,
    senderNickname: '測試署名',
  });

  if (result.virtual) {
    console.error('\n❌ Twilio 未就緒，僅寫入虛擬日誌:', result.twilioIssues);
    process.exit(1);
  }

  if (!isValidMessageSid(result.sid)) {
    console.error('\n❌ API 回傳無有效 SID:', result.sid);
    process.exit(1);
  }

  console.log('\n✅ 簡訊發送成功！');
  console.log('Message SID:', result.sid);
  console.log('Status     :', result.status);
  console.log('Response:');
  console.log(JSON.stringify({
    sid: result.sid,
    status: result.status,
    from: result.from,
    to: result.to,
  }, null, 2));
}

main().catch((err) => {
  console.error('\n❌ 測試失敗:', err.message);
  if (err.twilioError) console.error('Twilio Error:', JSON.stringify(err.twilioError, null, 2));
  process.exit(1);
});
