const HOOKS = [
  { key: 'pain', label: '🔥 痛點／共鳴型', hint: '戳中痛點或引發集體共鳴' },
  { key: 'curiosity', label: '💡 顛覆認知／好奇心型', hint: '讓人忍不住想點開看原因' },
  { key: 'story', label: '✍️ 故事／沉浸感型', hint: '帶入畫面感或情境' },
  { key: 'value', label: '⚡ 乾貨／實用價值型', hint: '直接給予好處或解決方案' },
  { key: 'quote', label: '🎯 金句／情感共鳴型', hint: '高質感、適合 IG 排版的短句' },
  { key: 'comment', label: '💬 留言／互動型', hint: '' },
];

const TAGS = [
  { key: 'broad', label: '大眾熱門標籤（流量池大）' },
  { key: 'niche', label: '精準分眾標籤（鎖定受眾）' },
  { key: 'vibe', label: '風格／情境標籤（增加質感）' },
];

let photo = '';
let last = null;

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hashLine(list) {
  return (list || []).map((tag) => `#${tag}`).join(' ');
}

function formatPlatform(pack) {
  const hooks = HOOKS.map((row) => `* **${row.label}**\n  * 「${pack.hooks[row.key]}」`).join('\n');
  const tags = TAGS.map((row) => `* **${row.label}**: ${hashLine(pack.tags[row.key])}`).join('\n');
  return [
    `## ${pack.name}`,
    '### 🪝 爆款鉤子標題（6種風格）',
    hooks,
    '',
    '### 🏷️ 流量 Hashtags 組合',
    tags,
  ].join('\n');
}

function formatAll(data) {
  const blocks = (data.platforms || []).map(formatPlatform).join('\n\n');
  return [
    '### 📸 圖片視覺解析',
    data.visual,
    '',
    blocks,
  ].join('\n');
}

function fileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('圖片讀取失敗，請換一張 JPG 或 PNG。'));
    };
    img.src = url;
  });
}

function paintPhoto() {
  const box = document.getElementById('photoPreview');
  if (!photo) {
    box.innerHTML = '';
    box.classList.add('hidden');
    return;
  }
  box.innerHTML = `<img src="${photo}" alt="要分析的照片" style="width:160px;height:160px;object-fit:cover;border-radius:12px;" />`;
  box.classList.remove('hidden');
}

function paintPack(pack) {
  const hooks = HOOKS.map((row) => {
    const line = String((pack.hooks && pack.hooks[row.key]) || '').trim();
    if (!line) return '';
    return `
    <section class="live-ep">
      <h3>${escapeHtml(row.label)}</h3>
      <p>「${escapeHtml(line)}」</p>
      <div class="admin-actions"><button class="btn btn-cream" type="button" data-copy-hook="${escapeHtml(pack.id)}:${row.key}">複製這句</button></div>
    </section>
  `;
  }).join('');
  const tags = TAGS.map((row) => `
    <p><strong>${escapeHtml(row.label)}</strong><br />${escapeHtml(hashLine(pack.tags[row.key]))}</p>
  `).join('');
  return `
    <section class="live-ep">
      <h3>${escapeHtml(pack.name)}</h3>
      <div class="admin-actions"><button class="btn btn-copper" type="button" data-copy-platform="${escapeHtml(pack.id)}">複製${escapeHtml(pack.name)}</button></div>
    </section>
    ${hooks}
    <section class="live-ep">
      <h3>🏷️ ${escapeHtml(pack.name)} Hashtags</h3>
      ${tags}
    </section>
  `;
}

function paintResult(data) {
  const packs = (data.platforms || []).map(paintPack).join('');
  document.getElementById('outBody').innerHTML = `
    <section class="live-ep">
      <h3>📸 圖片視覺解析</h3>
      <p>${escapeHtml(data.visual)}</p>
    </section>
    ${packs}
  `;
  document.getElementById('copyMsg').textContent = '';
  document.getElementById('resultBox').classList.remove('hidden');
  last = data;
}

async function refreshPlan() {
  const bar = document.getElementById('hookPlan');
  try {
    const data = await fetch('/api/hook/status').then((r) => r.json());
    setAgentPlanBar(bar, data, { notReady: '爆文鉤子暫時無法使用，請稍後再試。' });
  } catch {
    bar.textContent = '未購方案者，此智能體可試用 1 次。';
  }
}

function selectedPlatforms() {
  return Array.from(document.querySelectorAll('#platformPick input:checked')).map((el) => el.value);
}

async function makeHook() {
  const msg = document.getElementById('hookMsg');
  const btn = document.getElementById('makeBtn');
  const platforms = selectedPlatforms();
  if (!platforms.length) {
    msg.textContent = '請勾選至少一個平台。';
    return;
  }
  if (!photo) {
    msg.textContent = '請先上傳一張要發的照片。';
    return;
  }
  msg.textContent = platforms.length > 1 ? '正在看圖，依勾選的平台分別寫，約 20 秒。' : '正在看圖並寫標題，約 15 秒。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/hook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platforms,
        note: document.getElementById('note').value.trim(),
        image: photo,
      }),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('連線中斷，請再按一次。');
    }
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

document.getElementById('photo').addEventListener('change', async (e) => {
  const file = (e.target.files || [])[0];
  const msg = document.getElementById('hookMsg');
  e.target.value = '';
  if (!file) return;
  try {
    photo = await fileToJpegDataUrl(file);
    paintPhoto();
    msg.textContent = '';
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById('makeBtn').addEventListener('click', makeHook);
document.getElementById('againBtn').addEventListener('click', makeHook);
document.getElementById('hookForm').addEventListener('submit', (e) => {
  e.preventDefault();
  makeHook();
});

function findPack(id) {
  return (last && last.platforms || []).find((pack) => pack.id === id);
}

document.getElementById('outBody').addEventListener('click', async (e) => {
  const note = document.getElementById('copyMsg');
  const platformBtn = e.target.closest('[data-copy-platform]');
  const hookBtn = e.target.closest('[data-copy-hook]');
  if ((!platformBtn && !hookBtn) || !last) return;
  let text = '';
  let done = '';
  if (platformBtn) {
    const pack = findPack(platformBtn.dataset.copyPlatform);
    if (!pack) return;
    text = formatPlatform(pack);
    done = `已複製${pack.name}。`;
  } else {
    const [id, key] = String(hookBtn.dataset.copyHook || '').split(':');
    const pack = findPack(id);
    if (!pack) return;
    text = pack.hooks[key] || '';
    done = '已複製這句。';
  }
  try {
    await navigator.clipboard.writeText(text);
    note.textContent = done;
  } catch {
    note.textContent = '複製失敗，請自行選取文字。';
  }
});

document.getElementById('copyAllBtn').addEventListener('click', async () => {
  const note = document.getElementById('copyMsg');
  if (!last) return;
  try {
    await navigator.clipboard.writeText(formatAll(last));
    note.textContent = '已複製全部。';
  } catch {
    note.textContent = '複製失敗，請自行選取文字。';
  }
});

refreshPlan();
