const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const clipVideo = require('./clip-video');

function dataRoot() {
  return process.env.DATA_DIR || path.join(__dirname, '..', 'data');
}

function folderOf(id) {
  if (!/^[a-f0-9]{16}$/.test(String(id || ''))) return '';
  return path.join(dataRoot(), 'toon', id);
}

function writeStatus(folder, status) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'status.json'), JSON.stringify(status));
}

function readStatus(id) {
  const folder = folderOf(id);
  if (!folder) return null;
  const file = path.join(folder, 'status.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function imageDataUrl(part) {
  const raw = part && (part.inlineData || part.inline_data);
  if (!raw || !raw.data) return '';
  const mime = String(raw.mimeType || raw.mime_type || 'image/jpeg');
  const kind = /png/i.test(mime) ? 'png' : /webp/i.test(mime) ? 'webp' : 'jpeg';
  return `data:image/${kind};base64,${raw.data}`;
}

async function geminiStill(prompt) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('靜圖尚未開通。');
  const text = [
    'Horizontal 16:9 animated film still. One character, one action about to start.',
    'No speech bubbles, no nameplates, no subtitles, no captions, no readable text, no watermark.',
    prompt,
  ].join('\n');
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=' + encodeURIComponent(key),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
        },
      }),
      signal: AbortSignal.timeout(120000),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('靜圖沒有做成，請再試一次。');
  const image = (json.candidates?.[0]?.content?.parts || []).map(imageDataUrl).find(Boolean);
  if (!image) throw new Error('靜圖沒有做成，請再試一次。');
  return image;
}

async function waitClip(job) {
  const started = Date.now();
  while (Date.now() - started < 6 * 60 * 1000) {
    const peek = await clipVideo.check(job);
    if (peek.status === 'failed') throw new Error(peek.error || '這一鏡失敗');
    if (peek.status === 'done' && peek.videoUrl) return peek.videoUrl;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error('這一鏡逾時。請不要重按。');
}

function movingShots(shots) {
  const list = (Array.isArray(shots) ? shots : []).filter((shot) => shot && shot.motion && String(shot.prompt || '').trim());
  if (list.length !== 4) throw new Error('要先切出正好四段要動的鏡頭。');
  return list.slice(0, 4).map((shot) => ({
    n: Number(shot.n) || 0,
    say: String(shot.say || '').slice(0, 240),
    who: String(shot.who || '').slice(0, 20),
    picture: String(shot.picture || '').slice(0, 240),
    prompt: String(shot.prompt || '').slice(0, 900),
  }));
}

async function oneClip(shot) {
  const still = await geminiStill(shot.prompt);
  const submitted = await clipVideo.submit({
    images: [still],
    product: shot.picture || shot.who || '角色',
    prompt: [
      shot.prompt,
      'Horizontal 16:9, 5 seconds, one physical action.',
      'Keep the same character from the first frame to the last frame.',
      'No speech bubbles, nameplates, subtitles, or readable text.',
    ].join(' '),
    duration: '5',
    ratio: '16:9',
    generateAudio: false,
  });
  const url = await waitClip(submitted);
  const file = await clipVideo.finish(url, { duration: '5', engine: 'kling' });
  return file.buffer;
}

async function run(id, shots) {
  const folder = folderOf(id);
  const status = readStatus(id);
  for (let i = 0; i < shots.length; i += 1) {
    status.step = `第 ${shots[i].n} 鏡：先畫靜圖，再做成 5 秒`;
    status.shots[i].state = 'running';
    writeStatus(folder, status);
    try {
      const video = await oneClip(shots[i]);
      fs.writeFileSync(path.join(folder, `shot-${i}.mp4`), video);
      status.shots[i].state = 'done';
      status.shots[i].file = i;
    } catch (err) {
      status.shots[i].state = 'error';
      status.shots[i].error = String(err && err.message || '這一鏡失敗').slice(0, 180);
      status.status = 'error';
      status.step = status.shots[i].error;
      writeStatus(folder, status);
      return;
    }
    writeStatus(folder, status);
  }
  status.status = 'done';
  status.step = '四段都好了。下載後放進剪映，其餘鏡頭用定妝照。';
  writeStatus(folder, status);
}

function start(shots) {
  if (!String(process.env.GEMINI_API_KEY || '').trim()) throw new Error('靜圖尚未開通。');
  if (!clipVideo.configured()) throw new Error('生片尚未開通。');
  const moving = movingShots(shots);
  const id = crypto.randomBytes(8).toString('hex');
  const folder = path.join(dataRoot(), 'toon', id);
  writeStatus(folder, {
    status: 'running',
    step: '已收到，開始畫第 1 張',
    shots: moving.map((shot) => ({ n: shot.n, who: shot.who, say: shot.say, state: 'wait' })),
  });
  run(id, moving).catch((err) => {
    const status = readStatus(id) || { shots: [] };
    status.status = 'error';
    status.step = String(err && err.message || '生片失敗').slice(0, 180);
    writeStatus(folder, status);
  });
  return { id };
}

function shotFile(id, index) {
  const folder = folderOf(id);
  const n = Number(index);
  if (!folder || !Number.isInteger(n) || n < 0 || n > 3) return '';
  const file = path.join(folder, `shot-${n}.mp4`);
  return fs.existsSync(file) ? file : '';
}

module.exports = { start, readStatus, shotFile };
