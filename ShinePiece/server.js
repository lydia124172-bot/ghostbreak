const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { adminConfigured, login: adminLogin, requireAdmin } = require('./services/admin-auth');
const { publicConfig, loadContent, saveContent, upsertItem, removeItem, archiveCurrentMonth, archiveItem, flashItem, relistItem, deleteArchived, setQty, deductStock, restock, addWishCount } = require('./services/content');
const members = require('./services/members');
const journal = require('./services/journal');
const { parseListing } = require('./services/listing');
const { readListing } = require('./services/read-listing');
const { loadOrders, addOrder, removeOrder, findOrder, updateOrder } = require('./services/orders');
const { INQUIRE_EMAIL, initMail, sendMail, orderMail, partnerMail, wishMail, mailConfigured } = require('./services/mail');
const { METHODS, buildEcpay, verifyEcpay, instructions, publicPay, parseAmount } = require('./services/pay');

const PORT = Number(process.env.PORT || 3003);
const BASE_URL = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(DATA_DIR, 'uploads', 'products')
  : path.join(PUBLIC, 'uploads', 'products');

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => (req.path === '/api/admin/read-listing' ? next() : express.json({ limit: '1mb' })(req, res, next)));
app.use(express.urlencoded({ extended: true }));

const pages = {
  '/': 'index.html',
  '/shop': 'issue.html',
  '/issue': 'issue.html',
  '/live': 'issue.html',
  '/qr': 'qr.html',
  '/cart': 'cart.html',
  '/order': 'order.html',
  '/partner': 'partner.html',
  '/wish': 'wish.html',
  '/member': 'member.html',
  '/admin': 'admin.html',
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, site: publicConfig().name, admin: adminConfigured() });
});

app.get('/api/config', (_req, res) => {
  res.json(publicConfig());
});

app.post('/api/admin/login', (req, res) => {
  const result = adminLogin(req.body?.password);
  if (!result.ok) return res.status(401).json({ error: result.error });
  res.json({ token: result.token });
});

app.get('/api/admin/content', requireAdmin, (_req, res) => {
  res.json(loadContent());
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safeExt}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const ok = /\.(jpe?g|png|webp|gif)$/.test(ext) || /^image\/(jpeg|jpg|png|webp|gif)$/.test(mime);
    cb(ok ? null : new Error('請上傳 jpg、png、webp 或 gif'), ok);
  },
});

function listingBody(body) {
  return {
    id: body?.id,
    images: body?.images,
    image: body?.image,
    description: body?.description || body?.summary,
    summary: body?.description || body?.summary,
    filename: body?.filename,
    ...(body && 'qty' in body ? { qty: body.qty } : {}),
  };
}

app.post('/api/admin/upload', requireAdmin, (req, res) => {
  upload.array('photos', 12)(req, res, (err) => {
    if (err) {
      const error = err.code === 'LIMIT_FILE_SIZE' ? '單張圖片請小於 8MB' : (err.message || '圖片上傳失敗');
      return res.status(400).json({ error });
    }
    const files = (req.files || []).map((file) => ({
      url: `/uploads/products/${file.filename}`,
      name: path.parse(file.originalname || '').name,
    }));
    res.json({ files });
  });
});

app.post('/api/admin/read-listing', requireAdmin, express.json({ limit: '18mb' }), async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images.filter((x) => typeof x === 'string') : [];
    res.json(await readListing(images));
  } catch (err) {
    res.status(400).json({ error: err.message || '讀圖失敗' });
  }
});

