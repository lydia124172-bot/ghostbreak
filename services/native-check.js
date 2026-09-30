const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Resend } = require('resend');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const FILE = path.join(DATA_DIR, 'native-check-orders.json');
const BRAND = 'Native Chinese Check';
const MODELS = ['gemini-flash-lite-latest', 'gemini-3.6-flash'];

const PLANS = {
  quick: {
    id: 'quick',
    name: 'Quick Fix',
    amount: '9.00',
    maxDraft: 300,
    maxMeaning: 800,
    turnaround: '24 hours',
  },
  polish: {
    id: 'polish',
    name: 'Polish',
    amount: '29.00',
    maxDraft: 1000,
    maxMeaning: 2500,
    turnaround: '48 hours',
  },
  tattoo: {
    id: 'tattoo',
    name: 'Tattoo Check',
    amount: '15.00',
    maxDraft: 20,
    maxMeaning: 200,
    turnaround: '24 hours',
  },
};

const CALLIGRAPHY = { name: 'Calligraphy design', amount: '25.00', turnaround: '48 hours' };
const FILES_DIR = path.join(DATA_DIR, 'nc-files');

const TONES = ['natural', 'romantic', 'formal', 'business', 'friendly', 'respectful'];
const STATUSES = ['pending_payment', 'paid', 'in_progress', 'delivered', 'refunded'];

function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(data.orders) ? data.orders : [];
  } catch {
    return [];
  }
}

function save(orders) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ orders }, null, 2), 'utf8');
}

function publicPlans() {
  return Object.values(PLANS).map(({ id, name, amount, maxDraft, turnaround }) => ({ id, name, amount, maxDraft, turnaround }));
}

function publicAddons() {
  return { calligraphy: { ...CALLIGRAPHY, plans: ['tattoo'] } };
}

function turnaroundOf(row) {
  return row.calligraphy ? CALLIGRAPHY.turnaround : PLANS[row.planId]?.turnaround || '48 hours';
}

function cleanText(value, max) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function validateOrder(body = {}) {
  const plan = PLANS[String(body.plan || '')];
  if (!plan) throw new Error('Please choose a plan.');
  const draft = String(body.draft || '').replace(/\r/g, '').trim();
  const meaning = String(body.meaning || '').replace(/\r/g, '').trim();
  if (!draft && !meaning) throw new Error('Please paste your Chinese text, or tell us in English what you want to say.');
  if (draft.length > plan.maxDraft) throw new Error(`${plan.name} covers up to ${plan.maxDraft} Chinese characters. Please shorten it or choose a bigger plan.`);
  if (meaning.length > plan.maxMeaning) throw new Error(`Your English note is too long for ${plan.name}. Please shorten it or choose a bigger plan.`);
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email so we can send you the result.');
  return {
    plan,
    draft,
    meaning,
    email,
    name: cleanText(body.name, 60),
    purpose: cleanText(body.purpose, 200),
    tone: TONES.includes(body.tone) ? body.tone : 'natural',
    calligraphy: plan.id === 'tattoo' && body.calligraphy === true,
  };
}

