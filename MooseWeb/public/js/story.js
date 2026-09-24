const DEMO_SCRIPT = [
  '晨光從窗邊進來，木桌上放著一袋剛烘好的手沖咖啡豆。',
  '手撥開袋口，深焙香氣散開。熱水緩緩注入濾杯，液面慢慢漲起。',
  '最後端起杯子靠近窗邊，蒸汽在光裡轉了一下。',
  '不要字幕、不要浮水印。旁白：今天下單，今晚烘好寄出。',
].join('\n');

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
  const el = document.getElementById('storyMsg');
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
    img.onerror = () => reject(new Error('商品圖讀取失敗'));
    img.src = url;
  });
}

async function waitJob(jobId, onPhase) {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await fetch(`/api/story/video/job/${encodeURIComponent(jobId)}`, { headers: tokenHeaders() });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 402) throw new Error(body.error || '請先申請劇本廣告方案。');
    if (res.status === 404) throw new Error(body.error || '找不到這次生片。');
    if (!res.ok) throw new Error(body.error || '生片失敗');
    if (body.videoUrl) return body;
    if (onPhase) onPhase(body.status === 'running' ? '製作中' : '排隊中');
  }
  throw new Error('生片逾時。若已做好，請按取回，不要連續重按。');
}

function showPreview(videoUrl) {
  const video = document.getElementById('preview');
  video.src = videoUrl;
  document.getElementById('previewBox').classList.remove('hidden');
  document.getElementById('downloadBtn').href = `${videoUrl}?download=1`;
}

async function refreshPlan() {
  const bar = document.getElementById('storyPlan');
  if (!bar) return;
  try {
    const st = await fetch('/api/story/status', { headers: tokenHeaders() }).then((r) => r.json());
    if (!st.video) {
      bar.textContent = '劇本廣告尚未開通。示範仍可看。';
      return;
    }
    if (st.owner) {
      bar.textContent = '作者已登入後台。可請 AI 寫劇本。自己出片不扣方案次數，仍扣生片成本。';
      return;
    }
    const me = await fetch('/api/account/me').then((r) => r.json());
    if (me.ok && me.email && me.storyPlan) {
      const left = me.storyCredits != null ? `剩餘 ${me.storyCredits} 次` : '';
      bar.innerHTML = `目前：${escapeHtml(me.storyPlanName || '劇本廣告')}　${left}　一次一支。　<a href="/account">管理方案</a>`;
      return;
    }
    bar.innerHTML = '未購也可看示範，也可請 AI 寫劇本。要出自己的片子，請先選下方方案。　<a href="#storyPlans">看方案</a>';
  } catch {
    bar.textContent = '未購也可看示範。寫稿可用 AI；出片需劇本廣告方案。';
  }
}

function renderPlans(plans) {
  const box = document.getElementById('planGrid');
  if (!box) return;
  const rows = (plans || []).filter((plan) => plan.product === 'storyclip');
  box.innerHTML = rows.map((plan) => `
    <article class="plan-card">
      <p class="meta">${escapeHtml(plan.period)}</p>
      <h3>${escapeHtml(plan.name)}</h3>
      <p class="plan-scope">${escapeHtml(plan.scope || '')}</p>
      <p class="plan-price">${escapeHtml(plan.priceLabel)}</p>
      <p class="plan-quota">${escapeHtml(plan.quota || '')}</p>
      <ul>${(plan.features || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      <a class="btn btn-copper" href="/account">${plan.id === 'story-once' ? '先買單支' : '選擇月用'}</a>
    </article>
  `).join('');
}

document.getElementById('demoScript').textContent = DEMO_SCRIPT;

const demo = document.getElementById('demoVideo');
demo.addEventListener('error', () => {
  showMsg('示範片讀取中。可先讀劇本，稍後再重新整理。');
});

async function collectStoryInput() {
  const product = document.getElementById('product').value.trim();
  const notes = document.getElementById('notes').value.trim();
  const photo = document.getElementById('photo').files[0];
  const images = photo ? [await fileToJpegDataUrl(photo)] : [];
  return { product, notes, photo, images };
}

