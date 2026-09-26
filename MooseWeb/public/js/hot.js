function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function secondsLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '20–30秒';
  if (/秒|分鐘|分/.test(text)) return text;
  return `${text}秒`;
}

function paintItems(rows, heading) {
  if (!rows || !rows.length) return '';
  const cards = rows.map((row, i) => `
    <section class="live-ep">
      <h3>${i + 1}. ${escapeHtml(row.q)}</h3>
      <p>建議時長 ${escapeHtml(secondsLabel(row.seconds))}　${escapeHtml(row.when || '')}</p>
      <p><strong>為什麼現在有人問</strong><br />${escapeHtml(row.why)}</p>
      <p><strong>開頭怎麼講</strong><br />${escapeHtml(row.hook)}</p>
      <p><strong>鏡頭怎麼拍</strong><br />${escapeHtml(row.how)}</p>
      <p><strong>收尾</strong><br />${escapeHtml(row.cta)}</p>
    </section>
  `).join('');
  return `<section class="live-ep"><h3>${escapeHtml(heading)}</h3></section>${cards}`;
}

function resultHtml(data) {
  const sources = (data.sources || []).filter(Boolean);
  return `
    ${data.thin ? `<section class="live-ep"><p>${escapeHtml(data.thin)}</p></section>` : ''}
    ${paintItems(data.taiwan, '台灣現在常問')}
    ${paintItems(data.foreign, '國外近一年可拍的思維')}
    ${sources.length ? `<section class="live-ep"><h3>這次有對到的公開來源</h3><p>${sources.map((row) => escapeHtml(row)).join('　／　')}</p></section>` : ''}
  `;
}

function formatAll(data) {
  const block = (rows, title) => (rows || []).map((row, i) => [
    `${title}${i + 1}. ${row.q || ''}（${secondsLabel(row.seconds)}／${row.when || ''}）`,
    `為什麼：${row.why || ''}`,
    `開頭：${row.hook || ''}`,
    `怎麼拍：${row.how || ''}`,
    `收尾：${row.cta || ''}`,
  ].join('\n')).join('\n\n');
  return [
    `熱問短片｜${data.topic || ''}`,
    data.live ? '這次有搜公開網頁。' : '這次沒搜到即時網頁，題目偏常見問法。',
    data.thin || '',
    '',
    block(data.taiwan, '台灣　'),
    '',
    block(data.foreign, '國外　'),
    '',
    (data.sources || []).length ? `來源：${(data.sources || []).join('、')}` : '',
  ].filter((line, i, arr) => line || arr[i - 1]).join('\n');
}

function paintResult(data) {
  document.getElementById('outName').textContent = data.topic ? `${data.topic}｜現在能拍的題` : '熱問短片';
  document.getElementById('outLine').textContent = data.live
    ? '這次有搜公開網頁，不是固定題庫。'
    : '這次沒搜到即時網頁，題目偏常見問法，請稍後再試一次。';
  document.getElementById('hotOut').innerHTML = resultHtml(data);
  document.getElementById('resultBox').classList.remove('hidden');
  window.lastHot = data;
}

async function refreshPlan() {
  const bar = document.getElementById('hotPlan');
  if (!bar) return;
  try {
    const data = await fetch('/api/hot/status').then((r) => r.json());
    if (!data.ready) {
      bar.textContent = '熱問暫時無法使用，請稍後再試。';
      return;
    }
    bar.textContent = `今日尚可免費產出 ${data.left}／${data.limit} 則。與口播腳本、直播稿、個人IP共用次數。`;
  } catch {
    bar.textContent = '每日可免費產出 20 則。';
  }
}

async function makeHot() {
  const msg = document.getElementById('hotMsg');
  const btn = document.getElementById('makeBtn');
  const topic = document.getElementById('topic').value.trim();
  const scope = document.getElementById('scope').value;
  if (topic.length < 2) {
    msg.textContent = '請寫行業或主題，例如餐廳。';
    return;
  }
  document.getElementById('resultBox').classList.add('hidden');
  msg.textContent = '正在搜公開網頁並整理題目，約一分鐘，請不要重按。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/hot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, scope }),
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

document.getElementById('hotForm').addEventListener('submit', (e) => {
  e.preventDefault();
  makeHot();
});

document.getElementById('makeBtn').addEventListener('click', (e) => {
  e.preventDefault();
  makeHot();
});

document.getElementById('topic').addEventListener('input', () => {
  document.getElementById('resultBox').classList.add('hidden');
});

document.getElementById('demoBtn').addEventListener('click', () => {
  document.getElementById('topic').value = '餐廳';
  document.getElementById('scope').value = 'both';
  makeHot();
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const note = document.getElementById('copyMsg');
  if (!window.lastHot) {
    note.textContent = '請先產出熱問。';
    return;
  }
  try {
    await navigator.clipboard.writeText(formatAll(window.lastHot));
    note.textContent = '已複製。';
  } catch {
    note.textContent = '複製失敗，請自行選取文字。';
  }
});

function fileName(data) {
  const name = String(data && data.topic || '熱問短片').replace(/[\\/:*?"<>|]/g, '').trim() || '熱問短片';
  return `${name}-熱問.pdf`;
}

document.getElementById('downloadBtn').addEventListener('click', async () => {
  const note = document.getElementById('copyMsg');
  const data = window.lastHot;
  if (!data) {
    note.textContent = '請先產出熱問。';
    return;
  }
  if (typeof html2pdf !== 'function') {
    note.textContent = 'PDF 套件尚未載入，請稍後再試，或先複製全部。';
    return;
  }
  note.textContent = '正在做成 PDF，請稍候。';
  const hold = document.createElement('div');
  hold.style.cssText = 'position:fixed;left:-12000px;top:0;width:720px;background:#fff;';
  hold.innerHTML = `
    <style>
      .hot-print { font-family: "Noto Sans TC","Microsoft JhengHei",sans-serif; color:#1a1a1a; background:#fff; padding:8px 4px 24px; font-size:13px; line-height:1.65; }
      .hot-print h1 { font-size:22px; margin:0 0 8px; }
      .hot-print .lead { margin:0 0 16px; }
      .hot-print h3 { font-size:15px; margin:0 0 8px; }
      .hot-print section { page-break-inside: avoid; margin:0 0 16px; }
      .hot-print p { margin:0 0 8px; }
    </style>
    <article class="hot-print">
      <h1>${escapeHtml(data.topic || '熱問短片')}</h1>
      <p class="lead">${data.live ? '這次有搜公開網頁。' : '這次沒搜到即時網頁，題目偏常見問法。'}</p>
      ${resultHtml(data)}
    </article>
  `;
  document.body.appendChild(hold);
  try {
    await html2pdf().set({
      margin: [12, 12, 14, 12],
      filename: fileName(data),
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(hold.querySelector('.hot-print')).save();
    note.textContent = '已開始下載 PDF。';
  } catch {
    note.textContent = 'PDF 下載失敗，請改複製全部。';
  } finally {
    hold.remove();
  }
});

refreshPlan();
