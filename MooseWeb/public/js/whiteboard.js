const form = document.getElementById('form');
const text = document.getElementById('text');
const textLabel = document.getElementById('textLabel');
const modes = document.getElementById('modes');
const voices = document.getElementById('voices');
const noteBox = document.getElementById('noteBox');
const note = document.getElementById('note');
const counts = document.getElementById('counts');
const countLabel = document.getElementById('countLabel');
const ratios = document.getElementById('ratios');
const submit = document.getElementById('submit');
const recover = document.getElementById('recover');
const msg = document.getElementById('msg');
const result = document.getElementById('result');
const preview = document.getElementById('preview');
const download = document.getElementById('download');
const copyBtn = document.getElementById('copyBtn');
const scriptBox = document.getElementById('script');
let mode = 'write';
let voice = 'teach';
let count = '18';
let ratio = '16:9';
let timer = 0;
let lastScript = '';

function pick(box, attr, apply) {
  box.addEventListener('click', (event) => {
    const btn = event.target.closest('[' + attr + ']');
    if (!btn) return;
    box.querySelectorAll('[' + attr + ']').forEach((item) => item.classList.toggle('active', item === btn));
    apply(btn.getAttribute(attr));
  });
}

pick(modes, 'data-mode', (value) => {
  mode = value;
  const script = mode === 'script';
  textLabel.textContent = script ? '旁白稿' : '主題';
  text.placeholder = script
    ? '用句號分開，最多 30 句。例如：客人先看到廣告。接著進到店裡。最後留下聯絡方式。'
    : '例如：一家店怎麼把客人從看到廣告帶到回購';
  countLabel.classList.toggle('hidden', script);
  counts.classList.toggle('hidden', script);
});
pick(voices, 'data-voice', (value) => {
  voice = value;
  noteBox.classList.toggle('hidden', voice !== 'other');
});
pick(counts, 'data-count', (value) => { count = value; });
pick(ratios, 'data-ratio', (value) => {
  ratio = value;
  preview.style.aspectRatio = ratio === '9:16' ? '9 / 16' : '16 / 9';
});

voices.querySelector('[data-voice="teach"]').classList.add('active');

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = sessionStorage.getItem('moose_admin_token') || '';
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function showDone(data) {
  clearInterval(timer);
  lastScript = data.script || '';
  const url = data.videoUrl + '?v=' + Date.now();
  preview.src = url;
  download.href = url;
  scriptBox.textContent = lastScript;
  result.classList.remove('hidden');
  msg.textContent = '白板講解好了。按影片左下角的播放，旁白在教主題，圖會跟著那一句出現。';
  msg.classList.remove('status-err');
  submit.disabled = false;
}

function fail(message) {
  clearInterval(timer);
  msg.textContent = message || '這次沒有做成，請再按一次。';
  msg.classList.add('status-err');
  submit.disabled = false;
}

async function readBody(res) {
  const raw = await res.text();
  try {
    return { data: raw ? JSON.parse(raw) : {}, raw };
  } catch {
    return { data: {}, raw };
  }
}

function reason(res, data, raw) {
  let message = '';
  if (data && typeof data.error === 'string') message = data.error.trim();
  else if (data && data.error) message = JSON.stringify(data.error).slice(0, 160);
  if (message && message !== '這次沒有做成') return message;
  const snippet = String(raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const status = res ? res.status : 0;
  if (status === 502 || status === 503 || status === 504 || /font-face|<html|bad gateway/i.test(snippet)) {
    return '網站剛剛斷線，請再按一次開始畫。';
  }
  if (snippet && snippet !== message) return '這次沒有做成（HTTP ' + status + '）' + snippet;
  return '這次沒有做成（HTTP ' + status + '）';
}

let blips = 0;

function poll(jobId) {
  clearInterval(timer);
  blips = 0;
  timer = setInterval(async () => {
    try {
      const res = await fetch('/api/whiteboard/job/' + jobId, { headers: authHeaders() });
      const { data, raw } = await readBody(res);
      if (res.status === 401) return fail('請先登入後台');
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        blips += 1;
        if (blips < 8) {
          msg.classList.remove('status-err');
          msg.textContent = '還在畫，請留在這個畫面。';
          return;
        }
        return fail(reason(res, data, raw));
      }
      blips = 0;
      if (!res.ok && !data.phase) return fail(reason(res, data, raw));
      if (data.status === 'done' && data.videoUrl) return showDone(data);
      if (data.status === 'error' || data.error) return fail(reason(res, data, raw));
      msg.textContent = data.phase || '正在畫…';
    } catch {
      msg.classList.remove('status-err');
      msg.textContent = '還在畫，請留在這個畫面。';
    }
  }, 2000);
}

copyBtn.addEventListener('click', async () => {
  if (!lastScript) return;
  try {
    await navigator.clipboard.writeText(lastScript);
    msg.textContent = '旁白已複製。';
    msg.classList.remove('status-err');
  } catch {
    msg.textContent = '這台裝置無法直接複製，請手動選取旁白。';
    msg.classList.add('status-err');
  }
});

recover.addEventListener('click', async () => {
  msg.classList.remove('status-err');
  msg.textContent = '正在取回剛才的片子…';
  try {
    const res = await fetch('/api/whiteboard/last', { headers: authHeaders() });
    const { data, raw } = await readBody(res);
    if (!res.ok) throw new Error(data.error || reason(res, data, raw));
    if (data.videoUrl) showDone(data);
    else if (data.jobId) poll(data.jobId);
    else throw new Error('沒有可取回的片子');
  } catch (err) {
    fail(err.message);
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!text.value.trim()) {
    fail(mode === 'script' ? '請先貼上旁白稿。' : '請先寫主題。');
    return;
  }
  if (voice === 'other' && !note.value.trim()) {
    fail('選了其它，請寫要的口吻。');
    return;
  }
  submit.disabled = true;
  result.classList.add('hidden');
  msg.classList.remove('status-err');
  msg.textContent = '已送出。同一張圖會一直留著，講到哪裡就畫到哪裡。請留在這個畫面。';
  try {
    const res = await fetch('/api/whiteboard', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        text: text.value,
        voice,
        other: note.value,
        ratio,
        mode,
        count,
      }),
    });
    const { data, raw } = await readBody(res);
    if (res.status === 401) throw new Error('請先登入後台');
    if (!res.ok) throw new Error(reason(res, data, raw));
    if (data.videoUrl) showDone(data);
    else if (data.jobId) poll(data.jobId);
    else throw new Error(reason(res, data, raw));
  } catch (err) {
    fail(err && err.message ? err.message : '連不上，請再按一次。');
  }
});
