const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const express = require('express');
const site = require('./data/site');
const {
  RESTAURANT_EMAIL,
  initMail,
  sendMail,
  saveReservation,
  mailConfigured,
} = require('./services/mail');
const {
  smsConfigured,
  sendReservationSms,
  sendFranchiseSms,
  sendGuestReserveSms,
  sendGuestFranchiseSms,
  getReservationNotifyPhones,
  getFranchiseNotifyPhone,
  isSmsTestMode,
  getFromNumber,
} = require('./services/sms');
const {
  getAvailability,
  getDayAvailability,
  checkReservationCapacity,
} = require('./services/capacity');
const { getLocationClosedInfo } = require('./services/store-hours');

const PORT = process.env.PORT || 3001;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const GA_MEASUREMENT_ID = String(process.env.GA_MEASUREMENT_ID || '').trim();
const app = express();

app.use(express.json());

function isPhone(value) {
  return /^[\d\s\-+()]{8,20}$/.test(String(value || '').trim());
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function locationById(id) {
  return site.locations.find((l) => l.id === id);
}

function resolveManagerPhone(loc) {
  const phones = getReservationNotifyPhones(loc);
  return phones[0] || '';
}

async function safeSendMail(opts) {
  try {
    return await sendMail(opts);
  } catch (err) {
    console.error('[Mail] 發送失敗', { to: opts.to, error: err.message });
    return { via: 'error', error: err.message };
  }
}

app.get('/api/health', (_req, res) => {
  const locs = site.locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    notifyCount: getReservationNotifyPhones(loc).length,
  }));
  const from = getFromNumber();
  res.json({
    ok: true,
    service: 'buff-steak',
    mail: mailConfigured(),
    sms: smsConfigured(),
    smsTestMode: isSmsTestMode(),
    twilioFromSuffix: from ? from.slice(-4) : null,
    franchiseNotify: getFranchiseNotifyPhone() || null,
    locations: locs,
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    brand: site.brand,
    locations: site.locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      phone: loc.phone,
      phoneTel: loc.phoneTel,
      address: loc.address,
      hours: loc.hours,
      closedWeekdays: loc.closedWeekdays || [],
      mapQuery: loc.mapQuery,
      capacity: loc.capacity,
    })),
    timeSlots: site.timeSlots,
    timeSlotGroups: site.timeSlotGroups,
    diningDuration: site.diningDuration,
    mailConfigured: mailConfigured(),
    smsConfigured: smsConfigured(),
  });
});

app.get('/api/reserve/availability', (req, res) => {
  const locationId = String(req.query.locationId || '').trim();
  const date = String(req.query.date || '').trim();
  const time = String(req.query.time || '').trim();

  const loc = locationById(locationId);
  if (!loc) return res.status(400).json({ error: '請選擇分店' });
  if (!date || !time) return res.status(400).json({ error: '請選擇日期與時間' });
  if (!site.timeSlots.includes(time)) return res.status(400).json({ error: '請選擇有效時段' });

  res.json(getAvailability(loc, date, time));
});

app.get('/api/reserve/day-availability', (req, res) => {
  const locationId = String(req.query.locationId || '').trim();
  const date = String(req.query.date || '').trim();

  const loc = locationById(locationId);
  if (!loc) return res.status(400).json({ error: '請選擇分店' });
  if (!date) return res.status(400).json({ error: '請選擇日期' });

  const closedInfo = getLocationClosedInfo(loc, date);
  const slots = getDayAvailability(loc, date);

  res.json({
    locationId: loc.id,
    date,
    closed: closedInfo.closed,
    closedMessage: closedInfo.message,
    slots,
  });
});

