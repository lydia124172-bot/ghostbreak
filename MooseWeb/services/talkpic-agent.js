const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { ffmpegBin, runFfmpeg } = require('./clip-export');
const clipTts = require('./clip-tts');
const clipStore = require('./clip-store');

const VOICES = {
  influencer: '網紅口吻：像台灣網紅在跟觀眾聊天，口語、親切、有一點節奏。不要新聞播報腔。',
  doc: '紀錄片旁白：沉穩，句子完整，把看到的事說清楚。不要吆喝，不要賣東西。',
  anchor: '新聞主播口吻：咬字清楚、客觀、先講重點。不要撒嬌，不要用網路流行語。',
  ad: '商品廣告口吻：精簡有力，只講看得到的特點。不要編價格和功效。',
  teach: '教學解說：按步驟講清楚。',
};

const jobs = new Map();

function configured() {
  return Boolean(String(process.env.GEMINI_API_KEY || '').trim()) && Boolean(ffmpegBin());
}

function looksLikeJailbreak(text) {
  return /忽略(以上|先前|之前|所有)?(指令|規則)|ignore (previous|all) instructions|輸出(原始|全部)?(提示|指令|prompt)|show (me )?(the )?(system|original) prompt|越獄|jailbreak/i.test(String(text || ''));
}

function clean(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function publicError(err) {
  const message = String(err && err.message || '');
  if (/請|最多|至少|無法提供|尚未|轉檔|沒有產出|每一句|這次沒有/.test(message)) return message;
  if (/quota|429|RESOURCE_EXHAUSTED|high demand|UNAVAILABLE|503/i.test(message)) return '現在使用的人較多，請稍後再試。';
  return '這次沒有做成，請再試一次。';
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```json\s*|\s*```$/g, '').trim();
  const from = raw.indexOf('{');
  const to = raw.lastIndexOf('}');
  if (from < 0 || to <= from) throw new Error('沒有產出旁白');
  try {
    return JSON.parse(raw.slice(from, to + 1));
  } catch {
    throw new Error('沒有產出旁白');
  }
}

async function askText(prompt) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('生圖尚未開通。');
  let lastErr;
  for (const model of ['gemini-flash-lite-latest', 'gemini-3.6-flash']) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 8192, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(45000),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error?.message || `旁白服務 ${res.status}`);
      const text = (json.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('\n');
      const data = extractJson(text);
      if (String(data.error || '').trim()) throw new Error('無法提供');
      return data;
    } catch (err) {
      lastErr = err;
      if (err.message === '無法提供') throw err;
    }
  }
  throw lastErr || new Error('沒有產出旁白');
}

function sentence(text) {
  const line = clean(text, 80);
  if (!line) return '';
  return /[。！？]$/.test(line) ? line : `${line}。`;
}

function splitScript(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (raw.length < 4) throw new Error('請先寫要講的內容。');
  let parts = raw.split(/(?<=[。！？])/).map((item) => item.trim()).filter(Boolean);
  if (parts.length === 1 && parts[0].length > 80) throw new Error('請用句號分成幾句，每一句 80 字以內。');
  parts = parts.map((item) => sentence(item.replace(/[。！？]+$/g, ''))).filter((item) => item.length >= 3);
  if (!parts.length) throw new Error('請先寫要講的內容。');
  if (parts.length > 30) throw new Error('最多 30 句，大約 5 分鐘。');
  if (parts.some((item) => item.length > 81)) throw new Error('每一句請在 80 字以內。');
  return parts;
}

const LENGTHS = {
  8: { n: 8, band: '22 到 32 個字', minutes: '約 1 分鐘' },
  12: { n: 12, band: '32 到 40 個字', minutes: '約 2 分鐘' },
  18: { n: 18, band: '36 到 44 個字', minutes: '約 3 分鐘' },
  24: { n: 24, band: '36 到 44 個字', minutes: '約 4 分鐘' },
  30: { n: 30, band: '36 到 46 個字', minutes: '約 5 分鐘' },
};

function lengthChoice(count) {
  return LENGTHS[count] || LENGTHS[18];
}

