const state = {
  catalog: null,
  workflow: 'free',
  style: 'keep',
  mockup: 'shirt',
  imageData: '',
  imageId: '',
  preview: '',
  painted: false,
  ratioTouched: false,
  busy: false,
  owner: false,
  loggedIn: false,
  credits: 0,
  lines: [],
  pickedLine: -1,
};

const RATIO_LABEL = {
  '1:1': '1:1　方圖',
  '4:5': '4:5　直式貼文',
  '3:4': '3:4　海報',
  '9:16': '9:16　限動',
  '16:9': '16:9　橫幅',
  '4:3': '4:3　簡報',
  '3:2': '3:2　橫式',
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
    if (file.size > 6 * 1024 * 1024) return reject(new Error('單張圖請小於 6MB。'));
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return reject(new Error('請用 JPG、PNG 或 WEBP。'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('讀取圖片失敗。'));
    reader.readAsDataURL(file);
  });
}

function nearestRatio(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = img.width / Math.max(1, img.height);
      const options = Object.keys(RATIO_LABEL);
      let best = '1:1';
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
    img.onerror = () => resolve('1:1');
    img.src = dataUrl;
  });
}

function applyLockedRatio() {
  const select = document.getElementById('ratio');
  if (!select || state.ratioTouched || !state.catalog) return;
  const row = workflowRow();
  if ((state.workflow === 'text' || state.workflow === 'inpaint') && state.sourceRatio) {
    select.value = state.sourceRatio;
    return;
  }
  if (row && row.ratio) select.value = row.ratio;
}

function workflowRow() {
  return (state.catalog.workflows || []).find((row) => row.id === state.workflow) || state.catalog.workflows[0];
}

function paintPlan(data) {
  const bar = document.getElementById('designPlan');
  state.owner = Boolean(data.owner);
  state.loggedIn = Boolean(data.loggedIn);
  state.credits = Number(data.credits || 0);
  if (!data.ready) {
    bar.textContent = '設計對話暫時無法使用，請稍後再試。';
    return;
  }
  if (state.owner) {
    bar.textContent = '作者登入中，設計不扣點。';
    return;
  }
  if (!state.loggedIn) {
    bar.innerHTML = '需先到方案頁登入。設計一張扣 1 點。　<a href="/account">看方案</a>';
    return;
  }
  bar.innerHTML = `帳號剩餘 ${state.credits} 點。設計一張扣 1 點。　<a href="/account">加點</a>`;
}

function chips(boxId, rows, current, onPick) {
  const box = document.getElementById(boxId);
  box.innerHTML = rows.map((row) => {
    const hint = row.hint ? ` title="${escapeHtml(row.hint)}"` : '';
    return `<button class="design-chip${row.id === current ? ' on' : ''}" type="button" data-id="${escapeHtml(row.id)}"${hint}>${escapeHtml(row.name)}</button>`;
  }).join('');
  box.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => onPick(btn.getAttribute('data-id')));
  });
}

function syncMode() {
  const mode = state.workflow;
  document.getElementById('textBox').classList.toggle('hidden', mode !== 'text');
  document.getElementById('mockupBox').classList.toggle('hidden', mode !== 'mockup');
  document.getElementById('styleBox').classList.toggle('hidden', mode === 'text');
  const note = document.getElementById('note');
  if (mode === 'text') note.placeholder = '可補充：字體維持粗體、顏色改成深紅';
  else if (mode === 'inpaint') note.placeholder = '例如：把 logo 放進塗掉的位置，其他不要動';
  else if (mode === 'mockup') note.placeholder = '可補充：模特兒站在白牆前，光線柔一點';
  else note.placeholder = '例如：夏季亞麻襯衫廣告，主標題寫「透氣不黏」，價格 NT$1,280，按鈕寫「立即選購」';
  applyLockedRatio();
  syncInpaint();
  syncStage();
  syncTextPreview();
}

