const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const opentype = require('opentype.js');
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
  8: { n: 8, band: '38 到 46 個字', total: '320 到 360 個字', minutes: '約 1 分鐘' },
  12: { n: 12, band: '42 到 50 個字', total: '520 到 600 個字', minutes: '約 2 分鐘' },
  18: { n: 18, band: '42 到 50 個字', total: '780 到 900 個字', minutes: '約 3 分鐘' },
  24: { n: 24, band: '42 到 50 個字', total: '1040 到 1200 個字', minutes: '約 4 分鐘' },
  30: { n: 30, band: '42 到 50 個字', total: '1300 到 1500 個字', minutes: '約 5 分鐘' },
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
  const message = String(err && (err.message || err) || '').replace(/\s+/g, ' ').trim();
  if (/aborted|timeout/i.test(message)) return '寫旁白逾時，請再試一次。';
  if (/quota|429|RESOURCE_EXHAUSTED|high demand|UNAVAILABLE|503/i.test(message)) return '現在使用的人較多，請稍後再試。';
  if (/請|最多|至少|無法提供|尚未|轉檔|沒有產出|每一句|這次沒有|沒有寫滿|旁白語音|生圖/.test(message)) {
    return message.slice(0, 120);
  }
  const detail = message.replace(/https?:\/\/\S+/g, '').replace(/key=[^\s]+/gi, '').slice(0, 100);
  if (detail) return `這次沒有做成：${detail}`;
  const name = err && err.name ? String(err.name) : '';
  if (name && name !== 'Error') return `這次沒有做成：${name}`;
  return '這次沒有做成，請再試一次。';
}

function unwrapPlan(data) {
  if (Array.isArray(data)) {
    const beats = [];
    data.forEach((row) => {
      if (Array.isArray(row?.beats)) beats.push(...row.beats);
      else if (row && (row.say || row.text || row.op)) beats.push(row);
    });
    return { beats };
  }
  return data;
}

function closeJson(raw) {
  let text = String(raw || '').trim().replace(/,\s*$/, '');
  if ((text.match(/"/g) || []).length % 2 === 1) text = text.replace(/"[^"]*$/, '').replace(/,\s*$/, '');
  const curly = (text.match(/{/g) || []).length - (text.match(/}/g) || []).length;
  const square = (text.match(/\[/g) || []).length - (text.match(/]/g) || []).length;
  return text + ']'.repeat(Math.max(0, square)) + '}'.repeat(Math.max(0, curly));
}

function extractJson(text) {
  const raw = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const tries = [raw];
  const from = raw.indexOf('{');
  const to = raw.lastIndexOf('}');
  if (from >= 0 && to > from) tries.push(raw.slice(from, to + 1));
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) tries.push(raw.slice(start, end + 1));
  if (from >= 0) tries.push(closeJson(raw.slice(from)));
  for (const item of tries) {
    if (!item) continue;
    for (const body of [item, item.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        return unwrapPlan(JSON.parse(body));
      } catch {
        /* 下一筆 */
      }
    }
  }
  throw new Error('沒有產出旁白');
}

const BEAT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    beats: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          say: { type: 'STRING' },
          op: { type: 'STRING' },
          what: { type: 'STRING' },
          text: { type: 'STRING' },
        },
        required: ['say', 'op'],
      },
    },
  },
  required: ['beats'],
};

