function showToast(msg, ok = true) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = ok ? 'var(--gold)' : '#ef4444';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
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
