const CART_KEY = 'shine-piece-cart';
const PAGE = document.body?.dataset?.page || '';

const BAG_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/></svg>`;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function loadCart() {
  try {
    const list = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveCart(list) {
  localStorage.setItem(CART_KEY, JSON.stringify(list));
  updateCartCount();
}

function addToCart(item) {
  const list = loadCart();
  const idx = list.findIndex((row) => row.id === item.id);
  if (idx >= 0) list[idx].qty = Math.min(99, (list[idx].qty || 1) + (item.qty || 1));
  else {
    list.push({
      id: item.id,
      name: item.name,
      price: item.price || '',
      image: item.image || '',
      origin: item.origin || '',
      qty: item.qty || 1,
    });
  }
  saveCart(list);
}

function updateCartCount() {
  const n = loadCart().reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
  document.querySelectorAll('[data-cart-count]').forEach((el) => {
    el.textContent = n ? String(n) : '';
    el.classList.toggle('is-on', n > 0);
  });
}

function isBadgeOnlyLine(line) {
  return /^【[^】]{1,30}】\s*$/.test(String(line || '').trim());
}

/** 客人看到的品名：略過只有標籤的那一行，改抓說明裡的真正品名 */
function productTitleLine(p) {
  const raw = String(p.name || '').trim();
  const tagged = raw.match(/^【[^】]+】\s*(.+)$/);
  if (tagged && tagged[1].trim()) return tagged[1].trim();
  if (raw && !isBadgeOnlyLine(raw)) return raw;
  const lines = String(p.summary || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    if (isBadgeOnlyLine(line)) continue;
    if (/^(日本|韓國|中國|泰國|台灣)$/.test(line)) continue;
    if (/^(售價|價格)[:：]/.test(line)) continue;
    if (/youtube|youtu\.be|vimeo|\.mp4|\.webm/i.test(line)) continue;
    const m = line.match(/^【[^】]+】\s*(.+)$/);
    const t = (m ? m[1] : line).trim();
    if (t) return t;
  }
  return raw.replace(/^【[^】]+】\s*/, '').trim() || '精選商品';
}

function shownName(p) {
  const dn = String(p.displayName || '').trim();
  if (dn && !isBadgeOnlyLine(dn)) {
    const m = dn.match(/^【[^】]+】\s*(.+)$/);
    if (m && m[1].trim()) return m[1].trim();
    if (!/^【/.test(dn)) return dn;
  }
  return productTitleLine(p);
}

function productImages(p) {
  if (Array.isArray(p.images) && p.images.length) return p.images.filter(Boolean);
  return p.image ? [p.image] : [];
}

/** 列表／首頁小圖：可自選 coverImage，否則用第一張商品圖 */
function productCover(p) {
  const cover = String(p.coverImage || '').trim();
  if (cover) return cover;
  return p.image || productImages(p)[0] || '';
}

/** 商品說明給客人看：略過產地、售價、標籤行，保留特色內文 */
function productBodyText(p, maxLines = 10) {
  const title = shownName(p);
  const lines = String(p.summary || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (/youtube|youtu\.be|vimeo|\.mp4|\.webm/i.test(line)) continue;
    if (/^(日本|韓國|中國|泰國|台灣)$/.test(line)) continue;
    if (/^(售價|價格)[:：]/.test(line)) continue;
    if (/^【[^】]{1,24}】\s*$/.test(line)) continue;
    if (/^(?:NT\$?|TWD|＄|\$)\s*[\d,]+(?:\s*元)?$/i.test(line.replace(/\s/g, ''))) continue;
    if (line === title) continue;
    if (title && line.startsWith('【') && line.includes(title.replace(/^【[^】]+】/, ''))) continue;
    out.push(line);
  }
  if (!out.length && lines.length) {
    const fallback = lines.find((line) => !/^(日本|韓國|中國|泰國|台灣)$/.test(line) && !/^【[^】]+】\s*$/.test(line));
    if (fallback) out.push(fallback);
  }
  return out.slice(0, maxLines).join('\n');
}

function bodyHtml(text) {
  return escapeHtml(text || '').replace(/\n/g, '<br>');
}

function productPhotosInner(p, imgClass = '') {
  const imgs = productImages(p);
  if (!imgs.length) return '';
  const alt = escapeHtml(shownName(p));
  const cls = imgClass ? ` class="${imgClass}"` : '';
  if (imgs.length === 1) {
    return `<img${cls} src="${escapeHtml(imgs[0])}" alt="${alt}" loading="lazy">`;
  }
  return `<div class="photo-stack">${imgs.map((url, i) => `<img${cls} src="${escapeHtml(url)}" alt="${alt} ${i + 1}" loading="lazy">`).join('')}</div>`;
}

function itemGalleryHtml(p) {
  const imgs = productImages(p);
  if (!imgs.length) return '';
  if (imgs.length === 1) {
    return `<img class="item-hero" src="${escapeHtml(imgs[0])}" alt="${escapeHtml(shownName(p))}">`;
  }
  return `<div class="item-gallery">${imgs.map((url, i) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(shownName(p))} ${i + 1}" loading="lazy">`).join('')}</div>`;
}

