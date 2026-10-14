const DEMOS = {
  image: { idea: '一杯拿鐵放在木桌上，早晨陽光從窗邊照進來，旁邊有一本翻開的書', picks: { style: '日系清新', shot: '半身', light: '自然窗光', ratio: '4:5 IG 貼文' } },
  video: { idea: '女生在花店裡把一束鮮花包好，抬頭對鏡頭微笑', picks: { style: '廣告質感', camera: '緩慢推近', seconds: '5 秒', ratio: '9:16 直式' } },
  text: { idea: '幫我的手作蛋糕店寫中秋節預購貼文，限量 50 盒', picks: { use: 'IG 貼文', tone: '溫暖感性', length: '100 字左右' } },
  reverse: { idea: '背景換成海邊，其他不變（不寫就完全照原圖）', picks: {} },
  clip: { idea: '鏡頭改成緩慢推近，其他照原片（不寫就完全照原片）', picks: {} },
};

function maxRefs() {
  return kind === 'reverse' ? 1 : 2;
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let kinds = [];
let kind = 'image';
let last = null;
let refImages = [];
let refVideo = null;
let refVideoUrl = '';
let imageRefNote = '';

const VIDEO_REF_NOTE = '<strong>要重現同一個人或同一段運鏡：</strong>請把原影片和提示詞一起交給可靈、Runway 或 Veo。只貼文字，做出來的會是類似的另一支影片。';

function fileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('圖片讀取失敗，請換一張 JPG 或 PNG。'));
    };
    img.src = url;
  });
}

