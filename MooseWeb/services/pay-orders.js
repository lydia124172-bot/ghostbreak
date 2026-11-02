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

function createOrder({ accountId, email, planId, amount, planName, periodic = false, method = 'credit' }) {
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
    method: String(method || 'credit'),
    status: 'pending',
    tradeNo: '',
    created: Date.now(),
    paidAt: 0,
    periodic: Boolean(periodic),
    renewals: [],
    cancelledAt: 0,
    paymentInfo: null,
  };
  store.orders.push(row);
  save(store);
  return row;
}

function findByTradeNo(merchantTradeNo) {
  return load().orders.find((row) => row.merchantTradeNo === merchantTradeNo) || null;
}

function findByExternalId(externalId) {
  const key = String(externalId || '');
  if (!key) return null;
  return load().orders.find((row) => row.externalId === key) || null;
}

function setExternalId(merchantTradeNo, externalId) {
  const store = load();
  const row = store.orders.find((item) => item.merchantTradeNo === merchantTradeNo);
  if (!row) return null;
  row.externalId = String(externalId || '');
  save(store);
  return row;
}

function listPaid() {
  return load().orders
    .filter((row) => row.status === 'paid')
    .sort((a, b) => Number(b.paidAt || 0) - Number(a.paidAt || 0));
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

function stillOpen(expireDate) {
  const raw = String(expireDate || '').trim();
  if (!raw) return true;
  const stamp = /\d{1,2}:\d{2}/.test(raw)
    ? Date.parse(`${raw.replace(/\//g, '-').replace(' ', 'T')}+08:00`)
    : Date.parse(`${raw.replace(/\//g, '-')}T23:59:59+08:00`);
  return Number.isFinite(stamp) ? stamp > Date.now() : true;
}

function setPaymentInfo(merchantTradeNo, info) {
  const store = load();
  const row = store.orders.find((item) => item.merchantTradeNo === merchantTradeNo);
  if (!row || row.status === 'paid') return row || null;
  row.status = 'awaiting';
  row.paymentInfo = {
    bankCode: String(info.bankCode || ''),
    vAccount: String(info.vAccount || ''),
    paymentNo: String(info.paymentNo || ''),
    expireDate: String(info.expireDate || ''),
    paymentType: String(info.paymentType || ''),
  };
  if (info.tradeNo) row.tradeNo = String(info.tradeNo);
  save(store);
  return row;
}

function listAwaiting(accountId) {
  return load().orders.filter((row) => (
    row.accountId === accountId
    && row.status === 'awaiting'
    && stillOpen(row.paymentInfo && row.paymentInfo.expireDate)
  ));
}

function markCancelled(merchantTradeNo) {
  const store = load();
  const row = store.orders.find((item) => item.merchantTradeNo === merchantTradeNo);
  if (!row) return null;
  row.cancelledAt = Date.now();
  save(store);
  return row;
}

module.exports = { createOrder, findByTradeNo, findByExternalId, setExternalId, listPaid, markPaid, recordRenewal, activeSubscription, markCancelled, setPaymentInfo, listAwaiting };
