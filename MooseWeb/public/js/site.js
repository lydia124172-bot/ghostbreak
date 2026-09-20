const menuBtn = document.getElementById('menuBtn');
const nav = document.getElementById('nav');
if (menuBtn && nav) {
  menuBtn.addEventListener('click', () => nav.classList.toggle('open'));
}

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
