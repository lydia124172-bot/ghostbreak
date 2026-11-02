const fs = require('fs');
const os = require('os');
const path = require('path');
const clipVideo = require('./clip-video');
const clipExport = require('./clip-export');

function configured() {
  return clipVideo.configured() && Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

function tidy(text, max) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function ratioOf(value) {
  if (value === '16:9' || value === '1:1' || value === '9:16') return value;
  return '9:16';
}

function ratioWords(ratio) {
  if (ratio === '16:9') return '橫式 16:9';
  if (ratio === '1:1') return '方形 1:1';
  return '直式 9:16';
}

function fontFile() {
  const candidates = [
    'C:/Windows/Fonts/msjh.ttc',
    'C:/Windows/Fonts/msjhbd.ttc',
    'C:/Windows/Fonts/mingliu.ttc',
  ];
  return candidates.find((file) => fs.existsSync(file)) || '';
}

function parsePlan(text) {
  const raw = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('沒有排好這一鏡，請再試一次。');
  let data;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('沒有排好這一鏡，請再試一次。');
  }
  const shots = Array.isArray(data.shots) ? data.shots.slice(0, 1) : [];
  if (!shots.length) throw new Error('沒有排好這一鏡，請再試一次。');
  const panels = (Array.isArray(data.panels) ? data.panels : [])
    .map((panel) => ({
      label: tidy(panel && panel.label, 16),
      value: tidy(panel && panel.value, 18),
      note: tidy(panel && panel.note, 16),
    }))
    .filter((panel) => panel.label || panel.value)
    .slice(0, 6);
  return {
    ratio: ratioOf(data.ratio),
    cast: tidy(data.cast, 180),
    place: tidy(data.place, 180),
    panels,
    shots: shots.map((shot, index) => {
      const visual = tidy(shot && shot.visual, 280);
      const motion = tidy(shot && shot.motion, 160);
      if (visual.length < 4) throw new Error(`第 ${index + 1} 鏡沒有畫面。`);
      return { visual, motion: motion || '自然地動一下', line: tidy(shot && shot.line, 40) };
    }),
  };
}

async function askPlan(instruction, seconds) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('廣告影片尚未開通。');
  const prompt = [
    '你是廣告導演。使用者只給一句指令，你要排一支只有一鏡的影片。',
    '只輸出 JSON，不要 markdown。',
    '{"ratio":"9:16","cast":"","place":"","panels":[{"label":"","value":"","note":""}],"shots":[{"visual":"","motion":"","line":""}]}',
    'ratio 只能是 9:16、16:9、1:1。沒說比例就用 9:16。橫式簡報用 16:9，方形用 1:1。',
    '只有一鏡。cast 寫外貌，沒有人就空字串。place 只寫一個地點。',
    'visual 寫可拍的畫面，人要能轉過來面對鏡頭。motion 寫這一整段的動作，最後必須轉成正面看觀眾。line 是要說的一句話，沒有對白就空字串，最多 18 個字。',
    '指令沒有要求數據、看板、介面、全息、營收、圖表時，panels 必須是空陣列。',
    '有要求時最多 6 個。label、value、note 只能用指令裡寫過的字和數字，不要自己編金額或百分比。',
    `片長 ${seconds} 秒，動作要在這一段做完，最後人要轉成正面看觀眾。`,
    `指令：${instruction}`,
  ].join('\n');
  const models = ['gemini-flash-lite-latest', 'gemini-3.6-flash'];
  let lastErr;
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: /flash-lite/i.test(model)
              ? { temperature: 0.4, maxOutputTokens: 1800 }
              : { temperature: 0.4, maxOutputTokens: 1800, thinkingConfig: { thinkingBudget: 0 } },
          }),
          signal: AbortSignal.timeout(45000),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error?.message || `排鏡失敗 ${res.status}`);
      const text = (json.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('\n');
      return parsePlan(text);
    } catch (err) {
      lastErr = err;
      if (/沒有排好|沒有畫面/.test(err.message || '')) throw err;
    }
  }
  throw lastErr || new Error('沒有排好這一鏡，請再試一次。');
}

function imageDataUrl(part) {
  const raw = part && (part.inlineData || part.inline_data);
  if (!raw || !raw.data) return '';
  const mime = String(raw.mimeType || raw.mime_type || 'image/jpeg');
  const kind = /png/i.test(mime) ? 'png' : /webp/i.test(mime) ? 'webp' : 'jpeg';
  return `data:image/${kind};base64,${raw.data}`;
}

