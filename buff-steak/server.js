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
  loadReservations,
  findReservation,
  updateReservation,
  mailConfigured,
} = require('./services/mail');
const { adminConfigured, login: adminLogin, requireAdmin } = require('./services/admin-auth');
const {
  smsConfigured,
  sendReservationSms,
  sendFranchiseSms,
  getReservationNotifyPhones,
  isSmsTestMode,
  getFromNumber,
} = require('./services/sms');
const {
  getAvailability,
  getDayAvailability,
  checkReservationCapacity,
} = require('./services/capacity');
const { getLocationClosedInfo } = require('./services/store-hours');
const { isValidTimeSlot, getAllPossibleTimeSlots } = require('./services/time-slots');
const { loadSettings, setOnlineFull, isOnlineFull, getOnlineFullMessage } = require('./services/store-settings');
const { formatDateWithWeekday } = require('./services/dates');

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
    franchiseNotify: null,
    hqNotify: 'email',
    adminConfigured: adminConfigured(),
    locations: locs,
  });
});

app.get('/api/config', (_req, res) => {
  const settings = loadSettings();
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
      onlineFull: Boolean(settings.onlineFull[loc.id]),
      onlineFullMessage: getOnlineFullMessage(loc),
    })),
    timeSlots: getAllPossibleTimeSlots(),
    timeSlotGroups: site.timeSlotGroups,
    timeSlotsByLocation: site.timeSlotsByLocation,
    diningDuration: site.diningDuration,
    minAdvanceHours: site.minAdvanceHours || 6,
    maxOnlineGuests: site.maxOnlineGuests || 9,
    reservationNotices: site.reservationNotices || [],
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
  if (!isValidTimeSlot(loc, date, time)) return res.status(400).json({ error: '請選擇有效時段' });

  if (isOnlineFull(loc.id)) {
    return res.json({
      ...getAvailability(loc, date, time),
      remaining: 0,
      available: false,
      onlineFull: true,
      onlineFullMessage: getOnlineFullMessage(loc),
    });
  }

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
  const onlineFull = isOnlineFull(loc.id);

  res.json({
    locationId: loc.id,
    date,
    closed: closedInfo.closed,
    closedMessage: closedInfo.message,
    onlineFull,
    onlineFullMessage: onlineFull ? getOnlineFullMessage(loc) : null,
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
    if (!guestsNum || guestsNum < 1) {
      return res.status(400).json({ success: false, error: '人數請填 1–9 人' });
    }

    const maxOnline = Number(site.maxOnlineGuests) || 9;
    if (guestsNum > maxOnline) {
      return res.status(400).json({
        success: false,
        error: `10 人以上不接受線上訂位，請致電${loc.name} ${loc.phone} 提前訂位，並於用餐前 1 天至分店預付訂金。`,
        code: 'PARTY_TOO_LARGE',
      });
    }

    if (!isValidTimeSlot(loc, date, time)) {
      return res.status(400).json({ success: false, error: '請選擇有效時段' });
    }

    if (isOnlineFull(loc.id)) {
      return res.status(400).json({
        success: false,
        error: getOnlineFullMessage(loc),
        code: 'ONLINE_FULL',
      });
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
      status: 'pending',
    };

    saveReservation(entry);

    const dateLabel = formatDateWithWeekday(date);
    const subject = `[八斧牛排] 線上訂位 — ${loc.name} ${dateLabel} ${time}`;
    const text = [
      '新的線上訂位',
      '──────────────',
      `分店：${loc.name}`,
      `日期：${dateLabel}`,
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
          `日期：${dateLabel}`,
          `時間：${time}`,
          `人數：${guestsNum} 人`,
          `單號：${entry.id}`,
          '',
          '如需更改或取消請提早 2 小時致電分店：',
          `${loc.phone}`,
          '',
          '感謝您選擇八斧牛排。',
        ].join('\n'),
      });
      guestEmailSent = guestMail?.via === 'resend' || guestMail?.via === 'smtp' || guestMail?.via === 'dry-run';
    }

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
      message: '訂位已送出。',
      reservation: {
        id: entry.id,
        locationName: loc.name,
        date,
        dateLabel,
        time,
        guests: guestsNum,
      },
      smsSent,
      guestConfirmation: {
        sms: false,
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

    res.json({
      success: true,
      id: entry.id,
      message: '已收到您的加盟詢問，我們將盡快與您聯繫。',
      smsSent,
      guestConfirmation: {
        sms: false,
        email: guestEmailSent,
      },
    });
  } catch (err) {
    console.error('[Franchise]', err.message);
    res.status(500).json({ success: false, error: '送出失敗，請稍後再試' });
  }
});

