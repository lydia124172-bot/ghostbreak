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

const LENGTHS = {
  8: { n: 8, band: '22 到 32 個字', minutes: '約 1 分鐘' },
  12: { n: 12, band: '32 到 40 個字', minutes: '約 2 分鐘' },
  18: { n: 18, band: '36 到 44 個字', minutes: '約 3 分鐘' },
  24: { n: 24, band: '36 到 44 個字', minutes: '約 4 分鐘' },
  30: { n: 30, band: '36 到 46 個字', minutes: '約 5 分鐘' },
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
  const message = String(err && err.message || '').replace(/\s+/g, ' ').trim();
  if (/aborted|timeout/i.test(message)) return '寫旁白逾時，請再試一次。';
  if (/quota|429|RESOURCE_EXHAUSTED|high demand|UNAVAILABLE|503/i.test(message)) return '現在使用的人較多，請稍後再試。';
  if (/請|最多|至少|無法提供|尚未|轉檔|沒有產出|每一句|這次沒有|沒有寫滿|旁白語音|生圖/.test(message)) {
    return message.slice(0, 120);
  }
  const detail = message.replace(/https?:\/\/\S+/g, '').replace(/key=[^\s]+/gi, '').slice(0, 100);
  if (detail) return `這次沒有做成：${detail}`;
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
          signal: AbortSignal.timeout(90000),
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

function lengthChoice(count) {
  return LENGTHS[count] || LENGTHS[18];
}

const DRAW = 'picture 只寫這一句要新畫上白板的那一個東西，例如：三個方框用箭頭連成流程、一個火柴人把箱子交給另一個人、一條由下往上的折線。不要寫整張照片，不要寫文字。';

async function writeBatch(text, voice, other, choice, need, done, total) {
  const tone = voice === 'other'
    ? `口吻：${clean(other, 120) || '自然口語'}`
    : (VOICES[voice] || VOICES.teach);
  const data = await askText([
    '你要寫一支白板講解。旁白在講的時候，白板上會把對應的手繪圖畫出來。只輸出 JSON。',
    '{"lines":[{"say":"","picture":""}]}',
    `這一批只寫 ${need} 句。整支片共 ${total} 句、唸完${choice.minutes}，現在從第 ${done + 1} 句寫到第 ${done + need} 句。`,
    `say 是要唸出來的繁體中文，每一句 ${choice.band}，結尾用句號。`,
    '句子要夠長，像 YouTube 知識或教學口播。整段從問題講到過程再收到結論。',
    DRAW,
    '每一句 say 和它的 picture 必須是同一件事。前面畫過的不要在 picture 裡重畫。',
    '只講主題裡有的內容，不要編價格、功效、人名。色情、未成年性相關、犯罪教學就回 {"error":"無法提供"}。',
    tone,
    `主題：${clean(text, 500)}`,
  ].join('\n'));
  return (Array.isArray(data.lines) ? data.lines : []).map((row) => ({
    say: sentence(row && row.say),
    picture: clean(row && row.picture, 180),
  })).filter((row) => row.say && row.picture).slice(0, need);
}

async function writeLines(text, voice, count, other) {
  const choice = lengthChoice(count);
  const n = choice.n;
  const lines = [];
  while (lines.length < n) {
    const need = Math.min(6, n - lines.length);
    const batch = await writeBatch(text, voice, other, choice, need, lines.length, n);
    if (!batch.length) break;
    lines.push(...batch);
  }
  if (lines.length < n - 2) throw new Error('沒有寫滿這支片的句數，請再試一次。');
  return lines.slice(0, n);
}

async function picturesFor(says) {
  const data = await askText([
    '下面每一句旁白都要在白板上新畫一個東西。不要改旁白的字。只輸出 JSON。',
    '{"pictures":[""]}',
    'pictures 的數量和順序必須跟旁白一樣。',
    DRAW,
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
  if (!part || part.thought) return null;
  const inline = part.inlineData || part.inline_data;
  if (!inline || !inline.data) return null;
  return Buffer.from(inline.data, 'base64');
}

async function generateSketch(picture) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const prompt = [
    '1:1 白板手繪。純白背景，黑色馬克筆線條。',
    `只畫這一個說明元素，放在正中，四周留白：${picture}`,
    '可以是箭頭、方框流程、火柴人、簡單圖示。線條清楚，像老師在白板上現畫。',
    '不要照片、不要彩色填色、不要陰影、不要灰色紙、不要格子、不要任何文字、數字、字幕、商標。',
    '只輸出圖像。',
  ].join('\n');
  const configs = [
    { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
    { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } },
    { responseModalities: ['IMAGE'] },
  ];
  let lastErr = new Error('沒有產出圖片');
  for (const generationConfig of configs) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig,
          }),
          signal: AbortSignal.timeout(90000),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message || `生圖服務 ${res.status}`);
      const parts = body.candidates?.[0]?.content?.parts || [];
      const image = parts.map(partImage).filter(Boolean).pop();
      if (!image) throw new Error('沒有產出圖片');
      return image;
    } catch (err) {
      lastErr = err;
      if (err.name === 'TimeoutError' || /aborted|timeout/i.test(err.message || '')) throw err;
    }
  }
  throw lastErr;
}

function frameOf(ratio) {
  if (ratio === '9:16') return { w: 720, h: 1280, cols: 2, rows: 3 };
  return { w: 1280, h: 720, cols: 3, rows: 2 };
}

