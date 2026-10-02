const STUDIO_LINE = 'https://line.me/R/ti/p/@155tgdul';

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('header.top nav');
  if (nav && !nav.querySelector('[data-line]')) {
    const link = document.createElement('a');
    link.href = STUDIO_LINE;
    link.target = '_blank';
    link.rel = 'noopener';
    link.dataset.line = '';
    link.className = 'nav-line';
    link.textContent = 'LINE';
    nav.appendChild(link);
  }
  document.querySelectorAll('footer .row').forEach((row) => {
    if (row.querySelector('[data-line]')) return;
    const slot = row.querySelector('span:last-child');
    if (!slot) return;
    const link = document.createElement('a');
    link.href = STUDIO_LINE;
    link.target = '_blank';
    link.rel = 'noopener';
    link.dataset.line = '';
    link.textContent = 'LINE';
    slot.append(document.createTextNode(' · '), link);
  });

  const filters = document.getElementById('filters');
  const works = document.getElementById('works');
  if (filters && works) {
    filters.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-kind]');
      if (!btn) return;
      const kind = btn.getAttribute('data-kind');
      filters.querySelectorAll('.filter-btn').forEach((el) => el.classList.toggle('active', el === btn));
      works.querySelectorAll('article').forEach((card) => {
        card.hidden = kind !== '全部' && card.getAttribute('data-kind') !== kind;
      });
    });
  }

  const hire = document.getElementById('hire');
  const serviceSelect = document.getElementById('inqService');
  function selectService(id) {
    if (!serviceSelect) return;
    if (id && [...serviceSelect.options].some((option) => option.value === id)) serviceSelect.value = id;
    const consult = document.getElementById('consult');
    if (consult) consult.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (hire) {
    hire.addEventListener('click', (event) => {
      if (event.target.closest('.hire-example-link')) return;
      const consultId = event.target.getAttribute('data-consult');
      if (consultId) {
        selectService(consultId);
        return;
      }
      const card = event.target.closest('.item-click');
      if (card) card.classList.toggle('open');
    });
  }
  const faqs = document.getElementById('faqs');
  if (faqs) {
    faqs.addEventListener('click', (event) => {
      const btn = event.target.closest('.faq-item button');
      if (btn) btn.parentElement.classList.toggle('open');
    });
  }
  const wanted = new URLSearchParams(location.search).get('service');
  if (wanted) selectService(wanted === 'leads' ? 'site' : wanted);

  const form = document.getElementById('inquireForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const err = document.getElementById('inqError');
    const ok = document.getElementById('inqOk');
    const btn = document.getElementById('inqBtn');
    err.classList.add('hidden');
    ok.classList.add('hidden');
    btn.disabled = true;
    const heading = document.querySelector('#head h1');
    const service = serviceSelect
      ? (serviceSelect.options[serviceSelect.selectedIndex]?.text || '')
      : `課程：${heading ? heading.textContent : ''}`;
    try {
      const res = await fetch('/api/studio/inquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('inqName').value.trim(),
          phone: document.getElementById('inqPhone').value.trim(),
          email: document.getElementById('inqEmail').value.trim(),
          service,
          message: document.getElementById('inqMessage').value.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '送出失敗');
      ok.textContent = '已收到，我們會再與您聯繫。';
      ok.classList.remove('hidden');
      form.reset();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
});
