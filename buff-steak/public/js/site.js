function showToast(msg, ok = true) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = ok ? 'var(--gold)' : '#ef4444';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
}

function trackEvent(name, params = {}) {
  try {
    if (typeof gtag === 'function') gtag('event', name, params);
  } catch (_) { /* ignore */ }
}

function isAdminPage() {
  return /\/admin(?:\.html)?$/.test(location.pathname);
}

const LINE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 10.304c0-5.369-5.383-9.738-12-9.738S0 4.935 0 10.304c0 4.814 4.269 8.846 10.036 9.608.391.084.923.258 1.057.59.121.3.079.766.038 1.08l-.164 1.02c-.05.303-.242 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C22.922 14.266 24 12.39 24 10.304z"/></svg>`;

function ensureLineFloat() {
  if (isAdminPage() || document.querySelector('.line-float')) return;
  const a = document.createElement('a');
  a.className = 'line-float hidden';
  a.setAttribute('data-line', '');
  a.setAttribute('aria-label', '加入官方 LINE');
  a.title = '加入官方 LINE';
  a.innerHTML = `${LINE_ICON}<span>官方 LINE</span>`;
  document.body.appendChild(a);
}

function ensureFooterLine() {
  if (isAdminPage()) return;
  const footer = document.querySelector('footer');
  if (!footer || footer.querySelector('[data-line]')) return;
  const a = document.createElement('a');
  a.className = 'footer-line hidden';
  a.setAttribute('data-line', '');
  a.textContent = '加入官方 LINE';
  footer.appendChild(a);
}

function applyLineLinks(url) {
  ensureLineFloat();
  ensureFooterLine();
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
      if (!el.dataset.lineTracked) {
        el.dataset.lineTracked = '1';
        el.addEventListener('click', () => trackEvent('line_click', { placement: el.className }));
      }
    }
  });
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

document.getElementById('navToggle')?.addEventListener('click', () => {
  document.getElementById('buffNav')?.classList.toggle('open');
});

async function loadSiteConfig() {
  if (isAdminPage()) return;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const data = await res.json();
    applyLineLinks(data.lineUrl);
    const text = String(data.homepageNotice || '').trim();
    const existing = document.getElementById('siteNotice');
    if (!text) {
      existing?.remove();
      return;
    }
    let el = existing;
    if (!el) {
      el = document.createElement('div');
      el.id = 'siteNotice';
      el.className = 'site-notice';
      el.setAttribute('role', 'status');
      const header = document.querySelector('.buff-header');
      if (header) header.insertAdjacentElement('afterend', el);
      else document.body.prepend(el);
    }
    el.textContent = text;
  } catch {
    /* ignore */
  }
}

document.addEventListener('DOMContentLoaded', loadSiteConfig);
