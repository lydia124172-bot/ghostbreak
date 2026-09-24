const crypto = require('crypto');

function merchantId() {
  return String(process.env.ECPAY_MERCHANT_ID || '').trim();
}

function hashKey() {
  return String(process.env.ECPAY_HASH_KEY || '').trim();
}

function hashIv() {
  return String(process.env.ECPAY_HASH_IV || '').trim();
}

function configured() {
  return Boolean(merchantId() && hashKey() && hashIv());
}

function isStage() {
  return String(process.env.ECPAY_STAGE || '').trim() === '1';
}

function checkoutUrl() {
  return isStage()
    ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
    : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
}

function urlencodeDotNet(str) {
  return encodeURIComponent(String(str))
    .replace(/'/g, '%27')
    .replace(/~/g, '%7e')
    .replace(/%20/g, '+');
}

function checkMacValue(params) {
  const keys = Object.keys(params)
    .filter((key) => key !== 'CheckMacValue')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  let raw = `HashKey=${hashKey()}`;
  keys.forEach((key) => { raw += `&${key}=${params[key]}`; });
  raw += `&HashIV=${hashIv()}`;
  raw = urlencodeDotNet(raw).toLowerCase();
  return crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
}

function verify(params) {
  const got = String(params.CheckMacValue || '').trim().toUpperCase();
  if (!got) return false;
  const copy = { ...params };
  delete copy.CheckMacValue;
  return checkMacValue(copy) === got;
}

function tradeDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function checkoutFields({ merchantTradeNo, amount, itemName, returnUrl, resultUrl, clientBackUrl, custom1, custom2 }) {
  if (!configured()) throw new Error('綠界尚未設定。');
  const fields = {
    MerchantID: merchantId(),
    MerchantTradeNo: String(merchantTradeNo).slice(0, 20),
    MerchantTradeDate: tradeDate(),
    PaymentType: 'aio',
    TotalAmount: String(Math.max(1, Math.round(Number(amount) || 0))),
    TradeDesc: '麋鹿網方案',
    ItemName: String(itemName || '商品短片方案').replace(/[#&]/g, ' ').slice(0, 200),
    ReturnURL: returnUrl,
    OrderResultURL: resultUrl,
    ClientBackURL: clientBackUrl,
    ChoosePayment: 'ALL',
    EncryptType: '1',
    CustomField1: String(custom1 || '').slice(0, 50),
    CustomField2: String(custom2 || '').slice(0, 50),
  };
  fields.CheckMacValue = checkMacValue(fields);
  return { action: checkoutUrl(), fields };
}

module.exports = { configured, isStage, verify, checkoutFields };