function slotBox(frame, index) {
  const per = frame.cols * frame.rows;
  const slot = index % per;
  const pad = 28;
  const gap = 16;
  const cellW = Math.floor((frame.w - pad * 2 - gap * (frame.cols - 1)) / frame.cols);
  const cellH = Math.floor((frame.h - pad * 2 - gap * (frame.rows - 1)) / frame.rows);
  const col = slot % frame.cols;
  const row = Math.floor(slot / frame.cols);
  return {
    x: pad + col * (cellW + gap),
    y: pad + row * (cellH + gap),
    w: cellW,
    h: cellH,
    fresh: slot === 0,
  };
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

function ffmpeg(args, output) {
  const bin = ffmpegBin();
  if (!bin) return Promise.reject(new Error('轉檔工具尚未就緒，這次沒有生圖。'));
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (chunk) => {
      err += chunk;
      if (err.length > 4000) err = err.slice(-4000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) resolve(output);
      else {
        const line = err.split(/\r?\n/).map((row) => row.trim()).filter(Boolean).pop() || '沒有產出畫面';
        reject(new Error(`轉檔失敗：${line.slice(0, 140)}`));
      }
    });
  });
}

function inkFilter(box, mode, reveal) {
  let extra = '';
  if (mode === 'reveal' && reveal) extra = `,scale=w='min(iw\\,max(2\\,iw*t/${reveal}))':h=ih:eval=frame`;
  else if (mode === 'fade' && reveal) extra = `,fade=t=in:st=0:d=${reveal}:alpha=1`;
  const key = mode === 'box' ? '' : ',format=rgba,colorkey=0xFFFFFF:0.12:0.04';
  return `[1:v]scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease,pad=${box.w}:${box.h}:(ow-iw)/2:(oh-ih)/2:white${key}${extra}[ink];[0:v][ink]overlay=${box.x}:${box.y}:format=auto`;
}

function blankBoard(file, frame) {
  const row = Math.ceil((frame.w * 3) / 4) * 4;
  const pixels = row * frame.h;
  const buf = Buffer.alloc(54 + pixels);
  buf.fill(0xff, 54);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + pixels, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(frame.w, 18);
  buf.writeInt32LE(frame.h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixels, 34);
  fs.writeFileSync(file, buf);
}

async function stampBoard(base, ink, box, dest) {
  let lastErr;
  for (const mode of ['plain', 'box']) {
    try {
      await ffmpeg([
        '-y', '-i', base, '-i', ink,
        '-filter_complex', `${inkFilter(box, mode, 0)},format=rgb24`,
        '-frames:v', '1', dest,
      ], dest);
      return;
    } catch (err) {
      lastErr = err;
      fs.rmSync(dest, { force: true });
    }
  }
  throw lastErr;
}

async function drawClip(base, ink, audioPath, box, dur, dest) {
  const reveal = Math.min(1.8, Math.max(0.7, dur * 0.45)).toFixed(2);
  let lastErr;
  for (const mode of ['reveal', 'fade', 'box']) {
    try {
      await ffmpeg([
        '-y', '-loop', '1', '-framerate', '30', '-i', base, '-loop', '1', '-framerate', '30', '-i', ink, '-i', audioPath,
        '-t', dur.toFixed(2),
        '-filter_complex', `${inkFilter(box, mode, reveal)},fps=30,format=yuv420p[v]`,
        '-map', '[v]', '-map', '2:a',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        '-shortest', '-movflags', '+faststart',
        dest,
      ], dest);
      return;
    } catch (err) {
      lastErr = err;
      fs.rmSync(dest, { force: true });
    }
  }
  throw lastErr;
}

async function concatClips(files, work) {
  const list = path.join(work, 'list.txt');
  const out = path.join(work, 'whiteboard.mp4');
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
  const frame = frameOf(ratio === '9:16' ? '9:16' : '16:9');
  onPhase('正在寫旁白');
  const lines = mode === 'script'
    ? await picturesFor(splitScript(topic))
    : await writeLines(topic, voice, count, other);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-'));
  try {
    let board = path.join(work, 'board-0.bmp');
    blankBoard(board, frame);
    const clips = [];
    for (let i = 0; i < lines.length; i += 1) {
      onPhase(`正在畫第 ${i + 1} 筆，共 ${lines.length} 筆，並配上這一句`);
      const box = slotBox(frame, i);
      const base = box.fresh ? path.join(work, `blank-${i}.bmp`) : board;
      if (box.fresh) blankBoard(base, frame);
      const ink = path.join(work, `ink-${i}.png`);
      fs.writeFileSync(ink, await generateSketch(lines[i].picture));
      const audio = await clipTts.speak(lines[i].say);
      const ext = /mpeg|mp3/i.test(audio.mime || '') ? 'mp3' : 'wav';
      const aud = path.join(work, `aud-${i}.${ext}`);
      fs.writeFileSync(aud, audio.buffer);
      const dur = Math.min(18, Math.max(1.2, (await probeDuration(aud)) || 4));
      const clip = path.join(work, `clip-${i}.mp4`);
      await drawClip(base, ink, aud, box, dur, clip);
      const next = path.join(work, `board-${i + 1}.png`);
      await stampBoard(base, ink, box, next);
      board = next;
      clips.push(clip);
    }
    onPhase('正在接成一支片');
    const file = await concatClips(clips, work);
    return {
      buffer: fs.readFileSync(file),
      script: lines.map((row) => row.say).join(''),
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
      console.error('[whiteboard]', err.message);
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

module.exports = { configured, startJob, getJob, latestJob, slotBox, frameOf };