async function askText(prompt) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('生圖尚未開通。');
  let lastErr;
  const attempts = [
    ['gemini-flash-lite-latest', true],
    ['gemini-flash-lite-latest', false],
    ['gemini-3.6-flash', true],
    ['gemini-3.6-flash', false],
  ];
  for (const [model, schema] of attempts) {
    try {
      const generationConfig = { temperature: 0.4, maxOutputTokens: 4096 };
      if (schema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = BEAT_SCHEMA;
      }
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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error?.message || `旁白服務 ${res.status}`);
      const parts = json.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((part) => part && part.text && !part.thought).map((part) => part.text).join('\n')
        || parts.map((part) => part.text || '').join('\n');
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

const OPS = new Set(['object', 'label', 'circle', 'arrow']);
const DRAW_TALK = /白板|畫出|畫上|畫一個|畫成|寫上|圈起來|拉出箭頭|圖示|這一筆|箭頭指向/;
const PLAN = [
  '你在安排一支白板教學。旁白只教主題，圖負責把那一句畫出來。只輸出 JSON。',
  '{"beats":[{"say":"","op":"object","what":"","text":""}]}',
  'op 只能是 object、label、circle、arrow。',
  'object：這一筆要出現的實物，what 寫清楚那個東西。不要畫人，除非這句沒有人就講不清楚。禁止火柴人。',
  'label：在剛出現的東西旁邊寫很短的字，text 最多 8 個字，例如 +1,000、10,000、複利。',
  'circle：標出剛剛那個重點。text 留空。',
  'arrow：從剛出現的東西指向下一步。text 可寫指到的短字。',
  '順序固定成一輪一輪：先 object，再 label，再 circle 或 arrow，然後才換下一個 object。大約每 3 到 4 筆才有一個 object。',
  'say 是老師對觀眾講的繁體中文，在教主題本身。聽到這句時，畫面同時加上對應的那一筆。',
  'say 禁止描述作畫。不要出現白板、畫出、畫上、寫上、圈起來、拉箭頭、圖示、這一筆。',
].join('\n');

function asBeats(rows, limit) {
  const beats = (Array.isArray(rows) ? rows : []).map((row) => {
    const written = clean(row && row.text, 80);
    const spoken = clean(row && row.say, 80) || (written.length > 12 ? written : '');
    return {
      say: sentence(spoken),
      op: OPS.has(row && row.op) ? row.op : 'label',
      what: clean(row && row.what, 180),
      text: spoken && spoken !== written && written.length <= 16 ? written : '',
    };
  }).filter((row) => row.say);
  if (beats.length && beats[0].op !== 'object') beats[0].op = 'object';
  return beats.slice(0, limit);
}

function drawingTalk(beats) {
  return beats.filter((row) => DRAW_TALK.test(row.say)).length;
}

async function writeBatch(text, voice, other, choice, need, done, total) {
  const tone = voice === 'other'
    ? `口吻：${clean(other, 120) || '自然口語'}`
    : (VOICES[voice] || VOICES.teach);
  const lesson = [
    PLAN,
    `這一批只寫 ${need} 筆。整支片共 ${total} 筆，現在從第 ${done + 1} 筆寫到第 ${done + need} 筆。`,
    `整支片唸完要${choice.minutes}，全部 say 加起來 ${choice.total}。這一筆每一句 ${choice.band}，結尾用句號。`,
    '句子接起來是一堂課：第一筆點出主題，中間按順序講原因和做法，最後一筆留一個記得住的結論。',
    '份量要剛好塞進這個長度。選較短就少講幾件事，不要把長課硬塞進來，也不要只剩幾句空話。',
    '只講主題裡有的內容，不要編價格、功效、人名。色情、未成年性相關、犯罪教學就回 {"error":"無法提供"}。',
    tone,
    `主題：${clean(text, 500)}`,
  ];
  let best = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const extra = attempt
        ? '上一批在教怎麼畫。這次 say 只能教主題，禁止白板、畫出、寫上、圈起來、箭頭、圖示。'
        : '';
      const data = await askText([...lesson, extra].filter(Boolean).join('\n'));
      const beats = asBeats(data.beats, need);
      if (!best.length || drawingTalk(beats) < drawingTalk(best)) best = beats;
      if (beats.length && drawingTalk(beats) === 0) return beats;
    } catch (err) {
      if (err.message === '無法提供') throw err;
      if (best.length) return best;
      throw err;
    }
  }
  return best;
}

function localBeats(topic, n) {
  const subject = clean(topic, 18) || '這件事';
  const pattern = [
    { op: 'object', what: `${subject}的起點`, text: '', say: `${subject}先看起點。後面所有的變化，都是從這個起點慢慢累積出來的。` },
    { op: 'label', what: '', text: '起點', say: '把這個起點記下來。等一下每一步，都拿它來比較有沒有變多。' },
    { op: 'circle', what: '', text: '', say: '今天最重要的就是這個起點。看懂它，後面的數字才不會算錯。' },
    { op: 'arrow', what: '', text: '變多', say: '時間拉長以後，它會在原來的基礎上再增加，不是每次都從零開始。' },
  ];
  return Array.from({ length: n }, (_, index) => {
    const row = pattern[index % pattern.length];
    return { ...row, say: sentence(row.say) };
  });
}

async function writeLines(text, voice, count, other) {
  const choice = lengthChoice(count);
  const n = choice.n;
  const lines = [];
  try {
    while (lines.length < n) {
      const need = Math.min(6, n - lines.length);
      const batch = await writeBatch(text, voice, other, choice, need, lines.length, n);
      if (!batch.length) break;
      lines.push(...batch);
    }
  } catch (err) {
    if (err.message === '無法提供') throw err;
  }
  if (lines.length >= Math.min(4, n)) return lines.slice(0, n);
  return localBeats(text, n);
}

async function picturesFor(says) {
  try {
    const data = await askText([
      PLAN,
      '下面每一句都已經寫好，不要改 say 的字，只要決定 op、what、text。筆數和順序必須一樣。',
      '色情、未成年性相關、犯罪教學就回 {"error":"無法提供"}。',
      ...says.map((say, i) => `${i + 1}. ${say}`),
    ].join('\n'));
    const beats = asBeats(data.beats, says.length);
    if (beats.length === says.length) return beats.map((beat, i) => ({ ...beat, say: says[i] }));
  } catch (err) {
    if (err.message === '無法提供') throw err;
  }
  return says.map((say, i) => ({
    say,
    op: i % 4 === 0 ? 'object' : (i % 4 === 1 ? 'label' : (i % 4 === 2 ? 'circle' : 'arrow')),
    what: say,
    text: '',
  }));
}