function paintRefs() {
  const box = document.getElementById('refPreview');
  box.innerHTML = refImages.map((src, i) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
      <img src="${src}" alt="圖 ${i + 1}" style="width:96px;height:96px;object-fit:cover;border-radius:12px;" />
      <span>圖 ${i + 1}</span>
      <button class="btn btn-cream" type="button" data-ref-remove="${i}">移除</button>
    </div>
  `).join('');
  box.classList.toggle('hidden', !refImages.length);
}

function currentKind() {
  return kinds.find((k) => k.id === kind);
}

function paintPicks() {
  const box = document.getElementById('pickBox');
  const info = currentKind();
  if (!info) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = info.fields.map((field) => `
    <div>
      <label class="field" for="pick-${field.key}">${field.label}</label>
      <select id="pick-${field.key}" class="form-input" data-pick="${field.key}">
        <option value="">讓 AI 挑</option>
        ${field.options.map((opt) => `<option value="${opt}">${opt}</option>`).join('')}
      </select>
    </div>
  `).join('');
}

function paintVideo() {
  const box = document.getElementById('videoPreview');
  if (!refVideo || !refVideoUrl) {
    box.innerHTML = '';
    box.classList.add('hidden');
    return;
  }
  box.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:flex-start;gap:6px;">
      <video src="${refVideoUrl}" controls muted playsinline style="max-width:240px;max-height:180px;border-radius:12px;background:#111;"></video>
      <span>${escapeHtml(refVideo.name)}</span>
      <button class="btn btn-cream" type="button" id="videoRemove">移除</button>
    </div>
  `;
  box.classList.remove('hidden');
}

function clearVideo() {
  if (refVideoUrl) URL.revokeObjectURL(refVideoUrl);
  refVideo = null;
  refVideoUrl = '';
  paintVideo();
}

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
    const timer = setTimeout(() => finish(new Error('影片解析逾時，請換一支 MP4。')), 20000);
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
      if (duration > 60) {
        finish(new Error('請上傳 60 秒以內的影片。'));
        return;
      }
      try {
        await video.play().catch(() => {});
        video.pause();
      } catch { /* 有些瀏覽器不讓自動播放，改直接跳時間 */ }
      const count = duration < 2 ? 3 : duration < 8 ? 5 : 8;
      const times = [];
      for (let i = 0; i < count; i += 1) {
        const t = (duration * (i + 0.5)) / count;
        times.push(Number(Math.max(0.05, Math.min(duration - 0.05, t)).toFixed(2)));
      }
      const maxSide = 640;
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
          images.push(canvas.toDataURL('image/jpeg', 0.72));
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

function setKind(next) {
  kind = next;
  document.querySelectorAll('#kindRow [data-kind]').forEach((btn) => {
    const on = btn.dataset.kind === kind;
    btn.classList.toggle('btn-copper', on);
    btn.classList.toggle('btn-cream', !on);
  });
  const reverse = kind === 'reverse';
  const clip = kind === 'clip';
  const withVideo = clip || kind === 'video';
  document.getElementById('idea').placeholder = `例如：${DEMOS[kind].idea}`;
  document.getElementById('ideaLabel').textContent = reverse || clip ? '想改的地方（選填）' : '你的想法';
  document.getElementById('refLabel').textContent = reverse ? '要分析的圖（必填，一張）' : '參考圖（選填，最多兩張）';
  document.getElementById('refImageBox').classList.toggle('hidden', clip);
  document.getElementById('refVideoBox').classList.toggle('hidden', !withVideo);
  document.getElementById('videoLabel').textContent = clip ? '要分析的影片（必填，一支）' : '參考影片（選填，一支）';
  document.getElementById('videoHelp').textContent = clip
    ? '支援 MP4、WebM、MOV，60 秒內、80MB 內。影片留在你的瀏覽器，只把沿時間抽出的畫面送給 AI 來看動作與運鏡。'
    : '上傳 MP4、WebM 或 MOV，60 秒內、80MB 內。AI 會看影片裡的動作與運鏡，再配上你的想法寫成提示詞。只放影片、不寫想法也可以。';
  document.getElementById('reverseHint').classList.toggle('hidden', !reverse);
  document.getElementById('clipHint').classList.toggle('hidden', !clip);
  document.getElementById('videoKindHint').classList.toggle('hidden', kind !== 'video');
  document.getElementById('demoBtn').classList.toggle('hidden', reverse || clip);
  if (refImages.length > maxRefs()) {
    refImages = refImages.slice(0, maxRefs());
    paintRefs();
  }
  paintPicks();
}

function paintParts(parts) {
  const box = document.getElementById('partBox');
  document.getElementById('partList').innerHTML = (parts || []).map((p, i) => `
    <div style="margin:0 0 16px;">
      <label class="field">${escapeHtml(p.label)}</label>
      <textarea class="form-input" rows="2" data-part-zh="${i}">${escapeHtml(p.zh)}</textarea>
      <textarea class="form-input" rows="2" data-part-en="${i}" style="margin-top:6px;">${escapeHtml(p.en)}</textarea>
    </div>
  `).join('');
  box.classList.toggle('hidden', !(parts && parts.length));
}

function rebuildFromParts() {
  if (!last || !last.parts || !last.parts.length) return;
  const skip = (v) => !v || /^(無|none|n\/a)$/i.test(v.trim());
  last.parts.forEach((p, i) => {
    p.zh = document.querySelector(`[data-part-zh="${i}"]`).value.trim();
    p.en = document.querySelector(`[data-part-en="${i}"]`).value.trim();
  });
  last.zh = last.parts.map((p) => p.zh).filter((v) => !skip(v)).join('，').replace(/[。，]+，/g, '，');
  last.en = last.parts.map((p) => p.en).filter((v) => !skip(v)).join(' ').replace(/\s+/g, ' ');
  document.getElementById('outZh').textContent = last.zh;
  document.getElementById('outEn').textContent = last.en;
  document.getElementById('copyMsg').textContent = '已組成新提示詞，可以直接複製。';
}

function readPicks() {
  const picks = {};
  document.querySelectorAll('[data-pick]').forEach((sel) => {
    if (sel.value) picks[sel.dataset.pick] = sel.value;
  });
  return picks;
}

function paintResult(data) {
  document.getElementById('outKind').textContent = `${data.kindName || ''}提示詞`;
  document.getElementById('outName').textContent = data.title || '提示詞';
  document.getElementById('outEn').textContent = data.en;
  document.getElementById('outZh').textContent = data.zh;
  document.getElementById('outNeg').textContent = data.negative || '';
  document.getElementById('negBox').classList.toggle('hidden', !data.negative);
  const tips = data.tips || [];
  document.getElementById('outTips').innerHTML = tips.map((t, i) => `${i + 1}. ${String(t).replace(/</g, '&lt;')}`).join('<br />');
  document.getElementById('tipBox').classList.toggle('hidden', !tips.length);
  paintParts(data.parts);
  document.getElementById('toModelBtn').classList.toggle('hidden', data.kind !== 'image' && data.kind !== 'reverse');
  document.getElementById('copyMsg').textContent = '';
  document.getElementById('resultBox').classList.remove('hidden');
  last = data;
}

async function refreshPlan() {
  const bar = document.getElementById('promptPlan');
  try {
    const data = await fetch('/api/prompt/status').then((r) => r.json());
    kinds = data.kinds || [];
    paintPicks();
    if (!data.ready) {
      bar.textContent = '提示詞產生器暫時無法使用，請稍後再試。';
      return;
    }
    setAgentPlanBar(bar, data);
  } catch {
    bar.textContent = '未購方案者，各智能體可試用 1 次。';
  }
}

async function makePrompt() {
  const msg = document.getElementById('promptMsg');
  const btn = document.getElementById('makeBtn');
  const idea = document.getElementById('idea').value.trim();
  if (kind === 'clip' && !refVideo) {
    msg.textContent = '請先上傳一支要分析的影片。';
    return;
  }
  if (kind === 'reverse' && !refImages.length) {
    msg.textContent = '請先上傳一張要分析的圖。';
    return;
  }
  if (kind !== 'clip' && idea.length < 2 && !refImages.length && !refVideo) {
    msg.textContent = '請先寫一句想法，或上傳參考圖、參考影片。';
    return;
  }
  const analyzeVideo = (kind === 'clip' || kind === 'video') && refVideo;
  msg.textContent = analyzeVideo ? '正在讀取影片畫面…' : (refImages.length ? '正在看圖並寫提示詞，約 15 秒。' : '正在寫提示詞，約 10 秒。');
  btn.disabled = true;
  try {
    let frames = [];
    let video;
    if (analyzeVideo) {
      const sampled = await sampleVideo(refVideo);
      frames = sampled.images;
      video = {
        duration: sampled.duration,
        width: sampled.width,
        height: sampled.height,
        times: sampled.times,
      };
      msg.textContent = '正在看影片並寫提示詞，約 20 秒。';
    }
    const res = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        idea,
        picks: readPicks(),
        images: kind === 'clip' ? [] : refImages,
        frames,
        video,
      }),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('連線中斷，請再按一次。');
    }
    if (!res.ok) throw new Error(body.error || '產出失敗');
    paintResult(body);
    const note = document.getElementById('refNote');
    if (kind === 'clip' || (kind === 'video' && refVideo)) {
      note.innerHTML = VIDEO_REF_NOTE;
      note.classList.remove('hidden');
    } else {
      note.innerHTML = imageRefNote;
      note.classList.toggle('hidden', !refImages.length);
    }
    msg.textContent = '';
    refreshPlan();
  } catch (err) {
    msg.textContent = err.message || '產出失敗';
  } finally {
    btn.disabled = false;
  }
}

