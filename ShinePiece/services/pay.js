const crypto = require('crypto');

const MERCHANT_ID = String(process.env.ECPAY_MERCHANT_ID || '').trim();
const HASH_KEY = String(process.env.ECPAY_HASH_KEY || '').trim();
const HASH_IV = String(process.env.ECPAY_HASH_IV || '').trim();
const STAGE = String(process.env.ECPAY_MODE || 'stage').toLowerCase() !== 'prod';
const BANK_NAME = String(process.env.BANK_NAME || '').trim();
const BANK_CODE = String(process.env.BANK_CODE || '').trim();
const BANK_ACCOUNT = String(process.env.BANK_ACCOUNT || '').trim();

const METHODS = [
  { id: '刷卡', label: '刷卡（信用卡／Apple Pay／Google Pay）', note: '手機可走 Apple Pay、Google Pay。' },
  { id: '超商代碼', label: '超商代碼／條碼', note: '7-ELEVEN、全家、萊爾富、OK。' },
  { id: 'ATM虛擬帳號', label: 'ATM 虛擬帳號', note: '轉帳後自動對帳。' },
];

function ecpayReady() {
  return Boolean(MERCHANT_ID && HASH_KEY && HASH_IV);
}

function bankReady() {
  return Boolean(BANK_CODE && BANK_ACCOUNT);
}

function checkoutUrl() {
  return STAGE
    ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
    : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
}

function ecpayEncode(value) {
  return encodeURIComponent(String(value))
    .toLowerCase()
    .replace(/%2d/g, '-')
    .replace(/%5f/g, '_')
    .replace(/%2e/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2a/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%20/g, '+');
}

function checkMac(params) {
  const raw = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const str = `HashKey=${HASH_KEY}&${raw}&HashIV=${HASH_IV}`;
  return crypto.createHash('sha256').update(ecpayEncode(str)).digest('hex').toUpperCase();
}

function parseAmount(items) {
  return (items || []).reduce((sum, row) => {
    const n = Number(String(row.price || '').replace(/[^\d]/g, '')) || 0;
    const qty = Math.max(1, Number(row.qty) || 1);
    return sum + n * qty;
  }, 0);
}

function choosePayment(method) {
  if (method === '超商代碼') return 'CVS';
  if (method === 'ATM虛擬帳號') return 'ATM';
  return 'Credit';
}

function padTradeNo(id) {
  return String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(-19) || `S${Date.now()}`.slice(0, 20);
}

function buildEcpay(order, baseUrl) {
  const amount = parseAmount(order.items);
  if (!ecpayReady() || amount < 1) return null;
  const now = new Date();
  const tradeDate = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const itemName = (order.items || []).map((row) => row.name).join('#').slice(0, 180) || '瑄品集選本月開箱';
  const params = {
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: padTradeNo(order.id),
    MerchantTradeDate: tradeDate,
    PaymentType: 'aio',
    TotalAmount: String(amount),
    TradeDesc: '瑄品集選本月開箱',
    ItemName: itemName,
    ReturnURL: `${baseUrl}/api/pay/ecpay-return`,
    OrderResultURL: `${baseUrl}/api/pay/ecpay-result`,
    ClientBackURL: `${baseUrl}/order?done=${encodeURIComponent(order.id)}`,
    ChoosePayment: choosePayment(order.payment),
    EncryptType: '1',
    CustomField1: String(order.id || '').slice(0, 50),
  };
  params.CheckMacValue = checkMac(params);
  return { action: checkoutUrl(), fields: params, amount };
}

function verifyEcpay(body) {
  if (!ecpayReady() || !body || typeof body !== 'object') return false;
  const incoming = String(body.CheckMacValue || '');
  const params = { ...body };
  delete params.CheckMacValue;
  return incoming && incoming.toUpperCase() === checkMac(params);
}

function instructions(order) {
  if (order.payment === 'ATM虛擬帳號' && bankReady()) {
    return {
      title: '請轉帳至虛擬／對帳帳號',
      lines: [
        `${BANK_NAME || '銀行'} ${BANK_CODE} ${BANK_ACCOUNT}`,
        `金額請依訂單。單號 ${order.id} 請填入備註。`,
      ],
    };
  }
  if (order.payment === '超商代碼') {
    return {
      title: '超商代碼將寄到你的電話',
      lines: ['訂單已成立。金流開通後會立刻發送繳費代碼與條碼。'],
    };
  }
  return {
    title: '訂單已成立，請完成付款',
    lines: ['刷卡與行動支付導向金流頁。若尚未開通，我們會再傳付款連結。'],
  };
}

function publicPay() {
  return {
    methods: METHODS,
    ecpay: ecpayReady(),
    bank: bankReady(),
  };
}

module.exports = {
  METHODS,
  ecpayReady,
  bankReady,
  parseAmount,
  buildEcpay,
  verifyEcpay,
  instructions,
  publicPay,
};
