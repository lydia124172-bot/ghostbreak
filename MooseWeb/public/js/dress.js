const state = { model: '', cloth: '' };

function readFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('請先選圖。'));
    if (file.size > 2 * 1024 * 1024) return reject(new Error('單張圖請小於 2MB。'));
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return reject(new Error('請用 JPG、PNG 或 WEBP。'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('讀取圖片失敗。'));
    reader.readAsDataURL(file);
  });
}

function showPrev(id, dataUrl) {
  const img = document.getElementById(id);
  if (!img) return;
  img.src = dataUrl;
  img.classList.toggle('hidden', !dataUrl);
}

async function pick(inputId, key, prevId) {
  const msg = document.getElementById('dressMsg');
  msg.textContent = '';
  const file = document.getElementById(inputId).files[0];
  if (!file) {
    state[key] = '';
    showPrev(prevId, '');
    return;
  }
  try {
    state[key] = await readFile(file);
    showPrev(prevId, state[key]);
  } catch (err) {
    state[key] = '';
    showPrev(prevId, '');
    document.getElementById(inputId).value = '';
    msg.textContent = err.message || '讀取圖片失敗。';
  }
}

async function refreshPlan() {
  const bar = document.getElementById('dressPlan');
  if (!bar) return;
  try {
    const data = await fetch('/api/dress/status').then((r) => r.json());
    if (!data.ready) {
      bar.textContent = '換裝暫時無法使用，請稍後再試。';
      return;
    }
    if (data.owner) {
      bar.textContent = '作者後台已登入，產出不扣點。';
      return;
    }
    if (!data.loggedIn) {
      bar.textContent = '需先到方案頁登入。成功一張扣 1 點，與商品短片進階圖共用。';
      return;
    }
    bar.textContent = `目前剩餘 ${data.credits || 0} 點。成功一張扣 1 點，與商品短片進階圖共用。`;
  } catch {
    bar.textContent = '需登入並有方案點數。';
  }
}

function paintResult(image, extra) {
  const out = document.getElementById('outImage');
  const save = document.getElementById('saveBtn');
  out.src = image;
  save.href = image;
  document.getElementById('outLine').textContent = extra || '僅供試衣參考，不是實穿保證。';
  document.getElementById('resultBox').classList.remove('hidden');
}

async function makeDress() {
  const msg = document.getElementById('dressMsg');
  const btn = document.getElementById('makeBtn');
  if (!state.model || !state.cloth) {
    msg.textContent = '請先選模特兒照與衣服圖。';
    return;
  }
  document.getElementById('resultBox').classList.add('hidden');
  msg.textContent = '正在換裝，約半分鐘，請不要重按。';
  btn.disabled = true;
  try {
    const res = await fetch('/api/dress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.model,
        cloth: state.cloth,
        note: document.getElementById('note').value.trim(),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '產出失敗');
    paintResult(body.image, body.owner ? '作者後台已登入，這張不扣點。' : '僅供試衣參考，不是實穿保證。');
    msg.textContent = '';
    refreshPlan();
  } catch (err) {
    msg.textContent = err.message || '產出失敗';
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('modelFile').addEventListener('change', () => pick('modelFile', 'model', 'modelPrev'));
document.getElementById('clothFile').addEventListener('change', () => pick('clothFile', 'cloth', 'clothPrev'));
document.getElementById('makeBtn').addEventListener('click', makeDress);
document.getElementById('dressForm').addEventListener('submit', (e) => {
  e.preventDefault();
  makeDress();
});

refreshPlan();