function partImage(part) {
  if (!part || part.thought) return null;
  const inline = part.inlineData || part.inline_data;
  if (!inline || !inline.data) return null;
  return Buffer.from(inline.data, 'base64');
}

async function generateSketch(picture, promptOverride) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const prompt = promptOverride || [
    '1:1。純白背景。彩色白板插畫，平塗、顏色清楚，這個物件畫滿畫面大約八成。',
    `只畫這一個東西：${picture}`,
    '不要畫人，不要火柴人，不要箭頭，不要方框，不要任何文字和數字。',
    '不要照片、不要黑白線稿、不要灰色紙、不要格子、不要商標。',
    '成長或變多就畫成往上的階梯，或一根往上的線。不要畫成一圈圈的螺旋，也不要彩虹圈。',
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
  if (ratio === '9:16') return { w: 720, h: 1280, cols: 1, rows: 2 };
  return { w: 1280, h: 720, cols: 2, rows: 2 };
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
    const proc = spawn(bin, ['-threads', '1', '-i', file, '-f', 'null', '-'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); }, 20000);
    proc.on('close', () => {
      clearTimeout(timer);
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return resolve(0);
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
    proc.on('error', () => { clearTimeout(timer); resolve(0); });
  });
}

function ffmpeg(args, output) {
  const bin = ffmpegBin();
  if (!bin) return Promise.reject(new Error('轉檔工具尚未就緒，這次沒有生圖。'));
  const full = ['-threads', '1', '-filter_threads', '1', ...args];
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, full, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (chunk) => {
      err += chunk;
      if (err.length > 4000) err = err.slice(-4000);
    });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); }, 90000);
    const finish = (fn) => {
      clearTimeout(timer);
      fn();
    };
    proc.on('error', (error) => finish(() => reject(error)));
    proc.on('close', (code) => finish(() => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) resolve(output);
      else {
        const lines = err.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
        const line = lines.find((row) => /No such filter|Filter not found|Invalid|Error/i.test(row)) || lines[lines.length - 1] || '沒有產出畫面';
        reject(new Error(`轉檔失敗：${line.slice(0, 140)}`));
      }
    }));
  });
}

function inkFilter(box, mode, reveal) {
  const parts = [
    `scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease`,
    `pad=${box.w}:${box.h}:(ow-iw)/2:(oh-ih)/2:white`,
  ];
  if (mode !== 'box') parts.push('format=rgba', 'colorkey=0xFFFFFF:0.12:0.04');
  if (mode === 'reveal' && reveal) parts.push(`crop=w='max(2\\,min(iw\\,iw*t/${reveal}))':h=ih:0:0`);
  else if (mode === 'fade' && reveal) parts.push(`fade=t=in:st=0:d=${reveal}:alpha=1`);
  return `[1:v]${parts.join(',')}[ink];[0:v][ink]overlay=${box.x}:${box.y}:format=auto`;
}

