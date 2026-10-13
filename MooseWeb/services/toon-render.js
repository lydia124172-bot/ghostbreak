const fs = require('fs');
const os = require('os');
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

const CAST = [
  {
    test: /狐/,
    name: 'Charon',
    label: '狐',
    instructions: '用低沉、慢、帶輕蔑的台灣華語男聲說完下面這句，像主管在下命令。尾音收短。不要女聲，不要音效，不要笑。',
  },
  {
    test: /獾/,
    name: 'Fenrir',
    label: '獾',
    instructions: '用又急又兇、音量偏高的台灣華語男聲說完下面這句，像在罵人，句子往前衝。不要女聲，不要音效。',
  },
  {
    test: /貓/,
    name: 'Enceladus',
    label: '貓',
    instructions: '用很累、氣很弱、幾乎不想開口的台灣華語男聲說完下面這句。慢，沒有力氣。不要女聲，不要音效。',
  },
  {
    test: /熊/,
    name: 'Achird',
    label: '熊',
    instructions: '用輕鬆、慢、覺得很好笑的台灣華語男聲說完下面這句，像躺著看戲。不要女聲，不要音效。',
  },
];

const NARRATOR = {
  name: 'Pulcherrima',
  label: '女主播',
  instructions: '用有個性的台灣女主播聲音說完下面這句。咬字清楚，語氣帶一點俏皮和態度，像在播一則荒謬新聞，不要平鋪直敘，不要念稿腔，不要男聲，不要音效。',
};

function castOf(who) {
  const text = String(who || '');
  return CAST.find((row) => row.test.test(text)) || NARRATOR;
}

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function speakCast(line, cast) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('配音尚未開通。');
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('這一鏡沒有台詞。');
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${cast.instructions}\n${text}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cast.name } } },
      },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('配音沒有做成，請再試一次。');
  const part = json.candidates?.[0]?.content?.parts?.find((row) => row.inlineData || row.inline_data) || {};
  const blob = part.inlineData || part.inline_data || {};
  if (!blob.data) throw new Error('配音沒有做成，請再試一次。');
  const raw = Buffer.from(blob.data, 'base64');
  const mime = blob.mimeType || blob.mime_type || '';
  if (/wav/i.test(mime)) return raw;
  const rate = Number(String(mime).match(/rate=(\d+)/i)?.[1]) || 24000;
  return pcmToWav(raw, rate);
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

async function submitTurbo(stillDataUrl, prompt) {
  const key = String(process.env.FAL_KEY || '').trim();
  const file = clipVideo.parseDataUrl(stillDataUrl);
  const still = clipVideo.prepareStill(Buffer.from(file.b64, 'base64'), { ratio: '16:9', resolution: '720p' });
  const imageUrl = await clipVideo.falUpload(key, still, 'image/jpeg', 'toon.jpg');
  const model = 'minimax/h3-max-turbo/image-to-video';
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_url: imageUrl,
      duration: 5,
      resolution: '768P',
    }),
  });
  const body = await res.json().catch(() => ({}));
  const requestId = body.request_id || body.requestId || '';
  if (!res.ok || !requestId) throw new Error('這一鏡沒有排進生片，請再試一次。');
  const urls = clipVideo.queueUrls(model, requestId, body);
  return { requestId, model, statusUrl: urls.statusUrl, responseUrl: urls.responseUrl };
}

async function oneClip(shot, audioBuf, stillDataUrl) {
  const still = stillDataUrl || await geminiStill(shot.prompt);
  const submitted = await submitTurbo(still, [
    shot.prompt,
    'Horizontal 16:9, 5 seconds, one physical action.',
    'Keep the same character from the first frame to the last frame.',
    'No speech bubbles, nameplates, subtitles, or readable text.',
  ].join(' '));
  const url = await waitClip(submitted);
  const temp = path.join(os.tmpdir(), `toon-line-${Date.now()}.wav`);
  if (audioBuf) fs.writeFileSync(temp, audioBuf);
  const file = await clipVideo.finish(url, { duration: '5', engine: 'hailuo', audioPath: audioBuf ? temp : '' });
  return file.buffer;
}

