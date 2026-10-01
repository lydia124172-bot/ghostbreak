function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function li(items) {
  return (items || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('');
}

const id = new URLSearchParams(location.search).get('id');

fetch('/api/config')
  .then((r) => r.json())
  .then((data) => {
    const course = (data.courses || []).find((c) => c.id === id);
    if (!course) {
      document.getElementById('main').innerHTML = '<section class="page-head"><h1>找不到這門課</h1><p class="lead"><a href="/courses">回課程列表</a></p></section>';
      return;
    }
    document.title = `${course.title} — 麋鹿網`;
    document.getElementById('head').innerHTML = `
      <p class="kicker">${escapeHtml(course.status || '開放諮詢')}</p>
      <h1>${escapeHtml(course.title)}</h1>
      <p class="lead">${escapeHtml(course.audience ? `適合對象：${course.audience}` : '')}</p>
      <p>${escapeHtml(course.summary || '')}</p>
    `;
    document.getElementById('facts').innerHTML = `
      <div class="admin-2">
        <p><strong>堂數</strong><br>${escapeHtml(course.sessionLabel || `${course.sessions || ''} 堂`)}</p>
        <p><strong>單堂</strong><br>${escapeHtml(course.duration || '')}</p>
        <p><strong>形式</strong><br>${escapeHtml(course.format || '')}</p>
        <p><strong>費用</strong><br>${escapeHtml(course.priceLabel || '')}${course.earlyBirdLabel ? `<br><span class="meta">${escapeHtml(course.earlyBirdLabel)}</span>` : ''}</p>
      </div>
    `;
    document.getElementById('detail').textContent = course.detail || course.summary || '';
    document.getElementById('outcomes').innerHTML = li(course.outcomes);
    document.getElementById('features').innerHTML = li(course.features);
    document.getElementById('lessons').innerHTML = (course.lessons || []).map((row) => `
      <li>
        <strong>第 ${row.no} 堂　${escapeHtml(row.title)}</strong>
        <span class="meta">${escapeHtml(row.summary || '')}</span>
      </li>
    `).join('');
    document.getElementById('inqCourseId').value = course.id;
    const msg = document.getElementById('inqMessage');
    if (!msg.value) msg.value = `我想諮詢課程：${course.title}`;
  })
  .catch(() => {
    document.getElementById('main').innerHTML = '<section class="page-head"><h1>暫時無法載入</h1><p class="lead"><a href="/courses">回課程列表</a></p></section>';
  });

document.getElementById('inquireForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('inqError');
  const ok = document.getElementById('inqOk');
  const btn = document.getElementById('inqBtn');
  err.classList.add('hidden');
  ok.classList.add('hidden');
  btn.disabled = true;
  const courseId = document.getElementById('inqCourseId').value;
  const title = document.querySelector('#head h1')?.textContent || courseId;
  try {
    const res = await fetch('/api/inquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('inqName').value,
        phone: document.getElementById('inqPhone').value,
        email: document.getElementById('inqEmail').value,
        service: `課程：${title}`,
        message: document.getElementById('inqMessage').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '送出失敗');
    ok.textContent = data.message || '已送出，我們會盡快與你聯繫。';
    ok.classList.remove('hidden');
    e.target.reset();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});
