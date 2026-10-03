const state = {
  model: '',
  cloth: '',
  cloth2: '',
  image: '',
  imageId: '',
  videoCost: 3,
  videoCost10: 6,
  videoCost15: 9,
  videoHd: 3,
  videoHd10: 6,
  videoHd15: 9,
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

function frameLine(body, lead) {
  const ratio = body && body.aspectRatio ? body.aspectRatio : '';
  const size = body && body.imageSize ? body.imageSize : '';
  const asked = document.getElementById('dressSize') ? document.getElementById('dressSize').value : '';
  const spec = [ratio, size].filter(Boolean).join('、');
  const fallback = asked === '2K' && size === '1K' ? '2K 這次沒被接受，已改以 1K 產出。' : '';
  return [lead, spec ? `這張是 ${spec}。` : '', fallback].filter(Boolean).join('');
}

function motionChoice() {
  const picked = document.getElementById('motionSec').value;
  const duration = picked === '10' || picked === '15' ? picked : '5';
  const resolution = document.getElementById('motionRes').value === '1080p' ? '1080p' : '720p';
  const hd = resolution === '1080p';
  const points = duration === '15'
    ? (hd ? state.videoHd15 : state.videoCost15)
    : (duration === '10' ? (hd ? state.videoHd10 : state.videoCost10) : (hd ? state.videoHd : state.videoCost));
  return { duration, resolution, points };
}

function paintResult(image, extra, mediaId) {
  state.image = image;
  state.imageId = String(mediaId || '');
  const out = document.getElementById('outImage');
  const save = document.getElementById('saveBtn');
  out.src = state.imageId ? `/api/clip/media/${state.imageId}` : image;
  save.href = state.imageId ? `/api/clip/media/${state.imageId}?download=1` : '#';
  save.setAttribute('download', '換裝.jpg');
  document.getElementById('outLine').textContent = extra || '僅供試衣參考，不是實穿保證。';
  document.getElementById('resultBox').classList.remove('hidden');
  document.getElementById('bgBox').classList.remove('hidden');
  document.getElementById('videoBox').classList.add('hidden');
  document.getElementById('motionMsg').textContent = '';
  document.getElementById('bgMsg').textContent = '';
  const motionBtn = document.getElementById('motionBtn');
  if (motionBtn) motionBtn.disabled = !state.videoReady;
}

async function recoverLast(auto) {
  const msg = document.getElementById('dressMsg');
  try {
    const res = await fetch('/api/dress/last');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (!auto && msg) msg.textContent = body.error || '沒有可取回的換裝圖。';
      return false;
    }
    const mediaId = String(body.imageUrl || '').split('/').pop();
    paintResult(body.image, '已取回剛才的換裝圖。請先下載存檔，再離開頁面。', mediaId);
    if (msg) msg.textContent = '';
    return true;
  } catch {
    if (!auto && msg) msg.textContent = '取回失敗，請稍後再試。';
    return false;
  }
}

async function refreshPlan() {
  const bar = document.getElementById('dressPlan');
  if (!bar) return;
  try {
    const data = await fetch('/api/dress/status').then((r) => r.json());
    state.videoReady = Boolean(data.videoReady);
    state.videoCost = Number(data.videoCost || 4) || 4;
    state.videoCost10 = Number(data.videoCost10 || 7) || 7;
    state.videoCost15 = Number(data.videoCost15 || 10) || 10;
    state.videoHd = Number(data.videoHd || 5) || 5;
    state.videoHd10 = Number(data.videoHd10 || 10) || 10;
    state.videoHd15 = Number(data.videoHd15 || 15) || 15;
    paintScenes(data.scenes || []);
    const recoverBtn = document.getElementById('recoverBtn');
    if (recoverBtn) recoverBtn.classList.toggle('hidden', !data.hasLast);
    if (!data.ready) {
      bar.textContent = '換裝暫時無法使用，請稍後再試。';
      return;
    }
    const motion = data.videoReady
      ? `換裝／換背景各 1 點。短片 5 秒 ${state.videoCost} 點、10 秒 ${state.videoCost10} 點、15 秒 ${state.videoCost15} 點。`
      : '換裝／換背景可用。讓圖動起來暫時無法使用。';
    if (!data.loggedIn) {
      bar.textContent = `需先到方案頁登入。${motion}`;
      return;
    }
    bar.textContent = `目前剩餘 ${data.credits || 0} 點。${motion}`;
  } catch {
    bar.textContent = '需登入並有方案點數。';
  }
}

