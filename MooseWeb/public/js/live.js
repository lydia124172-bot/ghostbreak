const DEMO_TRADE = {
  industry: '保健食品',
  product: '',
  notes: '先搞懂是什麼再決定要不要吃。不要講療效。',
};

const DEMO_PRODUCT = {
  industry: '保健食品',
  product: '蜂膠 12 條獨立包裝',
  notes: '先看成分與使用方式，不要只看濃度數字。',
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatAll(data) {
  const rows = (data.episodes || []).map((ep) => [
    `${ep.no}｜${ep.title || ''}`,
    `內容類型：${ep.kind || ''}｜成交目的：${ep.goal || ''}`,
    `建議時長：${ep.duration || ''}｜拍攝風格：${ep.style || ''}`,
    '',
    '開頭鉤子',
    ep.hook || '',
    '',
    '完整口播',
    ep.voice || '',
    '',
    '拍攝提醒',
    ep.shots || '',
    '',
    '收尾CTA',
    ep.cta || '',
  ].join('\n'));
  return [`${data.headline || '直播稿'}`, data.angle || '', '', ...rows].filter((line, i, arr) => line || arr[i - 1]).join('\n');
}

function paintResult(data) {
  document.getElementById('outHeadline').textContent = data.headline || '十二則直播稿';
  document.getElementById('outAngle').textContent = data.angle || '';
  document.getElementById('episodeList').innerHTML = (data.episodes || []).map((ep) => `
    <section class="live-ep">
      <h3>${escapeHtml(ep.no)}｜${escapeHtml(ep.title)}</h3>
      <p>內容類型：${escapeHtml(ep.kind)}｜成交目的：${escapeHtml(ep.goal)}</p>
      <p>建議時長：${escapeHtml(ep.duration)}｜拍攝風格：${escapeHtml(ep.style)}</p>
      <p><strong>開頭鉤子</strong><br />${escapeHtml(ep.hook)}</p>
      <p><strong>完整口播</strong><br />${escapeHtml(ep.voice)}</p>
      <p><strong>拍攝提醒</strong><br />${escapeHtml(ep.shots)}</p>
      <p><strong>收尾CTA</strong><br />${escapeHtml(ep.cta)}</p>
    </section>
  `).join('');
  document.getElementById('resultBox').classList.remove('hidden');
  window.lastLive = data;
}

async function refreshPlan() {
  const bar = document.getElementById('livePlan');
  if (!bar) return;
  try {
    const data = await fetch('/api/live/status').then((r) => r.json());
    if (!data.ready) {
      bar.textContent = '直播稿暫時無法使用，請稍後再試。';
      return;
    }
    bar.textContent = `今日尚可免費產出 ${data.left}／${data.limit} 則。與口播腳本共用次數。`;
  } catch {
    bar.textContent = '每日可免費產出 20 則。';
  }
}

async function makeLive() {
  const msg = document.getElementById('liveMsg');
  const btn = document.getElementById('makeBtn');
  const industry = document.getElementById('industry').value.trim();
  const product = document.getElementById('product').value.trim();
  const notes = document.getElementById('notes').value.trim();
  if (!industry && !product && !notes) {
    msg.textContent = '請選行業別，或填商品名稱。';
    return;
  }
  if (industry === '其他' && !product && !notes) {
    msg.textContent = '選其他時，請填商品名稱或要講的重點。';
    return;
  }
  msg.textContent = '產出十二則中，約半分鐘，請不要重按。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry, product, notes }),
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

function fillDemo(demo) {
  document.getElementById('industry').value = demo.industry;
  document.getElementById('product').value = demo.product;
  document.getElementById('notes').value = demo.notes;
}

document.getElementById('liveForm').addEventListener('submit', (e) => {
  e.preventDefault();
  makeLive();
});

document.getElementById('demoTradeBtn').addEventListener('click', () => {
  fillDemo(DEMO_TRADE);
  makeLive();
});

document.getElementById('demoProductBtn').addEventListener('click', () => {
  fillDemo(DEMO_PRODUCT);
  makeLive();
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const note = document.getElementById('copyMsg');
  if (!window.lastLive) {
    note.textContent = '請先產出直播稿。';
    return;
  }
  try {
    await navigator.clipboard.writeText(formatAll(window.lastLive));
    note.textContent = '已複製十二則直播稿。';
  } catch {
    note.textContent = '複製失敗，請自行選取文字。';
  }
});

refreshPlan();
