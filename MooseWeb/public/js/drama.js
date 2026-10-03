function tokenHeaders(json) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = sessionStorage.getItem('moose_admin_token');
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showMsg(text) {
  const el = document.getElementById('dramaMsg');
  if (el) el.textContent = text;
}

function fileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const short = Math.min(img.width, img.height);
      const scale = short < 720 ? 720 / short : 1;
      const w = Math.min(1280, Math.round(img.width * scale));
      const h = Math.min(1280, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(240, w);
      canvas.height = Math.max(240, h);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => reject(new Error('參考圖讀取失敗'));
    img.src = url;
  });
}

async function waitJob(jobId, onPhase) {
  const started = Date.now();
    while (Date.now() - started < 18 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await fetch(`/api/drama/video/job/${encodeURIComponent(jobId)}`, { headers: tokenHeaders() });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 404) throw new Error(body.error || '請先登入後台。');
    if (res.status === 404) throw new Error(body.error || '找不到這次短劇。');
    if (!res.ok) throw new Error(body.error || '短劇失敗');
    if (body.videoUrl) return body;
    if (onPhase) onPhase(body.phase || (body.status === 'running' ? '製作中' : '排隊中'));
  }
  throw new Error('短劇逾時。若已做好，請按取回，不要連續重按。');
}

function showPreview(videoUrl) {
  const video = document.getElementById('preview');
  video.src = videoUrl;
  document.getElementById('previewBox').classList.remove('hidden');
  document.getElementById('downloadBtn').href = `${videoUrl}?download=1`;
}

async function refreshPlan() {
  const bar = document.getElementById('dramaPlan');
  if (!bar) return;
  try {
    const st = await fetch('/api/drama/status', { headers: tokenHeaders() }).then((r) => r.json());
    if (st.demoScript) document.getElementById('demoScript').textContent = st.demoScript;
    if (!st.owner) {
      bar.textContent = '這頁只在後台。請先登入後台。';
      return;
    }
    if (!st.video) {
      bar.textContent = '短劇出片尚未開通。';
      return;
    }
    bar.textContent = '後台接案用。三鏡約 15 秒，有配音。靜圖 Gemini 3 Pro 2K。一支約 NT$73，主角定妝另計，不扣站上點數。嘴型不保證。';
  } catch {
    bar.textContent = '請先登入後台再做短劇。';
  }
}

function photoInputs() {
  return [1, 2, 3].map((n) => document.getElementById(`photo${n}`));
}

function refreshPhotoSlots() {
  let picked = 0;
  photoInputs().forEach((input, i) => {
    const n = i + 1;
    const file = input && input.files && input.files[0];
    const img = document.getElementById(`photoPreview${n}`);
    const name = document.getElementById(`photoName${n}`);
    if (file) {
      picked += 1;
      if (img) {
        if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
        const url = URL.createObjectURL(file);
        img.dataset.url = url;
        img.src = url;
        img.hidden = false;
      }
      if (name) name.textContent = `已選：${file.name}`;
    } else {
      if (img) {
        if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
        img.removeAttribute('src');
        img.hidden = true;
      }
      if (name) name.textContent = '未選';
    }
  });
  const bar = document.getElementById('photoCount');
  if (bar) bar.textContent = picked ? `已選 ${picked}／3 張。` : '尚未選圖。三格都空也可以，由 AI 生畫面。';
}

async function collectInput() {
  const topic = document.getElementById('topic').value.trim();
  const notes = document.getElementById('notes').value.trim();
  const images = [];
  for (const input of photoInputs()) {
    const file = input && input.files && input.files[0];
    images.push(file ? await fileToJpegDataUrl(file) : '');
  }
  return { topic, notes, images };
}