function reservationFieldsFromBody(body) {
  const locationId = String(body.locationId || '').trim();
  const loc = locationById(locationId);
  const date = String(body.date || '').trim();
  const time = String(body.time || '').trim();
  const guestsNum = Number(body.guests);
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const notes = String(body.notes || '').trim();
  const status = String(body.status || 'pending').trim();
  return { loc, locationId, date, time, guestsNum, name, phone, email, notes, status };
}

function validateReservationInput(fields, { requireAll } = { requireAll: true }) {
  const { loc, date, time, guestsNum, name, phone, email, status } = fields;
  if (requireAll || fields.locationId) {
    if (!loc) return '請選擇分店';
  }
  if (requireAll || date) {
    if (!date) return '請選擇日期';
  }
  if (requireAll || time) {
    if (!time) return '請選擇時間';
    if (!isValidTimeSlot(loc, date, time)) return '請選擇有效時段';
  }
  if (requireAll || Number.isFinite(guestsNum)) {
    if (!guestsNum || guestsNum < 1 || guestsNum > 9) return '人數請填 1–9 人；10 人以上請致電分店，不在系統建檔';
  }
  if (requireAll || name) {
    if (!name || name.length < 2) return '請填寫姓名';
  }
  if (requireAll || phone) {
    if (!isPhone(phone)) return '請填寫有效電話';
  }
  if (email && !isEmail(email)) return 'Email 格式不正確';
  if (status && !['pending', 'confirmed', 'cancelled'].includes(status)) {
    return '狀態請選 待確認 / 已確認 / 已取消';
  }
  return null;
}

async function notifyGuestReservationChange(entry, loc, kind) {
  if (!entry.email || !isEmail(entry.email)) return;
  const titles = {
    created: '八斧牛排訂位已為您建立',
    updated: '八斧牛排訂位資料已更新',
    cancelled: '八斧牛排訂位已取消',
    confirmed: '八斧牛排訂位已確認',
  };
  const subject = titles[kind] || titles.updated;
  await safeSendMail({
    to: entry.email,
    subject,
    text: [
      `${entry.name} 您好，`,
      '',
      kind === 'cancelled' ? '您的訂位已取消。' : '您的訂位資料如下：',
      '',
      `分店：${loc?.name || entry.locationName}`,
      `日期：${formatDateWithWeekday(entry.date)}`,
      `時間：${entry.time}`,
      `人數：${entry.guests} 人`,
      `狀態：${entry.status === 'confirmed' ? '已確認' : entry.status === 'cancelled' ? '已取消' : '待確認'}`,
      `單號：${entry.id}`,
      '',
      `如有疑問請致電分店：${loc?.phone || ''}`,
      '',
      '八斧牛排 BUFF STEAK',
    ].join('\n'),
  });
}

app.post('/api/admin/login', (req, res) => {
  const result = adminLogin(req.body?.password);
  if (!result.ok) return res.status(401).json({ error: result.error });
  res.json({ token: result.token });
});

