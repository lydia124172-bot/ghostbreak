#!/usr/bin/env node
/**
 * Print Render deploy checklist (no secrets).
 * Usage: node scripts/render-deploy-check.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const REQUIRED = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'RESEND_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'RECAPTCHA_SITE_KEY',
  'RECAPTCHA_SECRET_KEY',
];

const PRODUCTION = {
  NODE_ENV: 'production',
  BASE_URL: 'https://bafuholdings.com',
  DOMAIN_NAME: 'bafuholdings.com',
  PAYPAL_MODE: 'live',
  RECAPTCHA_DEV_BYPASS: 'false',
  ALLOW_MOCK_PAY: 'false',
};

console.log('\n=== GhostBreak → Render deploy checklist ===\n');

console.log('Production defaults (set in render.yaml):');
Object.entries(PRODUCTION).forEach(([k, v]) => console.log(`  ${k}=${v}`));

console.log('\nSecrets to paste in Render Dashboard → Environment:');
REQUIRED.forEach((key) => {
  const val = process.env[key];
  const ok = Boolean(String(val || '').trim() && !/your_|test_secret|^test$/i.test(String(val)));
  console.log(`  ${ok ? '✅' : '❌'} ${key}${ok ? ' (found in local .env)' : ' (missing or placeholder)'}`);
});

console.log('\nAfter deploy:');
console.log('  1. Render → Settings → Custom Domains → add bafuholdings.com');
console.log('  2. Cloudflare DNS → CNAME @ or www → your-app.onrender.com');
console.log('  3. Open https://bafuholdings.com/api/health');
console.log('  4. Test PayPal Sandbox checkout on the live site');
console.log('  5. Live mode: PAYPAL_MODE=live + Live Client ID/Secret from developer.paypal.com\n');
