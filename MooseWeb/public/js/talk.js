function tokenHeaders(json) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = sessionStorage.getItem('moose_admin_token');
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function showMsg(text) {
  const el = document.getElementById('talkMsg');
  if (el) el.textContent = text;
}

async function uploadBlob(blob, kind) {
  const res = await fetch(`/api/clip/upload?kind=${encodeURIComponent(kind)}&mime=${encodeURIComponent(blob.type || 'application/octet-stream')}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || '上傳失敗');
  return body.id;
}

function fileToJpegDataUrl(file) {
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

async function waitJob(jobId, onPhase) {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await fetch(`/api/talk/video/job/${encodeURIComponent(jobId)}`, { headers: tokenHeaders() });
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

async function refreshPlan() {
  const bar = document.getElementById('talkPlan');
  if (!bar) return;
  try {
    const st = await fetch('/api/clip/status', { headers: tokenHeaders() }).then((r) => r.json());
    if (!st.talk) {
      bar.textContent = '數字人出鏡尚未開通。';
      return;
    }
    if (st.owner) {
      bar.textContent = '作者已登入。對嘴走官方接口，不扣方案點，仍扣 fal。約 USD 0.13／秒。';
      return;
    }
    bar.innerHTML = `對嘴一次扣 ${st.talkCredits || 5} 點。　<a href="/admin">後台登入</a>`;
  } catch {
    bar.textContent = '請先後台登入再試對嘴。';
  }
}

document.getElementById('talkForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const btn = document.getElementById('talkBtn');
  const face = document.getElementById('face').files[0];
  const voice = document.getElementById('voice').files[0];
  const narration = document.getElementById('narration').value.trim();
  if (!face) {
    showMsg('請上傳正面出鏡照片。');
    return;
  }
  if (!narration && !voice) {
    showMsg('請填旁白，或上傳口播音檔。');
    return;
  }
  btn.disabled = true;
  let tick = 0;
  let phase = '已送出';
  const clock = setInterval(() => {
    tick += 1;
    btn.textContent = `${phase} ${tick} 秒`;
    showMsg(`數字人${phase}，已過 ${tick} 秒。通常約 1 到 2 分鐘，請不要重按。`);
  }, 1000);
  try {
    let voiceId = '';
    if (voice) {
      if (voice.size > 8 * 1024 * 1024) throw new Error('口播音檔請小於 8MB');
      phase = '上傳口播';
      voiceId = await uploadBlob(voice, 'audio');
    }
    phase = '送出對嘴';
    const res = await fetch('/api/talk/video', {
      method: 'POST',
      headers: tokenHeaders(true),
      body: JSON.stringify({
        images: [await fileToJpegDataUrl(face)],
        narration,
        voiceId,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 402) throw new Error(body.error || '請先後台登入或確認點數。');
    if (!res.ok) throw new Error(body.error || '對嘴送出失敗');
    const done = body.videoUrl ? body : await waitJob(body.jobId, (next) => { phase = next; });
    const video = document.getElementById('preview');
    video.src = done.videoUrl;
    document.getElementById('previewBox').classList.remove('hidden');
    document.getElementById('downloadBtn').href = `${done.videoUrl}?download=1`;
    showMsg('對嘴短片已產出，請下載後發文。不要再按。');
  } catch (err) {
    showMsg(err.message || '對嘴失敗');
  } finally {
    clearInterval(clock);
    btn.disabled = false;
    btn.textContent = '產出對嘴短片';
  }
});

document.getElementById('recoverTalkBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('recoverTalkBtn');
  btn.disabled = true;
  try {
    showMsg('正在取回剛才的對嘴，不會再新做一支。');
    const last = await fetch('/api/talk/video/last', { headers: tokenHeaders() });
    const body = await last.json().catch(() => ({}));
    if (!last.ok) throw new Error(body.error || '沒有可取回的對嘴短片');
    const video = document.getElementById('preview');
    video.src = body.videoUrl;
    document.getElementById('previewBox').classList.remove('hidden');
    document.getElementById('downloadBtn').href = `${body.videoUrl}?download=1`;
    showMsg('已取回剛才的對嘴，請下載後發文。不要再按產出。');
  } catch (err) {
    showMsg(err.message || '取回失敗');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('backClipBtn')?.addEventListener('click', () => {
  window.close();
  showMsg('請直接關掉這一頁，切回原來的小廣告分頁。圖、配樂、口播都還在那一頁。不要在這裡再開一頁小廣告。');
});

function selectedTalkMode() {
  return document.querySelector('input[name="talkMode"]:checked')?.value || 'sell';
}

document.getElementById('writeTalkBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('writeTalkBtn');
  const product = document.getElementById('topic').value.trim();
  const features = document.getElementById('points').value.trim();
  const mode = selectedTalkMode();
  if (!product && !features) {
    showMsg('請先填商品或主題，或要講的內容。');
    return;
  }
  btn.disabled = true;
  showMsg('正在寫口播文案…');
  try {
    const res = await fetch('/api/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product, features, mode, images: [] }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '文案產出失敗');
    const voice = [body.script?.hook, body.script?.pain, body.script?.cta].filter(Boolean).join('');
    document.getElementById('narration').value = voice.slice(0, 280);
    showMsg('已填入口播。本頁對嘴約 10 秒，字數超過可再刪短。');
  } catch (err) {
    showMsg(err.message || '文案產出失敗');
  } finally {
    btn.disabled = false;
  }
});

refreshPlan();