document.querySelectorAll('#kindRow [data-kind]').forEach((btn) => {
  btn.addEventListener('click', () => setKind(btn.dataset.kind));
});

document.getElementById('refImg').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  const msg = document.getElementById('promptMsg');
  e.target.value = '';
  if (!files.length) return;
  const room = maxRefs() - refImages.length;
  msg.textContent = files.length > room ? `這裡最多 ${maxRefs()} 張，多的已略過。` : '';
  try {
    for (const file of files.slice(0, Math.max(0, room))) {
      refImages.push(await fileToJpegDataUrl(file));
    }
  } catch (err) {
    msg.textContent = err.message;
  }
  paintRefs();
});

document.getElementById('refPreview').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ref-remove]');
  if (!btn) return;
  refImages.splice(Number(btn.dataset.refRemove), 1);
  paintRefs();
});

document.getElementById('refVideo').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  const msg = document.getElementById('promptMsg');
  e.target.value = '';
  if (!file) return;
  const okType = /^video\//.test(file.type) || /\.(mp4|webm|mov)$/i.test(file.name);
  if (!okType) {
    msg.textContent = '請上傳 MP4、WebM 或 MOV。';
    return;
  }
  if (file.size > 80 * 1024 * 1024) {
    msg.textContent = '影片請小於 80MB。';
    return;
  }
  if (refVideoUrl) URL.revokeObjectURL(refVideoUrl);
  refVideo = file;
  refVideoUrl = URL.createObjectURL(file);
  paintVideo();
  msg.textContent = '';
});

document.getElementById('videoPreview').addEventListener('click', (e) => {
  if (!e.target.closest('#videoRemove')) return;
  clearVideo();
});

document.getElementById('rebuildBtn').addEventListener('click', rebuildFromParts);
document.getElementById('toModelBtn').addEventListener('click', () => {
  if (!last || !last.zh) return;
  sessionStorage.setItem('moosePromptToModel', last.zh.replace(/避免：[\s\S]*$/, '').trim());
  sessionStorage.setItem('moosePromptToDress', last.zh.replace(/避免：[\s\S]*$/, '').trim());
  location.href = '/dress';
});
document.getElementById('makeBtn').addEventListener('click', makePrompt);
document.getElementById('againBtn').addEventListener('click', makePrompt);
document.getElementById('promptForm').addEventListener('submit', (e) => {
  e.preventDefault();
  makePrompt();
});

document.getElementById('demoBtn').addEventListener('click', () => {
  const demo = DEMOS[kind];
  document.getElementById('idea').value = demo.idea;
  Object.entries(demo.picks).forEach(([key, value]) => {
    const sel = document.getElementById(`pick-${key}`);
    if (sel) sel.value = value;
  });
  makePrompt();
});

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const note = document.getElementById('copyMsg');
    const value = last && last[btn.dataset.copy];
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      note.textContent = '已複製。';
    } catch {
      note.textContent = '複製失敗，請自行選取文字。';
    }
  });
});

imageRefNote = document.getElementById('refNote').innerHTML;
setKind('image');
refreshPlan();
