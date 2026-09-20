const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const express = require('express');
const { adminConfigured, login: adminLogin, requireAdmin } = require('./services/admin-auth');
const { publicConfig, loadContent, saveContent, upsertItem, removeItem } = require('./services/content');
const { loadInquiries, addInquiry, removeInquiry } = require('./services/inquiries');
const { INQUIRE_EMAIL, initMail, sendMail, inquiryMail, mailConfigured } = require('./services/mail');

const PORT = Number(process.env.PORT || 3002);
const BASE_URL = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const PUBLIC = path.join(__dirname, 'public');

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

function sendPage(res, file, status = 200) {
  const full = path.join(PUBLIC, file);
  if (!fs.existsSync(full)) {
    res.status(404).type('html').send('<h1>Not found</h1>');
    return;
  }
  res.status(status).type('html').send(fs.readFileSync(full, 'utf8'));
}

Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (_req, res) => sendPage(res, file));
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin.html\n');
});

app.use(express.static(PUBLIC, { index: false }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  sendPage(res, '404.html', 404);
});

app.listen(PORT, async () => {
  await initMail();
  console.log(`麋鹿網    http://127.0.0.1:${PORT}`);
  console.log(`後台      http://127.0.0.1:${PORT}/admin`);
  console.log(`BASE_URL ${BASE_URL}`);
  console.log(`諮詢信箱 → ${INQUIRE_EMAIL || '未設定'}`);
  console.log(`Mail: ${mailConfigured() ? '已設定' : '未設定（請在 .env 放 RESEND_API_KEY）'}`);
});