app.get('/api/admin/reservations', requireAdmin, (req, res) => {
  const locationId = String(req.query.locationId || '').trim();
  const date = String(req.query.date || '').trim();
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();

  let list = loadReservations();
  if (locationId) list = list.filter((r) => r.locationId === locationId);
  if (date) list = list.filter((r) => r.date === date);
  if (status) list = list.filter((r) => (r.status || 'pending') === status);
  if (q) {
    list = list.filter((r) => {
      const hay = `${r.id} ${r.name} ${r.phone} ${r.email || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }
  list.sort((a, b) => {
    const da = `${a.date || ''} ${a.time || ''}`;
    const db = `${b.date || ''} ${b.time || ''}`;
    return db.localeCompare(da) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  res.json({ reservations: list });
});

app.post('/api/admin/reservations', requireAdmin, async (req, res) => {
  try {
    const fields = reservationFieldsFromBody(req.body || {});
    const err = validateReservationInput(fields);
    if (err) return res.status(400).json({ error: err });

    const { loc, date, time, guestsNum, name, phone, email, notes, status } = fields;
    const capacityCheck = checkReservationCapacity(loc, date, time, guestsNum, { skipLeadTime: true });
    if (!capacityCheck.ok) {
      return res.status(400).json({ error: capacityCheck.message, code: capacityCheck.code });
    }

    const entry = {
      id: `R-${Date.now()}`,
      createdAt: new Date().toISOString(),
      locationId: loc.id,
      locationName: loc.name,
      date,
      time,
      guests: guestsNum,
      name,
      phone,
      email,
      notes,
      status: status === 'cancelled' ? 'cancelled' : (status || 'confirmed'),
      source: 'admin',
    };
    saveReservation(entry);
    await notifyGuestReservationChange(entry, loc, entry.status === 'confirmed' ? 'confirmed' : 'created');
    res.json({ success: true, reservation: entry });
  } catch (e) {
    console.error('[Admin create]', e.message);
    res.status(500).json({ error: '新增失敗' });
  }
});

app.patch('/api/admin/reservations/:id', requireAdmin, async (req, res) => {
  try {
    const current = findReservation(req.params.id);
    if (!current) return res.status(404).json({ error: '找不到這筆訂位' });

    const merged = {
      locationId: req.body.locationId ?? current.locationId,
      date: req.body.date ?? current.date,
      time: req.body.time ?? current.time,
      guests: req.body.guests ?? current.guests,
      name: req.body.name ?? current.name,
      phone: req.body.phone ?? current.phone,
      email: req.body.email ?? current.email,
      notes: req.body.notes ?? current.notes,
      status: req.body.status ?? current.status ?? 'pending',
    };
    const fields = reservationFieldsFromBody(merged);
    const err = validateReservationInput(fields);
    if (err) return res.status(400).json({ error: err });

    const { loc, date, time, guestsNum, name, phone, email, notes, status } = fields;
    if (status !== 'cancelled') {
      const capacityCheck = checkReservationCapacity(loc, date, time, guestsNum, {
        skipLeadTime: true,
        excludeId: current.id,
      });
      if (!capacityCheck.ok) {
        return res.status(400).json({ error: capacityCheck.message, code: capacityCheck.code });
      }
    }

    const updated = updateReservation(current.id, {
      locationId: loc.id,
      locationName: loc.name,
      date,
      time,
      guests: guestsNum,
      name,
      phone,
      email,
      notes,
      status,
    });

    const kind = status === 'cancelled' ? 'cancelled' : status === 'confirmed' ? 'confirmed' : 'updated';
    await notifyGuestReservationChange(updated, loc, kind);
    res.json({ success: true, reservation: updated });
  } catch (e) {
    console.error('[Admin update]', e.message);
    res.status(500).json({ error: '更新失敗' });
  }
});

app.post('/api/admin/reservations/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const current = findReservation(req.params.id);
    if (!current) return res.status(404).json({ error: '找不到這筆訂位' });
    const updated = updateReservation(current.id, { status: 'cancelled' });
    const loc = locationById(updated.locationId);
    await notifyGuestReservationChange(updated, loc, 'cancelled');
    res.json({ success: true, reservation: updated });
  } catch (e) {
    console.error('[Admin cancel]', e.message);
    res.status(500).json({ error: '取消失敗' });
  }
});

app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  const settings = loadSettings();
  res.json({
    locations: site.locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      phone: loc.phone,
      onlineFull: Boolean(settings.onlineFull[loc.id]),
    })),
  });
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const locationId = String(req.body?.locationId || '').trim();
  if (!locationById(locationId)) return res.status(400).json({ error: '請選擇分店' });
  const settings = setOnlineFull(locationId, Boolean(req.body?.onlineFull));
  res.json({ success: true, settings });
});

const PUBLIC = path.join(__dirname, 'public');
const HTML_PAGES = ['menu', 'locations', 'reserve', 'franchise', 'gallery', 'story'];
const HTML_SKIP_GA = new Set(['404.html', 'admin.html']);

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
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin.html\n\nSitemap: ${BASE_URL}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').send(buildSitemapXml());
});

app.get('/', (_req, res) => sendPage(res, 'index.html'));
app.get('/admin', (_req, res) => sendPage(res, 'admin.html'));
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
      console.log('SMS:  已設定（⚠️ 測試模式：不發店長簡訊；總部改收 Email）');
    } else {
      console.log('SMS:  已設定（店長收簡訊；總部收 Email）');
    }
    console.log('  訂位簡訊（店長）：');
    site.locations.forEach((loc) => {
      const phones = getReservationNotifyPhones(loc);
      console.log(`    ${loc.name} → ${phones.length ? phones.join('、') : '未設定'}`);
    });
    console.log(`  總部 Email → ${RESTAURANT_EMAIL || '未設定'}`);
    console.log('  加盟通知 → 總部 Email（不發簡訊）');
  } else {
    console.log('SMS:  未設定（請在 .env 設 TWILIO_* 與店長手機）');
  }
  console.log(`GA4:  ${GA_MEASUREMENT_ID || '未設定（請設 GA_MEASUREMENT_ID）'}`);
  console.log('');
});