function renderCatalog() {
  const cat = state.catalog;
  chips('workflows', cat.workflows, state.workflow, (id) => {
    state.workflow = id;
    renderCatalog();
  });
  chips('styles', cat.styles, state.style, (id) => {
    state.style = id;
    renderCatalog();
  });
  chips('mockups', cat.mockups, state.mockup, (id) => {
    state.mockup = id;
    renderCatalog();
  });
  const ratio = document.getElementById('ratio');
  const picked = ratio.value;
  ratio.innerHTML = (cat.ratios || []).map((id) => `<option value="${id}">${escapeHtml(RATIO_LABEL[id] || id)}</option>`).join('');
  if ((cat.ratios || []).includes(picked)) ratio.value = picked;
  syncMode();
}

function addBubble(role, html) {
  document.getElementById('emptyNote').classList.add('hidden');
  const row = document.createElement('div');
  row.className = `design-msg ${role}`;
  row.innerHTML = `<div class="design-bubble">${html}</div>`;
  const log = document.getElementById('log');
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  return row;
}

function maskCanvas() {
  return document.getElementById('mask');
}

function clearMask() {
  const canvas = maskCanvas();
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  state.painted = false;
}

function pointerPos(event) {
  const canvas = maskCanvas();
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function setupStage(url) {
  const img = document.getElementById('stageImg');
  const canvas = maskCanvas();
  const probe = new Image();
  probe.onload = () => {
    const edge = Math.max(probe.width, probe.height) || 1;
    const scale = Math.min(1, 960 / edge);
    canvas.width = Math.max(1, Math.round(probe.width * scale));
    canvas.height = Math.max(1, Math.round(probe.height * scale));
    clearMask();
    img.src = url;
  };
  probe.src = url;
}

function syncTextPreview() {
  const wait = document.getElementById('textWait');
  const preview = document.getElementById('textPreview');
  const show = state.workflow === 'text' && Boolean(state.preview);
  if (wait) wait.classList.toggle('hidden', state.workflow !== 'text' || show);
  if (preview) preview.classList.toggle('hidden', !show);
  if (!show) return;
  if (state.textShownFor !== state.preview) {
    state.textShownFor = state.preview;
    layoutTextImage();
  }
  if (state.textReadFor !== state.preview && !state.reading) readLines();
}

function layoutTextImage() {
  const img = document.getElementById('textImg');
  const canvas = document.getElementById('textBoxes');
  const probe = new Image();
  probe.onload = () => {
    const edge = Math.max(probe.width, probe.height) || 1;
    const scale = Math.min(1, 960 / edge);
    canvas.width = Math.max(1, Math.round(probe.width * scale));
    canvas.height = Math.max(1, Math.round(probe.height * scale));
    img.src = state.preview;
    paintLines();
    document.getElementById('textPreview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  probe.src = state.preview;
}

function paintLines() {
  const canvas = document.getElementById('textBoxes');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  state.lines.forEach((line, index) => {
    if (![line.x, line.y, line.w, line.h].every((n) => Number(n) > 0)) return;
    const x = (Number(line.x) / 100) * canvas.width;
    const y = (Number(line.y) / 100) * canvas.height;
    const w = (Number(line.w) / 100) * canvas.width;
    const h = (Number(line.h) / 100) * canvas.height;
    const on = state.pickedLine === index;
    ctx.fillStyle = on ? 'rgba(29, 78, 216, 0.22)' : 'rgba(245, 158, 11, 0.2)';
    ctx.strokeStyle = on ? '#1d4ed8' : '#d97706';
    ctx.lineWidth = on ? 4 : 2;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  });
  const box = document.getElementById('textLines');
  box.innerHTML = state.lines.map((line, index) => (
    `<button class="design-chip${state.pickedLine === index ? ' on' : ''}" type="button" data-i="${index}">${escapeHtml(line.text)}</button>`
  )).join('');
  box.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => pickLine(Number(btn.getAttribute('data-i'))));
  });
}

