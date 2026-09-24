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
  while (Date.now() - started < 12 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await fetch(`/api/drama/video/job/${encodeURIComponent(jobId)}`, { headers: tokenHeaders() });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 402) throw new Error(body.error || '請先申請 AI短劇方案。');
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
    if (!st.video) {
      bar.textContent = 'AI短劇尚未開通。示範劇本仍可看。';
      return;
    }
    if (st.owner) {
      bar.textContent = '作者已登入後台。可請 AI 寫三鏡。自己出片不扣方案次數，仍扣三鏡成本。';
      return;
    }
    const me = await fetch('/api/account/me').then((r) => r.json());
    if (me.ok && me.email && me.dramaPlan) {
      const left = me.dramaCredits != null ? `剩餘 ${me.dramaCredits} 次` : '';
      bar.innerHTML = `目前：${escapeHtml(me.dramaPlanName || 'AI短劇')}　${left}　一次一支。　<a href="/account">管理方案</a>`;
      return;
    }
    bar.innerHTML = '未購也可看示範劇本，也可請 AI 寫三鏡。要出自己的片子，請先選下方方案。　<a href="#dramaPlans">看方案</a>';
  } catch {
    bar.textContent = '未購也可看示範劇本。寫稿可用 AI；出片需 AI短劇方案。';
  }
}

function renderPlans(plans) {
  const box = document.getElementById('planGrid');
  if (!box) return;
  const rows = (plans || []).filter((plan) => plan.product === 'dramaclip');
  box.innerHTML = rows.map((plan) => `
    <article class="plan-card">
      <p class="meta">${escapeHtml(plan.period)}</p>
      <h3>${escapeHtml(plan.name)}</h3>
      <p class="plan-scope">${escapeHtml(plan.scope || '')}</p>
      <p class="plan-price">${escapeHtml(plan.priceLabel)}</p>
      <p class="plan-quota">${escapeHtml(plan.quota || '')}</p>
      <ul>${(plan.features || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      <a class="btn btn-copper" href="/account">${plan.id === 'drama-once' ? '先買單支' : '選擇月用'}</a>
    </article>
  `).join('');
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

async function produceDrama(script) {
  const line = String(script || document.getElementById('script').value || '').trim();
  const { images } = await collectInput();
  if (line.length < 20) throw new Error('請先有三鏡劇本，或按「AI 寫三鏡」。');
  const ok = window.confirm('這會做三鏡、約 15 秒，並扣一次。示範只看文字，不必為了看效果再做。確定要新做嗎？');
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
    showMsg(`短劇${phase}，已過 ${tick} 秒。三鏡常要 3 到 6 分鐘，請不要重按。`);
  }, 1000);
  try {
    const res = await fetch('/api/drama/video', {
      method: 'POST',
      headers: tokenHeaders(true),
      body: JSON.stringify({ script: line, images }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 402) throw new Error(body.error || '請先申請 AI短劇方案。');
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

fetch('/api/config').then((r) => r.json()).then((data) => {
  renderPlans((data.tree && data.tree.plans) || []);
}).catch(() => {});

refreshPlan();
