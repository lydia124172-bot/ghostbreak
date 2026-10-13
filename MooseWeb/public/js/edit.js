const state = { image: '', reference: '', imageId: '', credits: 0, owner: false, loggedIn: false };

function shrinkImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const edge = Math.max(img.width, img.height) || 1;
      const scale = Math.min(1, 1280 / edge);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function nearestRatio(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = img.width / Math.max(1, img.height);
      const options = ['1:1', '3:4', '4:5', '9:16', '16:9'];
      let best = '3:4';
      let gap = Infinity;
      options.forEach((name) => {
        const [w, h] = name.split(':').map(Number);
        const diff = Math.abs(ratio - w / h);
        if (diff < gap) {
          gap = diff;
          best = name;
        }
      });
      resolve(best);
    };
    img.onerror = () => resolve('3:4');
    img.src = dataUrl;
  });
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('請先選圖。'));
    if (file.size > 6 * 1024 * 1024) return reject(new Error('單張圖請小於 6MB。'));
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return reject(new Error('請用 JPG、PNG 或 WEBP。'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('讀取圖片失敗。'));
    reader.readAsDataURL(file);
  });
}

function showPrev(id, dataUrl) {
  const img = document.getElementById(id);
  img.src = dataUrl || '';
  img.classList.toggle('hidden', !dataUrl);
}

async function refreshPlan() {
  const bar = document.getElementById('editPlan');
  try {
    const data = await fetch('/api/edit/status').then((r) => r.json());
    state.owner = Boolean(data.owner);
    state.loggedIn = Boolean(data.loggedIn);
    state.credits = Number(data.credits || 0);
    if (!data.ready) {
      bar.textContent = '改圖暫時無法使用，請稍後再試。';
      return;
    }
    if (state.owner) {
      bar.textContent = '作者登入中，改圖不扣點。';
      return;
    }
    if (!state.loggedIn) {
      bar.innerHTML = '需先到方案頁登入。改一張圖扣 1 點。　<a href="/account">看方案</a>';
      return;
    }
    bar.innerHTML = `帳號剩餘 ${state.credits} 點。改一張圖扣 1 點。　<a href="/account">加點</a>`;
  } catch {
    bar.textContent = '改圖暫時無法使用，請稍後再試。';
  }
}

function paintResult(mediaId, extra) {
  state.imageId = String(mediaId || '');
  const out = document.getElementById('outImage');
  const save = document.getElementById('saveBtn');
  out.src = state.imageId ? `/api/clip/media/${state.imageId}` : '';
  save.href = state.imageId ? `/api/clip/media/${state.imageId}?download=1` : '#';
  document.getElementById('outLine').textContent = extra || '僅供改圖參考，小細節仍可能略變。';
  document.getElementById('resultBox').classList.remove('hidden');
}

async function saveFile(event) {
  if (event) event.preventDefault();
  const save = document.getElementById('saveBtn');
  const note = document.getElementById('editMsg');
  if (!state.imageId) {
    if (note) note.textContent = '還沒有圖片可下載。';
    return;
  }
  const prev = save.textContent;
  save.textContent = '下載中…';
  try {
    const res = await fetch(`/api/clip/media/${state.imageId}?download=1`);
    if (!res.ok) throw new Error('下載失敗，請再試一次。');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = '改圖.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    if (note) note.textContent = '已開始下載，請到「下載」資料夾查看。';
  } catch (err) {
    if (note) note.textContent = err.message || '下載失敗，請再試一次。';
  } finally {
    save.textContent = prev;
  }
}

async function makeEdit() {
  const msg = document.getElementById('editMsg');
  const btn = document.getElementById('makeBtn');
  const note = document.getElementById('note').value.trim();
  if (!state.image) {
    msg.textContent = '請先上傳原圖。';
    return;
  }
  if (note.length < 2) {
    msg.textContent = '請寫要改的是哪裡。';
    return;
  }
  const picked = document.getElementById('ratio').value;
  const aspectRatio = picked || await nearestRatio(state.image);
  msg.textContent = '正在只改你寫的那一塊，約半分鐘，請不要重按。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.image,
        reference: state.reference,
        note,
        aspectRatio,
        imageSize: document.getElementById('size').value,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '改圖失敗');
    const sizeNote = body.imageSize && body.imageSize !== document.getElementById('size').value
      ? `已改出 ${body.imageSize}。`
      : '';
    paintResult(body.mediaId, `${sizeNote}僅供改圖參考，小細節仍可能略變。`.trim());
    msg.textContent = '';
    refreshPlan();
  } catch (err) {
    msg.textContent = err.message || '改圖失敗';
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('photo').addEventListener('change', async (event) => {
  const msg = document.getElementById('editMsg');
  try {
    state.image = await shrinkImage(await readFile(event.target.files && event.target.files[0]));
    showPrev('photoPrev', state.image);
    if (msg) msg.textContent = '';
  } catch (err) {
    state.image = '';
    showPrev('photoPrev', '');
    event.target.value = '';
    if (msg) msg.textContent = err.message || '讀取圖片失敗。';
  }
});
document.getElementById('reference').addEventListener('change', async (event) => {
  const msg = document.getElementById('editMsg');
  try {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      state.reference = '';
      showPrev('refPrev', '');
      return;
    }
    state.reference = await shrinkImage(await readFile(file));
    showPrev('refPrev', state.reference);
    if (msg) msg.textContent = '';
  } catch (err) {
    state.reference = '';
    showPrev('refPrev', '');
    event.target.value = '';
    if (msg) msg.textContent = err.message || '讀取圖片失敗。';
  }
});
const noteBox = document.getElementById('note');
const savedNote = localStorage.getItem('moose-edit-note');
if (savedNote !== null) noteBox.value = savedNote;
noteBox.addEventListener('input', () => {
  localStorage.setItem('moose-edit-note', noteBox.value);
});
document.getElementById('makeBtn').addEventListener('click', makeEdit);
document.getElementById('saveBtn').addEventListener('click', saveFile);
refreshPlan();