function isSoldOut(p) {
  return p.qty === 0 || /缺貨|售完/.test(p.stock || '');
}

function soldOutButton(cls = 'add') {
  return `<button class="${cls}" type="button" disabled>${cls === 'add' ? '售完' : '已售完'}</button>`;
}

function stockNote(p) {
  if (isSoldOut(p)) return '<span class="stock-note">已售完</span>';
  if (typeof p.qty === 'number' && p.qty <= 5) return `<span class="stock-note">剩 ${p.qty} 件</span>`;
  return '';
}

const MEMBER_KEY = 'shine-piece-member';
function memberToken() {
  return localStorage.getItem(MEMBER_KEY) || '';
}

function cartPayload(p) {
  return encodeURIComponent(JSON.stringify({
    id: p.id,
    name: shownName(p),
    price: p.price || '',
    image: productCover(p),
    origin: p.origin || '',
  }));
}

function hasVideo(p) {
  return Boolean(String(p.video || '').trim());
}

function videoTeaser(p) {
  if (!hasVideo(p)) return '';
  const poster = productImages(p)[0] || p.image || '';
  const cap = escapeHtml(p.videoCaption || '親測／廠商短片');
  const href = `/item/${encodeURIComponent(p.id)}#short`;
  return `
    <a class="video-teaser" href="${href}">
      <span class="video-teaser-media">${poster ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy">` : ''}<span class="video-teaser-clap" aria-hidden="true">🎬</span></span>
      <span class="video-teaser-cap">${cap}</span>
    </a>`;
}

function videoFrame(url) {
  const src = String(url || '').trim();
  if (!src) return '<p class="lead">尚未連結親測短片。老闆可在後台「親測短片」上傳 MP4 或貼 YouTube。</p>';
  if (/youtube\.com\/embed\/|player\.vimeo\.com/.test(src)) {
    return `<div class="video-frame" id="short"><iframe src="${escapeHtml(src)}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen title="親測短片"></iframe></div>`;
  }
  if (/\.mp4|\.webm/i.test(src) || /^\/uploads\/products\//.test(src)) {
    return `<div id="short"><video class="item-hero item-video" src="${escapeHtml(src)}" controls playsinline></video></div>`;
  }
  return '';
}

function productCard(p) {
  const payload = cartPayload(p);
  const img = productCover(p) ? `<img src="${escapeHtml(productCover(p))}" alt="${escapeHtml(shownName(p))}" loading="lazy">` : '';
  const tag = p.flash ? `回鍋快閃${p.origin ? ' · ' + p.origin : ''}` : (p.origin || '');
  return `
    <article class="product">
      <a class="product-media" href="/item/${encodeURIComponent(p.id)}">${img}<span class="origin-tag${p.flash ? ' is-flash' : ''}">${escapeHtml(tag)}</span></a>
      <div class="product-info">
        <h3>${escapeHtml(shownName(p))}</h3>
        <div class="product-foot">
          <span class="price">${escapeHtml(p.price || '')}</span>
          ${isSoldOut(p) ? soldOutButton() : `<button class="add" type="button" data-add="${payload}">加入</button>`}
        </div>
      </div>
    </article>`;
}

function wishCard(p, monthLabel) {
  const img = p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">` : '';
  return `
    <article class="product">
      <div class="product-media">${img}<span class="origin-tag">${escapeHtml(p.origin || '')}</span></div>
      <div class="product-info">
        <h3>${escapeHtml(p.name)}</h3>
        <p class="product-cat">${escapeHtml(monthLabel || '過往集選')} · ${Number(p.wishCount) || 0} 人許願</p>
        <div class="product-foot">
          <span class="price">${escapeHtml(p.price || '')}</span>
          <button class="add" type="button" data-wish="${escapeHtml(p.id)}" data-wish-name="${escapeHtml(p.name)}">許願</button>
        </div>
      </div>
    </article>`;
}

function editorialLead(p) {
  const payload = cartPayload(p);
  const imgInner = productPhotosInner(p);
  const img = imgInner ? `<a class="spread-photo" href="/item/${encodeURIComponent(p.id)}">${imgInner}</a>` : '';
  const note = productBodyText(p, 4);
  return `
    <article class="spread">
      ${img}
      <div class="spread-copy">
        <p class="news-title">${escapeHtml(p.origin || 'THIS ISSUE')}</p>
        <h2>${escapeHtml(shownName(p))}</h2>
        <p class="body-text">${bodyHtml(note)}</p>
        <div class="product-foot">
          <span class="price">${escapeHtml(p.price || '')}</span>${stockNote(p)}
          ${isSoldOut(p) ? soldOutButton() : `<button class="add" type="button" data-buy="${payload}">立即結帳</button>`}
        </div>
      </div>
    </article>`;
}

