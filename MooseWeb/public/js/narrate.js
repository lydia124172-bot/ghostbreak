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
const summaryLine = document.getElementById('summaryLine');
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

function frameCount(duration) {
  if (duration < 6) return 4;
  return Math.min(16, Math.max(6, Math.round(duration / 5)));
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
    const timer = setTimeout(() => finish(new Error('影片解析逾時，請換一支 MP4。')), 25000);
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
      const count = frameCount(duration);
      const times = [];
      for (let i = 0; i < count; i += 1) {
        const t = (duration * (i + 0.5)) / count;
        times.push(Number(Math.max(0.05, Math.min(duration - 0.05, t)).toFixed(2)));
      }
      const maxSide = 512;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth || 640, video.videoHeight || 640));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
      canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const images = [];
      try {
        for (const t of times) {
          await seekVideo(video, t);
          await new Promise((r) => requestAnimationFrame(r));
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          if (frameLooksBlank(ctx, canvas.width, canvas.height)) {
            await new Promise((r) => setTimeout(r, 120));
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          images.push(canvas.toDataURL('image/jpeg', 0.66));
        }
      } catch (err) {
        finish(err instanceof Error ? err : new Error('影片無法解析，請換一支 MP4。'));
        return;
      }
      finish(null, {
        duration: Number(duration.toFixed(1)),
        width: video.videoWidth,
        height: video.videoHeight,
        images,
        times,
      });
    };
    video.src = url;
    video.load();
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clock(sec) {
  const n = Math.max(0, Number(sec) || 0);
  const m = Math.floor(n / 60);
  const s = (n % 60).toFixed(1).padStart(m ? 4 : 3, '0');
  return m ? `${m}:${s}` : `${s} 秒`;
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

function showResult(data) {
  lastScript = data.script || '';
  styleLine.textContent = data.style ? `風格：${data.style}` : '';
  summaryLine.textContent = data.summary || '';
  scriptBox.textContent = lastScript;
  beatsBox.innerHTML = (data.beats || []).map((row) => `
    <article class="item">
      <div>
        <p class="meta">${clock(row.start)} – ${clock(row.end)}${row.long ? '　這句字數偏多，配音可能超過這一段' : ''}</p>
        <h3>${escapeHtml(row.line)}</h3>
        ${row.see ? `<p>畫面：${escapeHtml(row.see)}</p>` : ''}
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
  msg.textContent = '正在看畫面，依內容和風格寫旁白…';
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
        frames: sampled.images,
        video: {
          duration: sampled.duration,
          width: sampled.width,
          height: sampled.height,
          times: sampled.times,
        },
        note: note.value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('請先登入後台');
    if (!res.ok) throw new Error(data.error || '旁白產出失敗');
    showResult(data);
    msg.textContent = `旁白好了，對上約 ${data.duration || sampled.duration} 秒。點「對這段」可核對畫面。`;
  } catch (err) {
    msg.textContent = err.message || '旁白產出失敗';
    msg.classList.add('status-err');
  } finally {
    submit.disabled = false;
  }
});
