const DEMO = {
  bio: '我是餐廳老闆，用商業思維經營實體門市，也自己開箱帶貨。粉專要做 Reels 開箱、直播餐廳，並說明我怎麼用 AI 把人導到 LINE。',
  fans: '臉書粉專 10 人、已發 200 則；IG、TikTok、YouTube、Threads 幾乎沒在養',
  goal: '臉書先到 1000 粉，成交導到 LINE',
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function secondsLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '15–20秒';
  if (/秒|分鐘|分/.test(text)) return text;
  return `${text}秒`;
}

function formatDays(rows, heading) {
  const days = (rows || []).map((row) => [
    `第${row.day}天｜${row.title || ''}（${row.type || ''}／${secondsLabel(row.seconds)}／先發${row.place || ''}）`,
    `開頭：${row.hook || ''}`,
    `怎麼拍：${row.how || ''}`,
    `這支發到其他平台時：${row.adapt || ''}`,
  ].join('\n')).join('\n\n');
  return days ? `${heading}\n${days}` : heading;
}

function formatAll(data) {
  const dos = (data.do || []).filter(Boolean).map((row) => `要：${row}`).join('\n');
  const donts = (data.dont || []).filter(Boolean).map((row) => `不要：${row}`).join('\n');
  const path = data.path || {};
  const after = data.after || {};
  const later = data.weeks || {};
  const ch = (data.channels || []).map((row) => [
    `${row.name}`,
    `特色：${row.trait || ''}`,
    `誰在這：${row.who || ''}`,
    `演算法：${row.algo || ''}`,
    `直播：${row.live || ''}`,
    `為何這樣開：${row.liveWhy || ''}`,
    `你的任務：${row.role || ''}`,
    `節奏：${row.cadence || ''}`,
    `拍法：${row.film || ''}`,
    `收尾：${row.cta || ''}`,
  ].join('\n')).join('\n\n');
  const names = (data.names || []).filter(Boolean).map((row, i) => `${i + 1}. ${row}`).join('\n');
  return [
    data.name || '個人IP',
    names ? `建議名稱\n${names}` : '',
    data.oneLiner || '',
    '',
    `給誰：${data.audience || ''}`,
    `提供：${data.offer || ''}`,
    `語氣：${data.voice || ''}`,
    `主場：${data.home || ''}。${data.homeWhy || ''}`,
    '',
    data.marks ? `只有你能拍：地點 ${data.marks.place || ''}；道具 ${data.marks.prop || ''}；開頭句 ${data.marks.line || ''}；找 ${data.marks.people || ''} 出鏡。不要拍：${data.marks.forbid || ''}` : '',
    (data.next || []).filter(Boolean).length ? `下個月還能拍：${(data.next || []).filter(Boolean).join('、')}` : '',
    '',
    `漲粉路徑：現在 ${path.now || ''} → 目標 ${path.target || ''}（${path.stage || ''}，約 ${path.weeks || ''}）`,
    path.seed || '',
    path.weekly || '',
    '',
    dos,
    donts,
    '',
    '各平台分析',
    ch,
    '',
    formatDays(data.week, '第一週開工表（站定、出臉、單鏡頭、邀熟人）'),
    '',
    formatDays(later.week2, `第2週每日攻略（${after.week2 || '比第一週難：鉤子、切鏡、直播後剪3支'}）`),
    '',
    formatDays(later.week3, `第3週每日攻略（${after.week3 || '再難：看完播、重發、互推'}）`),
    '',
    formatDays(later.week4, `第4週每日攻略（${after.week4 || '最難：比封面、固定時段、練成交'}）`),
    '',
    `第4週之後（維持第4週七天難度，不要退回第一週）\n${after.loop || ''}`,
  ].filter((line, i, arr) => line || arr[i - 1]).join('\n');
}

