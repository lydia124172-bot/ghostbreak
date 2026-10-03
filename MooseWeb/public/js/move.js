const state = { image: '', ready: false, cost5: 3, cost10: 6, cost15: 9 };

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
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`/api/clip/video/job/${encodeURIComponent(jobId)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '生片失敗');
    if (body.status === 'done' && body.videoUrl) return body;
    const phase = body.status === 'running' ? '正在生成短片' : '排隊中';
    const sec = body.duration || duration || '';
    note.textContent = `${phase}（${sec}秒）。請不要重按。`;
  }
  throw new Error('生片逾時，請稍後再試。');
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
    const res = await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.image,
        duration,
        ratio: document.getElementById('ratio').value,
        motion: document.getElementById('motion').value.trim(),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '生片失敗');
    const done = body.videoUrl ? body : await waitJob(body.jobId, duration);
    paintVideo(done);
    refreshPlan();
  } catch (err) {
    note.textContent = err.message || '生片失敗';
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('photo').addEventListener('change', async (event) => {
  const note = document.getElementById('moveMsg');
  try {
    state.image = await readFile(event.target.files && event.target.files[0]);
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
document.getElementById('duration').addEventListener('change', paintCosts);
document.getElementById('makeBtn').addEventListener('click', makeMove);
document.getElementById('saveBtn').addEventListener('click', saveFile);
refreshPlan();