function createOrder(fields) {
  const orders = load();
  const row = {
    id: `NC-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    key: crypto.randomBytes(12).toString('hex'),
    planId: fields.plan.id,
    planName: fields.calligraphy ? `${fields.plan.name} + Calligraphy Design` : fields.plan.name,
    amount: fields.calligraphy
      ? (Number(fields.plan.amount) + Number(CALLIGRAPHY.amount)).toFixed(2)
      : fields.plan.amount,
    calligraphy: fields.calligraphy,
    image: '',
    draft: fields.draft,
    meaning: fields.meaning,
    purpose: fields.purpose,
    tone: fields.tone,
    email: fields.email,
    name: fields.name,
    status: 'pending_payment',
    paypalOrderId: '',
    createdAt: new Date().toISOString(),
    paidAt: null,
    deliveredAt: null,
    result: '',
    notes: '',
  };
  orders.unshift(row);
  save(orders);
  return row;
}

function findOrder(id) {
  return load().find((o) => o.id === id) || null;
}

function updateOrder(id, patch) {
  const orders = load();
  const row = orders.find((o) => o.id === id);
  if (!row) return null;
  Object.assign(row, patch);
  save(orders);
  return row;
}

function customerView(row) {
  return {
    id: row.id,
    planName: row.planName,
    amount: row.amount,
    status: row.status,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
    draft: row.draft,
    meaning: row.meaning,
    result: row.status === 'delivered' ? row.result : '',
    notes: row.status === 'delivered' ? row.notes : '',
    calligraphy: Boolean(row.calligraphy),
    hasImage: row.status === 'delivered' && Boolean(row.image),
  };
}

// ── Calligraphy image ──────────────────────────────────────────

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function saveImage(id, dataUrl) {
  const row = findOrder(id);
  if (!row) throw new Error('找不到訂單');
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('請上傳 JPG 或 PNG 圖片');
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('圖片太大，請小於 6MB');
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
  if (row.image) fs.rmSync(path.join(FILES_DIR, row.image), { force: true });
  const name = `${row.id}-${crypto.randomBytes(4).toString('hex')}.${IMAGE_TYPES[match[1]]}`;
  fs.writeFileSync(path.join(FILES_DIR, name), buf);
  return updateOrder(row.id, { image: name });
}

function imagePath(row) {
  if (!row?.image) return null;
  const file = path.join(FILES_DIR, path.basename(row.image));
  return fs.existsSync(file) ? file : null;
}

// ── AI free check ──────────────────────────────────────────────

const PROMPT = `You are a native Taiwanese Mandarin teacher. A non-native speaker wrote the Chinese text below (often with Google Translate or AI).
Judge how natural it sounds to a native speaker in Taiwan (Traditional Chinese).
Reply ONLY with JSON:
{"verdict":"natural|minor|unnatural","summary":"one or two sentences in English","issues":[{"text":"the exact problem phrase from the input","why":"short English explanation of why it sounds wrong or unnatural"}]}
Rules:
- Up to 5 issues, most important first. Quote phrases exactly as written.
- Do NOT give the corrected sentence or a rewritten version. Only point out problems and explain.
- If the text is in Simplified Chinese, mention in the summary that it will be delivered in Traditional Chinese.
- If the input is not Chinese, set verdict "unnatural" and say so in the summary.`;

function aiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function askModel(model, text, context) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\n${context ? `What the writer wants to say (English): ${context}\n\n` : ''}Chinese text:\n${text}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: 'application/json' },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `AI ${res.status}`);
    const out = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const match = out.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI returned no result');
    return JSON.parse(match[0]);
  } finally {
    clearTimeout(timer);
  }
}

async function aiCheck(text, context) {
  if (!aiConfigured()) throw new Error('The free AI check is not available right now. You can still order a teacher review.');
  const draft = String(text || '').trim().slice(0, 300);
  if (!draft) throw new Error('Please paste some Chinese text first.');
  let lastErr;
  for (const model of MODELS) {
    try {
      const data = await askModel(model, draft, cleanText(context, 400));
      const verdict = ['natural', 'minor', 'unnatural'].includes(data.verdict) ? data.verdict : 'minor';
      return {
        verdict,
        summary: cleanText(data.summary, 400),
        issues: (Array.isArray(data.issues) ? data.issues : []).slice(0, 5).map((i) => ({
          text: cleanText(i.text, 80),
          why: cleanText(i.why, 240),
        })).filter((i) => i.text || i.why),
      };
    } catch (err) {
      lastErr = err;
    }
  }
  console.error('[native-check ai]', lastErr && lastErr.message);
  throw new Error('The AI check is busy. Please try again in a minute.');
}

// ── Email ──────────────────────────────────────────────────────

function domain() {
  return String(process.env.DOMAIN_NAME || 'bafuholdings.com').trim().toLowerCase();
}

function notifyAddress() {
  return String(process.env.NC_NOTIFY_EMAIL || process.env.INQUIRE_EMAIL || '').trim();
}

let resend = null;
async function sendMail({ to, subject, text, html, replyTo, attachments }) {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  if (!key || !to) {
    console.log('[native-check mail skipped]', subject, '→', to || '(no address)');
    return { skipped: true };
  }
  if (!resend) resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: `${BRAND} <noreply@${domain()}>`,
    to: [to],
    subject,
    text,
    html,
    ...(replyTo ? { replyTo } : {}),
    ...(attachments?.length ? { attachments } : {}),
  });
  if (error) throw new Error(error.message || 'Email failed');
  return data;
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function orderLink(baseUrl, row) {
  return `${baseUrl}/chinese-check/order?id=${encodeURIComponent(row.id)}&k=${row.key}`;
}

async function mailPaid(baseUrl, row) {
  const link = orderLink(baseUrl, row);
  const tasks = [sendMail({
    to: row.email,
    subject: `We got your order ${row.id} — ${BRAND}`,
    text: `Hi${row.name ? ` ${row.name}` : ''},\n\nThanks for your order (${row.planName}, US$${row.amount}). A native Taiwanese teacher will check your Chinese and email you the result within ${turnaroundOf(row)}.\n\nTrack your order: ${link}\n\n— ${BRAND}`,
    html: `<p>Hi${row.name ? ` ${esc(row.name)}` : ''},</p><p>Thanks for your order (<b>${esc(row.planName)}</b>, US$${esc(row.amount)}). A native Taiwanese teacher will check your Chinese and email you the result within ${esc(turnaroundOf(row))}.</p><p><a href="${link}">Track your order</a></p><p>— ${BRAND}</p>`,
  })];
  const owner = notifyAddress();
  if (owner) {
    tasks.push(sendMail({
      to: owner,
      subject: `新訂單 ${row.id}：${row.planName} US$${row.amount}`,
      text: `有新的中文修改訂單。\n方案：${row.planName}${row.calligraphy ? '\n★ 含書法字體圖稿：用教育部標準楷書、教育部隸書、霞鶩文楷 TC 排好，交件時在後台上傳圖檔（48 小時內）' : ''}\n客人：${row.email}\n用途：${row.purpose || '-'}\n語氣：${row.tone}\n\n中文原文：\n${row.draft || '(無)'}\n\n英文想表達的意思：\n${row.meaning || '(無)'}\n\n請到後台交件：${baseUrl}/admin.html`,
    }));
  }
  const results = await Promise.allSettled(tasks);
  results.filter((r) => r.status === 'rejected').forEach((r) => console.error('[native-check mail]', r.reason?.message));
}

async function mailDelivered(baseUrl, row) {
  const link = orderLink(baseUrl, row);
  const img = imagePath(row);
  await sendMail({
    to: row.email,
    ...(img ? { attachments: [{ filename: `calligraphy-${row.id}${path.extname(img)}`, content: fs.readFileSync(img) }] } : {}),
    replyTo: `support@${domain()}`,
    subject: `Your checked Chinese is ready — ${row.id}`,
    text: `Hi${row.name ? ` ${row.name}` : ''},\n\nHere is your checked Chinese:\n\n${row.result}\n\n${row.notes ? `Teacher's notes:\n${row.notes}\n\n` : ''}${img ? 'Your calligraphy design is attached. Show it to your tattoo artist exactly as it is.\n\n' : ''}View it online: ${link}\n\nQuestions? Just reply to this email.\n\n— ${BRAND}`,
    html: `<p>Hi${row.name ? ` ${esc(row.name)}` : ''},</p><p>Here is your checked Chinese:</p><div style="font-size:20px;line-height:1.8;padding:16px;border-left:4px solid #b4552d;background:#faf7f2;white-space:pre-wrap">${esc(row.result)}</div>${row.notes ? `<p><b>Teacher's notes</b></p><div style="white-space:pre-wrap">${esc(row.notes)}</div>` : ''}${img ? '<p><b>Your calligraphy design is attached.</b> Show it to your tattoo artist exactly as it is.</p>' : ''}<p><a href="${link}">View it online</a></p><p>Questions? Just reply to this email.</p><p>— ${BRAND}</p>`,
  });
}

module.exports = {
  PLANS,
  STATUSES,
  publicPlans,
  publicAddons,
  saveImage,
  imagePath,
  validateOrder,
  createOrder,
  findOrder,
  updateOrder,
  loadOrders: load,
  customerView,
  aiConfigured,
  aiCheck,
  mailPaid,
  mailDelivered,
};
