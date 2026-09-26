const state = {
  model: '',
  cloth: '',
  image: '',
  videoCost: 3,
  videoReady: false,
  scenes: [],
  scene: '',
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('請先選圖。'));
    if (file.size > 2 * 1024 * 1024) return reject(new Error('單張圖請小於 2MB。'));
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return reject(new Error('請用 JPG、PNG 或 WEBP。'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('讀取圖片失敗。'));
    reader.readAsDataURL(file);
  });
}

function showPrev(id, dataUrl) {
  const img = document.getElementById(id);
  if (!img) return;
  img.src = dataUrl;
  img.classList.toggle('hidden', !dataUrl);
}

async function pick(inputId, key, prevId) {
  const msg = document.getElementById('dressMsg');
  msg.textContent = '';
  const file = document.getElementById(inputId).files[0];
  if (!file) {
    state[key] = '';
    showPrev(prevId, '');
    return;
  }
  try {
    state[key] = await readFile(file);
    showPrev(prevId, state[key]);
  } catch (err) {
    state[key] = '';
    showPrev(prevId, '');
    document.getElementById(inputId).value = '';
    msg.textContent = err.message || '讀取圖片失敗。';
  }
}

function paintScenes(rows) {
  const grid = document.getElementById('sceneGrid');
  if (!grid) return;
  state.scenes = Array.isArray(rows) ? rows : [];
  if (!state.scenes.length) {
    grid.innerHTML = '<p class="combo-fit">場景稍後補上。</p>';
    return;
  }
  if (!state.scene) state.scene = state.scenes[0].id;
  grid.innerHTML = state.scenes.map((row) => `
    <button class="clip-type${row.id === state.scene ? ' active' : ''}" type="button" data-scene="${escapeHtml(row.id)}">
      <strong>${escapeHtml(row.name)}</strong>
      <span>${escapeHtml(row.hint || '')}</span>
    </button>
  `).join('');
}

async function refreshPlan() {
  const bar = document.getElementById('dressPlan');
  if (!bar) return;
  try {
    const data = await fetch('/api/dress/status').then((r) => r.json());
    state.videoReady = Boolean(data.videoReady);
    state.videoCost = Number(data.videoCost || 3) || 3;
    paintScenes(data.scenes || []);
    if (!data.ready) {
      bar.textContent = '換裝暫時無法使用，請稍後再試。';
      return;
    }
    const motion = data.videoReady
      ? `換裝／換背景各 1 點；動起來 ${state.videoCost} 點（5 或 10 秒）。`
      : '換裝／換背景可用。讓圖動起來暫時無法使用。';
    if (data.owner) {
      bar.textContent = `作者後台已登入，產出不扣點。${motion}`;
      return;
    }
    if (!data.loggedIn) {
      bar.textContent = `需先到方案頁登入。${motion}`;
      return;
    }
    bar.textContent = `目前剩餘 ${data.credits || 0} 點。${motion}`;
  } catch {
    bar.textContent = '需登入並有方案點數。';
  }
}

function paintResult(image, extra) {
  state.image = image;
  const out = document.getElementById('outImage');
  const save = document.getElementById('saveBtn');
  out.src = image;
  save.href = image;
  document.getElementById('outLine').textContent = extra || '僅供試衣參考，不是實穿保證。';
  document.getElementById('resultBox').classList.remove('hidden');
  document.getElementById('bgBox').classList.remove('hidden');
  document.getElementById('videoBox').classList.add('hidden');
  document.getElementById('motionMsg').textContent = '';
  document.getElementById('bgMsg').textContent = '';
  const motionBtn = document.getElementById('motionBtn');
  if (motionBtn) motionBtn.disabled = !state.videoReady;
}

