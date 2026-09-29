const LIMITS = { face: 3, item: 2 };
const pics = { face: [], item: [] };
let cost = 2;

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
  document.getElementById(`${type}Img`).addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    const msg = document.getElementById('modelMsg');
    e.target.value = '';
    if (!files.length) return;
    const room = LIMITS[type] - pics[type].length;
    msg.textContent = files.length > room ? `這裡最多 ${LIMITS[type]} 張，多的已略過。` : '';
    try {
      for (const file of files.slice(0, Math.max(0, room))) {
        pics[type].push(await fileToJpegDataUrl(file));
      }
    } catch (err) {
      msg.textContent = err.message;
    }
    paint(type);
  });
  document.getElementById(`${type}Preview`).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    pics[type].splice(Number(btn.dataset.remove), 1);
    paint(type);
  });
}

async function refreshPlan() {
  const bar = document.getElementById('modelPlan');
  try {
    const data = await fetch('/api/model/status').then((r) => r.json());
    cost = data.cost || 2;
    const pick = document.getElementById('scenePick');
    if (pick.options.length <= 1) {
      (data.scenes || []).forEach((s) => pick.add(new Option(`${s.name}（${s.hint}）`, s.id)));
    }
    if (!data.ready) {
      bar.textContent = '固定模特兒暫時無法使用，請稍後再試。';
      return;
    }
    if (data.owner) bar.textContent = '管理者模式：不限次數。';
    else if (data.loggedIn) bar.textContent = `每張扣 ${cost} 點，目前剩 ${data.credits} 點。`;
    else bar.textContent = `每張扣 ${cost} 點，需購買方案點數後使用。`;
  } catch {
    bar.textContent = `每張扣 ${cost} 點。`;
  }
}

async function makePhoto() {
  const msg = document.getElementById('modelMsg');
  const btns = [document.getElementById('makeBtn'), document.getElementById('againBtn')];
  const scene = document.getElementById('scene').value.trim();
  if (!pics.face.length) {
    msg.textContent = '請先上傳至少一張模特兒照片。';
    return;
  }
  if (scene.length < 2) {
    msg.textContent = '請寫場景或動作。';
    return;
  }
  msg.textContent = '正在產出，約 30 到 60 秒，請不要重按或離開。';
  btns.forEach((b) => { b.disabled = true; });
  try {
    const res = await fetch('/api/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        faces: pics.face,
        items: pics.item,
        scene,
        sceneId: document.getElementById('scenePick').value,
        ratio: document.getElementById('ratioPick').value,
      }),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('連線中斷。請不要重按，稍等一下到「模特兒換裝」頁取回結果。');
    }
    if (!res.ok) throw new Error(body.error || '產出失敗');
    document.getElementById('outImg').src = body.image;
    document.getElementById('downloadBtn').href = body.mediaId ? `/api/clip/media/${body.mediaId}` : body.image;
    document.getElementById('resultBox').classList.remove('hidden');
    document.getElementById('resultBox').scrollIntoView({ behavior: 'smooth' });
    msg.textContent = '';
    refreshPlan();
  } catch (err) {
    msg.textContent = err.message || '產出失敗';
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}

bindPicker('face');
bindPicker('item');
document.getElementById('makeBtn').addEventListener('click', makePhoto);
document.getElementById('againBtn').addEventListener('click', makePhoto);
document.getElementById('modelForm').addEventListener('submit', (e) => {
  e.preventDefault();
  makePhoto();
});

const handoff = sessionStorage.getItem('moosePromptToModel');
if (handoff) {
  document.getElementById('scene').value = handoff.slice(0, 600);
  sessionStorage.removeItem('moosePromptToModel');
}
refreshPlan();
