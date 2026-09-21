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

function shownName(p) {
  return p.displayName || p.name || '';
}

function cartPayload(p) {
  return encodeURIComponent(JSON.stringify({
    id: p.id,
    name: shownName(p),
    price: p.price || '',
    image: p.image || '',
    origin: p.origin || '',
  }));
}

function videoFrame(url) {
  const src = String(url || '');
  if (!src) return '<p class="lead">說明裡貼上 YouTube 連結，這裡會出現直播實測短片。</p>';
  if (/youtube\.com\/embed\/|player\.vimeo\.com/.test(src)) {
    return `<div class="video-frame"><iframe src="${escapeHtml(src)}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen title="直播精華"></iframe></div>`;
  }
  if (/\.mp4|\.webm/i.test(src)) {
    return `<video class="item-hero" src="${escapeHtml(src)}" controls playsinline></video>`;
  }
  return '';
}

function productCard(p) {
  const payload = cartPayload(p);
  const img = p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(shownName(p))}" loading="lazy">` : '';
  const tag = p.flash ? `回鍋快閃${p.origin ? ' · ' + p.origin : ''}` : (p.origin || '');
  return `
    <article class="product">
      <a class="product-media" href="/item/${encodeURIComponent(p.id)}">${img}<span class="origin-tag${p.flash ? ' is-flash' : ''}">${escapeHtml(tag)}</span></a>
      <div class="product-info">
        <h3>${escapeHtml(shownName(p))}</h3>
        <div class="product-foot">
          <span class="price">${escapeHtml(p.price || '')}</span>
          <button class="add" type="button" data-add="${payload}">加入</button>
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
  const img = p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(shownName(p))}">` : '';
  const note = String(p.summary || '').split('\n').filter(Boolean).slice(-1)[0] || '';
  return `
    <article class="spread">
      <a class="spread-photo" href="/item/${encodeURIComponent(p.id)}">${img}</a>
      <div class="spread-copy">
        <p class="news-title">${escapeHtml(p.origin || 'THIS ISSUE')}</p>
        <h2>${escapeHtml(shownName(p))}</h2>
        <p>${escapeHtml(note)}</p>
        <div class="product-foot">
          <span class="price">${escapeHtml(p.price || '')}</span>
          <button class="add" type="button" data-buy="${payload}">立即結帳</button>
        </div>
      </div>
    </article>`;
}

function tocPick(p, i) {
  const n = String(i + 1).padStart(2, '0');
  return `<li><a href="/item/${encodeURIComponent(p.id)}"><span>${n}</span><b>${escapeHtml(shownName(p))}</b><em>${escapeHtml(p.origin || '')}</em></a></li>`;
}

function featureRow(p, i) {
  const payload = cartPayload(p);
  const img = p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(shownName(p))}" loading="lazy">` : '';
  const note = String(p.summary || '').split('\n').filter((line) => line && !/youtube|youtu\.be|vimeo|\.mp4/i.test(line)).filter(Boolean).slice(-1)[0] || '';
  const n = String(i + 1).padStart(2, '0');
  const tag = p.flash ? `回鍋快閃 · ${p.origin || ''}` : (p.origin || '');
  return `
    <article class="feature-row">
      <a class="feature-photo" href="/item/${encodeURIComponent(p.id)}">${img}</a>
      <div class="feature-copy">
        <p class="news-title">${n}　${escapeHtml(tag)}</p>
        <h2><a href="/item/${encodeURIComponent(p.id)}">${escapeHtml(shownName(p))}</a></h2>
        <p>${escapeHtml(note)}</p>
        <div class="product-foot issue-actions">
          <span class="price">${escapeHtml(p.price || '')}</span>
          <button class="add" type="button" data-add="${payload}">放入</button>
          <a class="more" href="/item/${encodeURIComponent(p.id)}">看短片</a>
          <button class="btn btn-ink" type="button" data-buy="${payload}">立即結帳</button>
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
            <img src="/logo.png" alt="瑄品集選">
            <span><strong>瑄品集選</strong><small>Monthly Guide</small></span>
          </a>
          <nav class="nav" id="nav">
            ${navLink('/', 'home', '月刊')}
            ${navLink('/issue', 'issue', '本月開箱')}
            ${navLink('/wish', 'wish', '許願池')}
            <a href="/issue">客廳直播</a>
            ${navLink('/order', 'order', '結帳')}
          </nav>
          <div class="header-side">
            <a class="header-line hidden" data-line href="#">LINE 諮詢</a>
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
          <span>© 瑄品集選　月刊生活指南</span>
          <span><a href="/issue">本月專區</a>　<a href="/qr">直播 QR</a>　<a href="/partner">通路合作</a>　<a class="hidden" data-line href="#">LINE 諮詢</a></span>
        </div>
      </footer>`;
  }
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

const menuBtn = document.getElementById('menuBtn');
const nav = document.getElementById('nav');
if (menuBtn && nav) {
  menuBtn.addEventListener('click', () => nav.classList.toggle('open'));
}

fetch('/api/config').then((r) => r.json()).then((data) => {
  applyLineLinks(data.lineUrl);
  [
    'heroTitle', 'heroLead', 'coverLabel', 'coverEnglish', 'pullQuote',
    'countryHead', 'countryLead', 'shopLead', 'col1Title', 'col1Body',
    'col2Title', 'col2Body', 'col3Title', 'col3Body', 'liveTitle', 'liveWhen',
    'liveNote', 'archiveNote', 'wishLead', 'nextTitle', 'nextNote',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el && data[id]) el.textContent = data[id];
  });
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
    const vol = `Vol. ${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
    coverIssue.textContent = `${vol}　${data.monthLabel || data.tagline || '月刊生活指南'}`;
  }
  if (coverEnglish) coverEnglish.classList.toggle('hidden', !data.coverEnglish);
  if (data.themeVisual && themeVisual) themeVisual.src = data.themeVisual;
  if (shopMonth && PAGE !== 'issue') shopMonth.textContent = data.themeTitle || data.monthLabel || '本月開箱';
  if (featuredTitle) featuredTitle.textContent = data.themeTitle || '本月開箱筆記';
  if (nextCard) nextCard.classList.toggle('hidden', !data.nextTitle);
}).catch(() => {});

updateCartCount();
