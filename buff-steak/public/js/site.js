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

async function loadSiteNotice() {
  if (/\/admin(?:\.html)?$/.test(location.pathname)) return;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const data = await res.json();
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

document.addEventListener('DOMContentLoaded', loadSiteNotice);
