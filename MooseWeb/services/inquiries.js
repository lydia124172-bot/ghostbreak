const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'inquiries.json');

function loadInquiries() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveInquiries(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
}

function addInquiry(entry) {
  const list = loadInquiries();
  list.unshift(entry);
  saveInquiries(list.slice(0, 300));
  return entry;
}

function removeInquiry(id) {
  const list = loadInquiries().filter((row) => row.id !== id);
  saveInquiries(list);
  return list;
}

module.exports = {
  loadInquiries,
  addInquiry,
  removeInquiry,
};