async function writeLines(text, voice, count, other) {
  const choice = lengthChoice(count);
  const n = choice.n;
  const tone = voice === 'other'
    ? `口吻：${clean(other, 120) || '自然口語'}`
    : (VOICES[voice] || VOICES.influencer);
  const data = await askText([
    '你要寫一支 YouTube 旁白，邊講邊換圖。只輸出 JSON。',
    '{"lines":[{"say":"","picture":""}]}',
    `剛好 ${n} 句，整段唸完${choice.minutes}。say 是要唸出來的繁體中文，每一句 ${choice.band}，結尾用句號。`,
    '句子要夠長，像 YouTube 口播，不要短句湊數。整段從開頭講到收尾，中間有過程，不要只停在開頭。',
    'picture 寫這一張圖要畫的具體畫面：誰、什麼東西、在做什麼、在哪裡。不要寫「畫面中」，不要寫文字、字幕、商標。',
    '每一句 say 和它的 picture 必須是同一件事。整段要連得起來。',
    '只講主題裡有的內容，不要編價格、功效、人名。色情、未成年性相關、犯罪教學就回 {"error":"無法提供"}。',
    tone,
    `主題：${clean(text, 500)}`,
  ].join('\n'));
  const lines = (Array.isArray(data.lines) ? data.lines : []).map((row) => ({
    say: sentence(row && row.say),
    picture: clean(row && row.picture, 180),
  })).filter((row) => row.say && row.picture).slice(0, n);
  if (lines.length < n - 2) throw new Error('沒有寫滿這支片的句數，請再試一次。');
  return lines;
}

async function picturesFor(says) {
  const data = await askText([
    '下面每一句旁白都要配一張圖。不要改旁白的字。只輸出 JSON。',
    '{"pictures":[""]}',
    'pictures 的數量和順序必須跟旁白一樣。每一格寫該句要畫的具體畫面：誰、什麼東西、在做什麼、在哪裡。不要寫文字、字幕、商標。',
    '色情、未成年性相關、犯罪教學就回 {"error":"無法提供"}。',
    ...says.map((say, i) => `${i + 1}. ${say}`),
  ].join('\n'));
  const pictures = Array.isArray(data.pictures) ? data.pictures : [];
  return says.map((say, i) => ({
    say,
    picture: clean(pictures[i], 180) || say,
  }));
}

function partImage(part) {
  const inline = part && (part.inlineData || part.inline_data);
  if (!inline || !inline.data) return null;
  const mime = inline.mimeType || inline.mime_type || 'image/png';
  return { mime, buffer: Buffer.from(inline.data, 'base64') };
}

async function generateImage(picture, ratio) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const aspect = ratio === '16:9' ? '16:9' : '9:16';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: [
              `${aspect} 寫實畫面。`,
              `必須畫出：${picture}`,
              '不要任何文字、字幕、標題、浮水印、商標、介面。',
              '只輸出圖像。',
            ].join('\n'),
          }],
        }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: aspect, imageSize: '1K' },
        },
      }),
      signal: AbortSignal.timeout(90000),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `生圖服務 ${res.status}`);
  const image = (body.candidates?.[0]?.content?.parts || []).map(partImage).find(Boolean);
  if (!image) throw new Error('沒有產出圖片');
  return image;
}

