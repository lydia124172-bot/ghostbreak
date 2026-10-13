const state = { uploadId: '', file: null, marks: [], tool: 'brush', size: 22, drawing: null, ready: false };

const video = document.getElementById('video');
const paint = document.getElementById('paint');
const stage = document.getElementById('stage');
const pen = paint.getContext('2d');

function note(text) {
  document.getElementById('patchMsg').textContent = text;
}

function timeKey(time) {
  return Math.round(Number(time || 0) * 10) / 10;
}

function markAt(time) {
  const key = timeKey(time);
  return state.marks.find((mark) => Math.abs(mark.time - key) < 0.05);
}

function paintMarkLine() {
  const line = document.getElementById('markLine');
  if (!state.marks.length) {
    line.textContent = '還沒塗。暫停後，用畫筆塗滿要蓋掉的地方。';
    return;
  }
  const spots = state.marks.map((mark) => `${mark.time.toFixed(1)} 秒`).join('、');
  line.textContent = `已塗 ${state.marks.length} 處：${spots}。轉到後面若開口還在，拖到那個時間再塗一次。`;
}

function fitStage() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  paint.width = w;
  paint.height = h;
  stage.style.aspectRatio = `${w} / ${h}`;
  redraw();
}

function redraw() {
  pen.clearRect(0, 0, paint.width, paint.height);
  const near = state.marks.filter((mark) => Math.abs(mark.time - video.currentTime) < 0.2);
  const live = state.drawing ? [state.drawing] : [];
  pen.lineCap = 'round';
  pen.lineJoin = 'round';
  [...near, ...live].forEach((mark) => {
    if (!mark.points.length) return;
    pen.strokeStyle = mark.erase ? 'rgba(0,0,0,0.55)' : 'rgba(220, 40, 40, 0.55)';
    pen.lineWidth = mark.size || state.size;
    pen.beginPath();
    mark.points.forEach((point, index) => {
      const x = point.x * paint.width;
      const y = point.y * paint.height;
      if (index === 0) pen.moveTo(x, y);
      else pen.lineTo(x, y);
    });
    pen.stroke();
  });
}

function pointerPoint(event) {
  const rect = paint.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;
  return { x, y };
}

function startDraw(event) {
  if (!video.videoWidth) return;
  video.pause();
  document.getElementById('playBtn').textContent = '播放';
  const point = pointerPoint(event);
  if (!point) return;
  paint.setPointerCapture(event.pointerId);
  state.drawing = {
    time: timeKey(video.currentTime),
    size: state.size,
    erase: state.tool === 'erase',
    points: [point],
  };
  redraw();
}

function moveDraw(event) {
  if (!state.drawing) return;
  const point = pointerPoint(event);
  if (!point) return;
  const last = state.drawing.points[state.drawing.points.length - 1];
  if (Math.hypot(point.x - last.x, point.y - last.y) < 0.004) return;
  state.drawing.points.push(point);
  redraw();
}

function endDraw() {
  const stroke = state.drawing;
  state.drawing = null;
  if (!stroke || stroke.points.length < 1) return;
  const existing = markAt(stroke.time);
  if (stroke.erase) {
    if (!existing) return;
    const radius = (stroke.size / Math.max(paint.width, 1)) * 1.4;
    existing.points = existing.points.filter((point) => !stroke.points.some((gone) => Math.hypot(point.x - gone.x, point.y - gone.y) < radius));
    if (!existing.points.length) state.marks = state.marks.filter((mark) => mark !== existing);
  } else if (existing) {
    existing.points = existing.points.concat(stroke.points).slice(-400);
    existing.size = stroke.size;
  } else {
    state.marks.push({ time: stroke.time, size: stroke.size, points: stroke.points.slice(-400) });
  }
  paintMarkLine();
  redraw();
}

function sample(points) {
  if (points.length <= 20) return points.slice();
  const out = [];
  for (let i = 0; i < 20; i += 1) out.push(points[Math.round((i * (points.length - 1)) / 19)]);
  return out;
}

function payloadMarks() {
  return state.marks.map((mark) => {
    const points = sample(mark.points);
    let x0 = 1;
    let y0 = 1;
    let x1 = 0;
    let y1 = 0;
    mark.points.forEach((point) => {
      x0 = Math.min(x0, point.x);
      y0 = Math.min(y0, point.y);
      x1 = Math.max(x1, point.x);
      y1 = Math.max(y1, point.y);
    });
    const rx = (mark.size || 22) / (video.videoWidth || 1);
    const ry = (mark.size || 22) / (video.videoHeight || 1);
    points.push({ x: Math.max(0, x0 - rx), y: Math.max(0, y0 - ry) });
    points.push({ x: Math.min(1, x1 + rx), y: Math.min(1, y1 + ry) });
    return { time: mark.time, points: points.slice(0, 24) };
  }).filter((mark) => mark.points.length);
}

function setTool(tool) {
  state.tool = tool;
  document.getElementById('brushBtn').classList.toggle('btn-copper', tool === 'brush');
  document.getElementById('brushBtn').classList.toggle('btn-cream', tool !== 'brush');
  document.getElementById('eraseBtn').classList.toggle('btn-copper', tool === 'erase');
  document.getElementById('eraseBtn').classList.toggle('btn-cream', tool !== 'erase');
}

