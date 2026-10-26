const form = document.getElementById('form');
const fileInput = document.getElementById('file');
const fileMeta = document.getElementById('fileMeta');
const preview = document.getElementById('preview');
const note = document.getElementById('note');
const submit = document.getElementById('submit');
const copyBtn = document.getElementById('copyBtn');
const msg = document.getElementById('msg');
const result = document.getElementById('result');
const styleLine = document.getElementById('styleLine');
const scriptBox = document.getElementById('script');
const beatsBox = document.getElementById('beats');
let previewUrl = '';
let lastScript = '';

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('影片解析逾時，請換一支 MP4。'));
    }, 8000);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    try {
      video.currentTime = time;
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

function frameLooksBlank(ctx, width, height) {
  const data = ctx.getImageData(0, 0, width, height).data;
  let sum = 0;
  let n = 0;
  const step = Math.max(16, Math.floor(data.length / 1600) * 4);
  for (let i = 0; i < data.length; i += step) {
    sum += data[i] + data[i + 1] + data[i + 2];
    n += 1;
  }
  return n > 0 && sum / (n * 3) < 8;
}

function scanStep(duration) {
  if (duration <= 20) return 0.5;
  if (duration <= 60) return 1;
  if (duration <= 120) return 1.5;
  return 2;
}

function thumbOf(ctx, canvas) {
  const w = 32;
  const h = 18;
  const thumb = document.createElement('canvas');
  thumb.width = w;
  thumb.height = h;
  const tctx = thumb.getContext('2d', { willReadFrequently: true });
  tctx.drawImage(canvas, 0, 0, w, h);
  return tctx.getImageData(0, 0, w, h).data;
}

function diffScore(a, b) {
  let sum = 0;
  let n = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 1;
  }
  return n ? sum / (n * 3) : 0;
}

function capMarks(marks) {
  const rows = marks.slice();
  while (rows.length - 1 > 12) {
    let weakest = 1;
    for (let i = 2; i < rows.length - 1; i += 1) {
      if (rows[i].score < rows[weakest].score) weakest = i;
    }
    rows.splice(weakest, 1);
  }
  return rows;
}

function buildMarks(duration, samples) {
  const marks = [{ t: 0, score: Infinity }];
  samples.forEach((row) => {
    if (row.score >= 28 && row.t - marks[marks.length - 1].t >= 0.9) {
      marks.push({ t: row.t, score: row.score });
    }
  });
  marks.push({ t: duration, score: Infinity });
  const split = [marks[0]];
  for (let i = 1; i < marks.length; i += 1) {
    const prev = split[split.length - 1].t;
    const span = marks[i].t - prev;
    if (span > 3) {
      const parts = Math.ceil(span / 3);
      const step = span / parts;
      for (let p = 1; p < parts; p += 1) {
        split.push({ t: Number((prev + step * p).toFixed(2)), score: 0 });
      }
    }
    split.push(marks[i]);
  }
  for (let i = 1; i < split.length - 1;) {
    if (split[i].t - split[i - 1].t < 0.8) split.splice(i, 1);
    else i += 1;
  }
  return capMarks(split);
}

