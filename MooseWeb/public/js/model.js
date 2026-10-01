const LIMITS = { face: 3, item: 2 };
const pics = { face: [], item: [] };
let modelCost = 2;

function fileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('圖片讀取失敗，請換一張 JPG 或 PNG。'));
    };
    img.src = url;
  });
}

function paint(type) {
  const box = document.getElementById(`${type}Preview`);
  if (!box) return;
  const label = type === 'face' ? '模特兒' : '商品';
  box.innerHTML = pics[type].map((src, i) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
      <img src="${src}" alt="${label} ${i + 1}" style="width:96px;height:96px;object-fit:cover;border-radius:12px;" />
      <span>${label} ${i + 1}</span>
      <button class="btn btn-cream" type="button" data-remove="${i}">移除</button>
    </div>
  `).join('');
  box.classList.toggle('hidden', !pics[type].length);
}

function bindPicker(type) {
  const input = document.getElementById(`${type}Img`);
  const preview = document.getElementById(`${type}Preview`);
  if (!input || !preview) return;
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    const msg = document.getElementById('modelMsg');
    e.target.value = '';
    if (!files.length) return;
    const room = LIMITS[type] - pics[type].length;
    if (msg) msg.textContent = files.length > room ? `這裡最多 ${LIMITS[type]} 張，多的已略過。` : '';
    try {
      for (const file of files.slice(0, Math.max(0, room))) {
        pics[type].push(await fileToJpegDataUrl(file));
      }
    } catch (err) {
      if (msg) msg.textContent = err.message;
    }
    paint(type);
  });
  preview.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    pics[type].splice(Number(btn.dataset.remove), 1);
    paint(type);
  });
}

async function refreshModelPlan() {
  const bar = document.getElementById('dressPlan') || document.getElementById('modelPlan');
  if (!bar) return null;
  try {
    const data = await fetch('/api/model/status').then((r) => r.json());
    modelCost = data.cost || 2;
    const pick = document.getElementById('scenePick');
    if (pick && pick.options.length <= 1) {
      (data.scenes || []).forEach((s) => pick.add(new Option(`${s.name}（${s.hint}）`, s.id)));
    }
    const makeBtn = document.getElementById('modelMakeBtn');
    if (makeBtn) makeBtn.textContent = `產出照片（扣 ${modelCost} 點）`;
    return data;
  } catch {
    return null;
  }
}

async function makePhoto() {
  const msg = document.getElementById('modelMsg');
  const btns = [document.getElementById('modelMakeBtn'), document.getElementById('modelAgainBtn')];
  const scene = document.getElementById('scene')?.value.trim() || '';
  if (!pics.face.length) {
    if (msg) msg.textContent = '請先上傳至少一張模特兒照片。';
    return;
  }
  if (scene.length < 2) {
    if (msg) msg.textContent = '請寫場景或動作。';
    return;
  }
  if (msg) msg.textContent = '正在產出，約 30 到 60 秒，請不要重按或離開。';
  btns.forEach((b) => { if (b) b.disabled = true; });
  try {
    const res = await fetch('/api/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        faces: pics.face,
        items: pics.item,
        scene,
        sceneId: document.getElementById('scenePick')?.value || '',
        ratio: document.getElementById('ratioPick')?.value || '3:4',
      }),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('連線中斷。請稍後再試，不要連續重按。');
    }
    if (!res.ok) throw new Error(body.error || '產出失敗');
    const out = document.getElementById('modelOutImg');
    const dl = document.getElementById('modelDownloadBtn');
    if (out) out.src = body.image;
    if (dl) dl.href = body.mediaId ? `/api/clip/media/${body.mediaId}` : body.image;
    document.getElementById('modelResultBox')?.classList.remove('hidden');
    document.getElementById('modelResultBox')?.scrollIntoView({ behavior: 'smooth' });
    if (body.image) {
      try {
        await fetch('/api/dress/stash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: body.image }),
        });
      } catch { /* 略過 */ }
    }
    if (msg) msg.textContent = '';
    if (typeof window.refreshFitPlan === 'function') window.refreshFitPlan();
    else refreshModelPlan();
  } catch (err) {
    if (msg) msg.textContent = err.message || '產出失敗';
  } finally {
    btns.forEach((b) => { if (b) b.disabled = false; });
  }
}

function initModelPage() {
  if (!document.getElementById('modelForm')) return;
  bindPicker('face');
  bindPicker('item');
  document.getElementById('modelMakeBtn')?.addEventListener('click', makePhoto);
  document.getElementById('modelAgainBtn')?.addEventListener('click', makePhoto);
  document.getElementById('modelForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    makePhoto();
  });
  document.getElementById('modelToDressBtn')?.addEventListener('click', () => {
    if (typeof window.setFitMode === 'function') window.setFitMode('dress');
  });
  document.getElementById('modelToClipBtn')?.addEventListener('click', async () => {
    const src = document.getElementById('modelOutImg')?.src || '';
    if (!src.startsWith('data:image/') && !src.includes('/api/clip/media/')) {
      const msg = document.getElementById('modelMsg');
      if (msg) msg.textContent = '請先產出一張照片。';
      return;
    }
    try {
      let image = src;
      if (!image.startsWith('data:image/')) {
        const blob = await fetch(src).then((r) => r.blob());
        image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('讀取失敗'));
          reader.readAsDataURL(blob);
        });
      }
      await fetch('/api/dress/stash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      sessionStorage.setItem('mooseDressToClip', '1');
      location.href = '/clip';
    } catch (err) {
      const msg = document.getElementById('modelMsg');
      if (msg) msg.textContent = err.message || '無法接到商品短片';
    }
  });
  refreshModelPlan();
}

initModelPage();