app.post('/api/admin/preview-listing', requireAdmin, (req, res) => {
  res.json(parseListing(req.body?.text, req.body?.filename));
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const current = loadContent();
  const saved = saveContent({
    ...current,
    tagline: String(req.body.tagline || '').trim() || current.tagline,
    email: String(req.body.email || '').trim(),
    lineUrl: String(req.body.lineUrl || '').trim(),
    heroTitle: String(req.body.heroTitle || '').trim() || current.heroTitle,
    heroLead: String(req.body.heroLead || '').trim() || current.heroLead,
    monthLabel: String(req.body.monthLabel || '').trim(),
    liveWhen: String(req.body.liveWhen || '').trim() || current.liveWhen,
    liveNote: String(req.body.liveNote || '').trim(),
    themeTitle: String(req.body.themeTitle || '').trim(),
    themeOrigin: String(req.body.themeOrigin || '').trim(),
    themeVisual: String(req.body.themeVisual || '').trim() || current.themeVisual,
    nextTitle: String(req.body.nextTitle || '').trim(),
    nextNote: String(req.body.nextNote || '').trim(),
    coverLabel: String(req.body.coverLabel || '').trim(),
    coverEnglish: String(req.body.coverEnglish || '').trim(),
    pullQuote: String(req.body.pullQuote || '').trim(),
    countryHead: String(req.body.countryHead || '').trim(),
    countryLead: String(req.body.countryLead || '').trim(),
    shopLead: String(req.body.shopLead || '').trim(),
    shopEmpty: String(req.body.shopEmpty || '').trim(),
    col1Title: String(req.body.col1Title || '').trim(),
    col1Body: String(req.body.col1Body || '').trim(),
    col2Title: String(req.body.col2Title || '').trim(),
    col2Body: String(req.body.col2Body || '').trim(),
    col3Title: String(req.body.col3Title || '').trim(),
    col3Body: String(req.body.col3Body || '').trim(),
    liveTitle: String(req.body.liveTitle || '').trim(),
    archiveNote: String(req.body.archiveNote || '').trim(),
    wishLead: String(req.body.wishLead || '').trim(),
    coverVol: String(req.body.coverVol || '').trim(),
    origins: current.origins,
  });
  res.json({ success: true, content: saved });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, content: upsertItem('products', listingBody(req.body || {})) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '上架失敗' });
  }
});
app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, content: upsertItem('products', { ...listingBody(req.body || {}), id: req.params.id }) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '上架失敗' });
  }
});
app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  res.json({ success: true, content: removeItem('products', req.params.id) });
});
app.post('/api/admin/products/:id/archive', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, content: archiveItem(req.params.id) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '封存失敗' });
  }
});
app.post('/api/admin/rollover', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, content: archiveCurrentMonth() });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '換月失敗' });
  }
});
app.post('/api/admin/archive/:id/flash', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, content: flashItem(req.params.id) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '回鍋失敗' });
  }
});

app.post('/api/admin/archive/:id/relist', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, content: relistItem(req.params.id) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '重新上架失敗' });
  }
});
app.delete('/api/admin/archive/:id', requireAdmin, (req, res) => {
  res.json({ success: true, content: deleteArchived(req.params.id) });
});
app.patch('/api/admin/products/:id/qty', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, content: setQty(req.params.id, req.body?.qty) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '庫存更新失敗' });
  }
});

app.get('/api/admin/journal', requireAdmin, (_req, res) => {
  res.json({ posts: journal.loadPosts() });
});
app.post('/api/admin/journal', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, post: journal.savePost(req.body || {}) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '儲存失敗' });
  }
});
app.delete('/api/admin/journal/:id', requireAdmin, (req, res) => {
  journal.removePost(req.params.id);
  res.json({ success: true });
});

const ORDER_STATUSES = ['待付款', '已付款', '已出貨', '已完成', '已取消'];
app.get('/api/admin/orders', requireAdmin, (_req, res) => {
  res.json({ orders: loadOrders(), statuses: ORDER_STATUSES });
});
app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: '找不到訂單' });
  const patch = {};
  if (req.body?.status !== undefined) {
    const status = String(req.body.status || '').trim();
    if (order.kind === '零售訂單' && !ORDER_STATUSES.includes(status)) return res.status(400).json({ error: '狀態不正確' });
    patch.status = status.slice(0, 20);
    if (order.kind === '零售訂單') {
      if (status === '已取消' && !order.restocked) {
        restock(order.items);
        patch.restocked = true;
      } else if (status !== '已取消' && order.restocked) {
        try {
          deductStock(order.items);
        } catch (err) {
          return res.status(400).json({ error: `無法恢復訂單：${err.message}` });
        }
        patch.restocked = false;
      }
      if (status === '已出貨' && !order.shippedAt) patch.shippedAt = new Date().toISOString();
      if (status === '已付款' && !order.paidAt) patch.paidAt = new Date().toISOString();
    }
  }
  if (req.body?.trackingNo !== undefined) patch.trackingNo = String(req.body.trackingNo || '').trim().slice(0, 60);
  if (req.body?.adminNote !== undefined) patch.adminNote = String(req.body.adminNote || '').trim().slice(0, 500);
  res.json({ success: true, order: updateOrder(order.id, patch) });
});
app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const order = findOrder(req.params.id);
  if (order && order.kind === '零售訂單' && !order.restocked && !['已出貨', '已完成'].includes(order.status)) restock(order.items);
  res.json({ success: true, orders: removeOrder(req.params.id) });
});