async function writeStoryScript() {
  const { product, notes, images } = await collectStoryInput();
  if (!product && !images.length) throw new Error('請先填商品名稱，或上傳商品圖。');
  const res = await fetch('/api/story/script', {
    method: 'POST',
    headers: tokenHeaders(true),
    body: JSON.stringify({ product, notes, images }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || '寫稿失敗');
  const script = String(body.script || '').trim();
  if (script.length < 12) throw new Error('沒有產出劇本');
  document.getElementById('script').value = script;
  return script;
}

async function produceStory(script) {
  const line = String(script || document.getElementById('script').value || '').trim();
  const { product, photo, images } = await collectStoryInput();
  if (line.length < 12) throw new Error('請先有一段劇本，或按「AI 寫劇本」。');
  const ok = window.confirm('這會新做一支並扣一次。示範片可直接看，不必為了看效果再做。確定要新做嗎？');
  if (!ok) {
    showMsg('已取消。沒有新扣費。劇本仍留在欄位裡，可再改。');
    return;
  }
  const btn = document.getElementById('makeBtn');
  const writeMake = document.getElementById('writeMakeBtn');
  const writeBtn = document.getElementById('writeBtn');
  [btn, writeMake, writeBtn].forEach((el) => { if (el) el.disabled = true; });
  let tick = 0;
  let phase = '已送出';
  const clock = setInterval(() => {
    tick += 1;
    if (btn) btn.textContent = `${phase} ${tick} 秒`;
    showMsg(`質感片${phase}，已過 ${tick} 秒。通常約 1 到 2 分鐘，請不要重按。`);
  }, 1000);
  try {
    const payload = { script: line, product };
    if (photo) payload.images = images;
    const res = await fetch('/api/story/video', {
      method: 'POST',
      headers: tokenHeaders(true),
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 402) throw new Error(body.error || '請先申請劇本廣告方案。');
    if (!res.ok) throw new Error(body.error || '生片失敗');
    const done = body.videoUrl ? body : await waitJob(body.jobId, (next) => { phase = next; });
    showPreview(done.videoUrl);
    showMsg(done.recovered ? '已把做好的片子抓回來。請下載後發文。' : '質感片已產出，請下載後發文。不要再按。');
    refreshPlan();
  } finally {
    clearInterval(clock);
    [btn, writeMake, writeBtn].forEach((el) => { if (el) el.disabled = false; });
    if (btn) btn.textContent = '用現有劇本產出';
  }
}

document.getElementById('storyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await produceStory();
  } catch (err) {
    showMsg(err.message || '生片失敗');
  }
});

document.getElementById('writeBtn').addEventListener('click', async () => {
  const btn = document.getElementById('writeBtn');
  btn.disabled = true;
  btn.textContent = '寫稿中…';
  try {
    await writeStoryScript();
    showMsg('劇本已寫入。可改字，再按「用現有劇本產出」。');
  } catch (err) {
    showMsg(err.message || '寫稿失敗');
  } finally {
    btn.disabled = false;
    btn.textContent = 'AI 寫劇本';
  }
});

document.getElementById('writeMakeBtn').addEventListener('click', async () => {
  const btn = document.getElementById('writeMakeBtn');
  btn.disabled = true;
  btn.textContent = '寫稿中…';
  try {
    showMsg('正在寫劇本…');
    const script = await writeStoryScript();
    showMsg('劇本已寫入。接著確認是否出片。');
    await produceStory(script);
  } catch (err) {
    showMsg(err.message || '寫稿或生片失敗');
  } finally {
    btn.disabled = false;
    btn.textContent = 'AI 寫好並產出';
  }
});

document.getElementById('recoverBtn').addEventListener('click', async () => {
  const btn = document.getElementById('recoverBtn');
  btn.disabled = true;
  try {
    showMsg('正在取回剛才的片子，不會再新做一支。');
    const res = await fetch('/api/story/video/last', { headers: tokenHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '沒有可取回的短片');
    showPreview(body.videoUrl);
    showMsg('已取回剛才的片子，請下載後發文。不要再按產出。');
  } catch (err) {
    showMsg(err.message || '取回失敗');
  } finally {
    btn.disabled = false;
  }
});

fetch('/api/config').then((r) => r.json()).then((data) => {
  renderPlans((data.tree && data.tree.plans) || []);
}).catch(() => {});

refreshPlan();