async function makeDress() {
  const msg = document.getElementById('dressMsg');
  const btn = document.getElementById('makeBtn');
  if (!state.model || !state.cloth || !state.cloth2) {
    msg.textContent = '請先選模特兒照，以及兩張衣服圖。';
    return;
  }
  document.getElementById('resultBox').classList.add('hidden');
  const note = document.getElementById('note').value.trim();
  const positive = document.getElementById('promptPos').value.trim();
  const negative = document.getElementById('promptNeg').value.trim();
  msg.textContent = positive
    ? '正在依畫面上的提示詞換裝。請不要重按。'
    : '正在直接依衣服圖換裝。請不要重按。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/dress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.model,
        cloth: state.cloth,
        cloth2: state.cloth2,
        note,
        positive,
        negative,
        aspectRatio: document.getElementById('dressRatio').value,
        imageSize: document.getElementById('dressSize').value,
      }),
    });
    const body = await readJson(res);
    if (!res.ok) throw new Error(body.error || '產出失敗');
    paintResult(body.image, frameLine(body, '僅供試衣參考，不是實穿保證。'), body.mediaId);
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
        aspectRatio: document.getElementById('dressRatio').value,
        imageSize: document.getElementById('dressSize').value,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '換背景失敗');
    paintResult(body.image, frameLine(body, '背景已換。僅供試衣參考，不是實穿保證。'), body.mediaId);
    note.textContent = '';
    refreshPlan();
  } catch (err) {
    note.textContent = err.message || '換背景失敗';
  } finally {
    btn.disabled = false;
  }
}

