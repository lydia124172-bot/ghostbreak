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
let scrolledAudio = false;

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
      <p class="field">${escapeHtml(voiceOf(shot.who))}　按上面的藍色按鈕才會出聲</p>
      <p>${escapeHtml(shot.say)}</p>
      <p class="lead">${escapeHtml(shot.picture)}</p>
      ${prompt}
    </article>`;
  }).join('');
  const uploads = document.getElementById('uploadBox');
  uploads.innerHTML = moving.map((shot, index) => `<label class="field" for="still${index}">第 ${shot.n} 鏡　${escapeHtml(shot.who)}</label>
    <input id="still${index}" data-still="${index}" type="file" accept="image/*" />`).join('');
  lastPlan = plan;
  box.classList.remove('hidden');
  box.scrollIntoView({ block: 'start' });
}

function fileToJpeg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round(img.width * scale));
      canvas.height = Math.max(2, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('有一張鏡圖讀不到。'));
    };
    img.src = url;
  });
}

async function chosenStills(requireAll) {
  if (!requireAll) return null;
  const inputs = [...document.querySelectorAll('[data-still]')];
  if (!inputs.length || inputs.some((input) => !input.files || !input.files[0])) {
    throw new Error('請上傳正好四張鏡圖，一鏡一張。');
  }
  return Promise.all(inputs.map((input) => fileToJpeg(input.files[0])));
}

function voiceOf(who) {
  const name = String(who || '');
  if (/狐/.test(name)) return '配音　狐，低沉男聲';
  if (/獾/.test(name)) return '配音　獾，急怒男聲';
  if (/貓/.test(name)) return '配音　貓，疲憊男聲';
  if (/熊/.test(name)) return '配音　熊，鬆弛男聲';
  return '配音　女主播';
}

function lockMake(locked) {
  document.querySelectorAll('[data-act="upload"], [data-act="make"]').forEach((btn) => {
    btn.disabled = locked;
  });
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
  if (!scrolledAudio && (job.lines || []).some((line) => line.state === 'done' || line.state === 'running')) {
    scrolledAudio = true;
    list.scrollIntoView({ block: 'start' });
  }
}

async function pollJob(id) {
  const res = await fetch('/api/toon/job/' + encodeURIComponent(id), { headers: tokenHeaders(false) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || '找不到這次生片');
  renderJob(id, body);
  showMake(body.step || '');
  if (body.status === 'done' || body.status === 'error') {
    lockMake(false);
    return;
  }
  makeTimer = window.setTimeout(() => {
    pollJob(id).catch((err) => {
      showMake(err.message || '生片中斷');
      lockMake(false);
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
    showMsg('已切好。按藍色的「生成四段影片和配音」。聲音和影片會出現在按鈕下面。');
    const actions = document.querySelector('#planBox .toon-bar');
    if (actions) actions.scrollIntoView({ block: 'center' });
  } catch (err) {
    showMsg(err.message || '切鏡失敗');
  } finally {
    button.disabled = false;
  }
});

async function startMake(upload) {
  if (!lastPlan || !Array.isArray(lastPlan.shots)) {
    showMake('請先切鏡。');
    return;
  }
  window.clearTimeout(makeTimer);
  scrolledAudio = false;
  lockMake(true);
  showMake(upload ? '已開始。用你上傳的四張，先配音再做成影片。' : '已開始。會先畫四張靜圖，再做成影片。');
  try {
    const stills = await chosenStills(upload);
    const res = await fetch('/api/toon/make', {
      method: 'POST',
      headers: tokenHeaders(true),
      body: JSON.stringify({ shots: lastPlan.shots, stills }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '生片失敗');
    await pollJob(body.id);
  } catch (err) {
    showMake(err.message || '生片失敗');
    lockMake(false);
  }
}

document.querySelectorAll('[data-act="upload"]').forEach((btn) => {
  btn.addEventListener('click', () => startMake(true));
});
document.querySelectorAll('[data-act="make"]').forEach((btn) => {
  btn.addEventListener('click', () => startMake(false));
});
document.querySelectorAll('[data-act="copy"]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!lastPrompts) return;
    try {
      await navigator.clipboard.writeText(lastPrompts);
      showMsg('四段提示詞已複製。');
    } catch {
      showMsg('無法自動複製，請從每段提示詞手動選取。');
    }
  });
});
