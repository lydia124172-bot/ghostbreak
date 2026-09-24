const SLIDE_MS = 2800;
const DEMOS = {
  ugc: ['product-1.jpg', 'product-2.jpg', 'product-3.jpg'],
  life: ['model.jpg'],
  grid: ['product-1.jpg', 'product-2.jpg', 'product-3.jpg'],
};
const DEMO_COPY = {
  product: '手沖咖啡豆 200g',
  price: '特價 380 元',
  hook: '今天下單今晚烘',
};

const CLIP_CONNECT_OPEN = false;

const state = {
  style: 'ugc',
  images: [],
  posterBlob: null,
  videoBlob: null,
  mp4Blob: null,
  imageIds: [],
  videoId: '',
  skipPhotoReset: false,
  visionReady: false,
  enhanceReady: false,
  videoReady: false,
  exportReady: false,
  musicPick: 'bright',
  duration: '5',
};

function selectedStyle() {
  return state.style;
}

function selectedDuration() {
  return state.duration === '10' ? '10' : '5';
}

function makeBtnLabel() {
  return `產出小廣告（約 ${selectedDuration()} 秒）`;
}

function clipAuthHeaders(json) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = sessionStorage.getItem('moose_admin_token');
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片讀取失敗'));
    img.src = url;
  });
}

function coverDraw(ctx, img, w, h, zoom) {
  coverDrawAt(ctx, img, 0, 0, w, h, zoom);
}

function coverDrawAt(ctx, img, x, y, w, h, zoom) {
  const scale = Math.max(w / img.width, h / img.height) * (zoom || 1);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const chars = String(text || '').split('');
  const lines = [];
  let line = '';
  chars.forEach((ch) => {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else line = next;
  });
  if (line) lines.push(line);
  const out = lines.slice(0, maxLines || 2);
  if (out.length >= 2 && /^[？?！!。、，,．.]$/.test(out[out.length - 1])) {
    out[out.length - 2] += out.pop();
  }
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function paintVignette(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h * 0.38, h * 0.12, w / 2, h * 0.42, h * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function paintBottomFade(ctx, w, h, start) {
  const g = ctx.createLinearGradient(0, start, 0, h);
  g.addColorStop(0, 'rgba(10,8,14,0)');
  g.addColorStop(0.35, 'rgba(10,8,14,0.28)');
  g.addColorStop(1, 'rgba(10,8,14,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, start, w, h - start);
}

function fillShadowText(ctx, text, x, y) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 3;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('畫面輸出失敗'));
    }, type || 'image/jpeg', quality || 0.92);
  });
}

function tagLine(product) {
  const raw = String(product || '').replace(/[0-9.gG克元／/\s]+/g, '');
  const core = raw.slice(0, 8) || '商品';
  return [`#${core}`, '#好物分享', '#今日推薦', '#私訊下單'];
}

function usableHook(product, hook) {
  const h = String(hook || '').trim();
  const p = String(product || '').trim();
  if (!h) return '';
  if (h === DEMO_COPY.hook && p !== DEMO_COPY.product) return '';
  if (h === '今天下單今晚烘' && !/咖啡/.test(p)) return '';
  return h;
}

function captionFor(style, copy) {
  if (copy.ownCopy) return copy.ownCopy.slice(0, 2000);
  const product = copy.product;
  const price = copy.price;
  const hook = usableHook(copy.product, copy.hook);
  const sell = hook || '精選好物，直送到府！';
  if (style === 'life') {
    return [
      `你可能會好奇，${product} 和日常生活有什麼關係。其實，選對商品不只是當下舒服，還能讓儀式感回到每天。${sell}適量使用，就能讓日常更有節奏。下次挑選時，別忘了把「${product}」排進固定清單！`,
      price ? `現在${price}。` : '',
      '👉 追蹤我們，搶先看最新好物！',
      '🛒 私訊下單或留言了解',
      '',
      tagLine(product).concat(['#生活儀式', '#居家品味']).join(' '),
    ].filter(Boolean).join('\n');
  }
  if (style === 'grid') {
    return [
      `✈️【${product}】`,
      `🔥 ${sell}`,
      price ? `📌 ${price}` : '',
      '👉 追蹤我們，搶先看最新好物！',
      '🛒 私訊下單或留言了解',
      '',
      `重點：${product}適合日常使用，收到即可開始。`,
      tagLine(product).concat(['#必買', '#現貨']).join(' '),
    ].filter(Boolean).join('\n');
  }
  return [
    `🔥 ${product}`,
    `✈️ ${sell}`,
    price ? `${price}` : '',
    '👉 追蹤我們，搶先看最新好物！',
    '🛒 私訊下單或留言了解',
    '',
    tagLine(product).join(' '),
  ].filter(Boolean).join('\n');
}

function copyLines(text) {
  return String(text || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
}

function ugcLines({ product, price, hook }) {
  const cover = usableHook(product, hook);
  const lines = [cover || product, price].filter(Boolean);
  return lines.slice(0, 2);
}

function paintUgc(ctx, img, copy, t, lineIndex) {
  const w = 1080;
  const h = 1920;
  ctx.fillStyle = '#0c0b10';
  ctx.fillRect(0, 0, w, h);
  coverDraw(ctx, img, w, h, 1.04 + t * 0.08);
  paintVignette(ctx, w, h);
  paintBottomFade(ctx, w, h, 980);
  const text = ugcLines(copy)[lineIndex] || copy.product;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f6f1e6';
  ctx.font = '800 58px "Noto Sans TC", sans-serif';
  const lines = wrapText(ctx, text, 920, 3);
  let y = 1420 - Math.max(0, lines.length - 2) * 36;
  lines.forEach((row) => {
    fillShadowText(ctx, row, 72, y);
    y += 74;
  });
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#c4a574';
  ctx.fillRect(72, y + 4, 64, 4);
  const sub = [copy.product, copy.price].filter(Boolean).join('  ·  ');
  if (sub) {
    ctx.font = '600 28px "Noto Sans TC", sans-serif';
    ctx.fillStyle = 'rgba(246,241,230,0.9)';
    fillShadowText(ctx, sub, 72, y + 52);
  }
  ctx.textAlign = 'left';
}

function paintLife(ctx, img, copy) {
  const w = 1080;
  const h = 1350;
  ctx.fillStyle = '#0c0b10';
  ctx.fillRect(0, 0, w, h);
  coverDraw(ctx, img, w, h, 1.04);
  paintVignette(ctx, w, h);
  paintBottomFade(ctx, w, h, 820);
  const hook = usableHook(copy?.product, copy?.hook) || copy?.product || '';
  if (!hook) return;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f6f1e6';
  ctx.font = '800 48px "Noto Sans TC", sans-serif';
  let y = 1140;
  wrapText(ctx, hook, 920, 2).forEach((row) => {
    fillShadowText(ctx, row, 64, y);
    y += 62;
  });
  ctx.fillStyle = '#c4a574';
  ctx.fillRect(64, y + 2, 56, 3);
  if (copy?.product && copy.product !== hook) {
    ctx.font = '600 26px "Noto Sans TC", sans-serif';
    ctx.fillStyle = 'rgba(246,241,230,0.88)';
    fillShadowText(ctx, copy.product, 64, y + 46);
  }
}

function paintGrid(ctx, images, { product, price, hook }) {
  hook = usableHook(product, hook) || '立即選購';
  const w = 1080;
  const h = 1350;
  ctx.fillStyle = '#141218';
  ctx.fillRect(0, 0, w, h);
  const pad = 22;
  const gap = 16;
  const cellW = (w - pad * 2 - gap) / 2;
  const cellH = (h - pad * 2 - gap) / 2;
  const cells = [
    { x: pad, y: pad },
    { x: pad + cellW + gap, y: pad },
    { x: pad, y: pad + cellH + gap },
    { x: pad + cellW + gap, y: pad + cellH + gap },
  ];

  function photoCell(i, img, badge) {
    const { x, y } = cells[i];
    ctx.save();
    roundRect(ctx, x, y, cellW, cellH, 18);
    ctx.clip();
    ctx.fillStyle = '#1c1a22';
    ctx.fillRect(x, y, cellW, cellH);
    if (img) coverDrawAt(ctx, img, x, y, cellW, cellH, 1.05);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, y, cellW, cellH);
    ctx.restore();
    if (badge) {
      ctx.font = '700 24px "Noto Sans TC", sans-serif';
      const tw = ctx.measureText(badge).width;
      ctx.fillStyle = 'rgba(12,10,16,0.78)';
      roundRect(ctx, x + 18, y + 18, tw + 28, 42, 8);
      ctx.fill();
      ctx.fillStyle = '#e8d5b0';
      ctx.fillText(badge, x + 32, y + 47);
    }
  }

  const a = images[0];
  const b = images[1] || images[0];
  const c = images[2] || images[0];
  photoCell(0, a, '現貨');
  photoCell(2, b, '使用中');
  photoCell(3, c, price || '必買');

  const { x, y } = cells[1];
  ctx.fillStyle = '#1c1814';
  roundRect(ctx, x, y, cellW, cellH, 18);
  ctx.fill();
  ctx.fillStyle = '#c4a574';
  ctx.fillRect(x + 28, y + 36, 48, 4);
  ctx.fillStyle = '#f6f1e6';
  ctx.font = '800 42px "Noto Sans TC", sans-serif';
  wrapText(ctx, hook || '立即選購', cellW - 56, 4).forEach((row, i) => {
    ctx.fillText(row, x + 28, y + 100 + i * 52);
  });
  ctx.font = '600 26px "Noto Sans TC", sans-serif';
  ctx.fillStyle = 'rgba(246,241,230,0.78)';
  ctx.fillText(product, x + 28, y + cellH - 36);
}

