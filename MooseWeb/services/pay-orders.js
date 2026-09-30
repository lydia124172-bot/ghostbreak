const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'pay-orders.json');

function load() {
  try {
    if (!fs.existsSync(FILE)) return { orders: [] };
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { orders: Array.isArray(data.orders) ? data.orders : [] };
  } catch {
    return { orders: [] };
  }
}

function save(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf8');
}

function createOrder({ accountId, email, planId, amount, planName, periodic = false }) {
  const store = load();
  const merchantTradeNo = `M${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`.slice(0, 20);
  const row = {
    id: crypto.randomUUID(),
    merchantTradeNo,
    accountId,
    email,
    planId,
    planName,
    amount: Number(amount) || 0,
    status: 'pending',
    tradeNo: '',
    created: Date.now(),
    paidAt: 0,
    periodic: Boolean(periodic),
    renewals: [],
    cancelledAt: 0,
  };
  store.orders.push(row);
  save(store);
  return row;
}

function findByTradeNo(merchantTradeNo) {
  return load().orders.find((row) => row.merchantTradeNo === merchantTradeNo) || null;
}

function markPaid(merchantTradeNo, tradeNo) {
  const store = load();
  const row = store.orders.find((item) => item.merchantTradeNo === merchantTradeNo);
  if (!row) return null;
  if (row.status === 'paid') return row;
  row.status = 'paid';
  row.tradeNo = String(tradeNo || '');
  row.paidAt = Date.now();
  save(store);
  return row;
}

function recordRenewal(merchantTradeNo, key) {
  const store = load();
  const row = store.orders.find((item) => item.merchantTradeNo === merchantTradeNo);
  if (!row) return { row: null, fresh: false };
  row.renewals = Array.isArray(row.renewals) ? row.renewals : [];
  if (row.renewals.some((r) => r.key === key)) return { row, fresh: false };
  row.renewals.push({ key, at: Date.now() });
  save(store);
  return { row, fresh: true };
}

function activeSubscription(accountId) {
  return load().orders
    .filter((row) => row.accountId === accountId && row.periodic && row.status === 'paid' && !row.cancelledAt)
    .sort((a, b) => b.paidAt - a.paidAt)[0] || null;
}

function markCancelled(merchantTradeNo) {
  const store = load();
  const row = store.orders.find((item) => item.merchantTradeNo === merchantTradeNo);
  if (!row) return null;
  row.cancelledAt = Date.now();
  save(store);
  return row;
}

module.exports = { createOrder, findByTradeNo, markPaid, recordRenewal, activeSubscription, markCancelled };
