#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { generateLetter } = require('../services/letter');
const { sendAnonymousEmail } = require('../services/messenger');

const TEST_TO = process.env.RESEND_TEST_TO || 'lydia124172@gmail.com';

async function main() {
  const { letter } = generateLetter({
    tone: 'gentle',
    exName: '小美',
    senderNickname: '阿明',
  });

  console.log('\n=== Resend HTML 模板發信測試 ===');
  console.log('TO:', TEST_TO);
  console.log('署名: 阿明');
  console.log('內文預覽（前 120 字）:', `${letter.slice(0, 120)}…`);

  const result = await sendAnonymousEmail({
    to: TEST_TO,
    subject: '給小美的一封信',
    text: letter,
    senderNickname: '阿明',
    orderId: `TEST-${Date.now()}`,
  });

  console.log('\n✅ 發信成功');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('\n❌ 發信失敗:', err.message);
  if (err.resendError) console.error(JSON.stringify(err.resendError, null, 2));
  process.exit(1);
});