async function geminiStill(parts, ratio, imageSize) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const size = imageSize === '1K' ? '1K' : '2K';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: ratio, imageSize: size },
        },
      }),
      signal: AbortSignal.timeout(120000),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json.error?.message || `畫面失敗 ${res.status}`;
    if (size === '2K' && /invalid|imageSize|2K/i.test(message)) return geminiStill(parts, ratio, '1K');
    throw new Error(message);
  }
  const image = (json.candidates?.[0]?.content?.parts || []).map(imageDataUrl).find(Boolean);
  if (!image) throw new Error('沒有產出畫面，請再試一次。');
  return image;
}

function stillParts(plan, shot, hero) {
  const text = [
    `${ratioWords(plan.ratio)} 寫實廣告畫面，電影光。`,
    plan.cast ? `人物全程同一位：${plan.cast}` : '依這一鏡決定有沒有人。',
    plan.place ? `地點：${plan.place}` : '',
    hero ? '附圖是同一個人。臉、髮型、衣服要一樣，這一鏡的姿勢可以不同。' : '',
    plan.panels.length
      ? '人在畫面正中央，開始是側背，臉要露得出來。不要畫螢幕、光球、圖表、文字、數字、字幕、浮水印。四周留空，半透明數據板稍後會繞著他轉。'
      : '不要字幕、標題、浮水印，也不要出現可讀的亂碼。',
    `這一鏡：${shot.visual}`,
  ].filter(Boolean).join('\n');
  const parts = [{ text }];
  if (hero) {
    const file = clipVideo.parseDataUrl(hero);
    parts.push({ inline_data: { mime_type: file.mime, data: file.b64 } });
  }
  return parts;
}

function motionPrompt(plan, shot) {
  const line = shot.line
    ? `The only spoken words are exactly: "${shot.line}". Say that once, then stop.`
    : 'No speech. Ambient room sound only. Do not add dialogue, lyrics, or a narrator.';
  return [
    line,
    `${ratioWords(plan.ratio)} cinematic advertising shot, ${plan.seconds || 5} seconds, photoreal.`,
    'Animate this still. Keep the same face, hair, clothes, and place.',
    'He starts in a three-quarter back view, then turns until he faces the camera and looks straight at the viewer. His face is clear at the end. Do not keep his back to the camera.',
    plan.panels.length
      ? 'Do not add hologram spheres, screens, charts, captions, or readable text. Keep him in the center so panels can circle around him.'
      : 'No captions, subtitles, logos, or watermarks.',
    plan.cast ? `Same person: ${plan.cast}` : '',
    plan.place ? `Same place: ${plan.place}` : '',
    `Action: ${shot.motion}`,
    `Scene, not spoken: ${shot.visual}`,
    line,
  ].filter(Boolean).join('\n');
}

async function waitScene(job) {
  const started = Date.now();
  while (Date.now() - started < 12 * 60 * 1000) {
    const peek = await clipVideo.check(job);
    if (peek.status === 'failed') throw new Error(peek.error || '這一鏡失敗');
    if (peek.status === 'done' && peek.videoUrl) return peek.videoUrl;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error('這一鏡逾時。請不要重按。');
}

function writeText(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, value, 'utf8');
  return file.replace(/\\/g, '/').replace(':', '\\:');
}

function fontArg() {
  const file = fontFile();
  if (!file) throw new Error('這台電腦沒有可畫中文的字型，數據板疊不上去。');
  return file.replace(/\\/g, '/').replace(':', '\\:');
}

function mediaSeconds(file) {
  const bin = clipExport.ffmpegBin();
  return new Promise((resolve) => {
    const proc = require('child_process').spawn(bin, ['-i', file], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (chunk) => { err += chunk; });
    proc.on('close', () => {
      const match = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return resolve(5);
      resolve((Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]));
    });
  });
}

async function renderCard(dir, index, panel) {
  const font = fontArg();
  const png = path.join(dir, `card-${index}.png`);
  const filters = [
    'format=rgba',
    'drawbox=x=1:y=1:w=178:h=82:color=0x9ad8ff@0.85:t=2',
  ];
  const bits = [
    ['label', panel.label, 15, 12, '0xE8F6FF'],
    ['value', panel.value, 22, 36, '0xFFFFFF'],
    ['note', panel.note, 13, 62, '0xD6FFE8'],
  ];
  bits.forEach(([kind, value, size, top, color]) => {
    if (!value) return;
    const textfile = writeText(dir, `p${index}-${kind}.txt`, value.replace(/%/g, '％'));
    filters.push(`drawtext=fontfile='${font}':textfile='${textfile}':fontsize=${size}:fontcolor=${color}:x=14:y=${top}`);
  });
  await clipExport.runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'color=c=0x12324d@0.38:s=180x84:d=0.04,format=rgba',
    '-vf', filters.join(','),
    '-frames:v', '1', png,
  ], png);
  return png;
}