function countryPick(p) {
  const cover = productCover(p);
  const img = cover ? `<img src="${escapeHtml(cover)}" alt="">` : '';
  const meta = String(p.price || '').trim();
  return `<a class="country-pick" href="/item/${encodeURIComponent(p.id)}">
    ${img ? `<span class="country-pick-photo">${img}</span>` : ''}
    <span class="country-pick-copy">
      <b>${escapeHtml(shownName(p))}</b>
      ${meta ? `<em>${escapeHtml(meta)}</em>` : ''}
    </span>
  </a>`;
}

function tocPick(p, i) {
  const n = String(i + 1).padStart(2, '0');
  return `<li><a href="/item/${encodeURIComponent(p.id)}"><span>${n}</span><b>${escapeHtml(shownName(p))}</b><em>${escapeHtml(p.origin || '')}</em></a></li>`;
}

function featureRow(p, i) {
  const payload = cartPayload(p);
  const imgInner = productPhotosInner(p);
  const img = imgInner
    ? `<a class="feature-photo" href="/item/${encodeURIComponent(p.id)}">${imgInner}</a>`
    : '';
  const note = productBodyText(p, 8);
  const n = String(i + 1).padStart(2, '0');
  const tag = p.flash ? `回鍋快閃 · ${p.origin || ''}` : (p.origin || '');
  return `
    <article class="feature-row">
      ${img}
      <div class="feature-copy">
        <p class="news-title">${n}　${escapeHtml(tag)}</p>
        <h2><a href="/item/${encodeURIComponent(p.id)}">${escapeHtml(shownName(p))}</a></h2>
        <p class="body-text">${bodyHtml(note)}</p>
        ${hasVideo(p) ? videoTeaser(p) : ''}
        <div class="product-foot issue-actions">
          <span class="price">${escapeHtml(p.price || '')}</span>${stockNote(p)}
          ${isSoldOut(p) ? '' : `<button class="add" type="button" data-add="${payload}">放入</button>`}
          ${hasVideo(p) ? '' : `<a class="more" href="/item/${encodeURIComponent(p.id)}">看短片</a>`}
          ${isSoldOut(p) ? soldOutButton('btn btn-ink') : `<button class="btn btn-ink" type="button" data-buy="${payload}">立即結帳</button>`}
        </div>
      </div>
    </article>`;
}

function bindAddButtons(root = document) {
  root.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      addToCart(JSON.parse(decodeURIComponent(btn.getAttribute('data-add'))));
      btn.textContent = '已加入';
    });
  });
}

function bindBuyButtons(root = document) {
  root.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      addToCart(JSON.parse(decodeURIComponent(btn.getAttribute('data-buy'))));
      location.href = '/order';
    });
  });
}

function navLink(href, page, label) {
  const on = PAGE === page ? ' class="active"' : '';
  return `<a href="${href}"${on}>${label}</a>`;
}

function renderChrome() {
  const header = document.querySelector('[data-shell="header"]');
  if (header) {
    header.outerHTML = `
      <header class="site-header">
        <div class="goldbar"></div>
        <div class="wrap header-inner">
          <button class="menu-btn" id="menuBtn" type="button" aria-label="開啟選單"><span></span><span></span><span></span></button>
          <a class="brand" href="/">
            <img src="/logo.png" alt="Shine Piece 瑄品集選">
            <span><strong>瑄品集選</strong><small>Shine Piece</small></span>
          </a>
          <nav class="nav" id="nav">
            ${navLink('/', 'home', '首頁')}
            ${navLink('/issue', 'issue', '本月精選商品')}
            ${navLink('/journal', 'journal', '主編部落格')}
            ${navLink('/track', 'track', '訂單追蹤')}
            ${navLink('/wish', 'wish', '許願池')}
            <a href="/#live">蝦皮直播</a>
            ${navLink('/order', 'order', '結帳')}
          </nav>
          <div class="header-side">
            <a class="header-line hidden" data-line href="#">LINE 諮詢</a>
            <a class="header-member${PAGE === 'member' ? ' active' : ''}" href="/member">${memberToken() ? '我的訂單' : '會員'}</a>
            <a class="cart-btn" href="/cart" aria-label="購物車">${BAG_ICON}<span class="cart-badge" data-cart-count></span></a>
          </div>
        </div>
      </header>`;
  }
  const footer = document.querySelector('[data-shell="footer"]');
  if (footer) {
    footer.outerHTML = `
      <footer class="site-footer">
        <div class="wrap">
          <span>© 瑄品集選　版權由 Lydia Global Company 所有</span>
          <nav class="footer-links">
            <a href="/track">訂單追蹤</a>
            <a href="/privacy">隱私權政策</a>
            <a href="/terms">服務條款</a>
            <a class="footer-line hidden" data-line href="#">加入 LINE 官方帳號</a>
          </nav>
        </div>
      </footer>`;
  }
}

