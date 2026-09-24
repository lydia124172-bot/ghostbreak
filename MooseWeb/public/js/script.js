const DEMO = {
  product: '手沖咖啡豆 200g',
  features: '單品、下單當天烘焙、適合新手手沖',
  photos: ['product-1.jpg', 'product-2.jpg'],
};

const DEMO_TALK = {
  product: '客人先信你這個人',
  features: '開店先把信任講清楚。不要一開口就推商品。講完給一句可記住的下一步。',
};

function selectedMode() {
  return document.querySelector('input[name="scriptMode"]:checked')?.value || 'sell';
}

function setMode(value) {
  const el = document.querySelector(`input[name="scriptMode"][value="${value}"]`);
  if (el) el.checked = true;
}

function escapeText(value) {
  return String(value || '');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = escapeText(value);
}

function formatScript(data) {
  const s = data.script || {};
  const v = data.visual || {};
  const a = data.audio || {};
  return [
    '一、影片視覺與鏡頭設計',
    `黃金前 3 秒：${v.open3s || ''}`,
    `運鏡運作：${v.camera || ''}`,
    '',
    '二、爆款真人口播文案',
    `00:00–00:03　${s.hook || ''}`,
    `00:03–00:15　${s.pain || ''}`,
    `00:15–00:25　${s.cta || ''}`,
    '',
    '三、節奏與音效建議',
    `背景音樂：${a.bgm || ''}`,
    `關鍵音效：${a.sfx || ''}`,
  ].join('\n');
}

function paintResult(data) {
  setText('outOpen', data.visual?.open3s);
  setText('outCamera', data.visual?.camera);
  setText('outHook', data.script?.hook);
  setText('outPain', data.script?.pain);
  setText('outCta', data.script?.cta);
  setText('outBgm', data.audio?.bgm);
  setText('outSfx', data.audio?.sfx);
  document.getElementById('resultBox').classList.remove('hidden');
  window.lastScript = data;
}

function fileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 768 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => reject(new Error('圖片讀取失敗'));
    img.src = url;
  });
}

async function fetchDemoFiles() {
  const files = [];
  for (const name of DEMO.photos) {
    const blob = await fetch(`/clip-demo/${name}`).then((r) => {
      if (!r.ok) throw new Error('示範圖讀取失敗');
      return r.blob();
    });
    files.push(new File([blob], name, { type: blob.type || 'image/jpeg' }));
  }
  const dt = new DataTransfer();
  files.forEach((file) => dt.items.add(file));
  document.getElementById('photos').files = dt.files;
  return files;
}

async function refreshPlan() {
  const bar = document.getElementById('scriptPlan');
  if (!bar) return;
  try {
    const data = await fetch('/api/script/status').then((r) => r.json());
    if (!data.ready) {
      bar.textContent = '腳本暫時無法使用，請稍後再試。';
      return;
    }
    bar.textContent = `今日尚可免費產出 ${data.left}／${data.limit} 則。做成短片請用法付費工具。`;
  } catch {
    bar.textContent = '每日可免費產出 20 則。';
  }
}

async function makeScript() {
  const msg = document.getElementById('scriptMsg');
  const btn = document.getElementById('makeBtn');
  const product = document.getElementById('product').value.trim();
  const features = document.getElementById('features').value.trim();
  const mode = selectedMode();
  const files = [...document.getElementById('photos').files];
  if (!product && !features && !files.length) {
    msg.textContent = '請填商品名稱、主題，或要講的內容。';
    return;
  }
  if (mode === 'sell' && !product && !files.length) {
    msg.textContent = '帶貨請填商品名稱，或上傳商品圖。';
    return;
  }
  if (mode === 'talk' && !product && !features) {
    msg.textContent = '純說話請填主題，或要講的內容。';
    return;
  }
  msg.textContent = '產出中…';
  btn.disabled = true;
  try {
    const images = [];
    for (const file of files.slice(0, 3)) images.push(await fileToJpegDataUrl(file));
    const res = await fetch('/api/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product, features, mode, images }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '產出失敗');
    paintResult(body);
    msg.textContent = '';
    refreshPlan();
  } catch (err) {
    msg.textContent = err.message || '產出失敗';
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('scriptForm').addEventListener('submit', (e) => {
  e.preventDefault();
  makeScript();
});

document.getElementById('demoBtn').addEventListener('click', async () => {
  setMode('sell');
  document.getElementById('product').value = DEMO.product;
  document.getElementById('features').value = DEMO.features;
  const msg = document.getElementById('scriptMsg');
  try {
    await fetchDemoFiles();
  } catch (err) {
    msg.textContent = err.message || '示範圖讀取失敗';
    return;
  }
  makeScript();
});

document.getElementById('demoTalkBtn')?.addEventListener('click', () => {
  setMode('talk');
  document.getElementById('product').value = DEMO_TALK.product;
  document.getElementById('features').value = DEMO_TALK.features;
  const photos = document.getElementById('photos');
  photos.value = '';
  makeScript();
});

function voiceOnly(data) {
  const s = data.script || {};
  return [s.hook, s.pain, s.cta].filter(Boolean).join('');
}

document.getElementById('copyVoiceBtn')?.addEventListener('click', async () => {
  const note = document.getElementById('copyMsg');
  if (!window.lastScript) {
    note.textContent = '請先產出腳本。';
    return;
  }
  try {
    await navigator.clipboard.writeText(voiceOnly(window.lastScript));
    note.textContent = '已複製口播台詞。對嘴頁約 10 秒、280 字，可貼進去再刪到合適長度。';
  } catch {
    note.textContent = '複製失敗，請自行選取文字。';
  }
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const note = document.getElementById('copyMsg');
  if (!window.lastScript) {
    note.textContent = '請先產出腳本。';
    return;
  }
  try {
    await navigator.clipboard.writeText(formatScript(window.lastScript));
    note.textContent = '已複製。';
  } catch {
    note.textContent = '複製失敗，請自行選取文字。';
  }
});

refreshPlan();
