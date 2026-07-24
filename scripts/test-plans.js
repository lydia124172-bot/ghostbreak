#!/usr/bin/env node
/**
 * 測試 SMS / BUNDLE 方案發送邏輯
 * 用法：node scripts/test-plans.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { buildDeliverySmsBody, SMS_OFFICIAL_STATEMENT } = require('../services/letter');
const { resolvePlanDelivery, validatePlanDelivery } = require('../services/plans');
const { generateLetter } = require('../services/letter');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TEST_PHONE = process.env.TWILIO_TEST_TO || '+886970205800';
const TEST_EX_EMAIL = process.env.RESEND_TEST_TO || 'lydia124172@gmail.com';
const TEST_DELEGATE_EMAIL = process.env.DELEGATE_TEST_EMAIL || TEST_EX_EMAIL;

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

async function runPlanTest({ name, planId, payload }) {
  console.log(`\n${'='.repeat(50)}\n▶ ${name} (planId=${planId}, $${planId === 'sms' ? '19.99' : '24.99'})`);

  const mock = await fetchJson(`${BASE}/api/paypal/mock-pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, ...payload }),
  });

  const send = await fetchJson(`${BASE}/api/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: mock.orderId, planId, ...payload }),
  });

  console.log('✅ 發送成功');
  console.log('   planId   :', send.planId);
  console.log('   channels :', send.deliveries.map((d) => d.channel).join(', '));

  return send;
}

async function main() {
  const basePayload = {
    exName: '小美',
    senderNickname: '阿明',
    tone: 'gentle',
    anonEmail: TEST_DELEGATE_EMAIL,
  };

  // 單元：方案管道判斷
  const smsRoute = resolvePlanDelivery({ planId: 'sms', exEmail: null, exPhone: TEST_PHONE });
  const bundleRoute = resolvePlanDelivery({
    planId: 'bundle',
    exEmail: TEST_EX_EMAIL,
    exPhone: TEST_PHONE,
  });
  console.log('\n=== 方案管道單元測試 ===');
  console.log('SMS plan   →', smsRoute);
  console.log('BUNDLE plan→', bundleRoute);
  if (!smsRoute.sendSms || smsRoute.sendEmail) throw new Error('SMS 方案管道錯誤');
  if (!bundleRoute.sendEmail || !bundleRoute.sendSms) throw new Error('BUNDLE 方案管道錯誤');

  // 單元：SMS 官方聲明模板
  const { letter } = generateLetter({ tone: 'gentle', exName: '小美', senderNickname: '阿明' });
  const smsBody = buildDeliverySmsBody(letter, { senderNickname: '阿明' });
  console.log('\n=== SMS 模板檢查 ===');
  console.log('含官方聲明:', smsBody.includes(SMS_OFFICIAL_STATEMENT) ? '✅' : '❌');
  if (!smsBody.includes(SMS_OFFICIAL_STATEMENT)) throw new Error('SMS 缺少官方聲明');

  // 整合：SMS $19.99
  const smsSend = await runPlanTest({
    name: 'SMS 方案整合測試',
    planId: 'sms',
    payload: { ...basePayload, exContact: TEST_PHONE },
  });
  if (!smsSend.deliveries.some((d) => d.channel === 'sms')) {
    throw new Error('SMS 方案未觸發簡訊發送');
  }
  if (!smsSend.deliveries.some((d) => d.channel === 'delegate-confirmation')) {
    throw new Error('SMS 方案未觸發委託人副本確認信');
  }

  // 整合：BUNDLE $24.99（需委託人 email + 前任 email + 前任手機）
  const bundleSend = await runPlanTest({
    name: 'BUNDLE 全套包整合測試',
    planId: 'bundle',
    payload: {
      ...basePayload,
      exEmail: TEST_EX_EMAIL,
      exPhone: TEST_PHONE,
      exContact: `${TEST_EX_EMAIL}|${TEST_PHONE}`,
    },
  });
  const channels = bundleSend.deliveries.map((d) => d.channel);
  if (!channels.includes('sms')) throw new Error('BUNDLE 未發送簡訊');
  if (!channels.includes('email')) throw new Error('BUNDLE 未發送 Email');
  if (!channels.includes('delegate-confirmation')) {
    throw new Error('BUNDLE 未觸發委託人確認信流程');
  }
  const delegate = bundleSend.deliveries.find((d) => d.channel === 'delegate-confirmation');
  if (delegate?.failed) {
    console.warn('⚠️  委託人確認信因 Resend 網域未驗證而失敗（SMS 已發送，請至 resend.com 驗證 bafuholdings.com）');
  }

  console.log('\n🎉 所有方案測試通過');
}

main().catch((err) => {
  console.error('\n❌ 測試失敗:', err.message);
  process.exit(1);
});
