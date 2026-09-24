const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { adminConfigured, login: adminLogin, requireAdmin, isValidToken, readToken } = require('./services/admin-auth');
const { publicConfig, loadContent, saveContent, upsertItem, removeItem } = require('./services/content');
const { loadInquiries, addInquiry, removeInquiry } = require('./services/inquiries');
const { INQUIRE_EMAIL, initMail, sendMail, inquiryMail, resetMail, mailConfigured } = require('./services/mail');
const clipStore = require('./services/clip-store');
const clipPub = require('./services/clip-publish');
const clipShop = require('./services/clip-shop');
const clipCaption = require('./services/clip-caption');
const clipImage = require('./services/clip-image');
const clipVideo = require('./services/clip-video');
const clipMusic = require('./services/clip-music');
const clipTalk = require('./services/clip-talk');
const clipTts = require('./services/clip-tts');
const clipExport = require('./services/clip-export');
const storyVideo = require('./services/story-video');
const storyScript = require('./services/story-script');
const dramaVideo = require('./services/drama-video');
const dramaScript = require('./services/drama-script');
const scriptAgent = require('./services/script-agent');
const liveScript = require('./services/live-script');
const accounts = require('./services/accounts');
const ecpay = require('./services/ecpay');
const payOrders = require('./services/pay-orders');

const PORT = Number(process.env.PORT || 3002);
const BASE_URL = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const PUBLIC = path.join(__dirname, 'public');
const CLIP_CONNECT_OPEN = process.env.CLIP_CONNECT_OPEN === '1';
const DRAMA_OPEN = process.env.DRAMA_OPEN === '1';
const STORY_OPEN = process.env.STORY_OPEN === '1';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const pages = {
  '/': 'index.html',
  '/saas': 'saas.html',
  '/agents': 'agents.html',
  '/works': 'agents.html',
  '/courses': 'courses.html',
  '/hire': 'hire.html',
  '/match': 'match.html',
  '/research': 'research.html',
  '/ai': 'research.html',
  '/skills': 'skills.html',
  '/clip': 'clip.html',
  '/story': 'story.html',
  '/drama': 'drama.html',
  '/talk': 'talk.html',
  '/script': 'script.html',
  '/live': 'live.html',
  '/account': 'account.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
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
  res.append('Set-Cookie', `moose_owner=${result.token}; ${cookieFlags(req)}; Max-Age=43200`);
  res.json({ token: result.token });
});

