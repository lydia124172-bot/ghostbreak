const state = { image: '', product: '', ready: false, cost5: 3, cost10: 6, cost15: 9 };

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

function readFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('請先選圖。'));
    if (file.size > 6 * 1024 * 1024) return reject(new Error('圖片請小於 6MB。'));
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return reject(new Error('請用 JPG、PNG 或 WEBP。'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('讀取圖片失敗。'));
    reader.readAsDataURL(file);
  });
}

function pointsFor(duration) {
  if (duration === '15') return state.cost15;
  if (duration === '10') return state.cost10;
  return state.cost5;
}

function paintCosts() {
  const line = document.getElementById('costLine');
  const btn = document.getElementById('makeBtn');
  const duration = document.getElementById('duration').value;
  line.textContent = `5 秒 ${state.cost5} 點、10 秒 ${state.cost10} 點、15 秒 ${state.cost15} 點。這次扣 ${pointsFor(duration)} 點，成功才扣。15 秒等待較久。`;
  btn.textContent = `讓圖動起來（${duration} 秒）`;
}

async function refreshPlan() {
  const bar = document.getElementById('movePlan');
  try {
    const data = await fetch('/api/move/status').then((r) => r.json());
    state.ready = Boolean(data.ready);
    state.cost5 = Number(data.cost5 || 3) || 3;
    state.cost10 = Number(data.cost10 || 6) || 6;
    state.cost15 = Number(data.cost15 || 9) || 9;
    paintCosts();
    if (!data.ready) {
      bar.textContent = '讓圖動起來暫時無法使用，請稍後再試。';
      return;
    }
    if (data.owner) {
      bar.textContent = '作者登入中，不扣站內點數。生片仍會計 fal 費用。';
      return;
    }
    if (!data.loggedIn) {
      bar.innerHTML = '需先到方案頁登入。　<a href="/account">看方案</a>';
      return;
    }
    bar.innerHTML = `帳號剩餘 ${Number(data.credits || 0)} 點。　<a href="/account">加點</a>`;
  } catch {
    bar.textContent = '讓圖動起來暫時無法使用，請稍後再試。';
  }
}

async function waitJob(jobId, duration) {
  const note = document.getElementById('moveMsg');
  sessionStorage.setItem('moose-move-job', JSON.stringify({ jobId, duration }));
  for (let i = 0; i < 280; i += 1) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`/api/clip/video/job/${encodeURIComponent(jobId)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '生片失敗');
    if (body.status === 'done' && body.videoUrl) {
      sessionStorage.removeItem('moose-move-job');
      return body;
    }
    const phase = body.status === 'running' || body.status === 'saving' ? '正在生成短片' : '排隊中';
    const sec = body.duration || duration || '';
    note.textContent = `${phase}（${sec}秒）。15 秒大約要 6 到 12 分鐘。請不要重按。`;
  }
  throw new Error('頁面先停止等待，片子可能還在做。請不要重按，重新整理這頁會繼續等。');
}

function paintVideo(done) {
  const video = document.getElementById('outVideo');
  const save = document.getElementById('saveBtn');
  video.src = done.videoUrl;
  save.href = `${String(done.videoUrl || '').split('?')[0]}?download=1`;
  document.getElementById('resultBox').classList.remove('hidden');
  document.getElementById('moveMsg').textContent = `短片已完成（${done.duration || ''}秒）。`;
}

async function saveFile(event) {
  if (event) event.preventDefault();
  const save = document.getElementById('saveBtn');
  const note = document.getElementById('moveMsg');
  const href = save.getAttribute('href');
  if (!href || href === '#') {
    note.textContent = '還沒有短片可下載。';
    return;
  }
  const prev = save.textContent;
  save.textContent = '下載中…';
  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error('下載失敗，請再試一次。');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = '動起來.mp4';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    note.textContent = '已開始下載，請到「下載」資料夾查看。';
  } catch (err) {
    note.textContent = err.message || '無法下載，請再試一次。';
  } finally {
    save.textContent = prev || '儲存短片到裝置';
  }
}

async function makeMove() {
  const note = document.getElementById('moveMsg');
  const btn = document.getElementById('makeBtn');
  if (!state.image) {
    note.textContent = '請先上傳要動的圖。';
    return;
  }
  if (!state.ready) {
    note.textContent = '讓圖動起來暫時無法使用。';
    return;
  }
  const duration = document.getElementById('duration').value;
  note.textContent = `正在送出 ${duration} 秒短片，扣 ${pointsFor(duration)} 點，請不要重按。`;
  btn.disabled = true;
  document.getElementById('resultBox').classList.add('hidden');
  try {
    state.image = await shrinkImage(state.image);
    if (state.product) state.product = await shrinkImage(state.product);
    const res = await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.image,
        duration,
        ratio: document.getElementById('ratio').value,
        product: state.product,
        motion: document.getElementById('motion').value.trim(),
        garmentNote: document.getElementById('garmentNote').value.trim(),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '生片失敗');
    const done = body.videoUrl ? body : await waitJob(body.jobId, duration);
    paintVideo(done);
    refreshPlan();
  } catch (err) {
    const raw = String(err && err.message || '');
    note.textContent = raw === 'Failed to fetch'
      ? '連線中斷，請再按一次。這次還沒送出，不會扣點。'
      : (raw || '生片失敗');
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('photo').addEventListener('change', async (event) => {
  const note = document.getElementById('moveMsg');
  try {
    state.image = await shrinkImage(await readFile(event.target.files && event.target.files[0]));
    const img = document.getElementById('photoPrev');
    img.src = state.image;
    img.classList.remove('hidden');
    note.textContent = '';
  } catch (err) {
    state.image = '';
    document.getElementById('photoPrev').classList.add('hidden');
    event.target.value = '';
    note.textContent = err.message || '讀取圖片失敗。';
  }
});
document.getElementById('product').addEventListener('change', async (event) => {
  const note = document.getElementById('moveMsg');
  try {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      state.product = '';
      document.getElementById('productPrev').classList.add('hidden');
      return;
    }
    const raw = await readFile(file);
    state.product = await shrinkImage(raw);
    const img = document.getElementById('productPrev');
    img.src = state.product;
    img.classList.remove('hidden');
    note.textContent = '已附商品圖。生片前會先對這張的衣服結構。';
  } catch (err) {
    state.product = '';
    document.getElementById('productPrev').classList.add('hidden');
    event.target.value = '';
    note.textContent = err.message || '讀取商品圖失敗。';
  }
});
const garmentNote = document.getElementById('garmentNote');
const savedGarmentNote = localStorage.getItem('moose-move-garment-note');
if (savedGarmentNote !== null) garmentNote.value = savedGarmentNote;
garmentNote.addEventListener('input', () => {
  localStorage.setItem('moose-move-garment-note', garmentNote.value);
});
document.getElementById('duration').addEventListener('change', paintCosts);
document.getElementById('makeBtn').addEventListener('click', makeMove);
document.getElementById('saveBtn').addEventListener('click', saveFile);
refreshPlan();
(async () => {
  const raw = sessionStorage.getItem('moose-move-job');
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch { return; }
  if (!saved || !saved.jobId) return;
  const btn = document.getElementById('makeBtn');
  btn.disabled = true;
  try {
    const done = await waitJob(saved.jobId, saved.duration);
    paintVideo(done);
    refreshPlan();
  } catch (err) {
    document.getElementById('moveMsg').textContent = err.message || '生片失敗';
  } finally {
    btn.disabled = false;
  }
})();
