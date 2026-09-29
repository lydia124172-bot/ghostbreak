const DEMOS = {
  image: { idea: '一杯拿鐵放在木桌上，早晨陽光從窗邊照進來，旁邊有一本翻開的書', picks: { style: '日系清新', shot: '半身', light: '自然窗光', ratio: '4:5 IG 貼文' } },
  video: { idea: '女生在花店裡把一束鮮花包好，抬頭對鏡頭微笑', picks: { style: '廣告質感', camera: '緩慢推近', seconds: '5 秒', ratio: '9:16 直式' } },
  text: { idea: '幫我的手作蛋糕店寫中秋節預購貼文，限量 50 盒', picks: { use: 'IG 貼文', tone: '溫暖感性', length: '100 字左右' } },
  reverse: { idea: '背景換成海邊，其他不變（不寫就完全照原圖）', picks: {} },
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

function setKind(next) {
  kind = next;
  document.querySelectorAll('#kindRow [data-kind]').forEach((btn) => {
    const on = btn.dataset.kind === kind;
    btn.classList.toggle('btn-copper', on);
    btn.classList.toggle('btn-cream', !on);
  });
  const reverse = kind === 'reverse';
  document.getElementById('idea').placeholder = `例如：${DEMOS[kind].idea}`;
  document.getElementById('ideaLabel').textContent = reverse ? '想改的地方（選填）' : '你的想法';
  document.getElementById('refLabel').textContent = reverse ? '要分析的圖（必填，一張）' : '參考圖（選填，最多兩張）';
  document.getElementById('reverseHint').classList.toggle('hidden', !reverse);
  document.getElementById('demoBtn').classList.toggle('hidden', reverse);
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
    bar.textContent = data.owner
      ? '管理者模式：不限次數。'
      : `今日尚可免費產出 ${data.left}／${data.limit} 則。與口播腳本、熱問等智能體共用次數。`;
  } catch {
    bar.textContent = '每日可免費產出 20 則。';
  }
}

async function makePrompt() {
  const msg = document.getElementById('promptMsg');
  const btn = document.getElementById('makeBtn');
  const idea = document.getElementById('idea').value.trim();
  if (kind === 'reverse' && !refImages.length) {
    msg.textContent = '請先上傳一張要分析的圖。';
    return;
  }
  if (idea.length < 2 && !refImages.length) {
    msg.textContent = '請先寫一句想法，或上傳參考圖。';
    return;
  }
  msg.textContent = refImages.length ? '正在看圖並寫提示詞，約 15 秒。' : '正在寫提示詞，約 10 秒。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, idea, picks: readPicks(), images: refImages }),
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
    document.getElementById('refNote').classList.toggle('hidden', !refImages.length);
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

document.getElementById('rebuildBtn').addEventListener('click', rebuildFromParts);
document.getElementById('toModelBtn').addEventListener('click', () => {
  if (!last || !last.zh) return;
  sessionStorage.setItem('moosePromptToModel', last.zh.replace(/避免：[\s\S]*$/, '').trim());
  location.href = '/model';
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

setKind('image');
refreshPlan();