function orbitFilter(panels, seconds) {
  const angles = [-1.5708, 3.1416, 0, 2.356, 0.785, 1.5708];
  const lap = (Math.PI * 2 / seconds).toFixed(4);
  const chains = [];
  let prev = '0:v';
  panels.forEach((_, index) => {
    const spin = `${angles[index] ?? 1.5708}+t*${lap}`;
    const x = `main_w/2+(min(main_w\\,main_h)*0.38)*cos(${spin})-90`;
    const y = `main_h/2+(min(main_w\\,main_h)*0.34)*sin(${spin})-42`;
    const out = index === panels.length - 1 ? 'outv' : `v${index}`;
    chains.push(`[${prev}][${index + 1}:v]overlay=x='${x}':y='${y}':format=auto[${out}]`);
    prev = out;
  });
  return chains.join(';');
}

async function overlayPanels(buffer, panels) {
  const list = (panels || []).filter((panel) => panel && (panel.label || panel.value)).slice(0, 6);
  if (!list.length) return buffer;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-ad-'));
  const input = path.join(dir, 'in.mp4');
  const output = path.join(dir, 'out.mp4');
  fs.writeFileSync(input, buffer);
  const cards = [];
  for (let i = 0; i < list.length; i += 1) cards.push(await renderCard(dir, i, list[i]));
  const seconds = Math.max(1, Math.min(16, await mediaSeconds(input)));
  const graph = orbitFilter(list, seconds);
  const args = ['-y', '-i', input];
  cards.forEach((png) => args.push('-loop', '1', '-i', png));
  const video = ['-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20'];
  try {
    try {
      await clipExport.runFfmpeg([
        ...args, '-filter_complex', graph, '-map', '[outv]', '-map', '0:a?',
        ...video, '-c:a', 'copy', '-movflags', '+faststart', output,
      ], output);
    } catch {
      try { fs.unlinkSync(output); } catch { /* 略過 */ }
      await clipExport.runFfmpeg([
        ...args, '-filter_complex', graph, '-map', '[outv]',
        ...video, '-movflags', '+faststart', output,
      ], output);
    }
    return fs.readFileSync(output);
  } finally {
    try {
      fs.readdirSync(dir).forEach((name) => {
        try { fs.unlinkSync(path.join(dir, name)); } catch { /* 略過 */ }
      });
      fs.rmdirSync(dir);
    } catch { /* 略過 */ }
  }
}

function secondsOf(value) {
  const raw = String(value || '').trim();
  if (raw === '10' || raw === '15') return raw;
  return '5';
}

async function produce({ instruction, duration, onPhase }) {
  if (!configured()) throw new Error('廣告影片尚未開通。請確認生圖與圖生影片都已設定。');
  const brief = tidy(instruction, 500);
  if (brief.length < 4) throw new Error('請先寫一句指令。');
  const seconds = secondsOf(duration);
  if (onPhase) onPhase('正在安排這一鏡');
  const plan = await askPlan(brief, seconds);
  plan.seconds = Number(seconds);
  const shot = plan.shots[0];
  if (onPhase) onPhase('正在畫畫面');
  const still = await geminiStill(stillParts(plan, shot, ''), plan.ratio);
  if (onPhase) onPhase(`正在做 ${seconds} 秒影片`);
  const submitted = await clipVideo.submit({
    images: [still],
    product: shot.visual,
    hook: shot.line,
    style: 'ugc',
    duration: seconds,
    ratio: plan.ratio,
    prompt: motionPrompt(plan, shot),
    generateAudio: true,
  });
  const url = await waitScene(submitted);
  const file = await clipVideo.finish(url, { duration: seconds });
  let framed = file.buffer;
  if (plan.panels.length) {
    if (onPhase) onPhase('正在讓數據板繞著人轉');
    framed = await overlayPanels(file.buffer, plan.panels);
  }
  const playable = await clipExport.remuxPlayable(framed);
  return {
    buffer: playable.buffer,
    mime: 'video/mp4',
    duration: seconds,
    ratio: plan.ratio,
    panels: plan.panels.length,
  };
}

module.exports = { configured, produce, parsePlan, overlayPanels };