function pickLine(index) {
  const line = state.lines[index];
  if (!line) return;
  state.pickedLine = index;
  document.getElementById('fromText').value = line.text;
  document.getElementById('toText').focus();
  paintLines();
}

async function readLines() {
  const token = state.preview;
  state.textReadFor = token;
  state.reading = true;
  state.lines = [];
  state.pickedLine = -1;
  const note = document.getElementById('textRead');
  document.getElementById('textLines').innerHTML = '';
  if (note) note.textContent = '正在讀圖上的字。圖已經在上面。';
  try {
    const res = await fetch('/api/design/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.imageData,
        imageId: state.imageData ? '' : state.imageId,
      }),
    });
    const body = await res.json();
    if (state.preview !== token) return;
    if (!res.ok) throw new Error(body.error || '讀字失敗');
    state.lines = Array.isArray(body.lines) ? body.lines : [];
    paintLines();
    if (note) {
      note.textContent = state.lines.length
        ? '點圖上的框，或點下面一句。再寫要換成的字。'
        : '這張沒讀出文字。圖已經在上面，請自己填原本的字。';
    }
  } catch (err) {
    if (state.preview !== token) return;
    if (note) note.textContent = err.message || '讀字失敗。圖已經在上面，請自己填原本的字。';
  } finally {
    state.reading = false;
  }
}

function syncInpaint() {
  const on = state.workflow === 'inpaint';
  document.getElementById('inpaintBox').classList.toggle('hidden', !on);
  document.getElementById('uploadLabel').classList.toggle('hidden', on);
  const hasBase = Boolean(state.preview);
  document.getElementById('inpaintWait').classList.toggle('hidden', !on || hasBase);
  document.getElementById('clearBase').classList.toggle('hidden', !on || !hasBase);
  document.getElementById('clearUpload').classList.toggle('hidden', on || !hasBase);
  syncLogo();
}

function syncLogo() {
  const has = Boolean(state.logoData);
  const img = document.getElementById('logoPrev');
  img.src = has ? state.logoData : '';
  img.classList.toggle('hidden', !has);
  document.getElementById('clearLogo').classList.toggle('hidden', !has);
}

function clearBaseImage(message) {
  state.imageData = '';
  state.imageId = '';
  state.preview = '';
  state.stageFor = '';
  state.painted = false;
  state.textReadFor = '';
  state.textShownFor = '';
  document.getElementById('photo').value = '';
  document.getElementById('fileName').textContent = '';
  const msg = document.getElementById('designMsg');
  if (msg && message) msg.textContent = message;
  syncInpaint();
  syncStage();
  syncTextPreview();
}

function syncStage() {
  const wrap = document.getElementById('stageWrap');
  const show = state.workflow === 'inpaint' && Boolean(state.preview);
  wrap.classList.toggle('hidden', !show);
  if (show && state.stageFor !== state.preview) {
    state.stageFor = state.preview;
    setupStage(state.preview);
  }
}