async function drawAt(video, ctx, canvas, time) {
  await seekVideo(video, time);
  await new Promise((r) => requestAnimationFrame(r));
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  if (frameLooksBlank(ctx, canvas.width, canvas.height)) {
    await new Promise((r) => setTimeout(r, 80));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
}

function sampleVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.style.cssText = 'position:fixed;left:-9999px;width:160px;height:90px;';
    document.body.appendChild(video);
    let settled = false;
    const timer = setTimeout(() => finish(new Error('影片解析逾時，請換一支 MP4。')), 90000);
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.remove();
      if (err) reject(err);
      else resolve(data);
    };
    video.onerror = () => finish(new Error('影片讀取失敗，請換一支 MP4。'));
    video.onloadedmetadata = async () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration < 0.4) {
        finish(new Error('這支影片太短或無法讀取。'));
        return;
      }
      if (duration > 180) {
        finish(new Error('請上傳 3 分鐘以內的影片。'));
        return;
      }
      try {
        await video.play().catch(() => {});
        video.pause();
      } catch { /* 有些瀏覽器不讓自動播放，改直接跳時間 */ }
      const maxSide = 480;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth || 640, video.videoHeight || 640));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
      canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const step = scanStep(duration);
      const samples = [];
      try {
        let prev = null;
        for (let t = step; t < duration - 0.05; t += step) {
          const time = Number(Math.min(duration - 0.05, t).toFixed(2));
          await drawAt(video, ctx, canvas, time);
          const thumb = thumbOf(ctx, canvas);
          samples.push({ t: time, score: prev ? diffScore(prev, thumb) : 0 });
          prev = thumb;
        }
        const marks = buildMarks(duration, samples);
        const shots = [];
        for (let i = 0; i < marks.length - 1; i += 1) {
          const start = i === 0 ? 0 : marks[i].t;
          const end = i === marks.length - 2 ? duration : marks[i + 1].t;
          const mid = Math.min(end - 0.05, Math.max(start + 0.05, (start + end) / 2));
          await drawAt(video, ctx, canvas, mid);
          shots.push({
            start: Number(start.toFixed(2)),
            end: Number(end.toFixed(2)),
            image: canvas.toDataURL('image/jpeg', 0.62),
          });
        }
        finish(null, {
          duration: Number(duration.toFixed(1)),
          width: video.videoWidth,
          height: video.videoHeight,
          shots,
        });
      } catch (err) {
        finish(err instanceof Error ? err : new Error('影片無法解析，請換一支 MP4。'));
      }
    };
    video.src = url;
    video.load();
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  result.classList.add('hidden');
  copyBtn.classList.add('hidden');
  lastScript = '';
  if (!file) {
    preview.hidden = true;
    preview.removeAttribute('src');
    fileMeta.textContent = '尚未選片。';
    return;
  }
  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;
  preview.hidden = false;
  fileMeta.textContent = `${file.name}　選好了，按下方按鈕就會依時間看畫面。`;
});

function spokenScript(lines) {
  return lines.map((line, i) => {
    const text = String(line || '').trim();
    if (!text || i === lines.length - 1) return text;
    return /[。！？…]$/.test(text) ? text : `${text}。`;
  }).filter(Boolean).join('');
}

function showResult(data) {
  const beats = data.beats || [];
  lastScript = String(data.script || '').trim() || spokenScript(beats.map((row) => row.line));
  styleLine.textContent = data.style ? `風格：${data.style}` : '';
  scriptBox.textContent = lastScript;
  beatsBox.innerHTML = beats.map((row) => `
    <article class="item">
      <div>
        <p class="meta">${Number(row.start).toFixed(1)}–${Number(row.end).toFixed(1)} 秒${row.long ? '　這句字數偏多，配音可能超過這一段' : ''}</p>
        <h3>${escapeHtml(row.line)}</h3>
        ${row.see ? `<p>這段素材：${escapeHtml(row.see)}</p>` : ''}
      </div>
      <button type="button" class="btn btn-ghost" data-seek="${row.start}">對這段</button>
    </article>
  `).join('');
  result.classList.remove('hidden');
  copyBtn.classList.remove('hidden');
}

beatsBox.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-seek]');
  if (!btn || preview.hidden) return;
  preview.currentTime = Number(btn.getAttribute('data-seek')) || 0;
  preview.play().catch(() => {});
});

copyBtn.addEventListener('click', async () => {
  if (!lastScript) return;
  try {
    await navigator.clipboard.writeText(lastScript);
    msg.textContent = '旁白已複製。';
    msg.classList.remove('status-err');
  } catch {
    msg.textContent = '這台裝置無法直接複製，請手動選取旁白。';
    msg.classList.add('status-err');
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    msg.textContent = '請先選一支影片。';
    msg.classList.add('status-err');
    return;
  }
  submit.disabled = true;
  msg.classList.remove('status-err');
  msg.textContent = '正在依素材切段，對準每一段的秒數…';
  result.classList.add('hidden');
  try {
    const sampled = await sampleVideo(file);
    const headers = { 'Content-Type': 'application/json' };
    const token = sessionStorage.getItem('moose_admin_token') || '';
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch('/api/narrate', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        frames: sampled.shots.map((shot) => shot.image),
        video: {
          duration: sampled.duration,
          width: sampled.width,
          height: sampled.height,
          times: sampled.shots.map((shot) => (shot.start + shot.end) / 2),
          shots: sampled.shots.map((shot) => ({ start: shot.start, end: shot.end })),
        },
        note: note.value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('請先登入後台');
    if (!res.ok) throw new Error(data.error || '旁白產出失敗');
    showResult(data);
    msg.textContent = `旁白已跟素材對好，從 0 秒到 ${data.duration || sampled.duration} 秒。點「對這段」可核對那一秒。`;
  } catch (err) {
    msg.textContent = err.message || '旁白產出失敗';
    msg.classList.add('status-err');
  } finally {
    submit.disabled = false;
  }
});