async function fitStill(input, w, h, dest) {
  await ffmpeg([
    '-y', '-i', input,
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:white,format=rgba`,
    '-frames:v', '1', dest,
  ], dest);
}

function releaseFont() {
  boardFont = null;
}

let boardFont;

function loadedFont() {
  if (boardFont) return boardFont;
  const file = path.join(__dirname, '..', 'assets', 'jf-openhuninn-2.1.ttf');
  if (!fs.existsSync(file)) throw new Error('白板字型尚未就緒。');
  boardFont = opentype.loadSync(file);
  return boardFont;
}

function glyphContours(text) {
  const glyphPath = loadedFont().getPath(text, 0, 64, 64);
  const contours = [];
  let current = null;
  let cx = 0;
  let cy = 0;
  const lineTo = (x, y) => {
    current.push({ x, y });
    cx = x;
    cy = y;
  };
  glyphPath.commands.forEach((cmd) => {
    if (cmd.type === 'M') {
      current = [{ x: cmd.x, y: cmd.y }];
      contours.push(current);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'L') {
      lineTo(cmd.x, cmd.y);
    } else if (cmd.type === 'Q') {
      const x0 = cx;
      const y0 = cy;
      for (let step = 1; step <= 10; step += 1) {
        const t = step / 10;
        const mt = 1 - t;
        lineTo(mt * mt * x0 + 2 * mt * t * cmd.x1 + t * t * cmd.x, mt * mt * y0 + 2 * mt * t * cmd.y1 + t * t * cmd.y);
      }
    } else if (cmd.type === 'C') {
      const x0 = cx;
      const y0 = cy;
      for (let step = 1; step <= 10; step += 1) {
        const t = step / 10;
        const mt = 1 - t;
        lineTo(
          mt * mt * mt * x0 + 3 * mt * mt * t * cmd.x1 + 3 * mt * t * t * cmd.x2 + t * t * t * cmd.x,
          mt * mt * mt * y0 + 3 * mt * mt * t * cmd.y1 + 3 * mt * t * t * cmd.y2 + t * t * t * cmd.y,
        );
      }
    } else if (cmd.type === 'Z' && current && current.length) {
      current.push({ x: current[0].x, y: current[0].y });
    }
  });
  return contours.filter((pts) => pts.length > 2);
}

function writeMarkBmp(file, w, h, paint, color) {
  const width = Math.max(8, w);
  const height = Math.max(8, h);
  const ink = color || { r: 28, g: 48, b: 120 };
  const row = Math.ceil((width * 3) / 4) * 4;
  const pixels = row * height;
  const buf = Buffer.alloc(54 + pixels);
  buf.fill(0xff, 54);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + pixels, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixels, 34);
  const pts = [];
  const seen = new Uint8Array(width * height);
  const set = (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const off = 54 + (height - 1 - py) * row + px * 3;
    buf[off] = ink.b;
    buf[off + 1] = ink.g;
    buf[off + 2] = ink.r;
    const i = py * width + px;
    if (!seen[i]) {
      seen[i] = 1;
      pts.push(i);
    }
  };
  let splitAt = null;
  const cut = () => { if (splitAt == null) splitAt = pts.length; };
  paint(set, width, height, cut);
  fs.writeFileSync(file, buf);
  return { pts, split: splitAt == null ? pts.length : splitAt, color: ink, width, height };
}

function circleInk(file, w, h) {
  return writeMarkBmp(file, w, h, (set, width, height) => {
    const cx = width / 2;
    const cy = height / 2;
    const rx = width / 2 - 8;
    const ry = height / 2 - 8;
    for (let deg = 0; deg < 360; deg += 2) {
      const t = deg * Math.PI / 180;
      const x = cx + rx * Math.cos(t);
      const y = cy + ry * Math.sin(t);
      for (let oy = -4; oy <= 4; oy += 1) {
        for (let ox = -4; ox <= 4; ox += 1) {
          if (ox * ox + oy * oy <= 16) set(x + ox, y + oy);
        }
      }
    }
  }, { r: 196, g: 48, b: 43 });
}

function penInk(file) {
  writeMarkBmp(file, 36, 36, (set, width, height) => {
    const cx = width / 2;
    const cy = height / 2;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= 49) set(x, y);
      }
    }
  }, { r: 22, g: 110, b: 184 });
}

function arrowInk(file, w, h) {
  return writeMarkBmp(file, w, h, (set, width, height) => {
    const y = Math.round(height / 2);
    for (let x = 6; x < width - 26; x += 1) {
      for (let k = -3; k <= 3; k += 1) set(x, y + k);
    }
    for (let i = 0; i < 24; i += 1) {
      for (let k = -Math.floor(i * 0.7); k <= Math.floor(i * 0.7); k += 1) set(width - 8 - i, y + k);
    }
  }, { r: 22, g: 110, b: 184 });
}

function labelInk(file, w, h, text) {
  const label = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 16) || '重點';
  const contours = glyphContours(label);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  contours.forEach((pts) => pts.forEach((pt) => {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }));
  const gw = Math.max(1, maxX - minX);
  const gh = Math.max(1, maxY - minY);
  const scale = Math.min((Math.max(8, w) - 8) / gw, (Math.max(8, h) - 8) / gh);
  const dx = (w - gw * scale) / 2 - minX * scale;
  const dy = (h - gh * scale) / 2 - minY * scale;
  const placed = contours.map((pts) => pts.map((pt) => ({ x: pt.x * scale + dx, y: pt.y * scale + dy })));
  return writeMarkBmp(file, w, h, (set, width, height, cut) => {
    const dot = (x, y) => {
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let ox = -2; ox <= 2; ox += 1) {
          if (ox * ox + oy * oy <= 5) set(x + ox, y + oy);
        }
      }
    };
    placed.forEach((stroke) => {
      for (let i = 0; i < stroke.length - 1; i += 1) {
        const a = stroke[i];
        const b = stroke[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
        for (let s = 0; s <= steps; s += 1) {
          const t = s / steps;
          dot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        }
      }
    });
    cut();
    for (let y = 0; y < height; y += 1) {
      const hits = [];
      placed.forEach((pts) => {
        for (let i = 0; i < pts.length - 1; i += 1) {
          const a = pts[i];
          const b = pts[i + 1];
          if ((a.y > y) === (b.y > y)) continue;
          hits.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
        }
      });
      hits.sort((p, q) => p - q);
      for (let i = 0; i + 1 < hits.length; i += 2) {
        const from = Math.max(0, Math.ceil(hits[i]));
        const to = Math.min(width - 1, Math.floor(hits[i + 1]));
        for (let x = from; x <= to; x += 1) set(x, y);
      }
    }
  }, { r: 28, g: 48, b: 120 });
}

function placeBeats(frame, beats, scale) {
  let x = 36;
  let y = 36;
  let rowH = 0;
  let last = null;
  let overflow = false;
  const edge = 16;
  const items = beats.map((beat) => {
    const op = OPS.has(beat.op) ? beat.op : 'label';
    const text = clean(beat.text, 8);
    const w = Math.max(48, Math.round((op === 'object'
      ? Math.min(280, frame.w * 0.28)
      : (op === 'arrow' ? 160 : (op === 'circle' && last ? last.w + 28 : Math.min(280, 28 + Math.max(2, text.length) * 36)))) * scale));
    const h = Math.max(36, Math.round((op === 'object'
      ? Math.min(220, frame.h * 0.32)
      : (op === 'circle' && last ? last.h + 28 : (op === 'arrow' ? 64 : 72))) * scale));
    let bx = x;
    let by = y;
    if (op === 'object' || !last) {
      if (x + w > frame.w - edge) { x = 36; y += rowH + 16; rowH = 0; }
      bx = x;
      by = y;
      x += w + 16;
      rowH = Math.max(rowH, h);
    } else if (op === 'circle') {
      bx = last.x - 12;
      by = last.y - 12;
    } else if (op === 'label') {
      bx = last.x + last.w + 10;
      by = last.y + Math.max(0, Math.floor((last.h - h) / 2));
      if (bx + w > frame.w - edge) { bx = last.x; by = last.y + last.h + 8; }
    } else {
      bx = last.x + last.w + 8;
      by = last.y + Math.max(0, Math.floor(last.h / 2) - Math.floor(h / 2));
      if (bx + w > frame.w - edge) { bx = last.x; by = last.y + last.h + 8; }
    }
    if (bx < 8 || by < 8 || bx + w > frame.w - edge || by + h > frame.h - edge) overflow = true;
    const box = {
      x: Math.max(8, Math.min(frame.w - w - 8, Math.round(bx))),
      y: Math.max(8, Math.min(frame.h - h - 8, Math.round(by))),
      w: Math.round(w),
      h: Math.round(h),
    };
    if (op !== 'circle') {
      last = box;
      rowH = Math.max(rowH, (box.y + box.h) - y);
    }
    return { say: beat.say, op, what: beat.what, text, box, fresh: false };
  });
  return { items, overflow };
}

function layoutBeats(frame, beats) {
  let chosen = placeBeats(frame, beats, 1);
  for (let scale = 0.92; scale >= 0.46 && chosen.overflow; scale -= 0.08) {
    chosen = placeBeats(frame, beats, scale);
  }
  return chosen.items;
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

function probeSize(file) {
  const bin = ffmpegBin();
  if (!bin || !fs.existsSync(file)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const proc = spawn(bin, ['-i', file], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); }, 15000);
    proc.on('close', () => {
      clearTimeout(timer);
      const found = [...stderr.matchAll(/(\d{2,5})x(\d{2,5})/g)];
      const last = found[found.length - 1];
      resolve(last ? { w: Number(last[1]), h: Number(last[2]) } : null);
    });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

async function readRgb(file, w, h) {
  const raw = `${file}.rgb`;
  await ffmpeg(['-y', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-frames:v', '1', raw], raw);
  const buf = fs.readFileSync(raw);
  fs.rmSync(raw, { force: true });
  if (buf.length < w * h * 3) throw new Error('畫面讀不出來');
  return buf.subarray(0, w * h * 3);
}

function writeFrameBmp(file, rgb, w, h) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const pixels = row * h;
  const buf = Buffer.alloc(54 + pixels);
  buf.fill(0xff, 54);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + pixels, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixels, 34);
  for (let y = 0; y < h; y += 1) {
    const src = y * w * 3;
    const off = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x += 1) {
      buf[off + x * 3] = rgb[src + x * 3 + 2];
      buf[off + x * 3 + 1] = rgb[src + x * 3 + 1];
      buf[off + x * 3 + 2] = rgb[src + x * 3];
    }
  }
  fs.writeFileSync(file, buf);
}

function traceEdges(edge, w, h) {
  const list = [];
  for (let i = 0; i < edge.length; i += 1) if (edge[i]) list.push(i);
  if (!list.length) return list;
  const cell = 12;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const buckets = Array.from({ length: rows * cols }, () => []);
  const alive = new Uint8Array(edge.length);
  list.forEach((i) => {
    alive[i] = 1;
    const x = i % w;
    const y = (i / w) | 0;
    buckets[((y / cell) | 0) * cols + ((x / cell) | 0)].push(i);
  });
  const path = [];
  let unused = list.length;
  let startAt = 0;
  while (unused > 0) {
    while (startAt < list.length && !alive[list[startAt]]) startAt += 1;
    if (startAt >= list.length) break;
    let cur = list[startAt];
    alive[cur] = 0;
    unused -= 1;
    path.push(cur);
    while (unused > 0) {
      const x = cur % w;
      const y = (cur / w) | 0;
      let best = -1;
      let bestD = 18 * 18;
      const cx0 = Math.max(0, ((x / cell) | 0) - 1);
      const cy0 = Math.max(0, ((y / cell) | 0) - 1);
      const cx1 = Math.min(cols - 1, ((x / cell) | 0) + 1);
      const cy1 = Math.min(rows - 1, ((y / cell) | 0) + 1);
      for (let cy = cy0; cy <= cy1; cy += 1) {
        for (let cx = cx0; cx <= cx1; cx += 1) {
          const bucket = buckets[cy * cols + cx];
          for (let k = 0; k < bucket.length; k += 1) {
            const j = bucket[k];
            if (!alive[j]) continue;
            const dx = (j % w) - x;
            const dy = ((j / w) | 0) - y;
            const dist = dx * dx + dy * dy;
            if (dist > 0 && dist < bestD) { bestD = dist; best = j; }
          }
        }
      }
      if (best < 0) break;
      alive[best] = 0;
      unused -= 1;
      path.push(best);
      cur = best;
    }
  }
  return path;
}

function planImage(rgb, w, h) {
  const n = w * h;
  const ink = new Uint8Array(n);
  const edge = new Uint8Array(n);
  const nearWhite = (i) => rgb[i] > 244 && rgb[i + 1] > 244 && rgb[i + 2] > 244;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (nearWhite(i * 3)) continue;
      ink[i] = 1;
      let border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (!border) {
        const c = rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2];
        const neighbors = [i - 1, i + 1, i - w, i + w];
        for (let k = 0; k < neighbors.length; k += 1) {
          const j = neighbors[k];
          if (nearWhite(j * 3)) { border = true; break; }
          const d = rgb[j * 3] + rgb[j * 3 + 1] + rgb[j * 3 + 2];
          if (Math.abs(c - d) > 72) { border = true; break; }
        }
      }
      if (border) edge[i] = 1;
    }
  }
  let path = traceEdges(edge, w, h);
  if (path.length < 12) {
    path = [];
    for (let i = 0; i < n; i += 4) if (ink[i]) path.push(i);
  }
  const time = new Int32Array(n);
  time.fill(-1);
  path.forEach((i, tick) => {
    const x = i % w;
    const y = (i / w) | 0;
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const xx = x + ox;
        const yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (ink[j] && time[j] < 0) time[j] = tick;
      }
    }
  });
  const edgeEnd = Math.max(1, path.length);
  const dist = new Int32Array(n);
  dist.fill(-1);
  const queue = [];
  for (let i = 0; i < n; i += 1) {
    if (time[i] >= 0) { dist[i] = 0; queue.push(i); }
  }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head];
    head += 1;
    const x = i % w;
    const y = (i / w) | 0;
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let k = 0; k < next.length; k += 1) {
      const xx = x + next[k][0];
      const yy = y + next[k][1];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!ink[j] || dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      time[j] = edgeEnd + dist[j];
      queue.push(j);
    }
  }
  let maxTime = edgeEnd;
  for (let i = 0; i < n; i += 1) {
    if (!ink[i]) continue;
    if (time[i] < 0) time[i] = edgeEnd;
    if (time[i] > maxTime) maxTime = time[i];
  }
  return { time, edgeEnd, maxTime, path };
}

function putRgb(buf, w, h, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= w || py >= h) return;
  const off = (py * w + px) * 3;
  buf[off] = color[0];
  buf[off + 1] = color[1];
  buf[off + 2] = color[2];
}

function drawNib(buf, w, h, x, y) {
  const tip = [20, 24, 32];
  const body = [22, 110, 184];
  for (let oy = -2; oy <= 2; oy += 1) {
    for (let ox = -2; ox <= 2; ox += 1) {
      if (ox * ox + oy * oy <= 5) putRgb(buf, w, h, x + ox, y + oy, tip);
    }
  }
  for (let s = 3; s <= 16; s += 1) {
    const px = x - s;
    const py = y - Math.round(s * 0.45);
    putRgb(buf, w, h, px, py, body);
    putRgb(buf, w, h, px, py + 1, body);
    putRgb(buf, w, h, px + 1, py, body);
  }
}

async function drawSpeed(base, plan, audioPath, box, dur, dest, board) {
  const size = await probeSize(base);
  if (!size || size.w !== board.w || size.h !== board.h) throw new Error('白板尺寸對不上');
  const boardRgb = Buffer.from(await readRgb(base, board.w, board.h));
  let image = null;
  if (plan.kind === 'image') {
    const shot = await probeSize(plan.file);
    if (!shot || shot.w !== box.w || shot.h !== box.h) throw new Error('圖的尺寸對不上');
    const rgb = await readRgb(plan.file, box.w, box.h);
    image = { rgb, ...planImage(rgb, box.w, box.h) };
    if (!image.path.length) throw new Error('這張圖沒有可畫的筆畫');
  } else if (!plan.pts || plan.pts.length < 2) {
    throw new Error('這一筆太少');
  }
  let lead = Math.min(0.7, Math.max(0.35, dur * 0.18));
  let drawSec = Math.min(1.6, Math.max(0.7, dur - lead - 0.08));
  if (lead + drawSec > dur - 0.05) {
    drawSec = Math.max(0.55, dur - lead - 0.05);
  }
  const frames = Math.max(8, Math.min(14, Math.round(drawSec * 10)));
  const dir = path.join(path.dirname(dest), `spd-${path.basename(dest, '.mp4')}`);
  fs.mkdirSync(dir, { recursive: true });
  const frame = Buffer.alloc(boardRgb.length);
  writeFrameBmp(path.join(dir, 'f-000.bmp'), boardRgb, board.w, board.h);
  const split = plan.kind === 'marks' ? Math.max(1, Math.min(plan.pts.length, plan.split || plan.pts.length)) : 0;
  try {
    for (let f = 0; f < frames; f += 1) {
      boardRgb.copy(frame);
      const t = (f + 1) / frames;
      let penAt = null;
      if (image) {
        const edgeEnd = image.edgeEnd;
        const threshold = image.maxTime <= edgeEnd || t >= 1
          ? Math.ceil(t * image.maxTime)
          : (t < 0.58
            ? Math.ceil((t / 0.58) * edgeEnd)
            : edgeEnd + Math.ceil(((t - 0.58) / 0.42) * (image.maxTime - edgeEnd)));
        for (let y = 0; y < box.h; y += 1) {
          for (let x = 0; x < box.w; x += 1) {
            const i = y * box.w + x;
            if (image.time[i] < 0 || image.time[i] > threshold) continue;
            const src = i * 3;
            const dx = box.x + x;
            const dy = box.y + y;
            if (dx < 0 || dy < 0 || dx >= board.w || dy >= board.h) continue;
            const off = (dy * board.w + dx) * 3;
            frame[off] = image.rgb[src];
            frame[off + 1] = image.rgb[src + 1];
            frame[off + 2] = image.rgb[src + 2];
          }
        }
        const at = image.path[Math.min(image.path.length - 1, Math.floor(t * (image.path.length - 1)))];
        penAt = { x: box.x + (at % box.w), y: box.y + ((at / box.w) | 0) };
      } else {
        const total = plan.pts.length;
        const count = split >= total - 2
          ? Math.max(1, Math.ceil(t * total))
          : (t < 0.6
            ? Math.max(1, Math.ceil((t / 0.6) * split))
            : Math.min(total, split + Math.ceil(((t - 0.6) / 0.4) * (total - split))));
        const color = [plan.color.r, plan.color.g, plan.color.b];
        const mw = plan.width || box.w;
        for (let p = 0; p < count; p += 1) {
          const i = plan.pts[p];
          const x = box.x + (i % mw);
          const y = box.y + ((i / mw) | 0);
          putRgb(frame, board.w, board.h, x, y, color);
        }
        const tip = plan.pts[Math.min(count, Math.max(split, 1)) - 1];
        const along = plan.pts[Math.min(split - 1, Math.floor(t * (split - 1)))];
        const use = t < 0.6 || split >= total - 2 ? tip : along;
        penAt = { x: box.x + (use % mw), y: box.y + ((use / mw) | 0) };
      }
      if (f < frames - 1 && penAt) drawNib(frame, board.w, board.h, penAt.x, penAt.y);
      writeFrameBmp(path.join(dir, `f-${String(f + 1).padStart(3, '0')}.bmp`), frame, board.w, board.h);
    }
    const fps = frames / drawSec;
    const startPad = Math.max(0, lead - (1 / fps));
    const hold = Math.max(0, dur - lead - drawSec);
    const pad = [
      startPad > 0.05 ? `start_mode=clone:start_duration=${startPad.toFixed(2)}` : '',
      hold > 0.05 ? `stop_mode=clone:stop_duration=${hold.toFixed(2)}` : '',
    ].filter(Boolean);
    const vf = `${pad.length ? `tpad=${pad.join(':')},` : ''}fps=12,format=yuv420p`;
    await ffmpeg([
      '-y', '-framerate', fps.toFixed(3), '-start_number', '0', '-i', path.join(dir, 'f-%03d.bmp'),
      '-i', audioPath, '-t', dur.toFixed(2), '-vf', vf,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-shortest', '-movflags', '+faststart',
      dest,
    ], dest);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function drawClip(base, ink, audioPath, box, dur, dest, pen) {
  const reveal = Math.max(0.6, Math.min(1.6, dur - 0.15)).toFixed(2);
  const penOn = pen
    ? `;[2:v]scale=36:36,format=rgba,colorkey=0xFFFFFF:0.2:0.08[pen];[drawn][pen]overlay=x='${box.x}+min(${Math.max(1, box.w - 20)}\\,max(0\\,${box.w}*t/${reveal}))-8':y='${box.y + Math.round(box.h * 0.42)}':format=auto`
    : '';
  let lastErr;
  for (const mode of ['reveal', 'fade']) {
    try {
      const args = [
        '-y', '-loop', '1', '-framerate', '30', '-i', base, '-loop', '1', '-framerate', '30', '-i', ink,
      ];
      if (pen) args.push('-loop', '1', '-framerate', '30', '-i', pen);
      args.push('-i', audioPath, '-t', dur.toFixed(2));
      const drawn = inkFilter(box, mode, reveal);
      const filter = pen
        ? `${drawn.replace(/format=auto$/, 'format=auto[drawn]')}${penOn},fps=30,format=yuv420p[v]`
        : `${drawn},fps=30,format=yuv420p[v]`;
      args.push(
        '-filter_complex', filter,
        '-map', '[v]', '-map', `${pen ? 3 : 2}:a`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        '-shortest', '-movflags', '+faststart',
        dest,
      );
      await ffmpeg(args, dest);
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
      '-y', '-threads', '1', '-f', 'concat', '-safe', '0', '-i', list,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '23',
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
  onPhase('正在安排要畫的順序');
  const lines = layoutBeats(frame, mode === 'script'
    ? await picturesFor(splitScript(topic))
    : await writeLines(topic, voice, count, other));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-'));
  try {
    const pen = path.join(work, 'pen.bmp');
    penInk(pen);
    let board = path.join(work, 'board-0.bmp');
    blankBoard(board, frame);
    const clips = [];
    const stepName = { object: '畫上新的東西', label: '寫上短字', circle: '把重點圈起來', arrow: '畫箭頭' };
    for (let i = 0; i < lines.length; i += 1) {
      const item = lines[i];
      onPhase(`正在第 ${i + 1} 筆，共 ${lines.length} 筆，${stepName[item.op] || '往下畫'}`);
      const base = board;
      const ink = path.join(work, `ink-${i}.png`);
      let plan;
      if (item.op === 'object') {
        const rawInk = path.join(work, `raw-${i}.png`);
        fs.writeFileSync(rawInk, await generateSketch(item.what || item.say));
        try {
          await fitStill(rawInk, item.box.w, item.box.h, ink);
          fs.rmSync(rawInk, { force: true });
        } catch (err) {
          console.error('[whiteboard] fit', err && err.message);
          fs.renameSync(rawInk, ink);
        }
        plan = { kind: 'image', file: ink };
      } else if (item.op === 'label') {
        const bmp = path.join(work, `ink-${i}.bmp`);
        plan = { kind: 'marks', ...labelInk(bmp, item.box.w, item.box.h, item.text || item.say.slice(0, 8)) };
        releaseFont();
        fs.renameSync(bmp, ink);
      } else if (item.op === 'circle') {
        plan = { kind: 'marks', ...circleInk(ink, item.box.w, item.box.h) };
      } else {
        plan = { kind: 'marks', ...arrowInk(ink, item.box.w, item.box.h) };
      }
      const audio = await clipTts.speak(item.say);
      const ext = /mpeg|mp3/i.test(audio.mime || '') ? 'mp3' : 'wav';
      const aud = path.join(work, `aud-${i}.${ext}`);
      fs.writeFileSync(aud, audio.buffer);
      const dur = Math.min(18, Math.max(1.2, (await probeDuration(aud)) || 4));
      const clip = path.join(work, `clip-${i}.mp4`);
      try {
        await drawSpeed(base, plan, aud, item.box, dur, clip, frame);
      } catch (err) {
        console.error('[whiteboard] speed', err && err.message);
        try {
          await drawClip(base, ink, aud, item.box, dur, clip, pen);
        } catch (penErr) {
          console.error('[whiteboard] pen', penErr && penErr.message);
          await drawClip(base, ink, aud, item.box, dur, clip, '');
        }
      }
      const next = path.join(work, `board-${i + 1}.png`);
      await stampBoard(base, ink, item.box, next);
      board = next;
      clips.push(clip);
    }
    onPhase('正在接成一支片');
    const file = await concatClips(clips, work);
    return {
      buffer: fs.readFileSync(file),
      script: lines.map((row) => row.say).join(''),
      lines: lines.map((row) => ({ say: row.say, picture: row.text || row.what || row.op })),
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
      try {
        job.error = publicError(err);
      } catch (inner) {
        job.error = '這次沒有做成：' + String(inner && inner.message || inner || '錯誤').slice(0, 80);
      }
      console.error('[whiteboard]', err && (err.stack || err.message || err));
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
