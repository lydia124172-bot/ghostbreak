const menuBtn = document.getElementById('menuBtn');
const nav = document.getElementById('nav');

function pathOf() {
  return location.pathname.replace(/\/$/, '') || '/';
}

function applyPublicNav() {
  if (!nav) return;
  const path = pathOf();
  const items = [
    { href: '/', label: '首頁', on: path === '/' },
    { href: '/works', label: '看作品', on: path === '/works' || path === '/agents' || path === '/script' || path === '/live' || path === '/ip' },
    { href: '/courses', label: '上課', on: path === '/courses' },
    { href: '/hire', label: '做網站', on: path === '/hire' },
    { href: '/saas', label: '我做的付費工具', on: path === '/saas' || path === '/clip' || path === '/story' || path === '/talk' || path === '/drama' },
  ];
  nav.innerHTML = items.map((item) =>
    `<a href="${item.href}"${item.on ? ' class="active"' : ''}>${item.label}</a>`
  ).join('') + `<a href="/account" id="accountNav"${path === '/account' ? ' class="active"' : ''}>方案</a>`;
}

applyPublicNav();

if (menuBtn && nav) {
  menuBtn.addEventListener('click', () => nav.classList.toggle('open'));
}

function applyFooterExtras() {
  const box = document.querySelector('.footer-links');
  if (!box || box.dataset.extra) return;
  box.dataset.extra = '1';
  [
    { href: '/skills', label: '獲客地圖' },
    { href: '/research', label: 'AI 研究' },
    { href: '/match', label: '找人幫忙' },
  ].forEach((item) => {
    if (box.querySelector(`a[href="${item.href}"]`)) return;
    const a = document.createElement('a');
    a.href = item.href;
    a.textContent = item.label;
    const line = box.querySelector('.footer-line, [data-line]');
    box.insertBefore(a, line || null);
  });
}

applyFooterExtras();

const LINE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 10.304c0-5.369-5.383-9.738-12-9.738S0 4.935 0 10.304c0 4.814 4.269 8.846 10.036 9.608.391.084.923.258 1.057.59.121.3.079.766.038 1.08l-.164 1.02c-.05.303-.242 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C22.922 14.266 24 12.39 24 10.304z"/></svg>`;

function ensureLineFloat() {
  if (document.querySelector('.line-float')) return;
  const a = document.createElement('a');
  a.className = 'line-float hidden';
  a.setAttribute('data-line', '');
  a.setAttribute('aria-label', '加入 LINE 官方帳號');
  a.title = '加入 LINE 官方帳號';
  a.innerHTML = `${LINE_ICON}<span>加入 LINE</span>`;
  document.body.appendChild(a);
}

function applyLineLinks(url) {
  ensureLineFloat();
  document.querySelectorAll('.footer-line').forEach((el) => {
    el.classList.add('hidden');
    el.removeAttribute('data-line');
  });
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

fetch('/api/config').then((r) => r.json()).then((data) => {
  applyLineLinks(data.lineUrl);
}).catch(() => {});

function applyAccountNav(me) {
  const slot = document.getElementById('accountNav');
  if (!slot) return;
  const logged = Boolean(me && me.ok && me.email);
  slot.textContent = logged ? (me.planName && me.planName !== '免費' ? me.planName : '我的方案') : '方案';
}

fetch('/api/account/me').then((r) => r.json()).then(applyAccountNav).catch(() => applyAccountNav(null));
