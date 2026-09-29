const DEMOS = {
  image: { idea: '一杯拿鐵放在木桌上，早晨陽光從窗邊照進來，旁邊有一本翻開的書', picks: { style: '日系清新', shot: '半身', light: '自然窗光', ratio: '4:5 IG 貼文' } },
  video: { idea: '女生在花店裡把一束鮮花包好，抬頭對鏡頭微笑', picks: { style: '廣告質感', camera: '緩慢推近', seconds: '5 秒', ratio: '9:16 直式' } },
  text: { idea: '幫我的手作蛋糕店寫中秋節預購貼文，限量 50 盒', picks: { use: 'IG 貼文', tone: '溫暖感性', length: '100 字左右' } },
};

let kinds = [];
let kind = 'image';
let last = null;
let refImage = '';

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

function clearRef() {
  refImage = '';
  document.getElementById('refImg').value = '';
  document.getElementById('refPreview').classList.add('hidden');
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
  document.getElementById('idea').placeholder = `例如：${DEMOS[kind].idea}`;
  paintPicks();
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
  if (idea.length < 2 && !refImage) {
    msg.textContent = '請先寫一句想法，或上傳參考圖。';
    return;
  }
  msg.textContent = refImage ? '正在看圖並寫提示詞，約 15 秒。' : '正在寫提示詞，約 10 秒。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, idea, picks: readPicks(), image: refImage }),
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
  const file = e.target.files && e.target.files[0];
  const msg = document.getElementById('promptMsg');
  if (!file) return;
  try {
    refImage = await fileToJpegDataUrl(file);
    document.getElementById('refThumb').src = refImage;
    document.getElementById('refPreview').classList.remove('hidden');
    msg.textContent = '';
  } catch (err) {
    clearRef();
    msg.textContent = err.message;
  }
});

document.getElementById('refClear').addEventListener('click', clearRef);

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
