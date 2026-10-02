const MOOSE = 'https://moose.bafuholdings.com';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function studioHref(href) {
  const value = String(href || '');
  if (!value || /^https?:\/\//i.test(value) || value.startsWith('#')) return value;
  if (/^\/(works|courses|course|hire)(\?|$|\/)/.test(value)) return value;
  if (value.startsWith('/')) return MOOSE + value;
  return value;
}

async function studioConfig() {
  const res = await fetch('/api/studio/config');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '暫時讀不到內容');
  return data;
}

async function studioInquire(body) {
  const res = await fetch('/api/studio/inquire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '送出失敗');
  return data;
}

window.studio = { escapeHtml, studioHref, studioConfig, studioInquire, MOOSE };
