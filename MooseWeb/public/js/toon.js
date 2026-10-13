function tokenHeaders(json) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = sessionStorage.getItem('moose_admin_token');
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showMsg(text) {
  const el = document.getElementById('toonMsg');
  if (el) el.textContent = text;
}

let lastPrompts = '';

function renderPlan(plan) {
  const box = document.getElementById('planBox');
  const list = document.getElementById('shotList');
  document.getElementById('planTitle').textContent = plan.title || '分鏡';
  const moving = (plan.shots || []).filter((shot) => shot.motion);
  lastPrompts = moving.map((shot) => `第 ${shot.n} 鏡\n${shot.prompt}`).join('\n\n');
  list.innerHTML = (plan.shots || []).map((shot) => {
    const kind = shot.motion ? '要生片' : '定妝照';
    const prompt = shot.motion
      ? `<label class="field">即夢提示詞</label><textarea class="form-input" rows="4" readonly>${escapeHtml(shot.prompt)}</textarea>`
      : '';
    return `<article style="margin-top:18px;">
      <p class="field">第 ${shot.n} 鏡　${escapeHtml(kind)}　${escapeHtml(shot.who)}</p>
      <p>${escapeHtml(shot.say)}</p>
      <p class="lead">${escapeHtml(shot.picture)}</p>
      ${prompt}
    </article>`;
  }).join('');
  box.classList.remove('hidden');
  box.scrollIntoView({ block: 'start' });
}

document.getElementById('toonForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('planBtn');
  const script = document.getElementById('script').value.trim();
  button.disabled = true;
  showMsg('正在切鏡…');
  try {
    const res = await fetch('/api/toon/plan', {
      method: 'POST',
      headers: tokenHeaders(true),
      body: JSON.stringify({ script }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '切鏡失敗');
    renderPlan(body);
    showMsg('已切好。四段提示詞複製到即夢，每段生 5 秒。');
  } catch (err) {
    showMsg(err.message || '切鏡失敗');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  if (!lastPrompts) return;
  try {
    await navigator.clipboard.writeText(lastPrompts);
    showMsg('四段提示詞已複製。');
  } catch {
    showMsg('無法自動複製，請從每段提示詞手動選取。');
  }
});