async function refreshPlan() {
  const bar = document.getElementById('patchPlan');
  try {
    const data = await fetch('/api/patch/status').then((res) => res.json());
    state.ready = Boolean(data.ready);
    if (!data.ready) {
      bar.textContent = '修片子暫時無法使用，請稍後再試。';
      return;
    }
    if (data.owner) {
      bar.textContent = '作者登入中，不扣站內點數。追蹤仍可能計 fal 費用，不會整支重做。';
      return;
    }
    if (!data.loggedIn) {
      bar.innerHTML = '需先到方案頁登入。　<a href="/account">看方案</a>';
      return;
    }
    bar.innerHTML = `帳號剩餘 ${Number(data.credits || 0)} 點。成功扣 3 點。　<a href="/account">加點</a>`;
  } catch {
    bar.textContent = '修片子暫時無法使用，請稍後再試。';
  }
}

async function waitJob(jobId) {
  for (let i = 0; i < 200; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const res = await fetch(`/api/patch/job/${encodeURIComponent(jobId)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '修片失敗');
    if (body.status === 'done' && body.videoUrl) return body;
    note(body.status === 'running' ? '模型正在依畫筆重畫這一段布。請不要重按。' : '正在追蹤塗過的地方。請不要重按。');
  }
  throw new Error('修片逾時，請稍後再試。這次若沒做完，不會扣站上點數。');
}

function uploadVideo(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/patch/upload');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return;
      note(`正在上傳影片 ${Math.min(100, Math.round((event.loaded / event.total) * 100))}%。`);
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* 略過 */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.uploadId) resolve(body);
      else reject(new Error(body.error || '上傳失敗，請再試一次。'));
    };
    xhr.onerror = () => reject(new Error('影片沒送上去。請留在這個頁面再按一次。'));
    xhr.ontimeout = () => reject(new Error('上傳太久。請把影片縮短再試。'));
    xhr.onabort = () => reject(new Error('上傳已中斷，請再按一次。'));
    xhr.send(file);
  });
}

async function makePatch() {
  const btn = document.getElementById('makeBtn');
  if (!state.file) {
    note('請先放上影片。');
    return;
  }
  const marks = payloadMarks();
  if (!marks.length) {
    note('請先用畫筆塗滿要蓋掉的地方。');
    return;
  }
  if (!state.ready) {
    note('修片子暫時無法使用。');
    return;
  }
  btn.disabled = true;
  document.getElementById('resultBox').classList.add('hidden');
  try {
    note('正在上傳影片。');
    const uploaded = await uploadVideo(state.file);
    state.uploadId = uploaded.uploadId;
    note('正在追蹤畫筆塗過的地方。請不要重按。');
    const res = await fetch('/api/patch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId: state.uploadId,
        marks,
        prompt: document.getElementById('patchPrompt').value.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '修片失敗');
    const done = body.videoUrl ? body : await waitJob(body.jobId);
    const out = document.getElementById('outVideo');
    out.src = done.videoUrl;
    document.getElementById('saveBtn').href = `${String(done.videoUrl).split('?')[0]}?download=1`;
    document.getElementById('resultBox').classList.remove('hidden');
    note('片子回來了。請從你下筆的時間看裙子，蓋上去的只有那一截。');
    refreshPlan();
  } catch (err) {
    note(err.message || '修片失敗');
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('videoFile').addEventListener('change', () => {
  const file = document.getElementById('videoFile').files[0];
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) {
    note('影片請小於 40MB。');
    return;
  }
  state.file = file;
  state.marks = [];
  video.src = URL.createObjectURL(file);
  stage.classList.remove('hidden');
  document.getElementById('tools').classList.remove('hidden');
  paintMarkLine();
  note('');
});

video.addEventListener('loadedmetadata', () => {
  const scrub = document.getElementById('scrub');
  scrub.max = String(video.duration || 0);
  fitStage();
});
video.addEventListener('timeupdate', () => {
  document.getElementById('scrub').value = String(video.currentTime || 0);
  redraw();
});
document.getElementById('scrub').addEventListener('input', () => {
  video.pause();
  document.getElementById('playBtn').textContent = '播放';
  video.currentTime = Number(document.getElementById('scrub').value || 0);
  redraw();
});
document.getElementById('playBtn').addEventListener('click', () => {
  if (video.paused) {
    video.play();
    document.getElementById('playBtn').textContent = '暫停';
  } else {
    video.pause();
    document.getElementById('playBtn').textContent = '播放';
  }
});
document.getElementById('brushSize').addEventListener('input', (event) => {
  state.size = Number(event.target.value || 22);
});
document.getElementById('brushBtn').addEventListener('click', () => setTool('brush'));
document.getElementById('eraseBtn').addEventListener('click', () => setTool('erase'));
document.getElementById('clearHereBtn').addEventListener('click', () => {
  state.marks = state.marks.filter((mark) => Math.abs(mark.time - video.currentTime) >= 0.2);
  paintMarkLine();
  redraw();
});
document.getElementById('clearAllBtn').addEventListener('click', () => {
  state.marks = [];
  paintMarkLine();
  redraw();
});
paint.addEventListener('pointerdown', startDraw);
paint.addEventListener('pointermove', moveDraw);
paint.addEventListener('pointerup', endDraw);
paint.addEventListener('pointercancel', endDraw);
document.getElementById('patchForm').addEventListener('submit', (event) => event.preventDefault());
document.getElementById('makeBtn').addEventListener('click', makePatch);
setTool('brush');
refreshPlan();