async function recordCanvas(width, height, ms, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  paint(ctx, 0, 0);
  const stream = canvas.captureStream(30);
  const mime = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || '';
  const rec = mime
    ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5000000 })
    : new MediaRecorder(stream, { videoBitsPerSecond: 5000000 });
  const chunks = [];
  rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const done = new Promise((resolve, reject) => {
    rec.onerror = () => reject(new Error('錄製失敗'));
    rec.onstop = () => {
      if (!chunks.length) reject(new Error('短片是空的，請再試一次'));
      else resolve(new Blob(chunks, { type: rec.mimeType || chunks[0].type || 'video/webm' }));
    };
  });
  rec.start(200);
  const start = performance.now();
  while (performance.now() - start < ms) {
    const elapsed = performance.now() - start;
    paint(ctx, Math.min(1, elapsed / ms), elapsed);
    await wait(32);
  }
  rec.stop();
  return done;
}

async function makeUgc(images, copy) {
  const lines = ugcLines(copy);
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  paintUgc(canvas.getContext('2d'), images[0], copy, 0, 0);
  const posterBlob = await canvasBlob(canvas);
  const total = Math.max(1, images.length) * SLIDE_MS;
  const videoBlob = await recordCanvas(1080, 1920, total, (ctx, _t, elapsed) => {
    const idx = Math.min(images.length - 1, Math.floor(elapsed / SLIDE_MS));
    const lineIndex = Math.min(lines.length - 1, Math.floor(elapsed / SLIDE_MS));
    const local = (elapsed % SLIDE_MS) / SLIDE_MS;
    paintUgc(ctx, images[idx], copy, local, lineIndex);
  });
  return { posterBlob, videoBlob, kind: 'video' };
}

async function makeLife(images, copy) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  paintLife(canvas.getContext('2d'), images[0], copy);
  const posterBlob = await canvasBlob(canvas);
  const videoBlob = await recordCanvas(1080, 1350, 4000, (ctx, t) => {
    const w = 1080;
    const h = 1350;
    ctx.fillStyle = '#0c0b10';
    ctx.fillRect(0, 0, w, h);
    coverDraw(ctx, images[0], w, h, 1.04 + t * 0.08);
    paintVignette(ctx, w, h);
    paintBottomFade(ctx, w, h, 820);
    const hook = usableHook(copy?.product, copy?.hook) || copy?.product || '';
    if (!hook) return;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f6f1e6';
    ctx.font = '800 48px "Noto Sans TC", sans-serif';
    let y = 1140;
    wrapText(ctx, hook, 920, 2).forEach((row) => {
      fillShadowText(ctx, row, 64, y);
      y += 62;
    });
    ctx.fillStyle = '#c4a574';
    ctx.fillRect(64, y + 2, 56, 3);
    if (copy?.product && copy.product !== hook) {
      ctx.font = '600 26px "Noto Sans TC", sans-serif';
      ctx.fillStyle = 'rgba(246,241,230,0.88)';
      fillShadowText(ctx, copy.product, 64, y + 46);
    }
  });
  return { posterBlob, videoBlob, kind: 'video' };
}

async function makeGrid(images, copy) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  paintGrid(canvas.getContext('2d'), images, copy);
  const posterBlob = await canvasBlob(canvas);
  const videoBlob = await recordCanvas(1080, 1350, 4500, (ctx, t) => {
    ctx.save();
    ctx.translate(540, 675);
    ctx.scale(1 + t * 0.08, 1 + t * 0.08);
    ctx.translate(-540, -675);
    paintGrid(ctx, images, copy);
    ctx.restore();
  });
  return { posterBlob, videoBlob, kind: 'video' };
}

function saveNote(text) {
  const el = document.getElementById('saveMsg') || document.getElementById('publishMsg');
  if (el) el.textContent = text || '';
}

function setSaveLink(el, href, filename, ready, label) {
  if (!el) return;
  el.href = href || '#';
  if (filename) el.setAttribute('download', filename);
  el.classList.toggle('is-wait', !ready);
  el.setAttribute('aria-disabled', ready ? 'false' : 'true');
  if (label) el.textContent = label;
}