function probeDuration(file) {
  const bin = ffmpegBin();
  if (!bin || !fs.existsSync(file)) return Promise.resolve(0);
  return new Promise((resolve) => {
    const proc = spawn(bin, ['-i', file, '-f', 'null', '-'], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return resolve(0);
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
    proc.on('error', () => resolve(0));
  });
}

async function stillWithVoice(image, audio, ratio, work, index) {
  const img = path.join(work, `img-${index}.jpg`);
  const aud = path.join(work, `aud-${index}.wav`);
  const out = path.join(work, `clip-${index}.mp4`);
  fs.writeFileSync(img, image.buffer);
  fs.writeFileSync(aud, audio.buffer);
  const dur = Math.min(18, Math.max(1.2, (await probeDuration(aud)) || 4));
  const size = ratio === '16:9' ? [1280, 720] : [720, 1280];
  const vf = `scale=${size[0]}:${size[1]}:force_original_aspect_ratio=increase,crop=${size[0]}:${size[1]},fps=30,fade=t=in:st=0:d=0.35,format=yuv420p`;
  await runFfmpeg([
    '-y', '-loop', '1', '-i', img, '-i', aud,
    '-t', dur.toFixed(2),
    '-vf', vf,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-shortest', '-movflags', '+faststart',
    out,
  ], out);
  return out;
}

async function concatClips(files, work) {
  const list = path.join(work, 'list.txt');
  const out = path.join(work, 'talkpic.mp4');
  fs.writeFileSync(list, files.map((file) => `file '${file.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  try {
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], out);
  } catch {
    await runFfmpeg([
      '-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      out,
    ], out);
  }
  return out;
}

async function produce({ text, voice, other, ratio, mode, count, onPhase }) {
  if (!String(process.env.GEMINI_API_KEY || '').trim()) throw new Error('生圖尚未開通。');
  if (!ffmpegBin()) throw new Error('轉檔工具尚未就緒，這次沒有生圖。');
  if (!clipTts.configured() && !String(process.env.OPENAI_API_KEY || '').trim()) throw new Error('旁白語音尚未開通。');
  const topic = String(text || '').trim();
  if (looksLikeJailbreak(topic) || looksLikeJailbreak(other)) throw new Error('無法提供');
  const shape = ratio === '16:9' ? '16:9' : '9:16';
  onPhase('正在寫旁白');
  const lines = mode === 'script'
    ? await picturesFor(splitScript(topic))
    : await writeLines(topic, voice, count, other);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'talkpic-'));
  try {
    const clips = [];
    for (let i = 0; i < lines.length; i += 1) {
      onPhase(`正在生第 ${i + 1} 張，共 ${lines.length} 張，並配上這一句`);
      const image = await generateImage(lines[i].picture, shape);
      const audio = await clipTts.speak(lines[i].say);
      clips.push(await stillWithVoice(image, audio, shape, work, i));
    }
    onPhase('正在接成一支片');
    const file = await concatClips(clips, work);
    const script = lines.map((row) => row.say).join('');
    return {
      buffer: fs.readFileSync(file),
      script,
      lines: lines.map((row) => ({ say: row.say, picture: row.picture })),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function pruneJobs() {
  const cutoff = Date.now() - 40 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.created < cutoff) jobs.delete(id);
  }
}

function runningFor(sid) {
  for (const job of jobs.values()) {
    if (job.sid === sid && !job.result && !job.error) return job;
  }
  return null;
}

function publicJob(job) {
  if (!job) return null;
  if (job.result) return { jobId: job.id, status: 'done', ...job.result };
  if (job.error) return { jobId: job.id, status: 'error', error: job.error };
  return { jobId: job.id, status: job.phase === '已送出' ? 'queued' : 'running', phase: job.phase || '已送出' };
}

function startJob({ sid, text, voice, other, ratio, mode, count }) {
  if (looksLikeJailbreak(text) || looksLikeJailbreak(other)) throw new Error('無法提供');
  if (mode === 'script') splitScript(text);
  else if (clean(text, 300).length < 4) throw new Error('請先寫主題。');
  if (voice === 'other' && clean(other, 120).length < 2) throw new Error('選了其它，請寫要的口吻。');
  pruneJobs();
  const current = runningFor(sid);
  if (current) return publicJob(current);
  const job = {
    id: crypto.randomUUID(),
    sid,
    phase: '已送出',
    created: Date.now(),
    result: null,
    error: '',
  };
  jobs.set(job.id, job);
  setImmediate(() => {
    produce({
      text,
      voice,
      other,
      ratio,
      mode,
      count,
      onPhase: (phase) => { job.phase = phase; },
    }).then((made) => {
      const saved = clipStore.saveMedia(sid, 'video', made.buffer, 'video/mp4');
      job.result = {
        videoId: saved.id,
        videoUrl: `/api/clip/media/${saved.id}`,
        script: made.script,
        lines: made.lines,
      };
      job.phase = '完成';
    }).catch((err) => {
      job.error = publicError(err);
      console.error('[talkpic]', err.message);
    });
  });
  return publicJob(job);
}

function getJob(id, sid) {
  const job = jobs.get(id);
  if (!job || job.sid !== sid) return null;
  return publicJob(job);
}

function latestJob(sid) {
  let latest = null;
  for (const job of jobs.values()) {
    if (job.sid !== sid || !job.result) continue;
    if (!latest || job.created > latest.created) latest = job;
  }
  return latest ? publicJob(latest) : null;
}

module.exports = { configured, startJob, getJob, latestJob, splitScript };