app.post('/api/reserve', async (req, res) => {
  try {
    const {
      locationId, date, time, guests, name, phone, email, notes,
    } = req.body || {};

    const loc = locationById(String(locationId || '').trim());
    if (!loc) return res.status(400).json({ success: false, error: '請選擇分店' });
    if (!date || !time) return res.status(400).json({ success: false, error: '請選擇日期與時間' });
    if (!name || String(name).trim().length < 2) return res.status(400).json({ success: false, error: '請填寫姓名' });
    if (!isPhone(phone)) return res.status(400).json({ success: false, error: '請填寫有效電話' });

    const guestsNum = Number(guests);
    if (!guestsNum || guestsNum < 1 || guestsNum > 20) {
      return res.status(400).json({ success: false, error: '人數請填 1–20 人' });
    }

    if (!site.timeSlots.includes(time)) {
      return res.status(400).json({ success: false, error: '請選擇有效時段' });
    }

    const capacityCheck = checkReservationCapacity(loc, date, time, guestsNum);
    if (!capacityCheck.ok) {
      return res.status(400).json({
        success: false,
        error: capacityCheck.message,
        code: capacityCheck.code,
        capacity: capacityCheck.capacity,
        booked: capacityCheck.booked,
        remaining: capacityCheck.remaining,
      });
    }

    const entry = {
      id: `R-${Date.now()}`,
      createdAt: new Date().toISOString(),
      locationId: loc.id,
      locationName: loc.name,
      date,
      time,
      guests: guestsNum,
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: String(email || '').trim(),
      notes: String(notes || '').trim(),
    };

    saveReservation(entry);

    const subject = `[八斧牛排] 線上訂位 — ${loc.name} ${date} ${time}`;
    const text = [
      '新的線上訂位',
      '──────────────',
      `分店：${loc.name}`,
      `日期：${date}`,
      `時間：${time}`,
      `人數：${guestsNum}`,
      `姓名：${entry.name}`,
      `電話：${entry.phone}`,
      entry.email ? `Email：${entry.email}` : null,
      entry.notes ? `備註：${entry.notes}` : null,
      `單號：${entry.id}`,
      `提交時間：${entry.createdAt}`,
    ].filter(Boolean).join('\n');

    if (RESTAURANT_EMAIL) {
      await safeSendMail({ to: RESTAURANT_EMAIL, subject, text });
    }

    let guestEmailSent = false;
    if (entry.email && isEmail(entry.email)) {
      const guestMail = await safeSendMail({
        to: entry.email,
        subject: '八斧牛排訂位已收到（待餐廳確認）',
        text: [
          `${entry.name} 您好，`,
          '',
          '我們已收到您的線上訂位，此為「待確認」狀態，尚未保留座位。',
          '',
          `分店：${loc.name}`,
          `日期：${date}`,
          `時間：${time}`,
          `人數：${guestsNum} 人`,
          `單號：${entry.id}`,
          '',
          '我們將盡快致電與您確認。如需更改請直接致電分店：',
          `${loc.phone}`,
          '',
          '感謝您選擇八斧牛排。',
        ].join('\n'),
      });
      guestEmailSent = guestMail?.via === 'resend' || guestMail?.via === 'smtp' || guestMail?.via === 'dry-run';
    }

    const guestSmsResult = await sendGuestReserveSms(entry, loc);
    const guestSmsSent = guestSmsResult?.via === 'twilio' || guestSmsResult?.via === 'dry-run';

    const notifyPhones = getReservationNotifyPhones(loc);
    let smsSent = false;
    if (notifyPhones.length) {
      const smsResults = await sendReservationSms(entry, loc);
      smsSent = smsResults.some((r) => r.via === 'twilio' || r.via === 'dry-run');
    } else {
      console.warn(`[Reserve] 未設定 ${loc.name} 店長手機，略過簡訊通知`);
    }

    res.json({
      success: true,
      id: entry.id,
      message: '訂位已送出，我們將電話與您確認。',
      smsSent,
      guestConfirmation: {
        sms: guestSmsSent,
        email: guestEmailSent,
      },
    });
  } catch (err) {
    console.error('[Reserve]', err.message);
    res.status(500).json({ success: false, error: '送出失敗，請稍後再試或直接致電分店' });
  }
});

app.post('/api/franchise', async (req, res) => {
  try {
    const {
      name, phone, email, city, budget, experience, message,
    } = req.body || {};

    if (!name || String(name).trim().length < 2) return res.status(400).json({ success: false, error: '請填寫姓名' });
    if (!isPhone(phone)) return res.status(400).json({ success: false, error: '請填寫有效電話' });
    if (!email || !isEmail(email)) return res.status(400).json({ success: false, error: '請填寫有效 Email' });
    if (!city || String(city).trim().length < 2) return res.status(400).json({ success: false, error: '請填寫意向城市/區域' });

    const entry = {
      id: `F-${Date.now()}`,
      createdAt: new Date().toISOString(),
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: String(email).trim(),
      city: String(city).trim(),
      budget: String(budget || '').trim(),
      experience: String(experience || '').trim(),
      message: String(message || '').trim(),
    };

    const subject = `[八斧牛排] 加盟詢問 — ${entry.name} / ${entry.city}`;
    const text = [
      '新的加盟詢問',
      '──────────────',
      `姓名：${entry.name}`,
      `電話：${entry.phone}`,
      `Email：${entry.email}`,
      `意向區域：${entry.city}`,
      entry.budget ? `預算：${entry.budget}` : null,
      entry.experience ? `餐飲經驗：${entry.experience}` : null,
      entry.message ? `留言：${entry.message}` : null,
      `單號：${entry.id}`,
    ].filter(Boolean).join('\n');

    if (RESTAURANT_EMAIL) {
      await safeSendMail({ to: RESTAURANT_EMAIL, subject, text });
    }

    const guestMail = await safeSendMail({
      to: entry.email,
      subject: '八斧牛排加盟詢問已收到',
      text: [
        `${entry.name} 您好，`,
        '',
        '我們已收到您的加盟合作詢問，感謝您對八斧牛排的關注。',
        '',
        `意向區域：${entry.city}`,
        entry.budget ? `預算範圍：${entry.budget}` : null,
        entry.experience ? `餐飲經驗：${entry.experience}` : null,
        `單號：${entry.id}`,
        '',
        '我們將盡快與您聯繫，請保持手機暢通。',
        '',
        '八斧牛排 BUFF STEAK',
      ].filter(Boolean).join('\n'),
    });
    const guestEmailSent = guestMail?.via === 'resend' || guestMail?.via === 'smtp' || guestMail?.via === 'dry-run';

    const franchiseSms = await sendFranchiseSms(entry);
    const smsSent = franchiseSms?.via === 'twilio' || franchiseSms?.via === 'dry-run';

    const guestSmsResult = await sendGuestFranchiseSms(entry);
    const guestSmsSent = guestSmsResult?.via === 'twilio' || guestSmsResult?.via === 'dry-run';

    res.json({
      success: true,
      id: entry.id,
      message: '已收到您的加盟詢問，我們將盡快與您聯繫。',
      smsSent,
      guestConfirmation: {
        sms: guestSmsSent,
        email: guestEmailSent,
      },
    });
  } catch (err) {
    console.error('[Franchise]', err.message);
    res.status(500).json({ success: false, error: '送出失敗，請稍後再試' });
  }
});