function applyFooterExtras() {
  const box = document.querySelector('.footer-links');
  if (!box || box.dataset.extra) return;
  box.dataset.extra = '1';
  [{ href: 'https://bafuholdings.com/', label: '前往工作室' }].forEach((item) => {
    if (box.querySelector(`a[href="${item.href}"]`)) return;
    const a = document.createElement('a');
    a.href = item.href;
    a.textContent = item.label;
    const line = box.querySelector('.footer-line, [data-line]');
    box.insertBefore(a, line || null);
  });
}

function applyLineLinks(url) {
  document.querySelectorAll('[data-line]').forEach((el) => {
    if (!url) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    if (el.tagName === 'A') {
      el.href = url;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    }
  });
}

renderChrome();
applyFooterExtras();

const menuBtn = document.getElementById('menuBtn');
const nav = document.getElementById('nav');
if (menuBtn && nav) {
  menuBtn.addEventListener('click', () => nav.classList.toggle('open'));
}

fetch('/api/config').then((r) => r.json()).then((data) => {
  applyLineLinks(data.lineUrl);
  const url = String(data.liveUrl || '').trim();
  ['liveRoom', 'livePhoto'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el || !url) return;
    el.href = url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    el.classList.remove('hidden');
  });
  [
    'heroTitle', 'heroLead', 'coverLabel', 'coverEnglish', 'pullQuote',
    'countryHead', 'countryLead', 'shopLead', 'col1Title', 'col1Body',
    'col2Title', 'col2Body', 'col3Title', 'col3Body', 'liveTitle', 'liveWhen',
    'liveNote', 'archiveNote', 'wishLead', 'nextTitle', 'nextNote',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const value = String(data[id] || '').trim();
    if (id === 'countryLead') {
      const lead = value === '本月開箱' ? '' : value;
      el.textContent = lead;
      el.classList.toggle('hidden', !lead);
      return;
    }
    if (value) el.textContent = value;
    if (id === 'liveWhen') {
      el.textContent = value ? `直播時間：${value}` : '';
      el.classList.toggle('hidden', !value);
    }
    if (['countryLead', 'liveNote', 'col1Title', 'col1Body', 'col2Title', 'col2Body', 'col3Title', 'col3Body', 'coverEnglish', 'pullQuote', 'archiveNote', 'shopLead', 'wishLead'].includes(id)) {
      el.classList.toggle('hidden', !value);
    }
  });
  [1, 2, 3].forEach((n) => {
    const block = document.getElementById(`col${n}Block`);
    if (!block) return;
    block.classList.toggle('hidden', !String(data[`col${n}Title`] || data[`col${n}Body`] || '').trim());
  });
  const notesTile = document.getElementById('notesTile');
  if (notesTile) {
    const on = [1, 2, 3].some((n) => String(data[`col${n}Title`] || data[`col${n}Body`] || '').trim());
    notesTile.classList.toggle('hidden', !on);
  }
  const month = document.getElementById('monthLabel');
  const themeTitle = document.getElementById('themeTitle');
  const themeVisual = document.getElementById('themeVisual');
  const nextCard = document.getElementById('nextCard');
  const featuredTitle = document.getElementById('featuredTitle');
  const coverIssue = document.getElementById('coverIssue');
  const shopMonth = document.getElementById('shopMonth');
  const coverEnglish = document.getElementById('coverEnglish');
  if (month) month.textContent = data.themeOrigin ? `本月國家 · ${data.themeOrigin}` : (data.monthLabel || '本月國家');
  if (themeTitle) {
    const issue = data.themeTitle || '';
    themeTitle.textContent = issue;
    themeTitle.classList.toggle('hidden', !issue);
  }
  if (coverIssue) {
    const now = new Date();
    const vol = String(data.coverVol || '').trim() || `Vol. ${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
    const issue = String(data.monthLabel || data.tagline || '').trim();
    coverIssue.textContent = issue ? `${vol}　${issue}` : vol;
  }
  if (coverEnglish) coverEnglish.classList.toggle('hidden', !data.coverEnglish);
  if (data.themeVisual && themeVisual) themeVisual.src = data.themeVisual;
  if (shopMonth && PAGE !== 'issue') shopMonth.textContent = data.themeTitle || data.monthLabel || '本月開箱';
  if (featuredTitle) featuredTitle.textContent = data.themeTitle || '本月開箱筆記';
  if (nextCard) nextCard.classList.toggle('hidden', !data.nextTitle);
}).catch(() => {});

updateCartCount();
