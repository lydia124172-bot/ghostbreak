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
let lastPlan = null;
let makeTimer = 0;

function renderPlan(plan) {
  const box = document.getElementById('planBox');
  const list = document.getElementById('shotList');
  document.getElementById('planTitle').textContent = plan.title || '分鏡';
  const moving = (plan.shots || []).filter((shot) => shot.motion);
  lastPrompts = moving.map((shot) => `第 ${shot.n} 鏡\n${shot.prompt}`).join('\n\n');
  list.innerHTML = (plan.shots || []).map((shot) => {
    const kind = shot.motion ? '要生片' : '定妝照';
    const prompt = shot.motion
      ? `<label class="field">這一鏡</label><textarea class="form-input" rows="4" readonly>${escapeHtml(shot.prompt)}</textarea>`
      : '';
    return `<article style="margin-top:18px;">
      <p class="field">第 ${shot.n} 鏡　${escapeHtml(kind)}　${escapeHtml(shot.who)}</p>
      <p>${escapeHtml(shot.say)}</p>
      <p class="lead">${escapeHtml(shot.picture)}</p>
      ${prompt}
    </article>`;
  }).join('');
  lastPlan = plan;
  box.classList.remove('hidden');
  box.scrollIntoView({ block: 'start' });
}

function showMake(text) {
  const el = document.getElementById('makeMsg');
  if (el) el.textContent = text;
}

function renderJob(id, job) {
  const list = document.getElementById('videoList');
  const videos = (job.shots || []).map((shot, index) => {
    const video = shot.state === 'done'
      ? `<video class="clip-video" controls playsinline src="/api/toon/job/${encodeURIComponent(id)}/shot/${index}"></video>`
      : '';
    const note = shot.error ? escapeHtml(shot.error) : (shot.state === 'done' ? '好了' : (shot.state === 'running' ? '進行中' : '等待'));
    return `<article style="margin-top:18px;">
      <p class="field">第 ${escapeHtml(shot.n)} 鏡　${escapeHtml(shot.voice || shot.who || '')}　${note}</p>
      ${video}
    </article>`;
  }).join('');
  const lines = (job.lines || []).map((shot, index) => {
    const audio = shot.state === 'done'
      ? `<audio controls src="/api/toon/job/${encodeURIComponent(id)}/line/${index}"></audio>`
      : '';
    const note = shot.error ? escapeHtml(shot.error) : (shot.state === 'done' ? '好了' : (shot.state === 'running' ? '配音中' : '等待'));
    return `<article style="margin-top:14px;">
      <p class="field">第 ${escapeHtml(shot.n)} 鏡　${escapeHtml(shot.voice || '')}　${note}</p>
      <p>${escapeHtml(shot.say || '')}</p>
      ${audio}
    </article>`;
  }).join('');
  list.innerHTML = `${videos}<h2 style="margin-top:28px;">各鏡配音</h2>${lines}`;
}

async function pollJob(id) {
  const res = await fetch('/api/toon/job/' + encodeURIComponent(id), { headers: tokenHeaders(false) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || '找不到這次生片');
  renderJob(id, body);
  showMake(body.step || '');
  if (body.status === 'done' || body.status === 'error') {
    document.getElementById('makeBtn').disabled = false;
    return;
  }
  makeTimer = window.setTimeout(() => {
    pollJob(id).catch((err) => {
      showMake(err.message || '生片中斷');
      document.getElementById('makeBtn').disabled = false;
    });
  }, 4000);
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
    showMsg('已切好。按「在這裡生四段」，這一頁會畫靜圖並做成影片。');
  } catch (err) {
    showMsg(err.message || '切鏡失敗');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('makeBtn').addEventListener('click', async () => {
  if (!lastPlan || !Array.isArray(lastPlan.shots)) {
    showMake('請先切鏡。');
    return;
  }
  const button = document.getElementById('makeBtn');
  window.clearTimeout(makeTimer);
  button.disabled = true;
  showMake('已開始。四段會一鏡一鏡做，請留在這一頁。');
  try {
    const res = await fetch('/api/toon/make', {
      method: 'POST',
      headers: tokenHeaders(true),
      body: JSON.stringify({ shots: lastPlan.shots }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '生片失敗');
    await pollJob(body.id);
  } catch (err) {
    showMake(err.message || '生片失敗');
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
