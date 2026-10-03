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
const personaAgent = require('./services/persona-agent');
const hotAgent = require('./services/hot-agent');
const promptAgent = require('./services/prompt-agent');
const hookAgent = require('./services/hook-agent');
const dressAgent = require('./services/dress-agent');
const editAgent = require('./services/edit-agent');
const modelLock = require('./services/model-lock');
const accounts = require('./services/accounts');
const ecpay = require('./services/ecpay');
const payOrders = require('./services/pay-orders');
const lineBot = require('./services/line-bot');

const PORT = Number(process.env.PORT || 3002);
const BASE_URL = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const PUBLIC = path.join(__dirname, 'public');
const CLIP_CONNECT_OPEN = process.env.CLIP_CONNECT_OPEN === '1';
const DRAMA_OPEN = process.env.DRAMA_OPEN === '1';
const STORY_OPEN = process.env.STORY_OPEN !== '0';

const app = express();
app.set('trust proxy', 1);
const jsonDefault = express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { if (req.url === '/api/line/webhook') req.rawBody = buf; },
});
const largeJsonPost = /^\/api\/(dress|edit|move|model|hook|prompt|script|clip\/(caption|enhance|video|music-prompt)|talk\/video|story\/(script|video)|drama\/(script|video|cast))(\/|$)/;
app.use((req, res, next) => {
  if (req.method === 'POST' && largeJsonPost.test(req.path)) return next();
  return jsonDefault(req, res, next);
});

const STUDIO_ORIGIN = 'https://bafuholdings.com';

function redirectStudio(req, res, path) {
  const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, `${STUDIO_ORIGIN}${path}${q}`);
}

const pages = {
  '/': 'index.html',
  '/saas': 'saas.html',
  '/match': 'match.html',
  '/research': 'research.html',
  '/ai': 'research.html',
  '/skills': 'skills.html',
  '/clip': 'clip.html',
  '/story': 'story.html',
  '/talk': 'talk.html',
  '/script': 'script.html',
  '/live': 'live.html',
  '/ip': 'ip.html',
  '/hot': 'hot.html',
  '/prompt': 'prompt.html',
  '/hook': 'hook.html',
  '/dress': 'dress.html',
  '/edit': 'edit.html',
  '/move': 'move.html',
  '/model': 'model.html',
  '/account': 'account.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
  '/admin': 'admin.html',
};

app.get('/api/health', (_req, res) => {
  const disk = clipStore.diskInfo();
  res.json({
    ok: true,
    site: publicConfig().name,
    admin: adminConfigured(),
    diskUsedPct: disk && !disk.error ? disk.usedPct : null,
    diskError: disk && disk.error ? disk.error : undefined,
    hotError: hotAgent.lastFailure() || undefined,
  });
});

clipStore.pruneMedia(false);
setInterval(() => clipStore.pruneMedia(false), 60 * 60 * 1000).unref();

app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
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

function withAnalytics(html, file) {
  const id = String(process.env.GA_MEASUREMENT_ID || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id || /admin/i.test(file) || html.includes('googletagmanager.com/gtag/js')) return html;
  const snippet = `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`;
  return html.replace('</head>', `  ${snippet}\n</head>`);
}

function sendPage(req, res, file, status = 200) {
  const full = path.join(PUBLIC, file);
  if (!fs.existsSync(full)) {
    res.status(404).type('html').send('<h1>Not found</h1>');
    return;
  }
  const origin = requestOrigin(req);
  const html = withAnalytics(withSocialMeta(fs.readFileSync(full, 'utf8'), origin, req.path || '/', '/og.jpg'), file);
  res.setHeader('Cache-Control', 'no-cache');
  res.status(status).type('html').send(html);
}

app.get(['/works', '/agents'], (req, res) => redirectStudio(req, res, '/works'));
app.get('/courses', (req, res) => redirectStudio(req, res, '/courses'));
app.get('/course', (req, res) => redirectStudio(req, res, '/course'));
app.get('/hire', (req, res) => redirectStudio(req, res, '/hire'));
app.get('/drama', (req, res) => {
  if (!isOwner(req)) return res.redirect(302, '/story');
  return sendPage(req, res, 'drama.html');
});

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

function hasPaidClipPlan(req) {
  if (isOwner(req)) return true;
  const row = currentAccount(req);
  if (!row) return false;
  const pub = accounts.publicAccount(row);
  return Boolean(
    pub.ok
    && pub.plan !== 'free'
    && pub.planExpires
    && Date.parse(pub.planExpires) > Date.now()
  );
}

function agentTrialBucket(req, res) {
  const row = currentAccount(req);
  if (row && row.id) return `acc:${row.id}`;
  return `sid:${clipSid(req, res)}`;
}

function agentAccess(req, res, tool) {
  if (isOwner(req) || hasPaidClipPlan(req)) {
    return { unlimited: true, paid: true, tool };
  }
  const bucket = agentTrialBucket(req, res);
  const trial = clipStore.guestAgentTrialState(bucket, tool);
  return { unlimited: false, paid: false, bucket, tool, ...trial };
}

