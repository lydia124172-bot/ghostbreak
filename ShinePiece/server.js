const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { adminConfigured, login: adminLogin, requireAdmin } = require('./services/admin-auth');
const { publicConfig, loadContent, saveContent, upsertItem, removeItem, archiveCurrentMonth, archiveItem, flashItem, addWishCount } = require('./services/content');
const { parseListing } = require('./services/listing');
const { loadOrders, addOrder, removeOrder, findOrder, updateOrder } = require('./services/orders');
const { INQUIRE_EMAIL, initMail, sendMail, orderMail, partnerMail, wishMail, mailConfigured } = require('./services/mail');
const { METHODS, buildEcpay, verifyEcpay, instructions, publicPay } = require('./services/pay');

const PORT = Number(process.env.PORT || 3003);
const BASE_URL = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(DATA_DIR, 'uploads', 'products')
  : path.join(PUBLIC, 'uploads', 'products');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
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

app.get('/api/admin/orders', requireAdmin, (_req, res) => {
  res.json({ orders: loadOrders() });
});
app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  res.json({ success: true, orders: removeOrder(req.params.id) });
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
  const cleanItems = items.map((row) => ({
    id: String(row.id || '').trim(),
    name: String(row.name || '').trim().slice(0, 120),
    qty: Math.max(1, Math.min(99, Number(row.qty) || 1)),
    price: String(row.price || '').trim().slice(0, 40),
    image: String(row.image || '').trim().slice(0, 200),
  })).filter((row) => row.name);
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

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin.html\n\nUser-agent: Linespider\nAllow: /\n');
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
