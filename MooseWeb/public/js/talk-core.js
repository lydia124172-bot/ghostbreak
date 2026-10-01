function talkTokenHeaders(json) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = sessionStorage.getItem('moose_admin_token');
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function talkShowMsg(text) {
  const el = document.getElementById('talkMsg');
  if (el) el.textContent = text;
}

async function talkUploadBlob(blob, kind) {
  const res = await fetch(`/api/clip/upload?kind=${encodeURIComponent(kind)}&mime=${encodeURIComponent(blob.type || 'application/octet-stream')}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || '上傳失敗');
  return body.id;
}

function talkFileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 768 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('照片讀取失敗'));
    img.src = url;
  });
}

async function talkWaitJob(jobId, onPhase) {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await fetch(`/api/talk/video/job/${encodeURIComponent(jobId)}`, { headers: talkTokenHeaders() });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 402) throw new Error(body.error || '請先後台登入或確認點數。');
    if (res.status === 404) throw new Error(body.error || '找不到這次對嘴。');
    if (!res.ok) throw new Error(body.error || '對嘴失敗');
    if (body.videoUrl) return body;
    if (onPhase) {
      onPhase(body.status === 'saving' ? '存檔中' : body.status === 'running' ? '對嘴中' : '排隊中');
    }
  }
  throw new Error('對嘴逾時。若已做好，請按取回，不要重按產出。');
}

async function talkRefreshPlan() {
  const bar = document.getElementById('talkPlan');
  if (!bar) return;
  try {
    const st = await fetch('/api/clip/status', { headers: talkTokenHeaders() }).then((r) => r.json());
    if (!st.talk) {
      bar.textContent = '數字人出鏡尚未開通。';
      return;
    }
    bar.innerHTML = '對嘴每秒扣 1 點，依旁白或音檔長度計算。需登入並有方案點數。　<a href="/account">看方案</a>';
  } catch {
    bar.textContent = '請先登入帳號並確認點數。';
  }
}

async function talkSubmitProduce(event) {
  event.preventDefault();
  const btn = document.getElementById('talkBtn');
  const face = document.getElementById('face')?.files[0];
  const voice = document.getElementById('voice')?.files[0];
  const narration = document.getElementById('narration')?.value.trim() || '';
  if (!face) {
    talkShowMsg('請上傳正面出鏡照片。');
    return;
  }
  if (!narration && !voice) {
    talkShowMsg('請填口播，或上傳口播音檔。');
    return;
  }
  btn.disabled = true;
  let tick = 0;
  let phase = '已送出';
  const clock = setInterval(() => {
    tick += 1;
    btn.textContent = `${phase} ${tick} 秒`;
    talkShowMsg(`數字人${phase}，已過 ${tick} 秒。通常約 1 到 2 分鐘，請不要重按。`);
  }, 1000);
  try {
    let voiceId = '';
    if (voice) {
      if (voice.size > 8 * 1024 * 1024) throw new Error('口播音檔請小於 8MB');
      phase = '上傳口播';
      voiceId = await talkUploadBlob(voice, 'audio');
    }
    phase = '送出對嘴';
    const res = await fetch('/api/talk/video', {
      method: 'POST',
      headers: talkTokenHeaders(true),
      body: JSON.stringify({
        images: [await talkFileToJpegDataUrl(face)],
        narration,
        voiceId,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 402) throw new Error(body.error || '請先後台登入或確認點數。');
    if (!res.ok) throw new Error(body.error || '對嘴送出失敗');
    const done = body.videoUrl ? body : await talkWaitJob(body.jobId, (next) => { phase = next; });
    const video = document.getElementById('preview');
    if (video) video.src = done.videoUrl;
    document.getElementById('previewBox')?.classList.remove('hidden');
    const dl = document.getElementById('downloadBtn');
    if (dl) dl.href = `${done.videoUrl}?download=1`;
    talkShowMsg('對嘴短片已產出，請下載後發文。不要再按。');
    document.getElementById('previewBox')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (err) {
    talkShowMsg(err.message || '對嘴失敗');
  } finally {
    clearInterval(clock);
    btn.disabled = false;
    btn.textContent = '產出對嘴短片';
  }
}

async function talkRecoverLast() {
  const btn = document.getElementById('recoverTalkBtn');
  btn.disabled = true;
  try {
    talkShowMsg('正在取回剛才的對嘴，不會再新做一支。');
    const last = await fetch('/api/talk/video/last', { headers: talkTokenHeaders() });
    const body = await last.json().catch(() => ({}));
    if (!last.ok) throw new Error(body.error || '沒有可取回的對嘴短片');
    const video = document.getElementById('preview');
    if (video) video.src = body.videoUrl;
    document.getElementById('previewBox')?.classList.remove('hidden');
    const dl = document.getElementById('downloadBtn');
    if (dl) dl.href = `${body.videoUrl}?download=1`;
    talkShowMsg('已取回剛才的對嘴，請下載後發文。不要再按產出。');
  } catch (err) {
    talkShowMsg(err.message || '取回失敗');
  } finally {
    btn.disabled = false;
  }
}

function mooseBindTalkUi() {
  const form = document.getElementById('talkForm');
  if (!form || form.dataset.mooseBound) return;
  form.dataset.mooseBound = '1';
  form.addEventListener('submit', talkSubmitProduce);
  document.getElementById('recoverTalkBtn')?.addEventListener('click', talkRecoverLast);
  talkRefreshPlan();
}
