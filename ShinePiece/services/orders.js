const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'orders.json');

function loadOrders() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveOrders(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
}

function addOrder(entry) {
  const list = loadOrders();
  list.unshift(entry);
  saveOrders(list.slice(0, 400));
  return entry;
}

function removeOrder(id) {
  const list = loadOrders().filter((row) => row.id !== id);
  saveOrders(list);
  return list;
}

function findOrder(id) {
  return loadOrders().find((row) => row.id === id) || null;
}

function updateOrder(id, patch) {
  const list = loadOrders();
  const idx = list.findIndex((row) => row.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch };
  saveOrders(list);
  return list[idx];
}

module.exports = { loadOrders, addOrder, removeOrder, findOrder, updateOrder };