function agentStatusJson(req, res, tool, ready, extra = {}) {
  const access = agentAccess(req, res, tool);
  if (access.unlimited) {
    return { ready, paid: true, unlimited: true, left: null, limit: null, ...extra };
  }
  return {
    ready,
    paid: false,
    unlimited: false,
    left: access.left,
    limit: access.limit,
    ...extra,
  };
}

function denyAgentTrial(res) {
  return res.status(402).json({
    error: '此智能體試用已用完（各限 1 次）。購買付費工具方案後可不限次數使用。',
    left: 0,
    limit: clipStore.agentTrialLimit(),
    needPlan: true,
  });
}

function sendAccount(req, res, payload, sid) {
  if (sid) setAccountCookie(req, res, sid);
  res.json(payload);
}

app.get('/api/account/me', (req, res) => {
  const row = currentAccount(req);
  if (!row) return res.json({ ok: false });
  const sub = payOrders.activeSubscription(row.id);
  res.json({
    ...accounts.publicAccount(row),
    subscription: sub ? { planName: sub.planName, amount: sub.amount, since: sub.paidAt } : null,
  });
});

app.post('/api/account/subscription/cancel', async (req, res) => {
  const row = currentAccount(req);
  if (!row) return res.status(401).json({ error: '請先登入' });
  const sub = payOrders.activeSubscription(row.id);
  if (!sub) return res.status(400).json({ error: '目前沒有自動續約。' });
  try {
    await ecpay.cancelPeriod(sub.merchantTradeNo);
    payOrders.markCancelled(sub.merchantTradeNo);
    res.json({ ok: true, message: '已取消自動續約，本期到期前仍可正常使用。' });
  } catch (err) {
    console.error('[subscription cancel]', err.message);
    res.status(502).json({ error: '取消失敗，請稍後再試或透過 LINE 聯繫。' });
  }
});

app.post('/api/account/register', (req, res) => {
  try {
    const result = accounts.register(req.body?.email, req.body?.password, req.body?.name);
    sendAccount(req, res, result.account, result.sid);
  } catch (err) {
    res.status(400).json({ error: err.message || '註冊失敗' });
  }
});