function markedDataUrl() {
  const canvas = maskCanvas();
  const img = document.getElementById('stageImg');
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(img, 0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out.toDataURL('image/jpeg', 0.82);
}

let drawing = false;
let lastPoint = null;

maskCanvas().addEventListener('pointerdown', (event) => {
  drawing = true;
  maskCanvas().setPointerCapture(event.pointerId);
  lastPoint = pointerPos(event);
});
maskCanvas().addEventListener('pointermove', (event) => {
  if (!drawing || !lastPoint) return;
  const point = pointerPos(event);
  const ctx = maskCanvas().getContext('2d');
  ctx.strokeStyle = 'rgba(255, 0, 180, 0.55)';
  ctx.lineWidth = Number(document.getElementById('brush').value) || 36;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
  lastPoint = point;
  state.painted = true;
});
function stopDraw() {
  drawing = false;
  lastPoint = null;
}
maskCanvas().addEventListener('pointerup', stopDraw);
maskCanvas().addEventListener('pointercancel', stopDraw);
document.getElementById('clearMask').addEventListener('click', clearMask);
document.getElementById('baseUploadBtn').addEventListener('click', () => {
  document.getElementById('photo').click();
});
document.getElementById('clearBase').addEventListener('click', () => {
  clearBaseImage('已刪掉要塗的圖。');
});
document.getElementById('clearUpload').addEventListener('click', () => {
  clearBaseImage('已刪掉上傳的圖。');
});
document.getElementById('clearLogo').addEventListener('click', () => {
  state.logoData = '';
  document.getElementById('logoFile').value = '';
  syncLogo();
  const msg = document.getElementById('designMsg');
  if (msg) msg.textContent = '已刪掉 logo。要塗的圖還在。';
});
document.getElementById('logoFile').addEventListener('change', async (event) => {
  const msg = document.getElementById('designMsg');
  const file = event.target.files && event.target.files[0];
  try {
    if (!file) return;
    state.logoData = await shrinkImage(await readFile(file));
    syncLogo();
    if (msg) msg.textContent = 'logo 已附上，不會蓋掉要塗的圖。請在上面那張塗要放的位置。';
  } catch (err) {
    state.logoData = '';
    event.target.value = '';
    syncLogo();
    if (msg) msg.textContent = err.message || '讀取 logo 失敗。';
  }
});
document.getElementById('textBoxes').addEventListener('pointerdown', (event) => {
  const canvas = document.getElementById('textBoxes');
  const rect = canvas.getBoundingClientRect();
  const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100;
  const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100;
  const hit = state.lines.findIndex((line) => {
    if (![line.x, line.y, line.w, line.h].every((n) => Number(n) > 0)) return false;
    return px >= line.x && px <= line.x + line.w && py >= line.y && py <= line.y + line.h;
  });
  if (hit >= 0) pickLine(hit);
});
document.getElementById('textUploadBtn').addEventListener('click', () => {
  document.getElementById('photo').click();
});

async function refreshPlan() {
  const data = await fetch('/api/design/status').then((r) => r.json());
  if (!state.catalog) {
    state.catalog = data;
    renderCatalog();
  }
  paintPlan(data);
}

document.getElementById('ratio').addEventListener('change', () => {
  state.ratioTouched = true;
});

document.getElementById('photo').addEventListener('change', async (event) => {
  const msg = document.getElementById('designMsg');
  const file = event.target.files && event.target.files[0];
  try {
    if (!file) return;
    state.imageData = await shrinkImage(await readFile(file));
    state.imageId = '';
    state.preview = state.imageData;
    state.sourceRatio = await nearestRatio(state.imageData);
    applyLockedRatio();
    document.getElementById('fileName').textContent = file.name;
    state.textReadFor = '';
    state.textShownFor = '';
    if (msg) {
      msg.textContent = state.workflow === 'inpaint'
        ? '這張是要塗的圖。logo 請另外傳，不會蓋掉它。'
        : state.workflow === 'text'
          ? '圖已顯示在上面。輸出比例跟這張原圖，避免把人裁成半身。'
          : '已換上這張，送出後會以它為底。';
    }
    syncInpaint();
    syncStage();
    syncTextPreview();
  } catch (err) {
    state.imageData = '';
    event.target.value = '';
    document.getElementById('fileName').textContent = '';
    if (msg) msg.textContent = err.message || '讀取圖片失敗。';
  }
});

async function sendDesign(event) {
  event.preventDefault();
  if (state.busy) return;
  const msg = document.getElementById('designMsg');
  const btn = document.getElementById('sendBtn');
  const note = document.getElementById('note').value.trim();
  const from = document.getElementById('fromText').value.trim();
  const to = document.getElementById('toText').value.trim();
  if ((state.workflow === 'text' || state.workflow === 'mockup' || state.workflow === 'inpaint') && !state.preview) {
    msg.textContent = '請先上傳圖，或先做出一張再接著改。';
    return;
  }
  if (state.workflow === 'text' && !to) {
    msg.textContent = '請寫上要換成的正確文字。';
    return;
  }
  if (state.workflow === 'inpaint') {
    if (!state.preview) {
      msg.textContent = '請先上傳要改的圖，或先做出一張。';
      return;
    }
    if (!state.painted) {
      msg.textContent = '請在要塗的圖上塗出要改的位置。';
      return;
    }
    if (note.length < 2 && !state.logoData) {
      msg.textContent = '請寫塗掉的地方要改成什麼，或上傳要放上的 logo。';
      return;
    }
  } else if (state.workflow !== 'text' && note.length < 2 && state.workflow !== 'mockup') {
    msg.textContent = '請寫這張圖要呈現什麼。';
    return;
  }
  const paintNote = state.workflow === 'inpaint' && note.length < 2 && state.logoData
    ? '把附上的圖放進塗色的位置'
    : note;
  const userBits = [paintNote, state.workflow === 'text' && to ? `改成「${to}」` : ''].filter(Boolean);
  const thumb = state.preview ? `<img src="${escapeHtml(state.preview)}" alt="送出的圖" />` : '';
  addBubble('user', `<p>${escapeHtml(userBits.join('\n') || '套用場景')}</p>${thumb}`);
  msg.textContent = '正在做這張，約半分鐘，請不要重按。';
  state.busy = true;
  btn.disabled = true;
  try {
    const res = await fetch('/api/design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.imageData,
        imageId: state.imageData ? '' : state.imageId,
        marked: state.workflow === 'inpaint' ? markedDataUrl() : '',
        reference: state.workflow === 'inpaint' ? state.logoData : '',
        note: paintNote,
        from,
        to,
        workflow: state.workflow,
        style: state.style,
        mockup: state.mockup,
        aspectRatio: document.getElementById('ratio').value,
        imageSize: document.getElementById('size').value,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '設計失敗');
    state.imageData = '';
    state.imageId = String(body.mediaId || '');
    if (body.aspectRatio && RATIO_LABEL[body.aspectRatio]) state.sourceRatio = body.aspectRatio;
    state.preview = state.imageId ? `/api/clip/media/${state.imageId}` : '';
    document.getElementById('photo').value = '';
    document.getElementById('fileName').textContent = '';
    const sizeNote = body.imageSize && body.imageSize !== document.getElementById('size').value
      ? `已改出 ${body.imageSize}。`
      : '';
    const save = state.imageId
      ? `<div class="design-actions" style="margin-top:10px;"><a class="btn btn-copper" href="/api/clip/media/${encodeURIComponent(state.imageId)}?download=1" download="設計.jpg">下載圖片</a></div>`
      : '';
    addBubble('assistant', `<p>${escapeHtml(`${body.reply || '做好了。'} ${sizeNote}`.trim())}</p><img src="${escapeHtml(state.preview)}" alt="設計結果" />${save}`);
    msg.textContent = '';
    state.textReadFor = '';
    state.textShownFor = '';
    syncStage();
    syncTextPreview();
    refreshPlan().catch(() => {});
  } catch (err) {
    msg.textContent = err.message || '設計失敗';
    addBubble('assistant', `<p>${escapeHtml(err.message || '設計失敗')}</p>`);
  } finally {
    state.busy = false;
    btn.disabled = false;
  }
}

document.getElementById('designForm').addEventListener('submit', sendDesign);
document.getElementById('note').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    document.getElementById('designForm').requestSubmit();
  }
});

refreshPlan().catch(() => {
  document.getElementById('designPlan').textContent = '設計對話暫時無法使用，請稍後再試。';
});