function paintDays(rows, heading, note) {
  const intro = `
    <section class="live-ep">
      <h3>${escapeHtml(heading)}</h3>
      ${note ? `<p>${escapeHtml(note)}</p>` : ''}
    </section>
  `;
  const days = (rows || []).map((row) => `
    <section class="live-ep">
      <h3>第${escapeHtml(row.day)}天｜${escapeHtml(row.title)}</h3>
      <p>內容：${escapeHtml(row.type)}　建議時長 ${escapeHtml(secondsLabel(row.seconds))}　先發到：${escapeHtml(row.place)}</p>
      <p><strong>開頭怎麼講</strong><br />${escapeHtml(row.hook)}</p>
      <p><strong>鏡頭怎麼拍</strong><br />${escapeHtml(row.how)}</p>
      <p><strong>這支發到其他平台時怎麼做</strong><br />${escapeHtml(row.adapt)}</p>
    </section>
  `).join('');
  return intro + days;
}

function resultHtml(data) {
  const dos = (data.do || []).filter(Boolean).map((row) => `<li>要：${escapeHtml(row)}</li>`).join('');
  const donts = (data.dont || []).filter(Boolean).map((row) => `<li>不要：${escapeHtml(row)}</li>`).join('');
  const path = data.path || {};
  const after = data.after || {};
  const later = data.weeks || {};
  const channels = (data.channels || []).map((row) => `
    <section class="live-ep">
      <h3>${escapeHtml(row.name)}</h3>
      <p><strong>平台特色</strong><br />${escapeHtml(row.trait)}</p>
      <p><strong>誰在這裡</strong><br />${escapeHtml(row.who)}</p>
      <p><strong>演算法吃什麼</strong><br />${escapeHtml(row.algo)}</p>
      <p><strong>直播</strong><br />${escapeHtml(row.live)}</p>
      <p><strong>為何這樣開</strong><br />${escapeHtml(row.liveWhy)}</p>
      <p><strong>你在此階段的任務</strong><br />${escapeHtml(row.role)}</p>
      <p><strong>節奏</strong><br />${escapeHtml(row.cadence)}</p>
      <p><strong>拍法</strong><br />${escapeHtml(row.film)}</p>
      <p><strong>收尾</strong><br />${escapeHtml(row.cta)}</p>
    </section>
  `).join('');
  return `
    <section class="live-ep">
      <p>建議名稱：${(data.names || []).filter(Boolean).map((row) => escapeHtml(row)).join('　／　')}</p>
      <p>給誰：${escapeHtml(data.audience)}</p>
      <p>提供：${escapeHtml(data.offer)}</p>
      <p>語氣：${escapeHtml(data.voice)}</p>
      <p>主場：${escapeHtml(data.home)}。${escapeHtml(data.homeWhy)}</p>
      <p><strong>只有你能拍</strong><br />地點：${escapeHtml((data.marks && data.marks.place) || '')}　道具：${escapeHtml((data.marks && data.marks.prop) || '')}<br />開頭句：${escapeHtml((data.marks && data.marks.line) || '')}<br />找誰出鏡：${escapeHtml((data.marks && data.marks.people) || '')}<br />不要拍：${escapeHtml((data.marks && data.marks.forbid) || '')}</p>
      ${(data.next || []).filter(Boolean).length ? `<p><strong>做完一個月之後還能拍</strong><br />${(data.next || []).filter(Boolean).map((row) => escapeHtml(row)).join('　／　')}</p>` : ''}
      <p><strong>漲粉路徑</strong><br />現在 ${escapeHtml(path.now)} → 目標 ${escapeHtml(path.target)}（${escapeHtml(path.stage)}，約 ${escapeHtml(path.weeks)}）</p>
      <p>${escapeHtml(path.seed)}</p>
      <p>${escapeHtml(path.weekly)}</p>
      <ul>${dos}${donts}</ul>
    </section>
    ${channels}
    ${paintDays(data.week, '第一週開工表', '站定、出臉、單鏡頭、邀熟人。先學會每天出鏡。')}
    ${paintDays(later.week2, '第2週每日攻略', after.week2 || '比第一週難：前3秒鉤子、兩鏡頭切、直播後當天剪3支。')}
    ${paintDays(later.week3, '第3週每日攻略', after.week3 || '再難：看完播、重發最好的題、加互推或店內QR。')}
    ${paintDays(later.week4, '第4週每日攻略', after.week4 || '最難：比封面、固定直播時段、把成交動作練熟。')}
    <section class="live-ep">
      <h3>第4週之後</h3>
      <p>${escapeHtml(after.loop || '之後每週重複第4週這七天的難度與拍法，只換題材，不要退回第一週的單鏡頭站定。')}</p>
    </section>
  `;
}