async function makeDress() {
  const msg = document.getElementById('dressMsg');
  const btn = document.getElementById('makeBtn');
  if (!state.model || !state.cloth) {
    msg.textContent = '請先選模特兒照與衣服圖。';
    return;
  }
  document.getElementById('resultBox').classList.add('hidden');
  msg.textContent = '正在換裝，約半分鐘，請不要重按。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/dress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.model,
        cloth: state.cloth,
        note: document.getElementById('note').value.trim(),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '產出失敗');
    paintResult(body.image, body.owner ? '作者後台已登入，這張不扣點。' : '僅供試衣參考，不是實穿保證。');
    msg.textContent = '';
    refreshPlan();
  } catch (err) {
    msg.textContent = err.message || '產出失敗';
  } finally {
    btn.disabled = false;
  }
}

async function makeBg() {
  const note = document.getElementById('bgMsg');
  const btn = document.getElementById('bgBtn');
  if (!state.image) {
    note.textContent = '請先產出換裝圖。';
    return;
  }
  if (!state.scene) {
    note.textContent = '請先選一個背景場景。';
    return;
  }
  note.textContent = '正在換背景，約半分鐘，請不要重按。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/dress/bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.image,
        scene: state.scene,
        note: document.getElementById('bgNote').value.trim(),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '換背景失敗');
    paintResult(body.image, body.owner ? '背景已換。作者後台已登入，這張不扣點。' : '背景已換。僅供試衣參考，不是實穿保證。');
    note.textContent = '';
    refreshPlan();
  } catch (err) {
    note.textContent = err.message || '換背景失敗';
  } finally {
    btn.disabled = false;
  }
}

async function waitVideoJob(jobId) {
  const note = document.getElementById('motionMsg');
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`/api/clip/video/job/${encodeURIComponent(jobId)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '生片失敗');
    if (body.status === 'done' && body.videoUrl) return body;
    const phase = body.status === 'running' ? '正在生成短片' : '排隊中';
    note.textContent = `${phase}（${body.duration || ''}秒），約一分鐘，請不要重按。`;
  }
  throw new Error('生片逾時，請稍後再試。');
}

function paintVideo(done) {
  const box = document.getElementById('videoBox');
  const video = document.getElementById('outVideo');
  const save = document.getElementById('saveVideoBtn');
  video.src = done.videoUrl;
  save.href = done.videoUrl;
  box.classList.remove('hidden');
  document.getElementById('motionMsg').textContent = done.owner
    ? '作者後台已登入，這支不扣點。'
    : `短片已完成（${done.duration || ''}秒）。`;
}

async function makeMotion() {
  const note = document.getElementById('motionMsg');
  const btn = document.getElementById('motionBtn');
  if (!state.image) {
    note.textContent = '請先產出換裝圖。';
    return;
  }
  if (!state.videoReady) {
    note.textContent = '讓圖動起來暫時無法使用。';
    return;
  }
  const duration = document.getElementById('motionSec').value === '10' ? '10' : '5';
  note.textContent = `正在送出 ${duration} 秒短片，約扣 ${state.videoCost} 點，請不要重按。`;
  btn.disabled = true;
  document.getElementById('videoBox').classList.add('hidden');
  try {
    const res = await fetch('/api/dress/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.image,
        duration,
        note: document.getElementById('bgNote').value.trim() || document.getElementById('note').value.trim(),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '生片失敗');
    const done = body.videoUrl ? body : await waitVideoJob(body.jobId);
    paintVideo(done);
    refreshPlan();
  } catch (err) {
    note.textContent = err.message || '生片失敗';
  } finally {
    btn.disabled = !state.videoReady;
  }
}

document.getElementById('modelFile').addEventListener('change', () => pick('modelFile', 'model', 'modelPrev'));
document.getElementById('clothFile').addEventListener('change', () => pick('clothFile', 'cloth', 'clothPrev'));
document.getElementById('makeBtn').addEventListener('click', makeDress);
document.getElementById('bgBtn').addEventListener('click', makeBg);
document.getElementById('motionBtn').addEventListener('click', makeMotion);
document.getElementById('sceneGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-scene]');
  if (!btn) return;
  state.scene = btn.getAttribute('data-scene');
  document.querySelectorAll('#sceneGrid .clip-type').forEach((el) => {
    el.classList.toggle('active', el === btn);
  });
});
document.getElementById('dressForm').addEventListener('submit', (e) => {
  e.preventDefault();
  makeDress();
});

refreshPlan();
