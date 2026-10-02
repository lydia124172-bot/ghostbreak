const LINE_URL = 'https://line.me/R/ti/p/@155tgdul';
const LINE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 10.304c0-5.369-5.383-9.738-12-9.738S0 4.935 0 10.304c0 4.814 4.269 8.846 10.036 9.608.391.084.923.258 1.057.59.121.3.079.766.038 1.08l-.164 1.02c-.05.303-.242 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C22.922 14.266 24 12.39 24 10.304z"/></svg>';

document.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('.line-float')) {
    const line = document.createElement('a');
    line.className = 'line-float';
    line.href = LINE_URL;
    line.target = '_blank';
    line.rel = 'noopener';
    line.setAttribute('aria-label', '加入 LINE 官方帳號');
    line.innerHTML = `${LINE_ICON}<span>加入 LINE</span>`;
    document.body.appendChild(line);
  }

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