function paintResult(data) {
  document.getElementById('outName').textContent = data.name || '你的個人IP';
  document.getElementById('outLine').textContent = data.oneLiner || '';
  document.getElementById('ipOut').innerHTML = resultHtml(data);
  document.getElementById('resultBox').classList.remove('hidden');
  window.lastIp = data;
}

async function refreshPlan() {
  const bar = document.getElementById('ipPlan');
  if (!bar) return;
  try {
    const data = await fetch('/api/ip/status').then((r) => r.json());
    if (!data.ready) {
      bar.textContent = '個人IP暫時無法使用，請稍後再試。';
      return;
    }
    bar.textContent = `今日尚可免費產出 ${data.left}／${data.limit} 則。與口播腳本、直播稿共用次數。`;
  } catch {
    bar.textContent = '每日可免費產出 20 則。';
  }
}

async function makeIp() {
  const msg = document.getElementById('ipMsg');
  const btn = document.getElementById('makeBtn');
  const bio = document.getElementById('bio').value.trim();
  const fans = document.getElementById('fans').value.trim();
  const goal = document.getElementById('goal').value.trim();
  if (bio.length < 2) {
    msg.textContent = '請寫你的職業或簡介，例如房仲。';
    return;
  }
  document.getElementById('resultBox').classList.add('hidden');
  msg.textContent = '產出四週每日攻略中，約兩分鐘，請不要重按。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/ip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio, fans, goal }),
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

document.getElementById('ipForm').addEventListener('submit', (e) => {
  e.preventDefault();
  makeIp();
});

document.getElementById('bio').addEventListener('input', () => {
  document.getElementById('resultBox').classList.add('hidden');
});

document.getElementById('demoBtn').addEventListener('click', () => {
  document.getElementById('bio').value = DEMO.bio;
  document.getElementById('fans').value = DEMO.fans;
  document.getElementById('goal').value = DEMO.goal;
  makeIp();
});

function fileName(data, ext) {
  const name = String(data && data.name || '個人IP').replace(/[\\/:*?"<>|]/g, '').trim() || '個人IP';
  return `${name}.${ext || 'pdf'}`;
}

document.getElementById('copyBtn').addEventListener('click', async () => {
  const note = document.getElementById('copyMsg');
  if (!window.lastIp) {
    note.textContent = '請先產出個人IP。';
    return;
  }
  try {
    await navigator.clipboard.writeText(formatAll(window.lastIp));
    note.textContent = '已複製。';
  } catch {
    note.textContent = '複製失敗，請自行選取文字。';
  }
});

document.getElementById('downloadBtn').addEventListener('click', async () => {
  const note = document.getElementById('copyMsg');
  const data = window.lastIp;
  if (!data) {
    note.textContent = '請先產出個人IP。';
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
      .ip-print { font-family: "Noto Sans TC","Microsoft JhengHei",sans-serif; color:#1a1a1a; background:#fff; padding:8px 4px 24px; font-size:13px; line-height:1.65; }
      .ip-print h1 { font-size:22px; margin:0 0 8px; }
      .ip-print .lead { margin:0 0 16px; }
      .ip-print h3 { font-size:15px; margin:0 0 8px; }
      .ip-print section { page-break-inside: avoid; margin:0 0 16px; }
      .ip-print p, .ip-print li { margin:0 0 8px; }
    </style>
    <article class="ip-print">
      <h1>${escapeHtml(data.name || '個人IP')}</h1>
      <p class="lead">${escapeHtml(data.oneLiner || '')}</p>
      ${resultHtml(data)}
    </article>
  `;
  document.body.appendChild(hold);
  try {
    await html2pdf().set({
      margin: [12, 12, 14, 12],
      filename: fileName(data, 'pdf'),
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(hold.querySelector('.ip-print')).save();
    note.textContent = '已開始下載 PDF。';
  } catch {
    note.textContent = 'PDF 下載失敗，請改複製全部。';
  } finally {
    hold.remove();
  }
});

refreshPlan();