function spokenShots(shots) {
  return (Array.isArray(shots) ? shots : [])
    .map((shot) => ({
      n: Number(shot.n) || 0,
      say: String(shot.say || '').trim().slice(0, 240),
      who: String(shot.who || '').trim().slice(0, 20),
    }))
    .filter((shot) => shot.say);
}

async function run(id, shots, lines, frames) {
  const folder = folderOf(id);
  const status = readStatus(id);
  const audio = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cast = castOf(lines[i].who);
    status.step = `第 ${lines[i].n} 鏡配音：${cast.label}`;
    status.lines[i].state = 'running';
    status.lines[i].voice = cast.label;
    writeStatus(folder, status);
    try {
      const wav = await speakCast(lines[i].say, cast);
      fs.writeFileSync(path.join(folder, `line-${i}.wav`), wav);
      audio[i] = wav;
      status.lines[i].state = 'done';
    } catch (err) {
      status.lines[i].state = 'error';
      status.lines[i].error = String(err && err.message || '配音失敗').slice(0, 180);
      status.status = 'error';
      status.step = status.lines[i].error;
      writeStatus(folder, status);
      return;
    }
    writeStatus(folder, status);
  }
  for (let i = 0; i < shots.length; i += 1) {
    status.step = frames
      ? `第 ${shots[i].n} 鏡：用你上傳的圖做成 5 秒`
      : `第 ${shots[i].n} 鏡：先畫靜圖，再做成 5 秒`;
    status.shots[i].state = 'running';
    writeStatus(folder, status);
    const heard = lines.findIndex((line) => line.n === shots[i].n);
    try {
      const video = await oneClip(shots[i], heard >= 0 ? audio[heard] : null, frames ? frames[i] : '');
      fs.writeFileSync(path.join(folder, `shot-${i}.mp4`), video);
      status.shots[i].state = 'done';
      status.shots[i].file = i;
      status.shots[i].voice = castOf(shots[i].who).label;
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
  status.step = '四段影片和各鏡配音都好了。旁白是女主播，狐、獾、貓、熊是四個不同的男聲。';
  writeStatus(folder, status);
}

function uploadedFrames(stills) {
  const frames = Array.isArray(stills) ? stills.map((item) => String(item || '').trim()) : [];
  if (!frames.some(Boolean)) return null;
  if (frames.length !== 4 || frames.some((item) => !item)) throw new Error('請上傳正好四張鏡圖。');
  frames.forEach((item) => clipVideo.parseDataUrl(item));
  return frames;
}

function start(shots, stills) {
  if (!String(process.env.GEMINI_API_KEY || '').trim()) throw new Error('配音尚未開通。');
  if (!clipVideo.configured()) throw new Error('生片尚未開通。');
  const moving = movingShots(shots);
  const lines = spokenShots(shots);
  const frames = uploadedFrames(stills);
  const id = crypto.randomBytes(8).toString('hex');
  const folder = path.join(dataRoot(), 'toon', id);
  writeStatus(folder, {
    status: 'running',
    step: '已收到，先配音',
    shots: moving.map((shot) => ({ n: shot.n, who: shot.who, say: shot.say, voice: castOf(shot.who).label, state: 'wait' })),
    lines: lines.map((shot) => ({ n: shot.n, who: shot.who, say: shot.say, voice: castOf(shot.who).label, state: 'wait' })),
  });
  run(id, moving, lines, frames).catch((err) => {
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

function lineFile(id, index) {
  const folder = folderOf(id);
  const n = Number(index);
  if (!folder || !Number.isInteger(n) || n < 0 || n > 20) return '';
  const file = path.join(folder, `line-${n}.wav`);
  return fs.existsSync(file) ? file : '';
}

module.exports = { start, readStatus, shotFile, lineFile };