app.post('/api/account/name', (req, res) => {
  const row = currentAccount(req);
  if (!row) return res.status(401).json({ error: '請先登入' });
  try {
    res.json(accounts.setName(row.id, req.body?.name));
  } catch (err) {
    res.status(400).json({ error: err.message || '無法儲存名稱' });
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
  if (!full.price || full.id === 'free') return res.status(400).json({ error: '免費方案不必付款。' });
  const periodic = Boolean(req.body?.auto) && /／月/.test(full.priceLabel || '');
  if (periodic && payOrders.activeSubscription(row.id)) {
    return res.status(400).json({ error: '你已經有自動續約，要換方案請先取消目前的自動續約。' });
  }
  try {
    const order = payOrders.createOrder({
      accountId: row.id,
      email: row.email,
      planId: full.id,
      amount: full.price,
      planName: full.name,
      periodic,
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
      periodReturnUrl: periodic ? `${BASE_URL}/api/pay/ecpay/period` : '',
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

app.post('/api/line/webhook', (req, res) => {
  if (!lineBot.configured()) return res.status(503).end();
  if (!lineBot.verifySignature(req.rawBody, req.get('x-line-signature'))) return res.status(401).end();
  res.status(200).end();
  lineBot.handleEvents(req.body?.events, BASE_URL).catch((err) => console.error('[line-bot]', err.message));
});

app.post('/api/pay/ecpay/period', express.urlencoded({ extended: false }), (req, res) => {
  const body = req.body || {};
  if (!ecpay.configured() || !ecpay.verify(body)) {
    return res.status(400).type('text/plain').send('0|CheckMacValueError');
  }
  const order = payOrders.findByTradeNo(body.MerchantTradeNo);
  if (!order || !order.periodic) return res.status(404).type('text/plain').send('0|OrderNotFound');
  if (String(body.RtnCode) !== '1') {
    console.warn('[period] 續約扣款失敗', order.email, body.RtnMsg || '');
    return res.type('text/plain').send('1|OK');
  }
  const amount = Number(body.amount || body.PeriodAmount || 0);
  if (amount && amount !== Number(order.amount)) {
    return res.status(400).type('text/plain').send('0|AmountError');
  }
  if (Number(body.TotalSuccessTimes || 0) <= 1) return res.type('text/plain').send('1|OK');
  const key = String(body.Gwsr || body.ProcessDate || body.TotalSuccessTimes);
  const { fresh } = payOrders.recordRenewal(order.merchantTradeNo, key);
  if (fresh) {
    try { accounts.grantPlanById(order.accountId, order.planId); } catch { /* 續約已記，後台可補開 */ }
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
  res.json(agentStatusJson(req, res, 'script', scriptAgent.configured()));
});

app.post('/api/script', express.json({ limit: '8mb' }), async (req, res) => {
  const access = agentAccess(req, res, 'script');
  if (!access.unlimited && access.left <= 0) return denyAgentTrial(res);
  try {
    const result = await scriptAgent.writeScript({
      product: String(req.body?.product || '').trim(),
      features: String(req.body?.features || '').trim(),
      mode: String(req.body?.mode || '').trim(),
      images: Array.isArray(req.body?.images) ? req.body.images : [],
    });
    const extra = access.unlimited
      ? { paid: true, unlimited: true }
      : { left: clipStore.consumeGuestAgentTrial(access.bucket, 'script').left, limit: access.limit };
    res.json({ ...result, ...extra });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '產出逾時，請再試一次' : (err.message || '產出失敗');
    res.status(400).json({ error: msg });
  }
});

app.get('/api/live/status', (req, res) => {
  res.json(agentStatusJson(req, res, 'live', liveScript.configured()));
});

app.post('/api/live', express.json({ limit: '200kb' }), async (req, res) => {
  const access = agentAccess(req, res, 'live');
  if (!access.unlimited && access.left <= 0) return denyAgentTrial(res);
  try {
    const result = await liveScript.writeLive({
      industry: String(req.body?.industry || '').trim(),
      product: String(req.body?.product || '').trim(),
      notes: String(req.body?.notes || '').trim(),
    });
    const extra = access.unlimited
      ? { paid: true, unlimited: true }
      : { left: clipStore.consumeGuestAgentTrial(access.bucket, 'live').left, limit: access.limit };
    res.json({ ...result, ...extra });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '產出逾時，請再試一次' : (err.message || '產出失敗');
    res.status(400).json({ error: msg });
  }
});

app.get('/api/ip/status', (req, res) => {
  res.json(agentStatusJson(req, res, 'ip', personaAgent.configured()));
});

app.post('/api/ip', express.json({ limit: '200kb' }), async (req, res) => {
  const access = agentAccess(req, res, 'ip');
  if (!access.unlimited && access.left <= 0) return denyAgentTrial(res);
  try {
    const result = await personaAgent.writePersona({
      bio: String(req.body?.bio || '').trim(),
      fans: String(req.body?.fans || '').trim(),
      goal: String(req.body?.goal || '').trim(),
    });
    const extra = access.unlimited
      ? { paid: true, unlimited: true }
      : { left: clipStore.consumeGuestAgentTrial(access.bucket, 'ip').left, limit: access.limit };
    res.json({ ...result, ...extra });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '產出逾時，請再試一次' : (err.message || '產出失敗');
    res.status(400).json({ error: msg });
  }
});

app.get('/api/hot/status', (req, res) => {
  res.json(agentStatusJson(req, res, 'hot', hotAgent.configured()));
});

app.post('/api/hot', express.json({ limit: '200kb' }), async (req, res) => {
  const access = agentAccess(req, res, 'hot');
  if (!access.unlimited && access.left <= 0) return denyAgentTrial(res);
  try {
    const result = await hotAgent.writeHot({
      topic: String(req.body?.topic || '').trim(),
      scope: String(req.body?.scope || 'both').trim(),
    });
    const extra = access.unlimited
      ? { paid: true, unlimited: true }
      : { left: clipStore.consumeGuestAgentTrial(access.bucket, 'hot').left, limit: access.limit };
    res.json({ ...result, ...extra });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '產出逾時，請再試一次' : (err.message || '產出失敗');
    res.status(400).json({ error: msg });
  }
});

app.get('/api/hook/status', (req, res) => {
  res.json(agentStatusJson(req, res, 'hook', hookAgent.configured()));
});

app.post('/api/hook', express.json({ limit: '4mb' }), async (req, res) => {
  const owner = isOwner(req);
  const access = agentAccess(req, res, 'hook');
  if (!owner && !access.unlimited && access.left <= 0) return denyAgentTrial(res);
  try {
    const result = await hookAgent.writeHook({
      note: String(req.body?.note || '').trim(),
      image: String(req.body?.image || ''),
      platforms: Array.isArray(req.body?.platforms) ? req.body.platforms : [],
    });
    let extra = {};
    if (owner) extra = { owner: true };
    else if (access.unlimited) extra = { paid: true, unlimited: true };
    else extra = { left: clipStore.consumeGuestAgentTrial(access.bucket, 'hook').left, limit: access.limit };
    res.json({ ...result, ...extra });
  } catch (err) {
    res.status(400).json({ error: err.message || '產出失敗' });
  }
});

app.get('/api/prompt/status', (req, res) => {
  res.json(agentStatusJson(req, res, 'prompt', promptAgent.configured(), {
    owner: isOwner(req),
    kinds: promptAgent.publicKinds(),
  }));
});

app.post('/api/prompt', express.json({ limit: '6mb' }), async (req, res) => {
  const owner = isOwner(req);
  const access = agentAccess(req, res, 'prompt');
  if (!owner && !access.unlimited && access.left <= 0) return denyAgentTrial(res);
  try {
    const result = await promptAgent.writePrompt({
      kind: String(req.body?.kind || '').trim(),
      idea: String(req.body?.idea || '').trim(),
      picks: req.body?.picks && typeof req.body.picks === 'object' ? req.body.picks : {},
      images: Array.isArray(req.body?.images) ? req.body.images.filter((x) => typeof x === 'string') : [],
    });
    let extra = {};
    if (owner) extra = { owner: true };
    else if (access.unlimited) extra = { paid: true, unlimited: true };
    else extra = { left: clipStore.consumeGuestAgentTrial(access.bucket, 'prompt').left, limit: access.limit };
    res.json({ ...result, ...extra });
  } catch (err) {
    res.status(400).json({ error: err.message || '產出失敗' });
  }
});

app.get('/api/dress/status', (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  const videoCost = clipVideo.creditCost('5');
  const videoCost10 = clipVideo.creditCost('10');
  const videoCost15 = clipVideo.creditCost('15');
  const videoHd = clipVideo.creditCost('5', '1080p');
  const videoHd10 = clipVideo.creditCost('10', '1080p');
  const videoHd15 = clipVideo.creditCost('15', '1080p');
  const last = clipStore.getLastDress(clipSid(req, res));
  res.json({
    ready: dressAgent.configured(),
    videoReady: clipVideo.configured(),
    videoCost,
    videoCost10,
    videoCost15,
    videoHd,
    videoHd10,
    videoHd15,
    scenes: dressAgent.publicScenes(),
    owner,
    loggedIn: Boolean(paid && paid.ok),
    credits: paid ? Number(paid.credits || 0) : 0,
    hasLast: Boolean(last),
  });
});

function stashDressImage(req, res, dataUrl) {
  try {
    const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/i);
    if (!m) return '';
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 6 * 1024 * 1024) return '';
    const sid = clipSid(req, res);
    const saved = clipStore.saveMedia(sid, 'dress', buf, m[1]);
    clipStore.putLastDress(sid, saved.id);
    return saved.id;
  } catch {
    return '';
  }
}

function stashEditImage(req, res, dataUrl) {
  try {
    const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/i);
    if (!m) return '';
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 6 * 1024 * 1024) return '';
    const saved = clipStore.saveMedia(clipSid(req, res), 'edit', buf, m[1]);
    return saved.id;
  } catch {
    return '';
  }
}

app.get('/api/edit/status', (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  res.json({
    ready: editAgent.configured(),
    cost: 1,
    owner,
    loggedIn: Boolean(paid && paid.ok),
    credits: paid ? Number(paid.credits || 0) : 0,
  });
});

app.post('/api/edit', express.json({ limit: '12mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  if (!owner && (!paid || !paid.credits)) {
    return res.status(402).json({
      error: '改圖需購買方案點數。作者請先到後台登入，即可直接使用。',
    });
  }
  try {
    const result = await editAgent.edit({
      image: String(req.body?.image || ''),
      reference: String(req.body?.reference || ''),
      note: String(req.body?.note || '').trim(),
      aspectRatio: String(req.body?.aspectRatio || '').trim(),
      imageSize: String(req.body?.imageSize || '').trim(),
    });
    const mediaId = stashEditImage(req, res, result.image);
    if (!mediaId) return res.status(400).json({ error: '改圖暫存失敗，請再試一次。' });
    const frame = { imageSize: result.imageSize || '', aspectRatio: result.aspectRatio || '' };
    if (owner) return res.json({ owner: true, mediaId, ...frame });
    const account = accounts.consumeCredit(row.id, 1);
    res.json({ credits: account.credits, mediaId, ...frame });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '產出逾時，請不要重按。' : (err.message || '改圖失敗');
    res.status(400).json({ error: msg });
  }
});

app.post('/api/dress/stash', express.json({ limit: '8mb' }), (req, res) => {
  const image = String(req.body?.image || '');
  if (!image.startsWith('data:image/')) {
    return res.status(400).json({ error: '請先產出換裝圖。' });
  }
  const mediaId = stashDressImage(req, res, image);
  if (!mediaId) return res.status(400).json({ error: '換裝圖暫存失敗，請再試一次。' });
  res.json({ ok: true, mediaId, imageUrl: `/api/clip/media/${mediaId}` });
});

app.get('/api/dress/last', (req, res) => {
  const row = clipStore.getLastDress(clipSid(req, res));
  if (!row) return res.status(404).json({ error: '沒有可取回的換裝圖。請先產出一張，之後跳出去再回來就能取回。' });
  try {
    const buf = fs.readFileSync(row.full);
    const mime = row.mime || 'image/jpeg';
    res.json({
      image: `data:${mime};base64,${buf.toString('base64')}`,
      imageUrl: `/api/clip/media/${row.id}`,
      recovered: true,
    });
  } catch {
    res.status(404).json({ error: '沒有可取回的換裝圖。' });
  }
});

app.post('/api/dress/prompt', express.json({ limit: '12mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  if (!owner && (!paid || !paid.credits)) {
    return res.status(402).json({
      error: '優化提示詞需購買方案點數。作者請先到後台登入。',
    });
  }
  try {
    const prompts = await dressAgent.optimize({
      cloth: String(req.body?.cloth || ''),
      cloth2: String(req.body?.cloth2 || ''),
      note: String(req.body?.note || '').trim(),
    });
    res.json(prompts);
  } catch (err) {
    const msg = err.name === 'AbortError' ? '整理逾時，請再按一次。' : (err.message || '提示詞整理失敗');
    res.status(400).json({ error: msg });
  }
});

app.post('/api/dress', express.json({ limit: '12mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  if (!owner && (!paid || !paid.credits)) {
    return res.status(402).json({
      error: '換裝需購買方案點數。作者請先到後台登入，即可直接使用。',
    });
  }
  try {
    const result = await dressAgent.dress({
      model: String(req.body?.model || ''),
      cloth: String(req.body?.cloth || ''),
      cloth2: String(req.body?.cloth2 || ''),
      note: String(req.body?.note || '').trim(),
      positive: String(req.body?.positive || '').trim(),
      negative: String(req.body?.negative || '').trim(),
      aspectRatio: String(req.body?.aspectRatio || '').trim(),
      imageSize: String(req.body?.imageSize || '').trim(),
    });
    const mediaId = stashDressImage(req, res, result.image);
    const frame = { imageSize: result.imageSize || '', aspectRatio: result.aspectRatio || '' };
    if (owner) return res.json({ image: result.image, owner: true, mediaId, ...frame });
    const account = accounts.consumeCredit(row.id, 1);
    res.json({ image: result.image, credits: account.credits, mediaId, ...frame });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '產出逾時，請不要重按。' : (err.message || '產出失敗');
    res.status(400).json({ error: msg });
  }
});

app.get('/api/model/status', (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  res.json({
    ready: modelLock.configured(),
    cost: modelLock.creditCost(),
    ratios: modelLock.RATIOS,
    scenes: dressAgent.publicScenes(),
    owner,
    loggedIn: Boolean(paid && paid.ok),
    credits: paid ? Number(paid.credits || 0) : 0,
  });
});

app.post('/api/model', express.json({ limit: '14mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  const cost = modelLock.creditCost();
  if (!owner && (!paid || Number(paid.credits || 0) < cost)) {
    return res.status(402).json({
      error: `固定模特兒每張扣 ${cost} 點，需購買方案點數。作者請先到後台登入，即可直接使用。`,
    });
  }
  const strings = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  try {
    const result = await modelLock.generate({
      faces: strings(req.body?.faces),
      items: strings(req.body?.items),
      scene: String(req.body?.scene || ''),
      sceneId: String(req.body?.sceneId || '').trim(),
      ratio: String(req.body?.ratio || ''),
    });
    const mediaId = stashDressImage(req, res, result.image);
    if (owner) return res.json({ image: result.image, owner: true, mediaId });
    const account = accounts.consumeCredit(row.id, cost);
    res.json({ image: result.image, credits: account.credits, mediaId });
  } catch (err) {
    res.status(400).json({ error: err.message || '產出失敗' });
  }
});

app.post('/api/dress/bg', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  if (!owner && (!paid || !paid.credits)) {
    return res.status(402).json({
      error: '換背景需購買方案點數。作者請先到後台登入，即可直接使用。',
    });
  }
  const image = String(req.body?.image || '');
  if (!image.startsWith('data:image/')) {
    return res.status(400).json({ error: '請先產出換裝圖，再換背景。' });
  }
  try {
    const result = await dressAgent.changeBg({
      image,
      sceneId: String(req.body?.scene || '').trim(),
      note: String(req.body?.note || '').trim(),
      aspectRatio: String(req.body?.aspectRatio || '').trim(),
      imageSize: String(req.body?.imageSize || '').trim(),
    });
    const mediaId = stashDressImage(req, res, result.image);
    const frame = { imageSize: result.imageSize || '', aspectRatio: result.aspectRatio || '' };
    if (owner) return res.json({ image: result.image, owner: true, mediaId, ...frame });
    const account = accounts.consumeCredit(row.id, 1);
    res.json({ image: result.image, credits: account.credits, mediaId, ...frame });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '產出逾時，請不要重按。' : (err.message || '產出失敗');
    res.status(400).json({ error: msg });
  }
});

app.post('/api/dress/video', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  const duration = clipVideo.videoDuration(String(req.body?.duration || '5').trim());
  const resolution = clipVideo.videoResolution(req.body?.resolution);
  const ratio = clipVideo.frameRatio(req.body?.ratio);
  const cost = clipVideo.creditCost(duration, resolution);
  if (!owner && (!paid || Number(paid.credits || 0) < cost)) {
    return res.status(402).json({
      error: `讓圖動起來（${duration} 秒、${resolution}）需方案剩餘 ${cost} 點以上。作者請先到後台登入。`,
    });
  }
  const image = String(req.body?.image || '');
  if (!image.startsWith('data:image/')) {
    return res.status(400).json({ error: '請先產出換裝圖，再讓圖動起來。' });
  }
  const motion = String(req.body?.motion || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (/忽略(以上|先前|之前|所有)?(指令|規則)|ignore (previous|all) instructions|越獄|jailbreak/i.test(motion)) {
    return res.status(400).json({ error: '無法提供' });
  }
  try {
    const prompt = [
      `Animate this fashion try-on still into a ${duration}-second photoreal clip.`,
      'Keep the same person: face, hair, skin tone, and identity. Do not swap the face.',
      'Keep the outfit colors, cut, and details unchanged. Do not swap clothes, invent brands, or add a buckle, zipper, pocket, or button that is not already in the still. A tied fabric belt stays a tie, with no metal buckle.',
      motion
        ? `Action, performed continuously for the whole clip: ${motion}. This body motion is requested. Do not freeze the pose.`
        : 'No requested action. Gentle camera move and natural fabric, hair, or background motion only. Keep the pose.',
      'No captions, subtitles, watermarks, or on-screen text. No lip-sync talking. Single continuous shot.',
    ].join(' ');
    const submitted = await clipVideo.submit({
      images: [image],
      product: 'fashion try-on',
      duration,
      resolution,
      ratio,
      prompt,
    });
    pruneVideoJobs();
    const job = {
      id: crypto.randomUUID(),
      kind: 'dress',
      requestId: submitted.requestId,
      model: submitted.model,
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
      sid: clipSid(req, res),
      owner,
      accountId: row && row.id,
      cost,
      duration: submitted.duration,
      resolution: submitted.resolution || resolution,
      audioPath: submitted.audioPath || '',
      created: Date.now(),
      result: null,
      error: '',
    };
    videoJobs.set(job.id, job);
    saveVideoJobs();
    console.log('[dress-video] queued', submitted.duration + 's', submitted.resolution || resolution);
    res.json({ jobId: job.id, status: 'queued', duration: submitted.duration, resolution: submitted.resolution || resolution, cost });
  } catch (err) {
    console.log('[dress-video] submit failed', err && err.message);
    res.status(400).json({ error: err.message || '生片失敗' });
  }
});

app.get('/api/move/status', (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  res.json({
    ready: clipVideo.configured(),
    owner,
    loggedIn: Boolean(paid && paid.ok),
    credits: paid ? Number(paid.credits || 0) : 0,
    cost5: clipVideo.creditCost('5'),
    cost10: clipVideo.creditCost('10'),
    cost15: clipVideo.creditCost('15'),
  });
});

app.post('/api/move', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  const duration = clipVideo.videoDuration(String(req.body?.duration || '5').trim());
  const ratio = clipVideo.frameRatio(req.body?.ratio);
  const cost = clipVideo.creditCost(duration);
  if (!owner && (!paid || Number(paid.credits || 0) < cost)) {
    return res.status(402).json({
      error: `讓圖動起來（${duration} 秒）需方案剩餘 ${cost} 點以上。作者請先到後台登入。`,
    });
  }
  const image = String(req.body?.image || '');
  if (!image.startsWith('data:image/')) {
    return res.status(400).json({ error: '請先上傳要動的圖。' });
  }
  const motion = String(req.body?.motion || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (/忽略(以上|先前|之前|所有)?(指令|規則)|ignore (previous|all) instructions|越獄|jailbreak/i.test(motion)) {
    return res.status(400).json({ error: '無法提供' });
  }
  try {
    const prompt = [
      `Animate this still into a ${duration}-second photoreal clip.`,
      'Keep the same subject, face, product, colors, and details from the first frame.',
      'Do not add text, logos, watermarks, or objects that are not already in the still.',
      motion
        ? `Action, performed continuously for the whole clip: ${motion}. This body motion is requested. Do not freeze the pose.`
        : 'No requested action. Gentle camera move and natural motion in fabric, hair, or background only. Keep the pose.',
      'No captions, subtitles, watermarks, or on-screen text. No lip-sync talking. Single continuous shot.',
    ].join(' ');
    const submitted = await clipVideo.submit({
      images: [image],
      product: 'still photo',
      duration,
      ratio,
      prompt,
    });
    pruneVideoJobs();
    const job = {
      id: crypto.randomUUID(),
      kind: 'move',
      requestId: submitted.requestId,
      model: submitted.model,
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
      sid: clipSid(req, res),
      owner,
      accountId: row && row.id,
      cost,
      duration: submitted.duration,
      resolution: submitted.resolution || '720p',
      audioPath: submitted.audioPath || '',
      created: Date.now(),
      result: null,
      error: '',
    };
    videoJobs.set(job.id, job);
    saveVideoJobs();
    console.log('[move-video] queued', submitted.duration + 's');
    res.json({ jobId: job.id, status: 'queued', duration: submitted.duration, cost });
  } catch (err) {
    console.log('[move-video] submit failed', err && err.message);
    res.status(400).json({ error: err.message || '生片失敗' });
  }
});

app.get('/api/clip/status', (req, res) => {
  const sid = clipSid(req, res);
  const guest = clipStore.guestEnhanceState(sid);
  const visionAccess = agentAccess(req, res, 'caption');
  res.json({
    ...clipPub.status(sid),
    vision: clipCaption.configured(),
    enhance: clipImage.configured(),
    enhanceEngine: clipImage.engine(),
    video: clipVideo.configured(),
    videoEngine: clipVideo.engine(),
    videoDuration: clipVideo.videoDuration(),
    videoCredits: clipVideo.creditCost('5'),
    videoCredits10: clipVideo.creditCost('10'),
    videoCredits15: clipVideo.creditCost('15'),
    talk: clipTalk.configured(),
    talkEngine: clipTalk.engine(),
    talkPerSecond: 1,
    tts: clipTts.configured(),
    owner: isOwner(req),
    visionLeft: visionAccess.unlimited ? null : visionAccess.left,
    visionLimit: visionAccess.unlimited ? null : visionAccess.limit,
    visionUnlimited: Boolean(visionAccess.unlimited),
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
  const access = agentAccess(req, res, 'caption');
  if (!access.unlimited && access.left <= 0) {
    return res.status(402).json({
      error: '識圖寫文案的免費試用已用完（限 1 次）。購買方案後可不限次數，不扣點。',
      left: 0,
      limit: access.limit,
      needPlan: true,
    });
  }
  try {
    const result = await clipCaption.writeCaption({
      images: Array.isArray(req.body?.images) ? req.body.images : [],
      product: String(req.body?.product || '').trim(),
      price: String(req.body?.price || '').trim(),
      hook: String(req.body?.hook || '').trim(),
      style: String(req.body?.style || 'ugc'),
    });
    const extra = access.unlimited
      ? { paid: true, unlimited: true }
      : { left: clipStore.consumeGuestAgentTrial(access.bucket, 'caption').left, limit: access.limit };
    res.json({ ...result, ...extra });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '識圖逾時，請再試一次' : (err.message || '識圖失敗');
    res.status(400).json({ error: msg });
  }
});

app.post('/api/clip/enhance', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const row = currentAccount(req);
  const paid = row ? accounts.publicAccount(row) : null;
  if (!owner && (!hasPaidClipPlan(req) || !paid || !paid.credits)) {
    return res.status(402).json({
      error: '進階生圖需購買付費工具方案並有點數。作者請先到後台登入。',
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
  if (!owner && (!hasPaidClipPlan(req) || !paid || !paid.credits)) {
    return res.status(402).json({ error: '進階生圖需購買付費工具方案並有點數。' });
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
    engine: clipVideo.videoEngine(job.model),
    duration: job.duration || clipVideo.videoDuration(),
    resolution: job.resolution || '',
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
  const duration = clipVideo.videoDuration(String(req.body?.duration || '').trim());
  const cost = clipVideo.creditCost(duration);
  if (!owner && (!paid || Number(paid.credits || 0) < cost)) {
    return res.status(402).json({
      error: `小廣告（${duration} 秒）需先到後台登入，或方案剩餘 ${cost} 點以上。`,
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
      duration,
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
      audioPath: submitted.audioPath || '',
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
    if (peek.status !== 'done') return res.json({ jobId: job.id, status: peek.status, duration: job.duration || '', resolution: job.resolution || '' });
    if (!job.saving) {
      job.saving = true;
      const videoUrl = peek.videoUrl;
      setImmediate(() => {
        clipVideo.finish(videoUrl, {
          audioPath: job.audioPath,
          engine: clipVideo.videoEngine(job.model),
          duration: job.duration,
        }).then((fileOut) => {
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
    return res.json({ jobId: job.id, status: 'saving', duration: job.duration || '' });
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
  try {
    const sid = clipSid(req, res);
    let voice;
    const voiceId = String(req.body?.voiceId || '').trim();
    if (voiceId) {
      const media = clipStore.mediaOwned(voiceId, sid) ? clipStore.getMedia(voiceId) : null;
      if (!media) return res.status(400).json({ error: '找不到口播音檔，請重新選擇。' });
      voice = { buffer: fs.readFileSync(media.full), mime: media.mime };
    }
    const seconds = clipTalk.quoteSeconds({
      narration: String(req.body?.narration || '').trim(),
      voice,
    });
    const cost = clipTalk.creditCost(seconds);
    if (!owner && (!paid || Number(paid.credits || 0) < cost)) {
      return res.status(402).json({
        error: `數字人約 ${seconds} 秒，需方案剩餘 ${cost} 點（每秒 1 點）。作者請先到後台登入。`,
      });
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
  const scriptAccess = agentAccess(req, res, 'story');
  res.json({
    open: STORY_OPEN,
    video: STORY_OPEN && storyVideo.configured(),
    videoEngine: storyVideo.engine(),
    videoProvider: storyVideo.preferredProvider(),
    videoDuration: storyVideo.videoDuration(),
    durations: ['10', '15'],
    videoCredits: storyVideo.creditCost(),
    script: storyScript.configured(),
    scriptPaid: scriptAccess.unlimited,
    scriptLeft: scriptAccess.unlimited ? null : scriptAccess.left,
    scriptLimit: scriptAccess.unlimited ? null : scriptAccess.limit,
    demoScript: storyVideo.DEMO_SCRIPT,
    owner: isOwner(req),
    storyPlan: account && account.storyPlan ? account.storyPlan : '',
    storyCredits: account ? account.storyCredits : 0,
  });
});

app.post('/api/story/script', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  const access = agentAccess(req, res, 'story');
  if (!owner && !access.unlimited && access.left <= 0) return denyAgentTrial(res);
  try {
    const result = await storyScript.writeScript({
      product: String(req.body?.product || '').trim(),
      notes: String(req.body?.notes || '').trim(),
      images: Array.isArray(req.body?.images) ? req.body.images : [],
      duration: storyVideo.videoDuration(req.body?.duration),
      mode: req.body?.mode,
    });
    const extra = owner
      ? {}
      : access.unlimited
        ? { paid: true, unlimited: true }
        : { left: clipStore.consumeGuestAgentTrial(access.bucket, 'story').left };
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
  const duration = storyVideo.videoDuration(req.body?.duration);
  const cost = storyVideo.creditCost(duration);
  if (!owner && (!paid || Number(paid.storyCredits || 0) < cost)) {
    return res.status(402).json({
      error: `這支 ${duration} 秒要扣 ${cost} 秒。請到帳號購買秒數。`,
    });
  }
  try {
    const submitted = await storyVideo.submit({
      script: String(req.body?.script || '').trim(),
      product: String(req.body?.product || '').trim(),
      images: Array.isArray(req.body?.images) ? req.body.images : [],
      duration,
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
      engine: submitted.engine || storyVideo.engine(),
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
    const fileOut = await storyVideo.finish(peek.videoUrl, { engine: job.engine, duration: job.duration });
    const saved = clipStore.saveMedia(job.sid, 'video', fileOut.buffer, fileOut.mime || 'video/mp4');
    const extra = { recovered: false, engine: job.engine, duration: job.duration };
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
      engine: recovered.engine || storyVideo.engine(),
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
  '/api/drama/cast',
], (req, res, next) => {
  if (isOwner(req)) return next();
  return res.status(404).json({ error: '找不到這個功能。' });
});

app.get('/api/drama/status', (req, res) => {
  const owner = isOwner(req);
  res.json({
    open: owner,
    video: owner && dramaVideo.configured(),
    script: owner && dramaScript.configured(),
    scenes: dramaVideo.sceneCount(),
    duration: Number(dramaVideo.sceneDuration()) * dramaVideo.sceneCount(),
    demoScript: owner ? dramaVideo.DEMO_SCRIPT : '',
    owner,
  });
});

app.post('/api/drama/cast', express.json({ limit: '8mb' }), async (req, res) => {
  if (!isOwner(req)) return res.status(404).json({ error: '找不到這個功能。' });
  try {
    const result = await dramaVideo.makeCast({
      topic: String(req.body?.topic || '').trim(),
      notes: String(req.body?.notes || '').trim(),
      script: String(req.body?.script || '').trim(),
      prompt: String(req.body?.prompt || '').trim(),
      who: String(req.body?.who || '').trim(),
      appeal: String(req.body?.appeal || '').trim(),
    });
    res.json({ images: result.images, prompt: result.prompt || '' });
  } catch (err) {
    res.status(400).json({ error: err.message || '主角沒有生出來' });
  }
});

app.post('/api/drama/script', express.json({ limit: '8mb' }), async (req, res) => {
  if (!isOwner(req)) return res.status(404).json({ error: '找不到這個功能。' });
  try {
    const result = await dramaScript.writeScript({
      topic: String(req.body?.topic || '').trim(),
      notes: String(req.body?.notes || '').trim(),
      images: Array.isArray(req.body?.images) ? req.body.images : [],
    });
    res.json({ script: result.script });
  } catch (err) {
    const msg = err.name === 'AbortError' ? '寫稿逾時，請再試一次' : (err.message || '寫稿失敗');
    res.status(400).json({ error: msg });
  }
});

app.post('/api/drama/video', express.json({ limit: '8mb' }), async (req, res) => {
  const owner = isOwner(req);
  if (!owner) return res.status(404).json({ error: '找不到這個功能。' });
  const row = currentAccount(req);
  const cost = dramaVideo.creditCost();
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
      cast: (Array.isArray(req.body?.cast) ? req.body.cast : (req.body?.cast ? [req.body.cast] : []))
        .map((item) => {
          if (item && typeof item === 'object') {
            return { role: String(item.role || 'other').trim(), image: String(item.image || '').trim() };
          }
          return { role: 'lead', image: String(item || '').trim() };
        })
        .filter((item) => /^data:image\//.test(item.image))
        .slice(0, 4),
      castPrompt: String(req.body?.castPrompt || '').trim().slice(0, 800),
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
        cast: job.cast,
        castPrompt: job.castPrompt,
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
        job.cast = [];
        saveDramaJobs();
      }).catch((err) => {
        job.error = err.message || '短劇失敗';
        job.images = [];
        job.cast = [];
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
  if (!isOwner(req)) return res.status(404).json({ error: '找不到這個功能。' });
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

app.get(['/dongli', '/dongli/'], (_req, res) => {
  res.redirect(302, '/dongli/view.html');
});

app.use(express.static(PUBLIC, { index: false }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  sendPage(req, res, '404.html', 404);
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: '圖片太大，單張請小於 2MB。' });
  }
  if (err instanceof SyntaxError && err.status === 400) {
    return res.status(400).json({ error: '送出的內容無法讀取。' });
  }
  return next(err);
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
