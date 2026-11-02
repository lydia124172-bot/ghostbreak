const BANK = {
  bank: '彰化銀行',
  code: '009',
  branch: '士林分行',
  name: '利迪亞商行',
  account: '51788661256800',
};

function label() {
  return `${BANK.bank}（${BANK.code}）${BANK.branch}　戶名 ${BANK.name}　帳號 ${BANK.account}`;
}

module.exports = { BANK, label };