function canShareBlob(blob, name) {
  try {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    return Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

async function copyCaption() {
  const text = document.getElementById('caption').value;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    document.getElementById('caption').select();
    return false;
  }
}

function showFeed(caption, posterUrl, videoUrl) {
  document.getElementById('caption').value = caption;
  document.getElementById('feedCaption').textContent = caption;
  const video = document.getElementById('preview');
  const img = document.getElementById('previewImg');
  const stillFirst = state.style !== 'ugc';
  if (stillFirst) {
    img.src = posterUrl;
    img.classList.remove('hidden');
    video.pause();
    video.removeAttribute('src');
    video.classList.add('hidden');
  } else {
    img.classList.add('hidden');
    video.pause();
    video.removeAttribute('src');
    video.classList.remove('hidden');
    video.muted = false;
    video.defaultMuted = false;
    video.volume = 1;
    video.controls = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    const playWhenReady = () => {
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    };
    video.onerror = () => {
      showClipMsg('畫面轉不停時請按「下載短片」。檔案在，是瀏覽器還在讀索引。');
    };
    video.addEventListener('canplay', playWhenReady, { once: true });
    video.src = videoUrl;
    video.load();
  }
  setSaveLink(document.getElementById('downloadJpgBtn'), posterUrl, 'mooseclip.jpg', true, '下載封面');
  setSaveLink(document.getElementById('downloadMp4Btn'), '#', 'mooseclip.mp4', false, '短片準備中');
  const shareBtn = document.getElementById('shareBtn');
  const shareOk = canShareBlob(state.posterBlob, 'mooseclip.jpg') || canShareBlob(state.videoBlob, 'mooseclip.webm');
  shareBtn.classList.toggle('hidden', !shareOk);
  document.getElementById('previewBox').classList.remove('hidden');
  document.getElementById('previewBox').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function prepareDownloads() {
  state.exportReady = false;
  state.mp4Blob = null;
  state.videoId = '';
  state.imageIds = [];
  saveNote('正在準備可上傳的檔案…');
  try {
    const jpgId = await uploadBlob(state.posterBlob, 'image');
    state.imageIds = [jpgId];
    setSaveLink(document.getElementById('downloadJpgBtn'), `/api/clip/media/${jpgId}?download=1`, 'mooseclip.jpg', true, '下載封面');
    const videoId = await uploadBlob(state.videoBlob, 'video');
    state.videoId = videoId;
    const res = await fetch(`/api/clip/media/${videoId}/mp4`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '短片轉檔失敗');
    const isMp4 = /mp4/i.test(body.mime || '');
    setSaveLink(
      document.getElementById('downloadMp4Btn'),
      body.url || `/api/clip/media/${videoId}/mp4`,
      isMp4 ? 'mooseclip.mp4' : 'mooseclip.webm',
      true,
      isMp4 ? '下載短片' : '下載短片',
    );
    state.exportReady = true;
    saveNote(isMp4
      ? '檔案已可下載。手機可傳送到社群；電腦請下載後上傳。記得複製文案。'
      : '封面可下載。短片若手機傳不上去，請改發封面圖。');
  } catch (err) {
    setSaveLink(document.getElementById('downloadJpgBtn'), URL.createObjectURL(state.posterBlob), 'mooseclip.jpg', true, '下載封面');
    saveNote(err.message || '短片轉檔失敗，請先下載封面圖。');
  }
}

async function uploadBlob(blob, kind) {
  const res = await fetch(`/api/clip/upload?kind=${encodeURIComponent(kind)}&mime=${encodeURIComponent(blob.type || 'application/octet-stream')}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || '上傳失敗');
  return body.id;
}

async function refreshStatus() {
  const res = await fetch('/api/clip/status', { headers: clipAuthHeaders() });
  const data = await res.json();
  if (CLIP_CONNECT_OPEN) {
    fillLinks(data.links || {});
    renderQueue(data.queue || []);
    paintAccount('fb', data.facebook, data.pageName || data.links?.facebook, '寫粉專名稱或網址');
    paintAccount('ig', data.instagram, data.igName || data.links?.instagram, '寫名稱、網址或 @帳號');
    paintAccount('th', data.threads, data.links?.threads, '寫名稱、網址或 @帳號');
    paintAccount('tk', data.tiktok, data.tiktokName || data.links?.tiktok, '寫名稱、網址或 @帳號');
    const lines = [];
    if (!data.metaApp && !data.tiktokApp) {
      lines.push('自動發文尚未開通。請先下載短片與文案，到各平台自行上傳。');
    }
    const connectStatus = document.getElementById('connectStatus');
    if (connectStatus) connectStatus.textContent = lines.join(' ');
    const btns = [];
    if (data.metaApp) btns.push('<a class="btn btn-cream" href="/api/clip/connect/meta">連接 Facebook／IG／Threads</a>');
    if (data.tiktokApp) btns.push('<a class="btn btn-cream" href="/api/clip/connect/tiktok">連接 TikTok</a>');
    const connectBtns = document.getElementById('connectBtns');
    if (connectBtns) {
      connectBtns.innerHTML = btns.join('') || '<span class="combo-fit">先產出作品、填帳號並選時間。連接時只在官方畫面輸入密碼。</span>';
    }
  }
  state.visionReady = Boolean(data.vision);
  state.enhanceReady = Boolean(data.enhance);
  state.videoReady = Boolean(data.video);
  const visionMsg = document.getElementById('visionMsg');
  if (visionMsg && !state.visionReady) {
    visionMsg.textContent = '識圖文案暫時無法使用。可先自行填文案，或稍後再試。';
  }
  refreshPlan();
}

async function refreshPlan() {
  const bar = document.getElementById('clipPlan');
  if (!bar) return;
  try {
    const st = await fetch('/api/clip/status', { headers: clipAuthHeaders() }).then((r) => r.json());
    if (st.owner) {
      const video = st.video
        ? `小廣告走 Wan 圖生視頻，可選 5 或 10 秒。5 秒較快約 NT$16，10 秒約 NT$31。不扣方案點，仍扣 fal。`
        : '圖生視頻尚未開通。';
      const eng = `${video}換靜態圖走 Google。`;
      bar.innerHTML = `作者已登入後台。排版與識圖免費。${eng}`;
      return;
    }
    const me = await fetch('/api/account/me').then((r) => r.json());
    if (me.ok && me.email) {
      const extra = me.credits ? ` · 剩餘 ${me.credits} 點（換靜態圖扣 1 點）` : ' · 換靜態圖需方案點數';
      const pending = me.pendingPlan ? ' · 方案確認中' : '';
      bar.innerHTML = `目前方案：${me.planName}${extra}${pending}　小廣告一次扣 3 點　<a href="/account">管理方案</a>`;
    } else {
      bar.innerHTML = '排版與識圖不必登入。小廣告需登入方案或後台。作者請先<a href="/admin">後台登入</a>。';
    }
  } catch {
    bar.innerHTML = '排版與識圖不必登入。要會動請按「產出小廣告」。　<a href="/account">看方案</a>';
  }
}

function paintAccount(key, connected, label, emptyText) {
  const map = { fb: 'Fb', ig: 'Ig', th: 'Th', tk: 'Tk' };
  const st = document.getElementById(`${key}St`);
  const meta = document.getElementById(`${key}Meta`);
  const card = document.getElementById(`card${map[key]}`);
  if (st) {
    st.textContent = connected ? '已連接' : '需要授權';
    st.classList.toggle('ok', Boolean(connected));
  }
  if (card) card.classList.toggle('ok', Boolean(connected));
  if (meta) meta.textContent = label || emptyText;
}

function defaultSendAt() {
  const el = document.getElementById('sendAt');
  if (!el) return;
  if (!el || el.value) return;
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  el.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fillLinks(links) {
  const map = { instagram: 'linkIg', threads: 'linkThreads', facebook: 'linkFb', tiktok: 'linkTk' };
  Object.entries(map).forEach(([kind, id]) => {
    const el = document.getElementById(id);
    if (el && !el.value && links[kind]) el.value = links[kind];
  });
  checkFromLinks();
}

function readLinks() {
  return {
    instagram: document.getElementById('linkIg')?.value.trim() || '',
    threads: document.getElementById('linkThreads')?.value.trim() || '',
    facebook: document.getElementById('linkFb')?.value.trim() || '',
    tiktok: document.getElementById('linkTk')?.value.trim() || '',
  };
}

function checkFromLinks() {
  const links = readLinks();
  document.querySelectorAll('.clip-account-pick input').forEach((el) => {
    if (links[el.value]) el.checked = true;
  });
}

function selectedPlatforms() {
  const checked = [...document.querySelectorAll('.clip-account-pick input:checked')].map((el) => el.value);
  if (checked.length) return checked;
  const links = readLinks();
  return Object.keys(links).filter((key) => links[key]);
}

function jobLabel(row) {
  const when = row.at ? new Date(row.at).toLocaleString('zh-Hant') : '';
  const dest = (row.platforms || []).join('、');
  if (row.status === 'queued') return `${when} 將發到 ${dest}（已預約）`;
  if (row.status === 'sending') return `${when} 正在發到 ${dest}`;
  if (row.status === 'sent') return `${when} 已發到 ${dest}`;
  return `${when} ${dest}：${row.error || '發送失敗'}`;
}

function renderQueue(items) {
  const box = document.getElementById('queueList');
  if (!box) return;
  box.innerHTML = (items || []).map((row) => `<li>${esc(jobLabel(row))}</li>`).join('');
}

async function ensureUploaded() {
  if (!state.posterBlob || !state.videoBlob) throw new Error('請先產出小廣告。');
  if (state.videoId && state.imageIds.length) return;
  state.videoId = await uploadBlob(state.videoBlob, 'video');
  state.imageIds = [await uploadBlob(state.posterBlob, 'image')];
}

function readCopy() {
  const ownCopy = document.getElementById('ownCopy').value.trim();
  const first = copyLines(ownCopy)[0] || '';
  const product = document.getElementById('product').value.trim() || first.replace(/^[🔥✈️👉🛒📌\s]+/, '').slice(0, 40) || '商品';
  const hook = usableHook(product, document.getElementById('hook').value.trim() || first.replace(/^[🔥✈️👉🛒📌\s]+/, '').slice(0, 24));
  let caption = ownCopy;
  if (caption && /今天下單今晚烘|手沖咖啡豆/.test(caption) && !/咖啡/.test(product || '')) caption = '';
  return {
    product,
    price: document.getElementById('price').value.trim(),
    hook,
    ownCopy: caption,
  };
}

async function buildFromFiles(files) {
  const copy = readCopy();
  if (!files.length) throw new Error('請先選商品圖');
  const style = selectedStyle();
  const btn = document.getElementById('makeBtn');
  const msg = document.getElementById('publishMsg');
  btn.disabled = true;
  btn.textContent = '產出中…';
  showClipMsg('正在產出小廣告…');
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const images = [];
    for (const file of [...files].slice(0, 5)) images.push(await loadImage(file));
    state.images = [...files].slice(0, 5);
    let made;
    if (style === 'life') made = await makeLife(images, copy);
    else if (style === 'grid') made = await makeGrid(images, copy);
    else made = await makeWanVideo(files, copy);
    state.posterBlob = made.posterBlob;
    state.videoBlob = made.videoBlob;
    state.mp4Blob = null;
    state.videoId = '';
    state.imageIds = [];
    const caption = captionFor(style, copy);
    const posterUrl = URL.createObjectURL(made.posterBlob);
    const videoUrl = URL.createObjectURL(made.videoBlob);
    showFeed(caption, posterUrl, videoUrl);
    showClipMsg('畫面與文案已產出，請下載後發文。');
    await prepareDownloads();
  } finally {
    btn.disabled = false;
    btn.textContent = makeBtnLabel();
  }
}

function showClipMsg(text) {
  const pub = document.getElementById('publishMsg');
  const vis = document.getElementById('visionMsg');
  if (pub) {
    pub.classList.remove('hidden');
    pub.textContent = text;
  }
  if (vis && vis !== pub) vis.textContent = '';
}

async function assertVideoAllowed() {
  const st = await fetch('/api/clip/status', { headers: clipAuthHeaders() }).then((r) => r.json()).catch(() => ({}));
  state.videoReady = Boolean(st.video);
  if (!st.video) throw new Error('圖生視頻尚未開通。');
  if (st.owner) return;
  const me = await fetch('/api/account/me').then((r) => r.json()).catch(() => ({}));
  const need = Number(st.videoCredits || 3);
  if (!me.ok || Number(me.credits || 0) < need) {
    throw new Error(`小廣告需先到後台登入，或方案剩餘 ${need} 點以上。`);
  }
}

async function waitVideoJob(jobId, onPhase) {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await fetch(`/api/clip/video/job/${encodeURIComponent(jobId)}`, { headers: clipAuthHeaders() });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 402) throw new Error(body.error || '小廣告需後台登入或方案點數。');
    if (res.status === 404) break;
    if (!res.ok) throw new Error(body.error || '生片失敗');
    if (body.videoUrl) return body;
    if (onPhase) {
      onPhase(body.status === 'saving' ? '存檔中' : body.status === 'running' ? '製作中' : '排隊中');
    }
  }
  const last = await fetch('/api/clip/video/last', { headers: clipAuthHeaders() });
  const recovered = await last.json().catch(() => ({}));
  if (last.ok && recovered.videoUrl) return recovered;
  throw new Error('生片逾時。若 fal 已做好，請再按一次取回，不要連續重按。');
}

async function makeWanVideo(files, copy) {
  if (!state.videoReady) throw new Error('圖生視頻尚未開通。');
  await assertVideoAllowed();
  let tick = 0;
  let phase = '已送出';
  const clock = setInterval(() => {
    tick += 1;
    const btn = document.getElementById('makeBtn');
    if (btn) btn.textContent = `生片中 ${tick} 秒`;
    showClipMsg(`小廣告${phase}，已過 ${tick} 秒。通常約 1 分鐘，請不要重按。`);
  }, 1000);
  try {
    async function uploadTrack(file, label) {
      if (!file) return '';
      if (file.size > 8 * 1024 * 1024) throw new Error(`${label}請小於 8MB`);
      if (!acceptedAudioFile(file)) {
        throw new Error(`${label}只接受 .mp3 或 .wav，且小於 8MB`);
      }
      return uploadBlob(file, 'audio');
    }
    const music = document.getElementById('music') && document.getElementById('music').files[0];
    const voice = document.getElementById('voice') && document.getElementById('voice').files[0];
    const narration = (document.getElementById('narration') && document.getElementById('narration').value.trim()) || '';
    if (music) phase = '上傳配樂';
    const audioId = await uploadTrack(music, '配樂');
    if (voice) phase = '上傳口播';
    const voiceId = await uploadTrack(voice, '口播音檔');
    const res = await fetch('/api/clip/video', {
      method: 'POST',
      headers: clipAuthHeaders(true),
      body: JSON.stringify({
        images: [await fileToJpegDataUrl(files[0])],
        product: copy.product,
        price: copy.price,
        hook: copy.hook,
        style: 'ugc',
        audioId,
        musicPick: state.musicPick || 'bright',
        audioUrl: (document.getElementById('musicUrl') && document.getElementById('musicUrl').value.trim()) || '',
        voiceId,
        narration,
        duration: selectedDuration(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 402) throw new Error(body.error || '小廣告需後台登入或方案點數。');
    if (!res.ok) throw new Error(body.error || '生片失敗');
    const done = body.videoUrl ? body : await waitVideoJob(body.jobId, (next) => { phase = next; });
    const videoBlob = await (await fetch(done.videoUrl)).blob();
    showClipMsg(done.recovered ? '已把做好的小廣告抓回來。請下載後發文。' : '小廣告已產出，請下載後發文。');
    return { posterBlob: files[0], videoBlob, kind: 'video' };
  } finally {
    clearInterval(clock);
  }
}

async function fetchDemoFiles(names) {
  const files = [];
  for (const name of names) {
    const blob = await fetch(`/clip-demo/${name}`).then((r) => {
      if (!r.ok) throw new Error('示範圖讀取失敗');
      return r.blob();
    });
    files.push(new File([blob], name, { type: blob.type || 'image/jpeg' }));
  }
  const dt = new DataTransfer();
  files.forEach((file) => dt.items.add(file));
  state.skipPhotoReset = true;
  document.getElementById('photos').files = dt.files;
  state.skipPhotoReset = false;
  return files;
}

function clearCopyFields() {
  document.getElementById('product').value = '';
  document.getElementById('price').value = '';
  document.getElementById('hook').value = '';
  document.getElementById('ownCopy').value = '';
  const narration = document.getElementById('narration');
  if (narration) narration.value = '';
}

let captionSeq = 0;

async function writeCaptionFromFiles(files, { overwrite = true } = {}) {
  if (!files || !files.length) throw new Error('請先選商品圖');
  if (!state.visionReady) throw new Error('識圖文案暫時無法使用。請先改商品名稱與文案。');
  const seq = ++captionSeq;
  const images = [];
  for (const file of [...files].slice(0, 3)) images.push(await fileToJpegDataUrl(file));
  if (seq !== captionSeq) return;
  const res = await fetch('/api/clip/caption', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images,
      product: overwrite ? '' : document.getElementById('product').value.trim(),
      price: overwrite ? '' : document.getElementById('price').value.trim(),
      hook: overwrite ? '' : document.getElementById('hook').value.trim(),
      style: selectedStyle(),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (seq !== captionSeq) return;
  if (!res.ok) throw new Error(body.error || '識圖失敗');
  if (body.caption) document.getElementById('ownCopy').value = body.caption;
  if (body.product && (overwrite || !document.getElementById('product').value.trim())) {
    document.getElementById('product').value = body.product;
  }
  if (body.price && (overwrite || !document.getElementById('price').value.trim())) {
    document.getElementById('price').value = body.price;
  }
  if (body.hook && (overwrite || !document.getElementById('hook').value.trim())) {
    document.getElementById('hook').value = body.hook;
  }
}

document.getElementById('photos').addEventListener('change', async () => {
  if (state.skipPhotoReset) return;
  const files = document.getElementById('photos').files;
  if (!files.length) return;
  clearCopyFields();
  showClipMsg('已換圖，上一筆文案已清掉。正在依新圖重寫…');
  try {
    await writeCaptionFromFiles(files, { overwrite: true });
    showClipMsg('圖已就緒。可直接按「產出小廣告」。');
  } catch (err) {
    showClipMsg(err.message || '請先改商品名稱與文案，再產出。');
  }
});

document.querySelectorAll('#styleBtns .clip-type').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.style = btn.dataset.style;
    document.querySelectorAll('#styleBtns .clip-type').forEach((el) => el.classList.toggle('active', el === btn));
    saveClipDraft();
  });
});

function acceptedAudioFile(file) {
  if (!file) return false;
  if (file.size > 8 * 1024 * 1024) return false;
  return /\.(mp3|wav)$/i.test(file.name) || /audio\/(mpeg|mp3|wav|x-wav|wave)/i.test(file.type);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setMusicHint(text, kind) {
  const hint = document.getElementById('musicFileHint');
  if (!hint) return;
  hint.textContent = text;
  hint.classList.toggle('music-file-ok', kind === 'ok');
  hint.classList.toggle('music-file-bad', kind === 'bad');
}

function clearOwnMusic() {
  const input = document.getElementById('music');
  if (input) input.value = '';
  const btn = document.getElementById('musicBtn');
  if (btn) btn.textContent = '選自己的 MP3／WAV';
  setMusicHint('尚未選自己的檔。上面內建曲目已可直接用。自選只接受副檔名 .mp3 或 .wav；.m4a、.aac、.ogg、Suno 分享頁都不能用。');
}

function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!window.__mooseAudioCtx) window.__mooseAudioCtx = new Ctx();
  if (window.__mooseAudioCtx.state === 'suspended') window.__mooseAudioCtx.resume().catch(() => {});
}

function playMusicPreview(src, label) {
  const preview = document.getElementById('musicPreview');
  if (!preview) return;
  unlockAudio();
  preview.muted = false;
  preview.defaultMuted = false;
  preview.volume = 1;
  preview.pause();
  preview.src = src;
  const start = () => {
    preview.muted = false;
    preview.volume = 1;
    const playing = preview.play();
    if (playing) {
      playing.then(() => {
        showClipMsg(`正在播放「${label}」。若仍沒聲音，請按播放條的喇叭，並看瀏覽器分頁是否被靜音。`);
      }).catch(() => {
        showClipMsg(`「${label}」已選好。請按下面播放條的播放鍵，瀏覽器擋住自動播放。`);
      });
    }
  };
  preview.addEventListener('canplay', start, { once: true });
  preview.load();
}

document.querySelectorAll('#durationPicks .clip-type').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.duration = btn.dataset.duration === '10' ? '10' : '5';
    document.querySelectorAll('#durationPicks .clip-type').forEach((el) => el.classList.toggle('active', el === btn));
    const make = document.getElementById('makeBtn');
    if (make && !make.disabled) make.textContent = makeBtnLabel();
    showClipMsg(state.duration === '5' ? '下次產出 5 秒，會比較快。' : '下次產出 10 秒，等待會比較久。');
  });
});

document.querySelectorAll('#musicPicks .clip-type').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.musicPick = btn.dataset.music || 'none';
    document.querySelectorAll('#musicPicks .clip-type').forEach((el) => el.classList.toggle('active', el === btn));
    clearOwnMusic();
    const urlBox = document.getElementById('musicUrl');
    if (urlBox) urlBox.value = '';
    const preview = document.getElementById('musicPreview');
    const name = btn.querySelector('strong').textContent;
    if (state.musicPick === 'none') {
      if (preview) {
        preview.pause();
        preview.removeAttribute('src');
        preview.load();
      }
      showClipMsg('這次產出不加配樂。');
      saveClipDraft();
      return;
    }
    playMusicPreview(`/clip-music/${state.musicPick}.mp3?v=2`, name);
    saveClipDraft();
  });
});

document.getElementById('clipForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (selectedStyle() === 'ugc') {
    const ok = window.confirm('這會新做一支並扣費。若上一筆已經做好，請按「取消」，改按「取回剛才的小廣告」。確定要新做嗎？');
    if (!ok) {
      showClipMsg('已取消。沒有新扣費。若上一筆有片子，請按「取回剛才的小廣告」。');
      return;
    }
  }
  try {
    await buildFromFiles(document.getElementById('photos').files);
  } catch (err) {
    showClipMsg(err.message || '產出失敗');
  }
});

document.getElementById('recoverVideoBtn').addEventListener('click', async () => {
  const btn = document.getElementById('recoverVideoBtn');
  btn.disabled = true;
  try {
    showClipMsg('正在取回剛才做好的小廣告，不會再新做一支。');
    const last = await fetch('/api/clip/video/last', { headers: clipAuthHeaders() });
    const body = await last.json().catch(() => ({}));
    if (!last.ok) throw new Error(body.error || '沒有可取回的短片');
    const raw = await fetch(body.videoUrl);
    if (!raw.ok) throw new Error('取回的檔案讀不到。');
    const videoBlob = new Blob([await raw.arrayBuffer()], { type: 'video/mp4' });
    const posterBlob = document.getElementById('photos').files[0] || null;
    state.posterBlob = posterBlob;
    state.videoBlob = videoBlob;
    state.mp4Blob = null;
    state.videoId = body.videoId || '';
    state.imageIds = [];
    const caption = captionFor(selectedStyle(), readCopy());
    showFeed(caption, URL.createObjectURL(posterBlob), URL.createObjectURL(videoBlob));
    showClipMsg('已取回剛才的小廣告，請下載後發文。不要再按產出。');
    await prepareDownloads();
  } catch (err) {
    showClipMsg(err.message || '取回失敗');
  } finally {
    btn.disabled = false;
  }
});

function fileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const srcW = img.width || 0;
      const srcH = img.height || 0;
      if (srcW < 32 || srcH < 32) {
        URL.revokeObjectURL(url);
        reject(new Error('商品圖太小。請換一張至少 240×240 的清楚照片。'));
        return;
      }
      const minSide = 720;
      const maxSide = 1280;
      let scale = 1;
      if (Math.min(srcW, srcH) < minSide) scale = minSide / Math.min(srcW, srcH);
      if (Math.max(srcW, srcH) * scale > maxSide) scale = maxSide / Math.max(srcW, srcH);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(240, Math.round(srcW * scale));
      canvas.height = Math.max(240, Math.round(srcH * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, (canvas.width - srcW * scale) / 2, (canvas.height - srcH * scale) / 2, srcW * scale, srcH * scale);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => reject(new Error('圖片讀取失敗'));
    img.src = url;
  });
}

document.getElementById('enhanceBtn').addEventListener('click', async () => {
  const msg = document.getElementById('visionMsg') || document.getElementById('publishMsg');
  const files = document.getElementById('photos').files;
  const btn = document.getElementById('enhanceBtn');
  if (!files.length) {
    msg.textContent = '請先選商品圖。換靜態圖只換照片，不會變成會動的片子。';
    return;
  }
  if (!state.enhanceReady) {
    msg.textContent = '換靜態圖暫時無法使用。可先按「產出小廣告」。';
    return;
  }
  btn.disabled = true;
  let tick = 0;
  const clock = setInterval(() => {
    tick += 1;
    btn.textContent = `生圖中 ${tick} 秒`;
    msg.textContent = `正在換靜態圖，已過 ${tick} 秒。請稍候，不要重按。`;
  }, 1000);
  btn.textContent = '生圖中…';
  try {
    msg.textContent = '正在換靜態圖。請稍候，不要重按。';
    const res = await fetch('/api/clip/enhance', {
      method: 'POST',
      headers: clipAuthHeaders(true),
      body: JSON.stringify({
        images: [await fileToJpegDataUrl(files[0])],
        product: document.getElementById('product').value.trim(),
        price: document.getElementById('price').value.trim(),
        hook: document.getElementById('hook').value.trim(),
        style: selectedStyle(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 402) throw new Error(body.error || '進階生圖暫時無法使用。');
    if (!res.ok) {
      const last = await fetch('/api/clip/enhance/last', { headers: clipAuthHeaders() }).then((r) => r.json()).catch(() => ({}));
      if (last.image) {
        body.image = last.image;
        body.engine = last.engine || body.engine;
        body.recovered = true;
        body.owner = last.owner || body.owner;
      } else {
        throw new Error(body.error || '生圖失敗');
      }
    }
    const blob = await (await fetch(body.image)).blob();
    const file = new File([blob], 'enhanced.jpg', { type: blob.type || 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    [...files].slice(1).forEach((row) => dt.items.add(row));
    state.skipPhotoReset = true;
    document.getElementById('photos').files = dt.files;
    state.skipPhotoReset = false;
    const fluxNote = body.recovered
      ? '已把做好的圖抓回來。'
      : body.engine === 'seedream'
      ? '這張是 Seedream 測試圖。請看商品是否還在、場景像不像廣告。'
      : body.engine === 'flux'
        ? '這張是 Flux 測試圖。請看商品是否還在、場景像不像廣告。'
        : '';
    msg.textContent = body.owner
      ? `已換成進階圖（作者不扣點）。${fluxNote}請再按「產出小廣告」。`
      : body.credits != null
        ? `已換成進階圖，剩餘 ${body.credits} 點。${fluxNote}請再按「產出小廣告」。`
        : `已換成進階圖。${fluxNote}請再按「產出小廣告」。`;
    refreshPlan();
  } catch (err) {
    msg.textContent = err.message || '生圖失敗';
  } finally {
    clearInterval(clock);
    btn.disabled = false;
    btn.textContent = '換靜態圖（扣 1 點）';
  }
});

document.getElementById('visionBtn').addEventListener('click', async () => {
  const msg = document.getElementById('visionMsg') || document.getElementById('publishMsg');
  let files = document.getElementById('photos').files;
  const btn = document.getElementById('visionBtn');
  if (!state.visionReady) {
    msg.textContent = '識圖文案暫時無法使用。可先自行填文案，或稍後再試。';
    return;
  }
  btn.disabled = true;
  btn.textContent = '識圖中…';
  try {
    if (!files.length) {
      msg.textContent = '未選圖，改用示範圖識圖…';
      await fetchDemoFiles(DEMOS[selectedStyle()] || DEMOS.grid);
      files = document.getElementById('photos').files;
    }
    msg.textContent = '正在依圖撰寫文案…';
    await writeCaptionFromFiles(files, { overwrite: true });
    msg.textContent = '文案已依圖填入上方欄位，可再改，然後按「產出小廣告」。';
    document.getElementById('ownCopy').scrollIntoView({ block: 'center' });
  } catch (err) {
    msg.textContent = err.message || '識圖失敗';
  } finally {
    btn.disabled = false;
    btn.textContent = 'AI 識圖寫文案';
  }
});

document.getElementById('musicStyleBtn').addEventListener('click', async () => {
  const btn = document.getElementById('musicStyleBtn');
  btn.disabled = true;
  btn.textContent = '撰寫中…';
  try {
    const res = await fetch('/api/clip/music-prompt', {
      method: 'POST',
      headers: clipAuthHeaders(true),
      body: JSON.stringify({
        product: document.getElementById('product').value.trim(),
        price: document.getElementById('price').value.trim(),
        hook: document.getElementById('hook').value.trim(),
        narration: (document.getElementById('narration') && document.getElementById('narration').value.trim()) || '',
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '配樂風格寫作失敗');
    const box = document.getElementById('musicPrompt');
    box.value = body.prompt || '';
    box.focus();
    box.select();
    try { await navigator.clipboard.writeText(box.value); } catch { /* 仍可手動複製 */ }
    showClipMsg(`${body.style || '已寫好配樂風格'}。已複製，請到 Suno 貼上編輯。`);
  } catch (err) {
    showClipMsg(err.message || '配樂風格寫作失敗');
  } finally {
    btn.disabled = false;
    btn.textContent = '寫配樂風格';
  }
});

document.getElementById('copyMusicBtn').addEventListener('click', async () => {
  const text = document.getElementById('musicPrompt').value.trim();
  if (!text) {
    showClipMsg('請先按「寫配樂風格」。');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showClipMsg('已複製。請到 Suno 貼上編輯，下載 .mp3 後再選自己的配樂。');
  } catch {
    document.getElementById('musicPrompt').select();
    showClipMsg('請用 Ctrl+C 複製，再到 Suno 貼上。');
  }
});

document.getElementById('musicBtn').addEventListener('click', () => {
  document.getElementById('music').click();
});

document.getElementById('music').addEventListener('change', () => {
  const file = document.getElementById('music').files[0];
  const btn = document.getElementById('musicBtn');
  const preview = document.getElementById('musicPreview');
  if (!file) {
    clearOwnMusic();
    showClipMsg('未選自己的檔。會改用上面點選的內建曲目。');
    return;
  }
  const ext = (file.name.match(/\.([^.]+)$/) || [])[1] || '';
  if (!acceptedAudioFile(file)) {
    document.getElementById('music').value = '';
    btn.textContent = '選自己的 MP3／WAV';
    setMusicHint(
      `「${file.name}」不能用。只接受 .mp3 或 .wav，且小於 8MB。現在這個是 ${ext ? '.' + ext : '沒有副檔名'}。`,
      'bad'
    );
    showClipMsg(`這個檔不能用。請換成 .mp3 或 .wav（小於 8MB）。`);
    return;
  }
  btn.textContent = `已選：${file.name}`;
  setMusicHint(`可以用：${file.name}（${formatFileSize(file.size)}）。產出時會蓋過上面的內建曲目，並裁成與片子同長。`, 'ok');
  showClipMsg(`可以用：${file.name}。請確認你有權使用這段音樂。`);
  playMusicPreview(URL.createObjectURL(file), file.name);
});

document.getElementById('demoBtn').addEventListener('click', async () => {
  document.getElementById('product').value = '手沖咖啡豆 200g';
  document.getElementById('price').value = '特價 380 元';
  document.getElementById('hook').value = '今天下單今晚烘';
  const msg = document.getElementById('publishMsg');
  msg.textContent = '載入示範圖…';
  try {
    const files = await fetchDemoFiles(DEMOS[selectedStyle()] || DEMOS.grid);
    await buildFromFiles(files);
  } catch (err) {
    msg.textContent = err.message || '示範失敗';
  }
});

document.getElementById('preview').addEventListener('click', () => {
  const video = document.getElementById('preview');
  if (video.paused) video.play();
  else video.pause();
});

document.getElementById('caption').addEventListener('input', () => {
  document.getElementById('feedCaption').textContent = document.getElementById('caption').value;
});

document.getElementById('downloadMp4Btn').addEventListener('click', (event) => {
  if (event.currentTarget.classList.contains('is-wait')) event.preventDefault();
});

document.getElementById('copyCapBtn').addEventListener('click', async () => {
  const ok = await copyCaption();
  saveNote(ok ? '文案已複製，發文時直接貼上即可。' : '請手動複製文案。');
});

document.getElementById('shareBtn').addEventListener('click', async () => {
  const copied = await copyCaption();
  const stillFirst = state.style !== 'ugc';
  try {
    let blob = stillFirst ? state.posterBlob : (state.mp4Blob || null);
    let name = stillFirst ? 'mooseclip.jpg' : 'mooseclip.mp4';
    if (!stillFirst) {
      if (!blob && state.videoId && state.exportReady) {
        const res = await fetch(`/api/clip/media/${state.videoId}/mp4`);
        if (!res.ok) throw new Error('短片尚未就緒');
        blob = await res.blob();
        state.mp4Blob = blob;
        if (!/mp4/i.test(blob.type || '')) name = 'mooseclip.webm';
      }
      blob = blob || state.videoBlob;
      if (!/mp4/i.test(blob.type || '')) name = 'mooseclip.webm';
    }
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (!(navigator.canShare && navigator.canShare({ files: [file] }))) {
      saveNote('請改按下載，再開 IG 或 TikTok 上傳。' + (copied ? '文案已複製。' : ''));
      return;
    }
    await navigator.share({
      files: [file],
      text: document.getElementById('caption').value,
      title: document.getElementById('product').value.trim() || 'MooseClip',
    });
    saveNote(copied ? '已開啟傳送。請把複製好的文案貼到貼文。' : '已開啟傳送。請再複製文案貼上。');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    saveNote(err.message || '無法傳送，請改按下載。');
  }
});

document.getElementById('publishBtn')?.addEventListener('click', async () => {
  const msg = document.getElementById('publishMsg');
  const platforms = selectedPlatforms();
  if (!platforms.length) {
    msg.textContent = '請貼上帳號連結，或勾選平台。';
    return;
  }
  msg.textContent = '上傳並發送中…';
  try {
    await ensureUploaded();
    await fetch('/api/clip/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readLinks()),
    });
    const res = await fetch('/api/clip/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platforms,
        caption: document.getElementById('caption').value.trim(),
        imageIds: state.imageIds,
        videoId: state.videoId,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '發送失敗');
    msg.textContent = (body.results || []).map((row) => (
      row.ok ? `${row.platform} 已送出` : `${row.platform}：${row.error}`
    )).join(' ／ ');
  } catch (err) {
    msg.textContent = err.message || '發送失敗';
  }
});

document.getElementById('scheduleBtn')?.addEventListener('click', async () => {
  const msg = document.getElementById('publishMsg');
  const platforms = selectedPlatforms();
  const at = document.getElementById('sendAt').value;
  if (!platforms.length) {
    msg.textContent = '請貼上帳號連結，或勾選平台。';
    return;
  }
  if (!at) {
    msg.textContent = '請選擇發送時間。';
    return;
  }
  msg.textContent = '正在預約…';
  try {
    await ensureUploaded();
    const res = await fetch('/api/clip/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platforms,
        caption: document.getElementById('caption').value.trim(),
        imageIds: state.imageIds,
        videoId: state.videoId,
        at: new Date(at).toISOString(),
        links: readLinks(),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '預約失敗');
    renderQueue(body.queue || []);
    if (body.immediate) {
      const job = body.job || {};
      msg.textContent = job.status === 'sent' ? '已依選擇時間立即送出。' : (job.error || '已嘗試發送。');
    } else {
      msg.textContent = `已預約 ${new Date(at).toLocaleString('zh-Hant')} 自動發文。第一次請先按允許授權，到點才能真正發到帳號。`;
    }
  } catch (err) {
    msg.textContent = err.message || '預約失敗';
  }
});

['linkIg', 'linkThreads', 'linkFb', 'linkTk'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', checkFromLinks);
});

const CLIP_DRAFT_KEY = 'moose_clip_draft';
const CLIP_DRAFT_IDS = ['product', 'price', 'hook', 'narration', 'ownCopy', 'musicPrompt', 'musicUrl'];

function saveClipDraft() {
  const data = { musicPick: state.musicPick, style: state.style };
  CLIP_DRAFT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  try { sessionStorage.setItem(CLIP_DRAFT_KEY, JSON.stringify(data)); } catch { /* 略過 */ }
}

function restoreClipDraft() {
  let data;
  try { data = JSON.parse(sessionStorage.getItem(CLIP_DRAFT_KEY) || ''); } catch { data = null; }
  if (!data || typeof data !== 'object') return;
  CLIP_DRAFT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el && data[id]) el.value = data[id];
  });
  if (data.style) {
    state.style = data.style;
    document.querySelectorAll('#styleBtns .clip-type').forEach((el) => {
      el.classList.toggle('active', el.dataset.style === data.style);
    });
  }
  if (data.musicPick) {
    state.musicPick = data.musicPick;
    document.querySelectorAll('#musicPicks .clip-type').forEach((el) => {
      el.classList.toggle('active', el.dataset.music === data.musicPick);
    });
  }
}

CLIP_DRAFT_IDS.forEach((id) => {
  document.getElementById(id)?.addEventListener('input', saveClipDraft);
});
restoreClipDraft();
window.addEventListener('pagehide', saveClipDraft);

defaultSendAt();
refreshStatus();
const clipParams = new URLSearchParams(location.search);
const incomingShop = CLIP_CONNECT_OPEN ? (clipParams.get('shop') || '') : '';
const shopJustInstalled = incomingShop === '1';
const queryError = clipParams.get('error') || '';
if (CLIP_CONNECT_OPEN && incomingShop && incomingShop !== '1') {
  location.replace(`/api/clip/shop/install/shopify?${clipParams.toString()}`);
} else {
  if (/[?&]connected=/.test(location.search)) {
    document.getElementById('publishMsg').textContent = '帳號已連接。可勾選平台後發送。';
  }
  if (queryError && !/Shopify|商店|安裝/.test(queryError)) {
    document.getElementById('publishMsg').textContent = queryError;
  }
  if (clipParams.has('connected') || clipParams.has('error') || clipParams.has('shop')) {
    history.replaceState(null, '', '/clip');
  }
}

const shopState = { kind: 'shopify', shopifyApp: false };

function shopFieldsHtml(kind) {
  if (kind === 'shopify') {
    const appReady = shopState.shopifyApp;
    return `
      <p class="combo-fit">${appReady
        ? '填商店網域後按安裝，在 Shopify 畫面允許讀取商品即可。'
        : '目前請直接上傳圖片，或使用下方權杖自行連接商店。'}</p>
      <ol class="clip-help">
        <li>填入商店網域，例如 store.myshopify.com。</li>
        <li>按「安裝到 Shopify」，在後台按允許。</li>
        <li>回來後自動載入商品。點商品即可帶入上方出片。</li>
        <li>要發到 TK、IG、Threads、FB，請再到下方連接社群帳號。</li>
      </ol>
      <div class="skill-fields">
        <div><label class="field" for="shopDomain">Shopify 網域</label><input id="shopDomain" class="form-input" placeholder="store.myshopify.com" /></div>
      </div>
      <div class="admin-actions">
        <button class="btn btn-copper" type="button" id="shopifyInstallBtn"${appReady ? '' : ' disabled'}>安裝到 Shopify</button>
      </div>
      <details class="clip-adv">
        <summary>進階：用開發應用權杖（不走一鍵安裝）</summary>
        <ol class="clip-help">
          <li>後台「設定」→「應用程式和銷售管道」→「開發應用程式」→ 建立應用程式。</li>
          <li>開啟 Admin API，產品權限設為讀取，安裝應用程式。</li>
          <li>把 Admin API access token 填在下方，再按「載入商店商品」。</li>
        </ol>
        <div class="skill-fields">
          <div><label class="field" for="shopToken">Admin API 權杖</label><input id="shopToken" class="form-input" type="password" autocomplete="off" /></div>
        </div>
      </details>`;
  }
  if (kind === 'woocommerce') {
    return `
      <p class="combo-fit">請到 WordPress／WooCommerce 後台核發 REST API 金鑰後填入。</p>
      <ol class="clip-help">
        <li>WooCommerce → 設定 → 進階 → REST API → 新增金鑰。</li>
        <li>權限選讀取，產生後複製 Consumer key 與 Consumer secret。</li>
        <li>商店網址填前台網址（例如 https://shop.example.com），不要加 /wp-admin。</li>
        <li>按「載入商店商品」。</li>
      </ol>
      <div class="skill-fields">
        <div><label class="field" for="wooUrl">商店網址</label><input id="wooUrl" class="form-input" placeholder="https://your-store.com" /></div>
        <div><label class="field" for="wooKey">消費者金鑰（Consumer key）</label><input id="wooKey" class="form-input" autocomplete="off" /></div>
        <div><label class="field" for="wooSecret">消費者密鑰（Consumer secret）</label><input id="wooSecret" class="form-input" type="password" autocomplete="off" /></div>
      </div>`;
  }
  if (kind === 'generic') {
    return `
      <p class="combo-fit">適用沒有 Shopify／Woo 按鈕的平台。請提供商品列表的 JSON 網址。</p>
      <ol class="clip-help">
        <li>網址必須是 https，回傳 JSON 陣列，或包在 products、data、items 欄位裡。</li>
        <li>有權杖就填授權；欄位名稱依對方文件對應品名、價格、圖片。</li>
        <li>圖片欄位可填巢狀路徑，例如 images.0.src。</li>
      </ol>
      <div class="skill-fields">
        <div><label class="field" for="apiUrl">商品列表 API</label><input id="apiUrl" class="form-input" placeholder="https://api.example.com/products" /></div>
        <div><label class="field" for="apiToken">授權（選填）</label><input id="apiToken" class="form-input" type="password" autocomplete="off" placeholder="Bearer 或 token" /></div>
        <div><label class="field" for="apiListKey">列表欄位</label><input id="apiListKey" class="form-input" placeholder="products 或 data" /></div>
      </div>
      <div class="skill-fields">
        <div><label class="field" for="apiTitleKey">品名欄位</label><input id="apiTitleKey" class="form-input" placeholder="title" /></div>
        <div><label class="field" for="apiPriceKey">價格欄位</label><input id="apiPriceKey" class="form-input" placeholder="price" /></div>
        <div><label class="field" for="apiImageKey">圖片欄位</label><input id="apiImageKey" class="form-input" placeholder="images.0.src" /></div>
      </div>`;
  }
  return `
    <p class="combo-fit">這是練習用商品，點選即可帶入上方。實際開店請改選 Shopify，或直接上傳圖片。</p>`;
}

function renderShopFields() {
  document.getElementById('shopFields').innerHTML = shopFieldsHtml(shopState.kind);
}

function shopConnectBody() {
  const kind = shopState.kind;
  if (kind === 'shopify') {
    return { kind, shopDomain: document.getElementById('shopDomain')?.value.trim(), token: document.getElementById('shopToken')?.value.trim() };
  }
  if (kind === 'woocommerce') {
    return { kind, baseUrl: document.getElementById('wooUrl')?.value.trim(), key: document.getElementById('wooKey')?.value.trim(), secret: document.getElementById('wooSecret')?.value.trim() };
  }
  if (kind === 'generic') {
    return {
      kind,
      listUrl: document.getElementById('apiUrl')?.value.trim(),
      token: document.getElementById('apiToken')?.value.trim(),
      listKey: document.getElementById('apiListKey')?.value.trim(),
      titleKey: document.getElementById('apiTitleKey')?.value.trim() || 'title',
      priceKey: document.getElementById('apiPriceKey')?.value.trim() || 'price',
      imageKey: document.getElementById('apiImageKey')?.value.trim(),
    };
  }
  return { kind: 'demo' };
}

function esc(text) {
  return String(text || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function renderShopProducts(items) {
  const box = document.getElementById('shopProducts');
  if (!items.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = items.map((row) => `
    <button class="clip-product" type="button" data-id="${esc(row.id)}">
      ${row.image ? `<img src="${esc(row.image)}" alt="" />` : ''}
      <strong>${esc(row.title)}</strong>
      <span>${esc(row.price || '點此填入表單')}</span>
    </button>
  `).join('');
  box.querySelectorAll('.clip-product').forEach((btn) => {
    btn.addEventListener('click', () => useShopProduct(items.find((row) => String(row.id) === btn.dataset.id)));
  });
}

async function filesFromShop(product) {
  const files = [];
  for (const src of (product.images || []).slice(0, 5)) {
    const blob = await fetch(`/api/clip/shop/media?src=${encodeURIComponent(src)}`).then((r) => {
      if (!r.ok) throw new Error('商店商品圖讀取失敗');
      return r.blob();
    });
    const name = src.split('/').pop() || 'product.jpg';
    files.push(new File([blob], name, { type: blob.type || 'image/jpeg' }));
  }
  if (!files.length) throw new Error('此商品沒有圖片。可改為單獨上傳。');
  const dt = new DataTransfer();
  files.forEach((file) => dt.items.add(file));
  state.skipPhotoReset = true;
  document.getElementById('photos').files = dt.files;
  state.skipPhotoReset = false;
  return files;
}

async function useShopProduct(product) {
  if (!product) return;
  document.getElementById('product').value = product.title || '';
  document.getElementById('price').value = product.price || '';
  if (!document.getElementById('hook').value.trim()) document.getElementById('hook').value = '立即選購';
  const msg = document.getElementById('shopMsg');
  msg.textContent = '正在帶入商品圖…';
  try {
    await filesFromShop(product);
    msg.textContent = `已帶入「${product.title}」。可按上方「產出小廣告」，不必裝外掛。`;
    document.getElementById('clipForm').scrollIntoView({ block: 'start' });
  } catch (err) {
    msg.textContent = err.message || '帶入失敗';
  }
}

function setShopKind(kind) {
  shopState.kind = kind;
  document.querySelectorAll('#shopKindBtns .filter-btn').forEach((el) => el.classList.toggle('active', el.dataset.kind === kind));
  renderShopFields();
}

function installShopify() {
  const shop = document.getElementById('shopDomain')?.value.trim();
  const msg = document.getElementById('shopMsg');
  if (!shop) {
    msg.textContent = '請填商店網域，例如 store.myshopify.com';
    return;
  }
  if (!shopState.shopifyApp) {
    msg.textContent = '目前無法一鍵安裝。請用下方權杖，或直接上傳圖片。';
    return;
  }
  msg.textContent = '正在前往 Shopify 授權…';
  location.href = `/api/clip/shop/install/shopify?shop=${encodeURIComponent(shop)}`;
}

async function refreshShop() {
  renderShopFields();
  try {
    const st = await fetch('/api/clip/shop/status').then((r) => r.json());
    shopState.shopifyApp = Boolean(st.shopifyApp);
    if (st.connected && st.kind) setShopKind(st.kind);
    else renderShopFields();
    if (queryError && /Shopify|商店|安裝/.test(queryError)) {
      document.getElementById('shopMsg').textContent = queryError;
    }
    if (!st.connected) {
      if (!queryError) document.getElementById('shopMsg').textContent = shopState.shopifyApp
        ? '尚未安裝商店。填網域後按「安裝到 Shopify」，或直接在上方上傳圖片。'
        : '未連接商店。可直接在上方上傳圖片。';
      renderShopProducts([]);
      return;
    }
    const body = await fetch('/api/clip/shop/products').then((r) => r.json());
    if (body.error) throw new Error(body.error);
    document.getElementById('shopMsg').textContent = shopJustInstalled
      ? `已安裝 ${st.label || ''}，共 ${(body.products || []).length} 件。點商品出片後，再到下方連接社群即可發文。`
      : `已連接${st.label || ''}，共 ${(body.products || []).length} 件。點商品即可填表。`;
    renderShopProducts(body.products || []);
  } catch (err) {
    document.getElementById('shopMsg').textContent = err.message || '商店狀態讀取失敗';
  }
}

if (!CLIP_CONNECT_OPEN) {
  // 商店與社群連接建置中，審核通過後再開。
} else {
document.querySelectorAll('#shopKindBtns .filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => setShopKind(btn.dataset.kind));
});

document.getElementById('shopFields')?.addEventListener('click', (e) => {
  if (e.target.closest('#shopifyInstallBtn')) {
    e.preventDefault();
    installShopify();
  }
});

document.getElementById('shopConnectBtn')?.addEventListener('click', async () => {
  const msg = document.getElementById('shopMsg');
  if (shopState.kind === 'shopify' && !document.getElementById('shopToken')?.value.trim()) {
    installShopify();
    return;
  }
  msg.textContent = '載入商店中…';
  try {
    const res = await fetch('/api/clip/shop/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shopConnectBody()),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '連接失敗');
    msg.textContent = `已載入 ${ (body.products || []).length } 件商品。點選即可填入上方，再產出短片。`;
    renderShopProducts(body.products || []);
  } catch (err) {
    msg.textContent = err.message || '連接失敗';
  }
});

document.getElementById('shopDisconnectBtn')?.addEventListener('click', async () => {
  await fetch('/api/clip/shop/disconnect', { method: 'POST' });
  renderShopProducts([]);
  document.getElementById('shopMsg').textContent = '已中斷商店。可繼續單獨上傳圖片。';
});

refreshShop();
}