function memberStats(list, orders) {
  return list.map((row) => {
    const mine = orders.filter((o) => o.memberId === row.id && o.kind === '零售訂單');
    const spent = mine.filter((o) => o.status !== '已取消').reduce((sum, o) => sum + (Number(o.amount) || parseAmount(o.items)), 0);
    return { ...members.publicMember(row), orderCount: mine.length, spent };
  });
}
app.get('/api/admin/members', requireAdmin, (_req, res) => {
  res.json({ members: memberStats(members.loadMembers(), loadOrders()) });
});
app.post('/api/admin/members/:id/reset', requireAdmin, (req, res) => {
  try {
    res.json({ success: true, tempPassword: members.resetPassword(req.params.id) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '重設失敗' });
  }
});
app.delete('/api/admin/members/:id', requireAdmin, (req, res) => {
  members.removeMember(req.params.id);
  res.json({ success: true });
});

const memberAttempts = new Map();
function memberThrottle(req, res, next) {
  const key = req.ip || 'x';
  const now = Date.now();
  const hits = (memberAttempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (hits.length >= 20) return res.status(429).json({ error: '嘗試太多次，請 15 分鐘後再試' });
  hits.push(now);
  memberAttempts.set(key, hits);
  next();
}
function currentMember(req) {
  return members.verifyToken(members.readMemberToken(req));
}
function requireMember(req, res, next) {
  const member = currentMember(req);
  if (!member) return res.status(401).json({ error: '請先登入會員' });
  req.member = member;
  next();
}
function memberOrders(id) {
  return loadOrders()
    .filter((o) => o.memberId === id && o.kind === '零售訂單')
    .map((o) => ({
      id: o.id,
      createdAt: o.createdAt,
      status: o.status,
      payment: o.payment,
      shipping: o.shipping,
      trackingNo: o.trackingNo || '',
      amount: Number(o.amount) || parseAmount(o.items),
      items: (o.items || []).map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    }));
}
app.post('/api/member/register', memberThrottle, (req, res) => {
  try {
    res.json(members.register(req.body || {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '註冊失敗' });
  }
});
app.post('/api/member/login', memberThrottle, (req, res) => {
  try {
    res.json(members.login(req.body || {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '登入失敗' });
  }
});
app.get('/api/member/me', requireMember, (req, res) => {
  res.json({ member: members.publicMember(req.member), orders: memberOrders(req.member.id) });
});
app.patch('/api/member/me', requireMember, (req, res) => {
  try {
    const body = req.body || {};
    if (body.newPassword) members.login({ email: req.member.email, password: body.oldPassword });
    res.json(members.updateProfile(req.member.id, body));
  } catch (err) {
    const msg = err.status === 401 ? '舊密碼不正確' : err.message;
    res.status(400).json({ error: msg || '更新失敗' });
  }
});

async function safeSendMail(opts) {
  try {
    return await sendMail(opts);
  } catch (err) {
    console.error('[Mail] 發送失敗', { to: opts.to, error: err.message });
    return { via: 'error', error: err.message };
  }
}

function contactFields(body, { phoneRequired = false } = {}) {
  const name = String(body?.name || '').trim();
  const phone = String(body?.phone || '').trim();
  const email = String(body?.email || '').trim();
  const message = String(body?.message || '').trim();
  if (!name) return { error: '請填寫姓名' };
  if (phoneRequired && !phone) return { error: '請填寫電話' };
  if (!phone && !email) return { error: '請留下電話或 Email' };
  if (message.length > 2000) return { error: '內容過長' };
  return { name, phone, email, message };
}

app.post('/api/order', async (req, res) => {
  const fields = contactFields(req.body, { phoneRequired: true });
  if (fields.error) return res.status(400).json({ error: fields.error });
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 30) : [];
  const catalog = Object.fromEntries((loadContent().products || []).map((p) => [p.id, p]));
  const cleanItems = items.map((row) => {
    const id = String(row.id || '').trim();
    const known = catalog[id];
    return {
      id,
      name: known ? (known.displayName || known.name) : String(row.name || '').trim().slice(0, 120),
      qty: Math.max(1, Math.min(99, Number(row.qty) || 1)),
      price: known ? known.price : String(row.price || '').trim().slice(0, 40),
      image: known ? known.image : String(row.image || '').trim().slice(0, 200),
    };
  }).filter((row) => row.name);
  const gone = cleanItems.filter((row) => !catalog[row.id]);
  if (gone.length) return res.status(400).json({ error: `「${gone[0].name}」已下架，請從購物車移除` });
  if (!cleanItems.length) return res.status(400).json({ error: '請先加入商品' });
  const shipping = String(req.body?.shipping || '宅配').trim().slice(0, 20);
  const allowedPay = METHODS.map((row) => row.id);
  const payment = String(req.body?.payment || '刷卡').trim().slice(0, 20);
  const address = String(req.body?.address || '').trim().slice(0, 200);
  const city = String(req.body?.city || '').trim().slice(0, 40);
  const storeBrand = String(req.body?.storeBrand || '').trim().slice(0, 20);
  const store = String(req.body?.store || '').trim().slice(0, 80);
  const storeId = String(req.body?.storeId || '').trim().slice(0, 40);
  if (!['宅配', '超商取貨'].includes(shipping)) return res.status(400).json({ error: '請選擇配送方式' });
  if (!allowedPay.includes(payment)) return res.status(400).json({ error: '請選擇付款方式' });
  if (shipping === '宅配' && !address) return res.status(400).json({ error: '請填寫收件地址' });
  if (shipping === '超商取貨' && (!storeBrand || !store)) return res.status(400).json({ error: '請填寫取件超商與門市' });
  try {
    deductStock(cleanItems);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const member = currentMember(req);
  if (member && shipping === '宅配') members.updateProfile(member.id, { phone: fields.phone, city, address });
  const entry = {
    id: `O-${Date.now()}`,
    createdAt: new Date().toISOString(),
    kind: '零售訂單',
    status: '待付款',
    shipping,
    payment,
    city,
    address,
    storeBrand,
    store,
    storeId,
    ...fields,
    email: fields.email || (member ? member.email : ''),
    memberId: member ? member.id : '',
    amount: parseAmount(cleanItems),
    items: cleanItems,
  };
  addOrder(entry);
  const pay = buildEcpay(entry, BASE_URL);
  if (pay) updateOrder(entry.id, { tradeNo: pay.fields.MerchantTradeNo, amount: pay.amount });
  const mail = await safeSendMail(orderMail(entry));
  res.json({
    success: true,
    mailed: mail.via !== 'error' && mail.via !== 'dry-run',
    id: entry.id,
    status: entry.status,
    pay,
    hint: instructions(entry),
    payReady: publicPay().ecpay,
  });
});

app.post('/api/pay/ecpay-return', (req, res) => {
  if (!verifyEcpay(req.body)) return res.status(400).send('0|Fail');
  const id = String(req.body.CustomField1 || '').trim();
  if (id && String(req.body.RtnCode) === '1') {
    updateOrder(id, { status: '已付款', paidAt: new Date().toISOString(), tradeNo: req.body.MerchantTradeNo });
  }
  res.send('1|OK');
});

app.post('/api/pay/ecpay-result', (req, res) => {
  const id = String(req.body?.CustomField1 || '').trim();
  const ok = String(req.body?.RtnCode) === '1';
  res.redirect(`/order?done=${encodeURIComponent(id)}&paid=${ok ? '1' : '0'}`);
});

app.post('/api/wish', async (req, res) => {
  const fields = contactFields(req.body);
  if (fields.error) return res.status(400).json({ error: fields.error });
  const productId = String(req.body?.productId || '').trim();
  const want = String(req.body?.want || '').trim().slice(0, 120);
  let productName = want;
  let origin = '';
  let duplicate = false;
  if (productId) {
    try {
      const result = addWishCount(productId, `${productId}:${(fields.email || fields.phone).toLowerCase()}`);
      productName = result.product.name;
      origin = result.product.origin;
      duplicate = result.duplicate;
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message || '許願失敗' });
    }
  }
  if (!productName) return res.status(400).json({ error: '請選擇過往商品，或寫下想再買的東西' });
  const entry = {
    id: `W-${Date.now()}`,
    createdAt: new Date().toISOString(),
    kind: '許願預購',
    status: duplicate ? '已登記' : '累積中',
    ...fields,
    message: fields.message || (origin ? `${origin}／${productName}` : productName),
    items: [{ id: productId, name: productName, qty: 1, price: '', image: '' }],
  };
  addOrder(entry);
  const mail = await safeSendMail(wishMail(entry));
  res.json({
    success: true,
    mailed: mail.via !== 'error' && mail.via !== 'dry-run',
    duplicate,
    message: duplicate ? '你已為這件商品許過願，累積人數維持不變。' : '已記入許願池。達一定人數後，會考慮回鍋快閃。',
  });
});

app.post('/api/partner', async (req, res) => {
  const fields = contactFields(req.body);
  if (fields.error) return res.status(400).json({ error: fields.error });
  if (!fields.message) return res.status(400).json({ error: '請簡述可帶貨的平台或經驗' });
  const entry = {
    id: `P-${Date.now()}`,
    createdAt: new Date().toISOString(),
    kind: '帶貨申請',
    area: String(req.body?.area || '').trim().slice(0, 40),
    ...fields,
    items: [],
  };
  addOrder(entry);
  const mail = await safeSendMail(partnerMail(entry));
  res.json({ success: true, mailed: mail.via !== 'error' && mail.via !== 'dry-run', id: entry.id });
});

function requestOrigin(req) {
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  if (host && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    return `${proto === 'http' ? 'https' : proto}://${host}`.replace(/\/$/, '');
  }
  return BASE_URL;
}

function escapeAttr(value) {
  return String(value || '').replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}

function withSocialMeta(html, origin, pagePath, imagePath) {
  if (/property=["']og:image["']/.test(html)) return html;
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const desc = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i)
    || [])[1] || '';
  const image = `${origin}${imagePath}`;
  const url = `${origin}${pagePath === '/' ? '/' : pagePath}`;
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(desc)}" />`,
    `<meta property="og:url" content="${escapeAttr(url)}" />`,
    `<meta property="og:image" content="${escapeAttr(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:secure_url" content="${escapeAttr(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
    `<link rel="image_src" href="${escapeAttr(image)}" />`,
  ].join('\n    ');
  return html.replace(/<\/title>/i, `</title>\n    ${tags}`);
}

function sendPage(req, res, file, status = 200) {
  const full = path.join(PUBLIC, file);
  if (!fs.existsSync(full)) {
    res.status(404).type('html').send('<h1>Not found</h1>');
    return;
  }
  const origin = requestOrigin(req);
  const html = withSocialMeta(fs.readFileSync(full, 'utf8'), origin, req.path || '/', '/og.jpg');
  res.status(status).type('html').send(html);
}

Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (req, res) => sendPage(req, res, file));
});
app.get('/item/:id', (req, res) => sendPage(req, res, 'item.html'));

function siteName() {
  return loadContent().name || '瑄品集選';
}
function seoOrigin(req) {
  return /^https:\/\//i.test(BASE_URL) ? BASE_URL : requestOrigin(req);
}
app.get('/journal', (req, res) => {
  res.type('html').send(journal.renderList(seoOrigin(req), siteName()));
});
app.get('/journal/:slug', (req, res) => {
  const post = journal.findPublished(req.params.slug);
  if (!post) return sendPage(req, res, '404.html', 404);
  res.type('html').send(journal.renderPost(post, seoOrigin(req), siteName()));
});

app.get('/sitemap.xml', (req, res) => {
  const origin = seoOrigin(req);
  const urls = [
    { loc: '/', freq: 'weekly' },
    { loc: '/issue', freq: 'weekly' },
    { loc: '/journal', freq: 'weekly' },
    { loc: '/wish', freq: 'monthly' },
    { loc: '/partner', freq: 'monthly' },
  ];
  (loadContent().products || []).forEach((p) => urls.push({ loc: `/item/${encodeURIComponent(p.id)}`, freq: 'weekly' }));
  journal.publishedPosts().forEach((post) => urls.push({ loc: `/journal/${encodeURIComponent(post.slug)}`, freq: 'monthly', lastmod: post.updatedAt || post.publishedAt }));
  const body = urls.map((u) => `  <url><loc>${origin}${u.loc}</loc>${u.lastmod ? `<lastmod>${String(u.lastmod).slice(0, 10)}</lastmod>` : ''}<changefreq>${u.freq}</changefreq></url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin.html\nDisallow: /member\nDisallow: /cart\nDisallow: /order\n\nUser-agent: Linespider\nAllow: /\n\nSitemap: ${seoOrigin(req)}/sitemap.xml\n`);
});

app.use('/uploads/products', express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC, { index: false }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  sendPage(req, res, '404.html', 404);
});

app.listen(PORT, async () => {
  await initMail();
  console.log(`Shine Piece  ${BASE_URL}`);
  console.log(`後台         ${BASE_URL}/admin`);
  console.log(`直播 QR      ${BASE_URL}/qr`);
  console.log(`訂單信箱 → ${INQUIRE_EMAIL || '未設定'}`);
  console.log(`Mail: ${mailConfigured() ? '已設定' : '未設定（請在 .env 放 RESEND_API_KEY）'}`);
});