async function waitVideoJob(jobId, duration) {
  const note = document.getElementById('motionMsg');
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`/api/clip/video/job/${encodeURIComponent(jobId)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '生片失敗');
    if (body.status === 'done' && body.videoUrl) return body;
    const phase = body.status === 'running' ? '正在生成短片' : '排隊中';
    const sec = body.duration || duration || '';
    const wait = String(sec) === '15' ? '15 秒會比 5 秒久，請不要重按。' : '請不要重按。';
    note.textContent = `${phase}（${sec}秒）。${wait}`;
  }
  throw new Error('生片逾時，請稍後再試。');
}

async function saveDressFile(event) {
  if (event) event.preventDefault();
  const save = document.getElementById('saveBtn');
  const note = document.getElementById('dressMsg');
  if (!state.image && !state.imageId) {
    if (note) note.textContent = '還沒有圖片可下載。';
    return;
  }
  const prev = save.textContent;
  save.textContent = '下載中…';
  try {
    let blob;
    if (state.imageId) {
      const res = await fetch(`/api/clip/media/${state.imageId}?download=1`);
      if (!res.ok) throw new Error('下載失敗，請再試一次。');
      blob = await res.blob();
    } else {
      const res = await fetch(state.image);
      blob = await res.blob();
    }
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = '換裝.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    if (note) note.textContent = '已開始下載，請到「下載」資料夾查看。';
  } catch (err) {
    if (note) note.textContent = err.message || '無法下載，請再試一次。';
  } finally {
    save.textContent = prev || '下載圖片';
  }
}

function mediaDownloadUrl(videoUrl) {
  const base = String(videoUrl || '').split('?')[0];
  return base ? `${base}?download=1` : '#';
}

async function saveVideoFile(event) {
  if (event) event.preventDefault();
  const save = document.getElementById('saveVideoBtn');
  const note = document.getElementById('motionMsg');
  const href = save && save.getAttribute('href');
  if (!href || href === '#') {
    if (note) note.textContent = '還沒有短片可下載。';
    return;
  }
  const prev = save.textContent;
  save.textContent = '下載中…';
  save.setAttribute('aria-disabled', 'true');
  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error('下載失敗，請再試一次。');
    const blob = await res.blob();
    const name = /webm/i.test(blob.type || '') ? '換裝短片.webm' : '換裝短片.mp4';
    const file = new File([blob], name, { type: blob.type || 'video/mp4' });
    const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    if (phone && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      if (note) note.textContent = '已開啟分享，請選「儲存到檔案」或傳到電腦。';
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    if (note) note.textContent = '已開始下載，請到「下載」資料夾查看。';
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    if (note) note.textContent = err.message || '無法下載，請改用電腦瀏覽器開啟此頁再存。';
  } finally {
    save.textContent = prev || '下載短片';
    save.setAttribute('aria-disabled', 'false');
  }
}

function paintVideo(done) {
  const box = document.getElementById('videoBox');
  const video = document.getElementById('outVideo');
  const save = document.getElementById('saveVideoBtn');
  video.src = done.videoUrl;
  save.href = mediaDownloadUrl(done.videoUrl);
  save.setAttribute('download', '換裝短片.mp4');
  box.classList.remove('hidden');
  const resLabel = done.resolution ? `、${done.resolution}` : '';
  document.getElementById('motionMsg').textContent = `短片已完成（${done.duration || ''}秒${resLabel}）。`;
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
  const choice = motionChoice();
  const duration = choice.duration;
  note.textContent = `正在送出 ${duration} 秒、${choice.resolution} 短片，扣 ${choice.points} 點，請不要重按。`;
  btn.disabled = true;
  document.getElementById('videoBox').classList.add('hidden');
  try {
    const res = await fetch('/api/dress/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.image,
        duration,
        resolution: choice.resolution,
        ratio: document.getElementById('motionRatio').value,
        motion: document.getElementById('motionNote').value.trim(),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '生片失敗');
    const done = body.videoUrl ? body : await waitVideoJob(body.jobId, duration);
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
document.getElementById('clothFile2').addEventListener('change', () => pick('clothFile2', 'cloth2', 'clothPrev2'));
function clearOptimized() {
  const box = document.getElementById('promptBox');
  const pos = document.getElementById('promptPos');
  const neg = document.getElementById('promptNeg');
  if (pos) pos.value = '';
  if (neg) neg.value = '';
  if (box) box.classList.add('hidden');
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 413) throw new Error('圖片太大，單張請小於 2MB。');
    throw new Error('換裝暫時無法使用，請再試一次。');
  }
}

async function optimizeNote() {
  const msg = document.getElementById('dressMsg');
  const btn = document.getElementById('optimizeBtn');
  const note = document.getElementById('note').value.trim();
  if (note.length < 2) {
    msg.textContent = '請先寫一句描述。沒寫的話，無法整理提示詞。';
    return;
  }
  if (!state.cloth || !state.cloth2) {
    msg.textContent = '請先選兩張衣服圖，再優化提示詞。';
    return;
  }
  msg.textContent = '正在讓 Gemini 看衣服圖，寫一段短提示。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/dress/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cloth: state.cloth,
        cloth2: state.cloth2,
        note,
      }),
    });
    const body = await readJson(res);
    if (!res.ok) throw new Error(body.error || '提示詞整理失敗');
    document.getElementById('promptPos').value = body.positive || '';
    document.getElementById('promptNeg').value = body.negative || '';
    document.getElementById('promptBox').classList.remove('hidden');
    msg.textContent = '提示詞已展開，可再改，然後按產出換裝。';
  } catch (err) {
    msg.textContent = err.message || '提示詞整理失敗';
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('note').addEventListener('input', clearOptimized);
document.getElementById('optimizeBtn').addEventListener('click', optimizeNote);
document.getElementById('makeBtn').addEventListener('click', makeDress);
document.getElementById('saveBtn').addEventListener('click', saveDressFile);
document.getElementById('recoverBtn').addEventListener('click', () => recoverLast(false));
document.getElementById('bgBtn').addEventListener('click', makeBg);
document.getElementById('motionBtn').addEventListener('click', makeMotion);
document.getElementById('saveVideoBtn').addEventListener('click', saveVideoFile);

const DRESS_TO_CLIP_KEY = 'mooseDressToClip';

async function goToClip() {
  const note = document.getElementById('motionMsg');
  if (!state.image) {
    if (note) note.textContent = '請先產出換裝圖，再接到商品短片。';
    return;
  }
  const btn = document.getElementById('toClipBtn');
  const prev = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '帶入中…';
  }
  try {
    const res = await fetch('/api/dress/stash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: state.image }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || '換裝圖暫存失敗');
    }
    try { sessionStorage.setItem(DRESS_TO_CLIP_KEY, '1'); } catch { /* 略過 */ }
    location.href = '/clip';
  } catch (err) {
    if (note) note.textContent = err.message || '無法接到商品短片，請稍後再試。';
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || '接著做成商品短片';
    }
  }
}

document.getElementById('toClipBtn')?.addEventListener('click', goToClip);
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

const promptHandoff = sessionStorage.getItem('moosePromptToDress')
  || sessionStorage.getItem('moosePromptToModel');
if (promptHandoff) {
  const note = document.getElementById('note');
  if (note && !note.value.trim()) note.value = promptHandoff.slice(0, 120);
  sessionStorage.removeItem('moosePromptToDress');
  sessionStorage.removeItem('moosePromptToModel');
}
if (location.search.includes('mode=')) {
  history.replaceState(null, '', '/dress');
}
refreshPlan().then(() => recoverLast(true));