app.post('/api/admin/logout', (req, res) => {
  res.append('Set-Cookie', `moose_owner=; ${cookieFlags(req)}; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/admin/content', requireAdmin, (_req, res) => {
  res.json({ ...loadContent(), reminders: accounts.adminNotes() });
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const current = loadContent();
  const kinds = String(req.body.workKinds || '')
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const saved = saveContent({
    ...current,
    tagline: String(req.body.tagline || '').trim() || current.tagline,
    email: String(req.body.email || '').trim(),
    lineUrl: String(req.body.lineUrl || '').trim(),
    heroTitle: String(req.body.heroTitle || '').trim() || current.heroTitle,
    heroLead: String(req.body.heroLead || '').trim() || current.heroLead,
    workKinds: kinds.length ? kinds : current.workKinds,
  });
  res.json({ success: true, content: saved });
});

const LISTS = ['courses', 'works', 'hire', 'products', 'faqs'];

LISTS.forEach((key) => {
  app.post(`/api/admin/${key}`, requireAdmin, (req, res) => {
    const saved = upsertItem(key, req.body || {});
    res.json({ success: true, content: saved });
  });
  app.patch(`/api/admin/${key}/:id`, requireAdmin, (req, res) => {
    const saved = upsertItem(key, { ...(req.body || {}), id: req.params.id });
    res.json({ success: true, content: saved });
  });
  app.delete(`/api/admin/${key}/:id`, requireAdmin, (req, res) => {
    const saved = removeItem(key, req.params.id);
    res.json({ success: true, content: saved });
  });
});

async function safeSendMail(opts) {
  try {
    return await sendMail(opts);
  } catch (err) {
    console.error('[Mail] 發送失敗', { to: opts.to, error: err.message });
    return { via: 'error', error: err.message };
  }
}

app.post('/api/inquire', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const email = String(req.body?.email || '').trim();
  const service = String(req.body?.service || '').trim();
  const message = String(req.body?.message || '').trim();
  if (!name) return res.status(400).json({ error: '請填寫姓名' });
  if (!phone && !email) return res.status(400).json({ error: '請留下電話或 Email' });
  if (!message) return res.status(400).json({ error: '請填寫諮詢內容' });
  if (message.length > 2000) return res.status(400).json({ error: '諮詢內容過長' });
  const entry = {
    id: `Q-${Date.now()}`,
    createdAt: new Date().toISOString(),
    name,
    phone,
    email,
    service,
    message,
  };
  addInquiry(entry);
  const mail = await safeSendMail(inquiryMail(entry));
  res.json({ success: true, mailed: mail.via !== 'error' && mail.via !== 'dry-run' });
});

app.get('/api/admin/inquiries', requireAdmin, (_req, res) => {
  res.json({ inquiries: loadInquiries() });
});

app.delete('/api/admin/inquiries/:id', requireAdmin, (req, res) => {
  res.json({ success: true, inquiries: removeInquiry(req.params.id) });
});

app.get('/api/admin/accounts', requireAdmin, (_req, res) => {
  res.json({ accounts: accounts.listAccounts(), plans: accounts.publicTree().plans });
});

app.post('/api/admin/accounts/plan', requireAdmin, (req, res) => {
  try {
    const account = accounts.grantPlan(req.body?.email, req.body?.plan);
    res.json({ success: true, account });
  } catch (err) {
    res.status(400).json({ error: err.message || '開通失敗' });
  }
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

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function clipSid(req, res) {
  const cookies = parseCookies(req);
  let sid = cookies.clip_sid;
  if (!sid || sid.length < 16) {
    sid = crypto.randomBytes(16).toString('hex');
    const secure = requestOrigin(req).startsWith('https://') ? '; Secure' : '';
    res.append('Set-Cookie', `clip_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000${secure}`);
  }
  return sid;
}

function cookieFlags(req) {
  const secure = requestOrigin(req).startsWith('https://') ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function setAccountCookie(req, res, sid) {
  res.append('Set-Cookie', `moose_sid=${sid}; ${cookieFlags(req)}; Max-Age=15552000`);
}

function clearAccountCookie(req, res) {
  res.append('Set-Cookie', `moose_sid=; ${cookieFlags(req)}; Max-Age=0`);
}

function currentAccount(req) {
  return accounts.getBySid(parseCookies(req).moose_sid);
}

function isOwner(req) {
  const cookie = parseCookies(req).moose_owner;
  return isValidToken(cookie) || isValidToken(readToken(req));
}

function sendAccount(req, res, payload, sid) {
  if (sid) setAccountCookie(req, res, sid);
  res.json(payload);
}

app.get('/api/account/me', (req, res) => {
  const row = currentAccount(req);
  res.json(row ? accounts.publicAccount(row) : { ok: false });
});

app.post('/api/account/register', (req, res) => {
  try {
    const result = accounts.register(req.body?.email, req.body?.password);
    sendAccount(req, res, result.account, result.sid);
  } catch (err) {
    res.status(400).json({ error: err.message || '註冊失敗' });
  }
});

app.post('/api/account/login', (req, res) => {
  try {
    const result = accounts.login(req.body?.email, req.body?.password);
    sendAccount(req, res, result.account, result.sid);
  } catch (err) {
    res.status(400).json({ error: err.message || '登入失敗' });
  }
});

app.post('/api/account/logout', (req, res) => {
  accounts.clearSession(parseCookies(req).moose_sid);
  clearAccountCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/account/forgot', async (req, res) => {
  const message = '若此 Email 已註冊，重設信將在幾分鐘內寄達。請查看收件匣與垃圾信件。';
  try {
    const result = accounts.requestReset(req.body?.email);
    if (result.found && result.token) {
      const origin = requestOrigin(req);
      const link = `${origin}/account?reset=${result.token}`;
      const mail = await safeSendMail(resetMail({ email: result.email, link }));
      if (mail?.via === 'error') {
        return res.status(503).json({ error: '重設信暫時寄不出。請稍後再試，或透過 LINE 聯繫。' });
      }
      if (/127\.0\.0\.1|localhost/i.test(origin)) {
        console.log('重設密碼（僅本機）', result.email);
      }
    }
    res.json({ ok: true, message });
  } catch (err) {
    res.status(400).json({ error: err.message || '無法寄出重設信' });
  }
});

app.post('/api/account/reset', (req, res) => {
  try {
    const result = accounts.resetPassword(req.body?.token, req.body?.password);
    sendAccount(req, res, result.account, result.sid);
  } catch (err) {
    res.status(400).json({ error: err.message || '無法重設密碼' });
  }
});

app.post('/api/account/plan', async (req, res) => {
  const row = currentAccount(req);
  if (!row) return res.status(401).json({ error: '請先登入' });
  try {
    const result = accounts.requestPlan(row, req.body?.plan);
    if (!result.granted) {
      const planName = result.plan?.name || String(req.body?.plan || '');
      const entry = {
        id: `P-${Date.now()}`,
        createdAt: new Date().toISOString(),
        name: row.email,
        phone: '',
        email: row.email,
        service: `${result.plan?.product === 'dramaclip' ? 'DramaClip' : result.plan?.product === 'storyclip' ? 'StoryClip' : 'MooseClip'} 方案 ${planName}`,
        message: `會員 ${row.email} 申請 ${planName}（${result.plan?.priceLabel || ''}）。請確認匯款或 LINE 後，於後台「會員方案」開通。`,
      };
      addInquiry(entry);
      await safeSendMail(inquiryMail(entry));
    }
    res.json({ success: true, account: result.account, message: result.message });
  } catch (err) {
    res.status(400).json({ error: err.message || '申請失敗' });
  }
});

app.get('/api/pay/status', (_req, res) => {
  res.json({ ecpay: ecpay.configured(), stage: ecpay.configured() && ecpay.isStage() });
});

app.post('/api/account/pay', express.json({ limit: '32kb' }), (req, res) => {
  const row = currentAccount(req);
  if (!row) return res.status(401).json({ error: '請先登入' });
  if (!ecpay.configured()) return res.status(503).json({ error: '線上付款尚未設定。可先用 LINE 申請。' });
  const plan = accounts.publicTree().plans.find((item) => item.id === String(req.body?.plan || '').trim());
  const full = require('./data/tree').plans.find((item) => item.id === String(req.body?.plan || '').trim());
  if (!full || !plan) return res.status(400).json({ error: '沒有這個方案' });
  if (full.product === 'storyclip') return res.status(400).json({ error: '劇本廣告建置中，尚未開放購買。' });
  if (full.product === 'dramaclip') return res.status(400).json({ error: 'AI短劇建置中，尚未開放購買。' });
  if (!full.price || full.id === 'free') return res.status(400).json({ error: '免費方案不必付款。' });
  try {
    const order = payOrders.createOrder({
      accountId: row.id,
      email: row.email,
      planId: full.id,
      amount: full.price,
      planName: full.name,
    });
    const checkout = ecpay.checkoutFields({
      merchantTradeNo: order.merchantTradeNo,
      amount: full.price,
      itemName: full.name,
      returnUrl: `${BASE_URL}/api/pay/ecpay/notify`,
      resultUrl: `${BASE_URL}/api/pay/ecpay/result`,
      clientBackUrl: `${BASE_URL}/account`,
      custom1: row.id,
      custom2: full.id,
    });
    res.json({ ok: true, action: checkout.action, fields: checkout.fields });
  } catch (err) {
    res.status(400).json({ error: err.message || '無法建立付款' });
  }
});

app.post('/api/pay/ecpay/notify', express.urlencoded({ extended: false }), (req, res) => {
  const body = req.body || {};
  if (!ecpay.configured() || !ecpay.verify(body)) {
    return res.status(400).type('text/plain').send('0|CheckMacValueError');
  }
  if (String(body.RtnCode) !== '1') {
    return res.type('text/plain').send('1|OK');
  }
  const order = payOrders.findByTradeNo(body.MerchantTradeNo);
  if (!order) return res.status(404).type('text/plain').send('0|OrderNotFound');
  if (order.status !== 'paid') {
    const amount = Number(body.TradeAmt || body.TotalAmount || 0);
    if (amount && amount !== Number(order.amount)) {
      return res.status(400).type('text/plain').send('0|AmountError');
    }
    payOrders.markPaid(order.merchantTradeNo, body.TradeNo);
    try { accounts.grantPlanById(order.accountId, order.planId); } catch { /* 訂單已記，後台可補開 */ }
  }
  return res.type('text/plain').send('1|OK');
});

app.post('/api/pay/ecpay/result', express.urlencoded({ extended: false }), (req, res) => {
  const body = req.body || {};
  const ok = ecpay.configured() && ecpay.verify(body) && String(body.RtnCode) === '1';
  return res.redirect(302, `${BASE_URL}/account?paid=${ok ? '1' : '0'}`);
});

app.get('/api/pay/ecpay/result', (_req, res) => {
  res.redirect(302, `${BASE_URL}/account`);
});

app.use([
  '/api/clip/connect',
  '/api/clip/oauth',
  '/api/clip/publish',
  '/api/clip/links',
  '/api/clip/schedule',
  '/api/clip/queue',
  '/api/clip/shop',
], (req, res, next) => {
  if (CLIP_CONNECT_OPEN) return next();
  if (req.method === 'GET' && String(req.get('accept') || '').includes('text/html')) {
    return res.redirect('/clip');
  }
  return res.status(503).json({ error: '商店連接與自動發文建置中，審核通過後開放。' });
});

app.get('/api/script/status', (req, res) => {
  const sid = clipSid(req, res);
  const guest = clipStore.guestScriptState(sid);
  res.json({
    ready: scriptAgent.configured(),
    left: guest.left,
    limit: guest.limit,
  });
});

app.post('/api/script', express.json({ limit: '8mb' }), async (req, res) => {
  const sid = clipSid(req, res);
  const guest = clipStore.guestScriptState(sid);
  if (!guest.left) {
    return res.status(402).json({
      error: `今日免費腳本已用完（${guest.limit} 則）。可明天再試，或使用付費工具做成短片。`,
      left: 0,
    });
  }
  try {
    const result = await scriptAgent.writeScript({
      product: String(req.body?.product || '').trim(),
      features: String(req.body?.features || '').trim(),
      mode: String(req.body?.mode || '').trim(),
      images: Array.isArray(req.body?.images) ? req.body.images : [],
    });
    const used = clipStore.consumeGuestScript(sid);
    res.json({ ...result, left: used.left, limit: used.limit });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '產出逾時，請再試一次' : (err.message || '產出失敗');
    res.status(400).json({ error: msg });
  }
});

app.get('/api/live/status', (req, res) => {
  const sid = clipSid(req, res);
  const guest = clipStore.guestScriptState(sid);
  res.json({
    ready: liveScript.configured(),
    left: guest.left,
    limit: guest.limit,
  });
});

app.post('/api/live', express.json({ limit: '200kb' }), async (req, res) => {
  const sid = clipSid(req, res);
  const guest = clipStore.guestScriptState(sid);
  if (!guest.left) {
    return res.status(402).json({
      error: `今日免費腳本已用完（${guest.limit} 則）。可明天再試。`,
      left: 0,
    });
  }
  try {
    const result = await liveScript.writeLive({
      industry: String(req.body?.industry || '').trim(),
      product: String(req.body?.product || '').trim(),
      notes: String(req.body?.notes || '').trim(),
    });
    const used = clipStore.consumeGuestScript(sid);
    res.json({ ...result, left: used.left, limit: used.limit });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '產出逾時，請再試一次' : (err.message || '產出失敗');
    res.status(400).json({ error: msg });
  }
});

app.get('/api/clip/status', (req, res) => {
  const sid = clipSid(req, res);
  const guest = clipStore.guestEnhanceState(sid);
  res.json({
    ...clipPub.status(sid),
    vision: clipCaption.configured(),
    enhance: clipImage.configured(),
    enhanceEngine: clipImage.engine(),
    video: clipVideo.configured(),
    videoEngine: clipVideo.engine(),
    videoDuration: clipVideo.videoDuration(),
    videoCredits: clipVideo.creditCost(),
    talk: clipTalk.configured(),
    talkEngine: clipTalk.engine(),
    talkCredits: clipTalk.creditCost(),
    tts: clipTts.configured(),
    owner: isOwner(req),
    guestEnhanceLeft: guest.left,
    guestEnhanceLimit: guest.limit,
  });
});

app.get('/api/clip/connect/:platform', (req, res) => {
  const sid = clipSid(req, res);
  const origin = requestOrigin(req);
  const platform = req.params.platform;
  const url = platform === 'tiktok' ? clipPub.tiktokAuthUrl(origin, sid) : clipPub.metaAuthUrl(origin, sid);
  if (!url) return res.status(400).type('html').send('目前無法連接此平台，請稍後再試或透過 LINE 聯繫。');
  res.redirect(url);
});

app.get('/api/clip/oauth/:platform/callback', async (req, res) => {
  try {
    await clipPub.handleOauth(req.params.platform, requestOrigin(req), req.query);
    res.redirect('/clip?connected=1');
  } catch (err) {
    res.redirect(`/clip?error=${encodeURIComponent(err.message || '授權失敗')}`);
  }
});

app.post('/api/clip/music-prompt', express.json({ limit: '200kb' }), async (req, res) => {
  try {
    const result = await clipCaption.writeMusicPrompt({
      product: String(req.body?.product || '').trim(),
      price: String(req.body?.price || '').trim(),
      hook: String(req.body?.hook || '').trim(),
      narration: String(req.body?.narration || '').trim(),
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || '配樂風格寫作失敗' });
  }
});

app.post('/api/clip/caption', express.json({ limit: '8mb' }), async (req, res) => {
  try {
    const result = await clipCaption.writeCaption({
      images: Array.isArray(req.body?.images) ? req.body.images : [],
      product: String(req.body?.product || '').trim(),
      price: String(req.body?.price || '').trim(),
      hook: String(req.body?.hook || '').trim(),
      style: String(req.body?.style || 'ugc'),
    });
    res.json(result);
  } catch (err) {
    const msg = err.name === 'AbortError' ? '識圖逾時，請再試一次' : (err.message || '識圖失敗');
    res.status(400).json({ error: msg });
  }
});

app.post('/api/clip/enhance', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  if (!owner && (!paid || !paid.credits)) {
    return res.status(402).json({
      error: '進階生圖需購買方案。作者請先到後台登入，即可直接使用，不必再註冊方案。',
    });
  }
  try {
    const result = await clipImage.enhance({
      images: Array.isArray(req.body?.images) ? req.body.images : [],
      product: String(req.body?.product || '').trim(),
      price: String(req.body?.price || '').trim(),
      hook: String(req.body?.hook || '').trim(),
      style: String(req.body?.style || 'ugc'),
    });
    if (owner) return res.json({ image: result.image, owner: true, engine: result.engine || '', recovered: Boolean(result.recovered) });
    const account = accounts.consumeCredit(row.id, 1);
    res.json({ image: result.image, credits: account.credits, engine: result.engine || '', recovered: Boolean(result.recovered) });
  } catch (err) {
    try {
      const recovered = await clipImage.recoverRecent();
      if (recovered && recovered.image) {
        if (owner) return res.json({ image: recovered.image, owner: true, engine: recovered.engine || '', recovered: true });
        if (row) {
          const account = accounts.consumeCredit(row.id, 1);
          return res.json({ image: recovered.image, credits: account.credits, engine: recovered.engine || '', recovered: true });
        }
        return res.json({ image: recovered.image, engine: recovered.engine || '', recovered: true });
      }
    } catch {
      /* fall through */
    }
    const msg = err.name === 'AbortError' ? '生圖逾時，請不要重按。' : (err.message || '生圖失敗');
    res.status(400).json({ error: msg });
  }
});

app.get('/api/clip/enhance/last', async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  if (!owner && (!paid || !paid.credits)) {
    return res.status(402).json({ error: '進階生圖需購買方案。' });
  }
  try {
    const recovered = await clipImage.recoverRecent();
    if (!recovered || !recovered.image) return res.status(404).json({ error: '沒有可取回的圖。' });
    res.json({ image: recovered.image, engine: recovered.engine || '', recovered: true, owner: Boolean(owner) });
  } catch (err) {
    res.status(400).json({ error: err.message || '取回失敗' });
  }
});

const VIDEO_JOB_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'clip-video-jobs.json');

function loadVideoJobs() {
  try {
    const rows = JSON.parse(fs.readFileSync(VIDEO_JOB_FILE, 'utf8'));
    return new Map(Object.entries(rows || {}));
  } catch {
    return new Map();
  }
}

const videoJobs = loadVideoJobs();

function saveVideoJobs() {
  const dir = path.dirname(VIDEO_JOB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VIDEO_JOB_FILE, JSON.stringify(Object.fromEntries(videoJobs), null, 2), 'utf8');
}

function pruneVideoJobs() {
  const cutoff = Date.now() - 40 * 60 * 1000;
  let changed = false;
  for (const [id, job] of videoJobs) {
    if (job.created < cutoff) {
      videoJobs.delete(id);
      changed = true;
    }
  }
  if (changed) saveVideoJobs();
}

function packVideoJob(job, saved, extra) {
  return {
    status: 'done',
    jobId: job.id,
    videoId: saved.id,
    videoUrl: `/api/clip/media/${saved.id}`,
    engine: 'wan',
    duration: job.duration || clipVideo.videoDuration(),
    ...extra,
  };
}

function latestReadyJob(sid, kind) {
  let latest = null;
  for (const job of videoJobs.values()) {
    if (!job || job.sid !== sid || !job.result || !job.result.videoId) continue;
    if (kind === 'talk' && job.kind !== 'talk') continue;
    if (kind !== 'talk' && job.kind === 'talk') continue;
    if (!clipStore.getMedia(job.result.videoId)) continue;
    if (!latest || job.created > latest.created) latest = job;
  }
  return latest;
}

app.post('/api/clip/video', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  const cost = clipVideo.creditCost();
  if (!owner && (!paid || Number(paid.credits || 0) < cost)) {
    return res.status(402).json({
      error: `小廣告需先到後台登入，或方案剩餘 ${cost} 點以上。`,
    });
  }
  try {
    const sid = clipSid(req, res);
    function loadAudio(id, label) {
      if (!id) return null;
      const media = clipStore.mediaOwned(id, sid) ? clipStore.getMedia(id) : null;
      if (!media) throw new Error(`找不到${label}，請重新選擇。`);
      return { buffer: fs.readFileSync(media.full), mime: media.mime };
    }
    let audio;
    let voice;
    try {
      audio = loadAudio(String(req.body?.audioId || '').trim(), '配樂');
      voice = loadAudio(String(req.body?.voiceId || '').trim(), '口播音檔');
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!audio) audio = clipMusic.loadPick(String(req.body?.musicPick || '').trim());
    const submitted = await clipVideo.submit({
      images: Array.isArray(req.body?.images) ? req.body.images : [],
      product: String(req.body?.product || '').trim(),
      price: String(req.body?.price || '').trim(),
      hook: String(req.body?.hook || '').trim(),
      style: String(req.body?.style || 'ugc'),
      audio,
      audioUrl: String(req.body?.audioUrl || '').trim(),
      voice,
      narration: String(req.body?.narration || '').trim(),
      duration: String(req.body?.duration || '').trim(),
    });
    pruneVideoJobs();
    const job = {
      id: crypto.randomUUID(),
      requestId: submitted.requestId,
      model: submitted.model,
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
      sid: clipSid(req, res),
      owner,
      accountId: row && row.id,
      cost,
      duration: submitted.duration,
      created: Date.now(),
      result: null,
      error: '',
    };
    videoJobs.set(job.id, job);
    saveVideoJobs();
    console.log('[clip-video] queued', submitted.duration + 's');
    res.json({ jobId: job.id, status: 'queued', duration: submitted.duration });
  } catch (err) {
    console.log('[clip-video] submit failed', err && err.message);
    res.status(400).json({ error: err.message || '生片失敗' });
  }
});

app.get('/api/clip/video/job/:jobId', async (req, res) => {
  pruneVideoJobs();
  const job = videoJobs.get(req.params.jobId);
  if (!job || job.sid !== clipSid(req, res)) {
    return res.status(404).json({ error: '找不到這次生片。請不要重按。' });
  }
  if (job.result) return res.json(job.result);
  if (job.error) return res.status(400).json({ error: job.error });
  try {
    const peek = await clipVideo.check(job);
    if (peek.status === 'failed') {
      job.error = peek.error || '生片失敗';
      saveVideoJobs();
      return res.status(400).json({ error: job.error });
    }
    if (peek.status !== 'done') return res.json({ jobId: job.id, status: peek.status });
    if (!job.saving) {
      job.saving = true;
      const videoUrl = peek.videoUrl;
      setImmediate(() => {
        clipVideo.finish(videoUrl).then((fileOut) => {
          const saved = clipStore.saveMedia(job.sid, 'video', fileOut.buffer, fileOut.mime || 'video/mp4');
          const extra = { recovered: false };
          if (job.owner) extra.owner = true;
          else if (job.accountId) {
            const account = accounts.consumeCredit(job.accountId, job.cost);
            extra.credits = account.credits;
          }
          job.result = packVideoJob(job, saved, extra);
          job.saving = false;
          saveVideoJobs();
        }).catch((err) => {
          job.error = err.message || '生片失敗';
          job.saving = false;
          saveVideoJobs();
          console.log('[clip-video] save failed', job.error);
        });
      });
    }
    return res.json({ jobId: job.id, status: 'saving' });
  } catch (err) {
    console.log('[clip-video] poll failed', err && err.message);
    res.status(400).json({ error: err.message || '生片失敗' });
  }
});

app.get('/api/clip/video/last', async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  const cost = clipVideo.creditCost();
  if (!owner && (!paid || Number(paid.credits || 0) < cost)) {
    return res.status(402).json({ error: '小廣告需先到後台登入，或方案有點數。' });
  }
  const local = latestReadyJob(clipSid(req, res), 'clip');
  if (local && local.result) {
    return res.json({ ...local.result, recovered: true });
  }
  try {
    const recovered = await clipVideo.recoverRecent();
    if (!recovered || !recovered.buffer) return res.status(404).json({ error: '沒有可取回的短片。' });
    const saved = clipStore.saveMedia(clipSid(req, res), 'video', recovered.buffer, recovered.mime || 'video/mp4');
    const extra = { recovered: true };
    if (owner) extra.owner = true;
    else if (paid) extra.credits = paid.credits;
    res.json({
      status: 'done',
      videoId: saved.id,
      videoUrl: `/api/clip/media/${saved.id}`,
      engine: recovered.engine || 'wan',
      duration: recovered.duration,
      ...extra,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || '取回失敗' });
  }
});

app.post('/api/talk/video', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  const cost = clipTalk.creditCost();
  if (!owner && (!paid || Number(paid.credits || 0) < cost)) {
    return res.status(402).json({
      error: `數字人出鏡需先到後台登入，或方案剩餘 ${cost} 點以上。`,
    });
  }
  try {
    const sid = clipSid(req, res);
    let voice;
    const voiceId = String(req.body?.voiceId || '').trim();
    if (voiceId) {
      const media = clipStore.mediaOwned(voiceId, sid) ? clipStore.getMedia(voiceId) : null;
      if (!media) return res.status(400).json({ error: '找不到口播音檔，請重新選擇。' });
      voice = { buffer: fs.readFileSync(media.full), mime: media.mime };
    }
    const submitted = await clipTalk.submit({
      images: Array.isArray(req.body?.images) ? req.body.images : [],
      narration: String(req.body?.narration || '').trim(),
      voice,
    });
    pruneVideoJobs();
    const job = {
      id: crypto.randomUUID(),
      requestId: submitted.requestId,
      model: submitted.model,
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
      sid,
      owner,
      accountId: row && row.id,
      cost,
      created: Date.now(),
      result: null,
      error: '',
      kind: 'talk',
    };
    videoJobs.set(job.id, job);
    saveVideoJobs();
    console.log('[clip-talk] queued');
    res.json({ jobId: job.id, status: 'queued' });
  } catch (err) {
    console.log('[clip-talk] submit failed', err && err.message);
    res.status(400).json({ error: err.message || '對嘴送出失敗' });
  }
});

app.get('/api/talk/video/job/:jobId', async (req, res) => {
  pruneVideoJobs();
  const job = videoJobs.get(req.params.jobId);
  if (!job || job.sid !== clipSid(req, res)) {
    return res.status(404).json({ error: '找不到這次對嘴。請不要重按。' });
  }
  if (job.result) return res.json(job.result);
  if (job.error) return res.status(400).json({ error: job.error });
  try {
    const peek = await clipVideo.check(job);
    if (peek.status === 'failed') {
      job.error = peek.error || '對嘴失敗';
      saveVideoJobs();
      return res.status(400).json({ error: job.error });
    }
    if (peek.status !== 'done') return res.json({ jobId: job.id, status: peek.status });
    if (!job.saving) {
      job.saving = true;
      const videoUrl = peek.videoUrl;
      setImmediate(() => {
        clipVideo.finish(videoUrl).then((fileOut) => {
          const saved = clipStore.saveMedia(job.sid, 'video', fileOut.buffer, fileOut.mime || 'video/mp4');
          const extra = { recovered: false, engine: 'sync3' };
          if (job.owner) extra.owner = true;
          else if (job.accountId) extra.credits = accounts.consumeCredit(job.accountId, job.cost).credits;
          job.result = packVideoJob(job, saved, extra);
          job.saving = false;
          saveVideoJobs();
        }).catch((err) => {
          job.error = err.message || '對嘴失敗';
          job.saving = false;
          saveVideoJobs();
          console.log('[clip-talk] save failed', job.error);
        });
      });
    }
    return res.json({ jobId: job.id, status: 'saving' });
  } catch (err) {
    console.log('[clip-talk] poll failed', err && err.message);
    res.status(400).json({ error: err.message || '對嘴失敗' });
  }
});

app.get('/api/talk/video/last', (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  const cost = clipTalk.creditCost();
  if (!owner && (!paid || Number(paid.credits || 0) < cost)) {
    return res.status(402).json({ error: '請先後台登入或確認點數。' });
  }
  const local = latestReadyJob(clipSid(req, res), 'talk');
  if (local && local.result) {
    return res.json({ ...local.result, recovered: true });
  }
  return res.status(404).json({ error: '沒有可取回的對嘴短片。請不要重按產出。' });
});

const STORY_JOB_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'story-video-jobs.json');

function loadStoryJobs() {
  try {
    const rows = JSON.parse(fs.readFileSync(STORY_JOB_FILE, 'utf8'));
    return new Map(Object.entries(rows || {}));
  } catch {
    return new Map();
  }
}

const storyJobs = loadStoryJobs();

function saveStoryJobs() {
  const dir = path.dirname(STORY_JOB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORY_JOB_FILE, JSON.stringify(Object.fromEntries(storyJobs), null, 2), 'utf8');
}

function pruneStoryJobs() {
  const cutoff = Date.now() - 40 * 60 * 1000;
  let changed = false;
  for (const [id, job] of storyJobs) {
    if (job.created < cutoff) {
      storyJobs.delete(id);
      changed = true;
    }
  }
  if (changed) saveStoryJobs();
}

app.use([
  '/api/story/script',
  '/api/story/video',
], (req, res, next) => {
  if (STORY_OPEN) return next();
  return res.status(503).json({ error: '劇本廣告建置中，尚未開放。' });
});

app.get('/api/story/status', (req, res) => {
  const paid = currentAccount(req);
  const account = paid ? accounts.publicAccount(paid) : null;
  const guest = clipStore.guestScriptState(clipSid(req, res));
  res.json({
    open: STORY_OPEN,
    video: STORY_OPEN && storyVideo.configured(),
    videoEngine: storyVideo.engine(),
    videoProvider: storyVideo.preferredProvider(),
    videoDuration: storyVideo.videoDuration(),
    videoCredits: storyVideo.creditCost(),
    script: storyScript.configured(),
    scriptLeft: guest.left,
    scriptLimit: guest.limit,
    demoScript: storyVideo.DEMO_SCRIPT,
    owner: isOwner(req),
    storyPlan: account && account.storyPlan ? account.storyPlan : '',
    storyCredits: account ? account.storyCredits : 0,
  });
});

app.post('/api/story/script', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const sid = clipSid(req, res);
  if (!owner) {
    const guest = clipStore.guestScriptState(sid);
    if (!guest.left) {
      return res.status(402).json({
        error: `今日免費寫劇本已用完（${guest.limit} 則）。可明天再試，或自己貼上劇本。`,
        left: 0,
      });
    }
  }
  try {
    const result = await storyScript.writeScript({
      product: String(req.body?.product || '').trim(),
      notes: String(req.body?.notes || '').trim(),
      images: Array.isArray(req.body?.images) ? req.body.images : [],
    });
    const extra = {};
    if (!owner) extra.left = clipStore.consumeGuestScript(sid).left;
    res.json({ script: result.script, ...extra });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '寫稿逾時，請再試一次' : (err.message || '寫稿失敗');
    res.status(400).json({ error: msg });
  }
});

app.post('/api/story/video', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  const cost = storyVideo.creditCost();
  if (!owner && (!paid || Number(paid.storyCredits || 0) < cost)) {
    return res.status(402).json({
      error: `請先看示範，再到帳號申請劇本廣告方案。一次需 ${cost} 次。`,
    });
  }
  try {
    const submitted = await storyVideo.submit({
      script: String(req.body?.script || '').trim(),
      product: String(req.body?.product || '').trim(),
      images: Array.isArray(req.body?.images) ? req.body.images : [],
    });
    pruneStoryJobs();
    const job = {
      id: crypto.randomUUID(),
      requestId: submitted.requestId,
      model: submitted.model,
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
      sid: clipSid(req, res),
      owner,
      accountId: row && row.id,
      cost,
      engine: 'seedance',
      provider: submitted.provider || 'fal',
      duration: submitted.duration,
      created: Date.now(),
      result: null,
      error: '',
    };
    storyJobs.set(job.id, job);
    saveStoryJobs();
    console.log('[story-video] queued', (submitted.provider || 'fal'), submitted.duration + 's');
    res.json({ jobId: job.id, status: 'queued', duration: submitted.duration });
  } catch (err) {
    console.log('[story-video] submit failed', err && err.message);
    res.status(400).json({ error: err.message || '生片失敗' });
  }
});

app.get('/api/story/video/job/:jobId', async (req, res) => {
  pruneStoryJobs();
  const job = storyJobs.get(req.params.jobId);
  if (!job || job.sid !== clipSid(req, res)) {
    return res.status(404).json({ error: '找不到這次生片。請不要重按。' });
  }
  if (job.result) return res.json(job.result);
  if (job.error) return res.status(400).json({ error: job.error });
  try {
    const peek = await storyVideo.check(job);
    if (peek.status === 'failed') {
      job.error = peek.error || '生片失敗';
      saveStoryJobs();
      return res.status(400).json({ error: job.error });
    }
    if (peek.status !== 'done') return res.json({ jobId: job.id, status: peek.status });
    const fileOut = await storyVideo.finish(peek.videoUrl, { engine: 'seedance', duration: job.duration });
    const saved = clipStore.saveMedia(job.sid, 'video', fileOut.buffer, fileOut.mime || 'video/mp4');
    const extra = { recovered: false, engine: 'seedance', duration: job.duration };
    if (job.owner) extra.owner = true;
    else if (job.accountId) extra.storyCredits = accounts.consumeStoryCredit(job.accountId, job.cost).storyCredits;
    job.result = {
      status: 'done',
      jobId: job.id,
      videoId: saved.id,
      videoUrl: `/api/clip/media/${saved.id}`,
      ...extra,
    };
    saveStoryJobs();
    res.json(job.result);
  } catch (err) {
    console.log('[story-video] poll failed', err && err.message);
    res.status(400).json({ error: err.message || '生片失敗' });
  }
});

app.get('/api/story/video/last', async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  if (!owner && (!paid || !paid.storyPlan)) {
    return res.status(402).json({ error: '請先申請劇本廣告方案。' });
  }
  try {
    const recovered = await storyVideo.recoverRecent();
    if (!recovered || !recovered.buffer) return res.status(404).json({ error: '沒有可取回的短片。' });
    const saved = clipStore.saveMedia(clipSid(req, res), 'video', recovered.buffer, recovered.mime || 'video/mp4');
    res.json({
      status: 'done',
      videoId: saved.id,
      videoUrl: `/api/clip/media/${saved.id}`,
      engine: 'seedance',
      duration: recovered.duration,
      recovered: true,
      owner: Boolean(owner),
      storyCredits: paid ? paid.storyCredits : 0,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || '取回失敗' });
  }
});

const DRAMA_JOB_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'drama-video-jobs.json');

function loadDramaJobs() {
  try {
    const rows = JSON.parse(fs.readFileSync(DRAMA_JOB_FILE, 'utf8'));
    return new Map(Object.entries(rows || {}));
  } catch {
    return new Map();
  }
}

const dramaJobs = loadDramaJobs();

function saveDramaJobs() {
  const dir = path.dirname(DRAMA_JOB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const slim = {};
  for (const [id, job] of dramaJobs) {
    slim[id] = { ...job, images: undefined };
  }
  fs.writeFileSync(DRAMA_JOB_FILE, JSON.stringify(slim, null, 2), 'utf8');
}

function pruneDramaJobs() {
  const cutoff = Date.now() - 40 * 60 * 1000;
  let changed = false;
  for (const [id, job] of dramaJobs) {
    if (job.created < cutoff) {
      dramaJobs.delete(id);
      changed = true;
    }
  }
  if (changed) saveDramaJobs();
}

function latestDramaJob(sid) {
  let latest = null;
  for (const job of dramaJobs.values()) {
    if (!job || job.sid !== sid || !job.result || !job.result.videoId) continue;
    if (!clipStore.getMedia(job.result.videoId)) continue;
    if (!latest || job.created > latest.created) latest = job;
  }
  return latest;
}

app.use([
  '/api/drama/script',
  '/api/drama/video',
], (req, res, next) => {
  if (DRAMA_OPEN) return next();
  return res.status(503).json({ error: 'AI短劇建置中，尚未開放。' });
});

app.get('/api/drama/status', (req, res) => {
  const paid = currentAccount(req);
  const account = paid ? accounts.publicAccount(paid) : null;
  const guest = clipStore.guestScriptState(clipSid(req, res));
  res.json({
    open: DRAMA_OPEN,
    video: DRAMA_OPEN && dramaVideo.configured(),
    script: DRAMA_OPEN && dramaScript.configured(),
    scenes: dramaVideo.sceneCount(),
    duration: Number(dramaVideo.sceneDuration()) * dramaVideo.sceneCount(),
    videoCredits: dramaVideo.creditCost(),
    scriptLeft: guest.left,
    scriptLimit: guest.limit,
    demoScript: dramaVideo.DEMO_SCRIPT,
    owner: isOwner(req),
    dramaPlan: account && account.dramaPlan ? account.dramaPlan : '',
    dramaCredits: account ? account.dramaCredits : 0,
  });
});

app.post('/api/drama/script', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const sid = clipSid(req, res);
  if (!owner) {
    const guest = clipStore.guestScriptState(sid);
    if (!guest.left) {
      return res.status(402).json({
        error: `今日免費寫劇本已用完（${guest.limit} 則）。可明天再試，或自己貼上三鏡。`,
        left: 0,
      });
    }
  }
  try {
    const result = await dramaScript.writeScript({
      topic: String(req.body?.topic || '').trim(),
      notes: String(req.body?.notes || '').trim(),
      images: Array.isArray(req.body?.images) ? req.body.images : [],
    });
    const extra = {};
    if (!owner) extra.left = clipStore.consumeGuestScript(sid).left;
    res.json({ script: result.script, ...extra });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '寫稿逾時，請再試一次' : (err.message || '寫稿失敗');
    res.status(400).json({ error: msg });
  }
});

app.post('/api/drama/video', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  const cost = dramaVideo.creditCost();
  if (!owner && (!paid || Number(paid.dramaCredits || 0) < cost)) {
    return res.status(402).json({
      error: `請先看示範劇本，再到帳號申請 AI短劇方案。一次需 ${cost} 次。`,
    });
  }
  try {
    dramaVideo.parseScenes(String(req.body?.script || '').trim());
    pruneDramaJobs();
    const job = {
      id: crypto.randomUUID(),
      sid: clipSid(req, res),
      owner,
      accountId: row && row.id,
      cost,
      script: String(req.body?.script || '').trim(),
      images: Array.isArray(req.body?.images) ? req.body.images : [],
      phase: '已送出',
      created: Date.now(),
      result: null,
      error: '',
    };
    dramaJobs.set(job.id, job);
    saveDramaJobs();
    setImmediate(() => {
      dramaVideo.produce({
        script: job.script,
        images: job.images,
        onPhase: (phase) => { job.phase = phase; },
      }).then((fileOut) => {
        const saved = clipStore.saveMedia(job.sid, 'video', fileOut.buffer, fileOut.mime || 'video/mp4');
        const extra = { recovered: false, engine: 'drama', scenes: fileOut.scenes };
        if (job.owner) extra.owner = true;
        else if (job.accountId) extra.dramaCredits = accounts.consumeDramaCredit(job.accountId, job.cost).dramaCredits;
        job.result = {
          status: 'done',
          jobId: job.id,
          videoId: saved.id,
          videoUrl: `/api/clip/media/${saved.id}`,
          duration: fileOut.duration,
          ...extra,
        };
        job.images = [];
        saveDramaJobs();
      }).catch((err) => {
        job.error = err.message || '短劇失敗';
        job.images = [];
        saveDramaJobs();
        console.log('[drama] failed', job.error);
      });
    });
    console.log('[drama] queued');
    res.json({ jobId: job.id, status: 'queued' });
  } catch (err) {
    res.status(400).json({ error: err.message || '短劇送出失敗' });
  }
});

app.get('/api/drama/video/job/:jobId', (req, res) => {
  pruneDramaJobs();
  const job = dramaJobs.get(req.params.jobId);
  if (!job || job.sid !== clipSid(req, res)) {
    return res.status(404).json({ error: '找不到這次短劇。請不要重按。' });
  }
  if (job.result) return res.json(job.result);
  if (job.error) return res.status(400).json({ error: job.error });
  return res.json({ jobId: job.id, status: job.phase === '已送出' ? 'queued' : 'running', phase: job.phase });
});

app.get('/api/drama/video/last', (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  if (!owner && (!paid || !paid.dramaPlan)) {
    return res.status(402).json({ error: '請先申請 AI短劇方案。' });
  }
  const local = latestDramaJob(clipSid(req, res));
  if (local && local.result) return res.json({ ...local.result, recovered: true });
  return res.status(404).json({ error: '沒有可取回的短劇。請不要重按產出。' });
});

app.post('/api/clip/upload', express.raw({ type: () => true, limit: '30mb' }), (req, res) => {
  const sid = clipSid(req, res);
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
  if (!buf.length) return res.status(400).json({ error: '沒有檔案' });
  const kind = String(req.query.kind || 'image');
  const mime = String(req.query.mime || req.get('content-type') || 'application/octet-stream');
  const row = clipStore.saveMedia(sid, kind, buf, mime);
  res.json({ id: row.id });
});

app.get('/api/clip/media/:id', (req, res) => {
  const row = clipStore.getMedia(req.params.id);
  if (!row) return res.status(404).end();
  const asDownload = String(req.query.download || '') === '1';
  const ext = /png/i.test(row.mime) ? 'png' : /webp/i.test(row.mime) ? 'webp' : /mp4/i.test(row.mime) ? 'mp4' : /webm/i.test(row.mime) ? 'webm' : 'jpg';
  if (asDownload) {
    return clipExport.sendDownload(res, row.full, row.mime || 'application/octet-stream', `mooseclip.${ext}`);
  }
  res.setHeader('Content-Type', row.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.resolve(row.full), { dotfiles: 'allow' });
});

app.post('/api/clip/media/:id/mp4', async (req, res) => {
  try {
    const ready = await clipExport.ensureMp4(req.params.id);
    res.json({ ok: true, url: `/api/clip/media/${req.params.id}/mp4`, mime: ready.mime });
  } catch (err) {
    res.status(400).json({ error: err.message || '短片轉檔失敗' });
  }
});

app.get('/api/clip/media/:id/mp4', async (req, res) => {
  try {
    const ready = await clipExport.ensureMp4(req.params.id);
    clipExport.sendDownload(res, ready.mp4Full, ready.mime || 'video/mp4', /mp4/i.test(ready.mime) ? 'mooseclip.mp4' : 'mooseclip.webm');
  } catch (err) {
    res.status(400).type('text').send(err.message || '短片轉檔失敗');
  }
});

app.post('/api/clip/publish', async (req, res) => {
  try {
    const results = await clipPub.publish({
      sid: clipSid(req, res),
      origin: requestOrigin(req),
      platforms: Array.isArray(req.body?.platforms) ? req.body.platforms : [],
      caption: String(req.body?.caption || '').slice(0, 2000),
      imageIds: Array.isArray(req.body?.imageIds) ? req.body.imageIds : [],
      videoId: String(req.body?.videoId || ''),
    });
    res.json({ results });
  } catch (err) {
    res.status(400).json({ error: err.message || '發送失敗' });
  }
});

app.post('/api/clip/links', (req, res) => {
  try {
    const sid = clipSid(req, res);
    const links = clipPub.saveLinks(sid, req.body || {});
    res.json({ ok: true, links, status: clipPub.status(sid) });
  } catch (err) {
    res.status(400).json({ error: err.message || '連結無效' });
  }
});

app.post('/api/clip/schedule', async (req, res) => {
  try {
    const sid = clipSid(req, res);
    const result = await clipPub.schedule({
      sid,
      origin: requestOrigin(req),
      platforms: Array.isArray(req.body?.platforms) ? req.body.platforms : [],
      caption: String(req.body?.caption || '').slice(0, 2000),
      imageIds: Array.isArray(req.body?.imageIds) ? req.body.imageIds : [],
      videoId: String(req.body?.videoId || ''),
      at: req.body?.at,
      links: req.body?.links || null,
    });
    res.json({ ...result, queue: clipStore.listQueue(sid) });
  } catch (err) {
    res.status(400).json({ error: err.message || '預約失敗' });
  }
});

app.get('/api/clip/queue', (req, res) => {
  res.json({ queue: clipStore.listQueue(clipSid(req, res)) });
});

app.get('/api/clip/shop/status', (req, res) => {
  res.json(clipShop.status(clipSid(req, res)));
});

app.get('/api/clip/shop/install/shopify', (req, res) => {
  try {
    const sid = clipSid(req, res);
    const url = clipShop.shopifyInstallUrl(requestOrigin(req), sid, req.query.shop, req.query);
    if (!url) return res.redirect(`/clip?error=${encodeURIComponent('尚未開通 Shopify 一鍵安裝')}`);
    res.redirect(url);
  } catch (err) {
    res.redirect(`/clip?error=${encodeURIComponent(err.message || '安裝失敗')}`);
  }
});

app.get('/api/clip/shop/oauth/shopify/callback', async (req, res) => {
  try {
    await clipShop.finishShopifyOauth(requestOrigin(req), req.query);
    res.redirect('/clip?shop=1');
  } catch (err) {
    res.redirect(`/clip?error=${encodeURIComponent(err.message || 'Shopify 授權失敗')}`);
  }
});

app.post('/api/clip/shop/connect', async (req, res) => {
  try {
    const sid = clipSid(req, res);
    clipShop.connect(sid, req.body || {}, requestOrigin(req));
    const items = await clipShop.products(sid, requestOrigin(req));
    res.json({ ok: true, shop: clipShop.status(sid), products: items });
  } catch (err) {
    res.status(400).json({ error: err.message || '商店連接失敗' });
  }
});

app.post('/api/clip/shop/disconnect', (req, res) => {
  clipShop.disconnect(clipSid(req, res));
  res.json({ ok: true, shop: { connected: false } });
});

app.get('/api/clip/shop/products', async (req, res) => {
  try {
    const items = await clipShop.products(clipSid(req, res), requestOrigin(req));
    res.json({ products: items });
  } catch (err) {
    res.status(400).json({ error: err.message || '讀取商品失敗' });
  }
});

app.get('/api/clip/shop/media', async (req, res) => {
  try {
    const file = await clipShop.fetchImage(clipSid(req, res), String(req.query.src || ''));
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(file.buf);
  } catch (err) {
    res.status(400).json({ error: err.message || '讀取商品圖失敗' });
  }
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin.html\n\nUser-agent: Linespider\nAllow: /\n');
});

app.use(express.static(PUBLIC, { index: false }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  sendPage(req, res, '404.html', 404);
});

app.listen(PORT, async () => {
  await initMail();
  setInterval(() => {
    clipPub.runDue().catch((err) => console.error('[Clip] 預約發送失敗', err.message));
  }, 60000);
  clipPub.runDue().catch(() => {});
  console.log(`麋鹿網    http://127.0.0.1:${PORT}`);
  console.log(`後台      http://127.0.0.1:${PORT}/admin`);
  console.log(`BASE_URL ${BASE_URL}`);
  console.log(`諮詢信箱 → ${INQUIRE_EMAIL || '未設定'}`);
  console.log(`Mail: ${mailConfigured() ? '已設定' : '未設定（請在 .env 放 RESEND_API_KEY）'}`);
});