const PUBLIC = path.join(__dirname, 'public');
const HTML_PAGES = ['menu', 'locations', 'reserve', 'franchise', 'gallery', 'story'];
const HTML_SKIP_GA = new Set(['404.html']);

function injectGaSnippet(html) {
  if (!GA_MEASUREMENT_ID || html.includes('googletagmanager.com/gtag/js')) return html;
  const id = GA_MEASUREMENT_ID.replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) return html;
  const snippet = `
  <script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${id}', { anonymize_ip: true });
  </script>`;
  return html.replace('</head>', `${snippet}\n</head>`);
}

function sendPage(res, file) {
  const filePath = path.join(PUBLIC, file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).sendFile('404.html', { root: PUBLIC });
  }
  if (HTML_SKIP_GA.has(file) || !file.endsWith('.html')) {
    return res.sendFile(file, { root: PUBLIC });
  }
  let html = fs.readFileSync(filePath, 'utf8');
  html = injectGaSnippet(html);
  res.type('html').send(html);
}

function sendPublicText(res, file, contentType) {
  const filePath = path.join(PUBLIC, file);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.type(contentType).send(fs.readFileSync(filePath, 'utf8'));
}

function buildSitemapXml() {
  const lastmod = '2026-08-11';
  const paths = ['/', '/menu', '/reserve', '/locations', '/gallery', '/story', '/franchise'];
  const priorities = { '/': '1.0', '/menu': '0.9', '/reserve': '0.95', '/locations': '0.9', '/gallery': '0.7', '/story': '0.7', '/franchise': '0.6' };
  const urls = paths.map((p) => {
    const loc = p === '/' ? `${BASE_URL}/` : `${BASE_URL}${p}`;
    return `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><priority>${priorities[p] || '0.5'}</priority></url>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').send(buildSitemapXml());
});

app.get('/', (_req, res) => sendPage(res, 'index.html'));
HTML_PAGES.forEach((page) => {
  app.get(`/${page}`, (_req, res) => sendPage(res, `${page}.html`));
});

app.use(express.static(PUBLIC, { index: false }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  let rel = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
  if (!rel.includes('.')) {
    const htmlPath = path.join(PUBLIC, `${rel}.html`);
    if (fs.existsSync(htmlPath)) rel = `${rel}.html`;
  }
  const file = path.join(PUBLIC, rel);
  if (fs.existsSync(file) && rel.endsWith('.html')) return sendPage(res, rel);
  if (fs.existsSync(file)) return res.sendFile(rel, { root: PUBLIC });
  return sendPage(res, '404.html');
});

app.listen(PORT, async () => {
  await initMail();
  console.log('');
  console.log('========================================');
  console.log('  八斧牛排 BUFF STEAK 官網已啟動');
  console.log(`  網址 → ${BASE_URL}`);
  console.log('========================================');
  console.log(`Mail: ${mailConfigured() ? '已設定' : '未設定（表單仍可測試，請設 RESTAURANT_EMAIL）'}`);
  if (smsConfigured()) {
    if (isSmsTestMode()) {
      console.log('SMS:  已設定（⚠️ 測試模式：簡訊只發給總部，不通知店長）');
    } else {
      console.log('SMS:  已設定（正式模式：店長 + 總部都會收到）');
    }
    console.log('  訂位簡訊：');
    site.locations.forEach((loc) => {
      const phones = getReservationNotifyPhones(loc);
      console.log(`    ${loc.name} → ${phones.length ? phones.join('、') : '未設定'}`);
    });
    console.log(`  加盟簡訊 → ${getFranchiseNotifyPhone() || '未設定'}`);
  } else {
    console.log('SMS:  未設定（請在 .env 設 TWILIO_* 與店長手機）');
  }
  console.log(`GA4:  ${GA_MEASUREMENT_ID || '未設定（請設 GA_MEASUREMENT_ID）'}`);
  console.log('');
});