async function writeDramaScript() {
  const { topic, notes, images } = await collectInput();
  if (topic.length < 2) throw new Error('請先填短劇主題。');
  const res = await fetch('/api/drama/script', {
    method: 'POST',
    headers: tokenHeaders(true),
    body: JSON.stringify({ topic, notes, images }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || '寫稿失敗');
  const script = String(body.script || '').trim();
  if (script.length < 20) throw new Error('沒有產出三鏡劇本');
  document.getElementById('script').value = script;
  return script;
}

let castImages = [];
const castSlots = { male: '', female: '' };
const castGallery = [];
let castSeq = 0;

function castPayload() {
  const payload = [];
  const male = castGallery.find((item) => item.role === 'male' && item.picked);
  const female = castGallery.find((item) => item.role === 'female' && item.picked);
  if (male) payload.push({ role: 'male', image: male.src });
  if (female) payload.push({ role: 'female', image: female.src });
  castGallery.filter((item) => item.role === 'other' && item.picked).slice(-2).forEach((item) => {
    payload.push({ role: 'other', image: item.src });
  });
  castImages = payload;
  if (male) castSlots.male = male.src;
  if (female) castSlots.female = female.src;
  return payload;
}

function pickCast(id) {
  const item = castGallery.find((entry) => entry.id === id);
  if (!item) return;
  if (item.role === 'other') {
    item.picked = true;
    const picked = castGallery.filter((entry) => entry.role === 'other' && entry.picked);
    while (picked.length > 2) picked.shift().picked = false;
    return;
  }
  castGallery.forEach((entry) => {
    if (entry.role === item.role) entry.picked = entry.id === id;
  });
  castSlots[item.role] = item.src;
}

function addCast(role, src) {
  if (!src) return;
  castSeq += 1;
  castGallery.push({ id: castSeq, role, src, picked: false });
  pickCast(castSeq);
}

function renderCast() {
  const box = document.getElementById('castPreviewBox');
  box.innerHTML = '';
  const count = { male: 0, female: 0, other: 0 };
  castGallery.forEach((item) => {
    count[item.role] = (count[item.role] || 0) + 1;
    const name = item.role === 'female' ? '女主' : item.role === 'other' ? '其他人' : '男主';
    const label = `${name} ${count[item.role]}${item.picked ? ' · 用這張' : ''}`;
    const wrap = document.createElement('figure');
    wrap.style.cssText = `margin:0;cursor:pointer;border-radius:8px;${item.picked ? 'outline:2px solid #1c1915;outline-offset:3px;' : ''}`;
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = label;
    img.style.cssText = 'max-width:240px;border-radius:8px;display:block;';
    const cap = document.createElement('figcaption');
    cap.className = 'lead';
    cap.textContent = label;
    wrap.appendChild(img);
    wrap.appendChild(cap);
    wrap.addEventListener('click', () => {
      if (item.role === 'other' && item.picked) item.picked = false;
      else pickCast(item.id);
      renderCast();
      showMsg('已選定這次影片要用的人。男主、女主各一張，其他人最多兩張。');
    });
    box.appendChild(wrap);
  });
}

async function uploadCast(role, input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const src = await fileToJpegDataUrl(file);
  addCast(role, src);
  renderCast();
  const name = role === 'female' ? '女主' : role === 'other' ? '其他人' : '男主';
  showMsg(`${name}的照片已留下，並設成這次要用的人。點別張可以改。`);
}

async function makeCast() {
  const { topic, notes } = await collectInput();
  const script = document.getElementById('script').value.trim();
  const prompt = document.getElementById('castPrompt').value.trim();
  const whoBtn = document.querySelector('#castWho .clip-type.active');
  const who = whoBtn && whoBtn.dataset.who ? whoBtn.dataset.who : 'male';
  const appealBtn = document.querySelector('#castAppeal .clip-type.active');
  const appeal = appealBtn && appealBtn.dataset.appeal ? appealBtn.dataset.appeal : 'pretty';
  if (!prompt && topic.length < 2 && script.length < 2) throw new Error('請先寫主角提示詞，或先填主題。');
  const btn = document.getElementById('castBtn');
  btn.disabled = true;
  btn.textContent = '優化並生成中…';
  try {
    const res = await fetch('/api/drama/cast', {
      method: 'POST',
      headers: tokenHeaders(true),
      body: JSON.stringify({ topic, notes, script, prompt, who, appeal }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '主角沒有生出來');
    const fresh = (Array.isArray(body.images) ? body.images : []).filter(Boolean).slice(0, 2);
    const roles = Array.isArray(body.roles) ? body.roles : [];
    if (who === 'both') {
      fresh.forEach((src, index) => addCast(roles[index] === 'female' ? 'female' : 'male', src));
    } else if (who === 'female') {
      addCast('female', fresh[0]);
    } else if (who === 'other') {
      addCast('other', fresh[0]);
    } else {
      addCast('male', fresh[0]);
    }
    if (body.prompt) document.getElementById('castPrompt').value = String(body.prompt);
    castPayload();
    renderCast();
    const face = appeal === 'rough' ? '這次照難看。' : '這次先好看。';
    showMsg(who === 'other'
      ? `其他人已留下，舊圖也還在。劇情有寫到他，那一鏡才會放進去。${face}約 NT$5。`
      : who === 'both'
        ? `兩位已照各自的描述分開，提示詞已優化並寫回欄位。舊圖還在。${face}約 NT$10。`
        : `新的一張已留下，之前的圖也還在。三鏡用最新的男主、女主，以及最近兩位其他人。${face}約 NT$5。`);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成主角';
  }
}

async function produceDrama(script) {
  const line = String(script || document.getElementById('script').value || '').trim();
  const { images } = await collectInput();
  if (line.length < 20) throw new Error('請先有三鏡劇本，或按「AI 寫三鏡」。');
  const ok = window.confirm('這會做三鏡、約 15 秒、有配音。三張分鏡約 NT$13，配音約 NT$60，一支約 NT$73，不扣站上點數。某一鏡失敗重做會再計一次。確定要新做嗎？');
  if (!ok) {
    showMsg('已取消。沒有新扣費。劇本仍留在欄位裡，可再改。');
    return;
  }
  const buttons = ['makeBtn', 'writeMakeBtn', 'writeBtn'].map((id) => document.getElementById(id));
  buttons.forEach((el) => { if (el) el.disabled = true; });
  let tick = 0;
  let phase = '已送出';
  const clock = setInterval(() => {
    tick += 1;
    const btn = document.getElementById('makeBtn');
    if (btn) btn.textContent = `${phase} ${tick} 秒`;
    showMsg(`短劇${phase}，已過 ${tick} 秒。三鏡有配音，常要 6 到 12 分鐘，請不要重按。`);
  }, 1000);
  try {
    const res = await fetch('/api/drama/video', {
      method: 'POST',
      headers: tokenHeaders(true),
      body: JSON.stringify({
        script: line,
        images,
        cast: castPayload(),
        castPrompt: document.getElementById('castPrompt').value.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 404) throw new Error(body.error || '請先登入後台。');
    if (!res.ok) throw new Error(body.error || '短劇失敗');
    const done = body.videoUrl ? body : await waitJob(body.jobId, (next) => { phase = next; });
    showPreview(done.videoUrl);
    showMsg(done.recovered ? '已把做好的短劇抓回來。請下載後發文。' : '短劇已產出，請下載後發文。不要再按。');
    refreshPlan();
  } finally {
    clearInterval(clock);
    buttons.forEach((el) => { if (el) el.disabled = false; });
    const btn = document.getElementById('makeBtn');
    if (btn) btn.textContent = '用現有劇本產出';
  }
}

document.getElementById('dramaForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await produceDrama();
  } catch (err) {
    showMsg(err.message || '短劇失敗');
  }
});

document.querySelectorAll('#castWho .clip-type, #castAppeal .clip-type').forEach((btn) => {
  btn.addEventListener('click', () => {
    const box = btn.closest('.clip-types');
    box.querySelectorAll('.clip-type').forEach((el) => el.classList.toggle('active', el === btn));
  });
});

document.getElementById('castBtn').addEventListener('click', async () => {
  try {
    await makeCast();
  } catch (err) {
    showMsg(err.message || '主角沒有生出來');
  }
});

[
  ['castFileMale', 'male'],
  ['castFileFemale', 'female'],
  ['castFileOther', 'other'],
].forEach(([id, role]) => {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener('change', async () => {
    try {
      await uploadCast(role, input);
    } catch (err) {
      showMsg(err.message || '照片沒有讀到');
    }
  });
});

document.getElementById('writeBtn').addEventListener('click', async () => {
  const btn = document.getElementById('writeBtn');
  btn.disabled = true;
  btn.textContent = '寫稿中…';
  try {
    await writeDramaScript();
    showMsg('三鏡已寫入。可改字，再按「用現有劇本產出」。');
  } catch (err) {
    showMsg(err.message || '寫稿失敗');
  } finally {
    btn.disabled = false;
    btn.textContent = 'AI 寫三鏡';
  }
});

document.getElementById('writeMakeBtn').addEventListener('click', async () => {
  const btn = document.getElementById('writeMakeBtn');
  btn.disabled = true;
  btn.textContent = '寫稿中…';
  try {
    showMsg('正在寫三鏡…');
    const script = await writeDramaScript();
    showMsg('三鏡已寫入。接著確認是否出片。');
    await produceDrama(script);
  } catch (err) {
    showMsg(err.message || '寫稿或出片失敗');
  } finally {
    btn.disabled = false;
    btn.textContent = '一鍵寫好並產出';
  }
});

document.getElementById('recoverBtn').addEventListener('click', async () => {
  const btn = document.getElementById('recoverBtn');
  btn.disabled = true;
  try {
    showMsg('正在取回剛才的短劇，不會再新做一支。');
    const res = await fetch('/api/drama/video/last', { headers: tokenHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '沒有可取回的短劇');
    showPreview(body.videoUrl);
    showMsg('已取回剛才的短劇，請下載後發文。不要再按產出。');
  } catch (err) {
    showMsg(err.message || '取回失敗');
  } finally {
    btn.disabled = false;
  }
});

photoInputs().forEach((input) => {
  if (input) input.addEventListener('change', refreshPhotoSlots);
});
refreshPhotoSlots();

refreshPlan();
