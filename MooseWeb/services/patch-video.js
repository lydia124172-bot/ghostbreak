const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const clipVideo = require('./clip-video');

function ffmpegBin() {
  try {
    const bin = require('ffmpeg-static');
    if (bin && fs.existsSync(bin)) return bin;
  } catch {
    /* 略過 */
  }
  return '';
}

function falKey() {
  return String(process.env.FAL_KEY || '').trim();
}

function configured() {
  return Boolean(falKey() && ffmpegBin());
}

function probe(file) {
  const bin = ffmpegBin();
  if (!bin) throw new Error('修片暫時無法使用，請稍後再試。');
  const info = spawnSync(bin, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const text = `${info.stderr || ''}\n${info.stdout || ''}`;
  const size = text.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const fpsMatch = text.match(/(\d+(?:\.\d+)?) fps/);
  const dur = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!size || !fpsMatch || !dur) throw new Error('這支影片讀取失敗，請換 mp4 再試。');
  const width = Number(size[1]);
  const height = Number(size[2]);
  const fps = Number(fpsMatch[1]);
  const duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  if (!width || !height || !fps || !duration) throw new Error('這支影片讀取失敗，請換 mp4 再試。');
  if (duration > 20) throw new Error('修片目前最長 20 秒。');
  const frames = Math.max(1, Math.round(duration * fps));
  return { width, height, fps, duration, frames };
}

function promptsFromMarks(marks, probeInfo) {
  const prompts = [];
  const boxes = [];
  const list = Array.isArray(marks) ? marks.slice(0, 8) : [];
  for (const mark of list) {
    const time = Number(mark && mark.time);
    if (!Number.isFinite(time) || time < 0 || time > probeInfo.duration + 0.05) continue;
    const frame = Math.max(0, Math.min(probeInfo.frames - 1, Math.round(time * probeInfo.fps)));
    const pts = (Array.isArray(mark.points) ? mark.points : []).slice(0, 24).map((point) => ({
      x: Math.round(Number(point.x) * probeInfo.width),
      y: Math.round(Number(point.y) * probeInfo.height),
    })).filter((point) => point.x >= 0 && point.y >= 0 && point.x < probeInfo.width && point.y < probeInfo.height);
    if (!pts.length) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    pts.forEach((point) => {
      x0 = Math.min(x0, point.x);
      y0 = Math.min(y0, point.y);
      x1 = Math.max(x1, point.x);
      y1 = Math.max(y1, point.y);
    });
    const padX = Math.max(6, Math.round(probeInfo.width * 0.012));
    const padY = Math.max(6, Math.round(probeInfo.height * 0.012));
    boxes.push({
      frame_index: frame,
      x_min: Math.max(0, x0 - padX),
      y_min: Math.max(0, y0 - padY),
      x_max: Math.min(probeInfo.width - 1, x1 + padX),
      y_max: Math.min(probeInfo.height - 1, y1 + padY),
    });
    pts.forEach((point) => {
      prompts.push({ x: point.x, y: point.y, label: 1, frame_index: frame });
    });
  }
  if (!prompts.length) throw new Error('請先在開叉上塗一筆。');
  return { prompts, boxes };
}

async function submitTrack(videoPath, marks) {
  if (!configured()) throw new Error('修片暫時無法使用，請稍後再試。');
  const info = probe(videoPath);
  const { prompts, boxes } = promptsFromMarks(marks, info);
  const key = falKey();
  const videoUrl = await clipVideo.falUpload(key, fs.readFileSync(videoPath), 'video/mp4', 'patch.mp4');
  const res = await fetch('https://queue.fal.run/fal-ai/sam2/video', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_url: videoUrl,
      prompts,
      box_prompts: boxes,
      apply_mask: false,
    }),
  });
  const body = await res.json().catch(() => ({}));
  const requestId = body.request_id || body.requestId || '';
  if (!res.ok || !requestId) {
    const message = body.error || body.message || body.detail || `追蹤服務 ${res.status}`;
    throw new Error(typeof message === 'string' ? message : '追蹤這一段失敗，請只塗開叉再試。');
  }
  const model = 'fal-ai/sam2/video';
  const urls = clipVideo.queueUrls(model, requestId, body);
  return { requestId, model, statusUrl: urls.statusUrl, responseUrl: urls.responseUrl, info };
}

function dilate(mask, w, h) {
  const next = Buffer.from(mask);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      if (mask[i] >= 128) continue;
      if (
        mask[i - 1] >= 128 || mask[i + 1] >= 128
        || mask[i - w] >= 128 || mask[i + w] >= 128
      ) next[i] = 255;
    }
  }
  return next;
}

function maskFromTracked(original, tracked, w, h) {
  const n = w * h;
  let black = 0;
  let extreme = 0;
  for (let i = 0; i < n; i += 1) {
    const max = Math.max(tracked[i * 3], tracked[i * 3 + 1], tracked[i * 3 + 2]);
    if (max < 24) black += 1;
    if (max < 16 || max > 240) extreme += 1;
  }
  const gray = Buffer.alloc(n);
  if (black / n > 0.55) {
    for (let i = 0; i < n; i += 1) {
      const max = Math.max(tracked[i * 3], tracked[i * 3 + 1], tracked[i * 3 + 2]);
      gray[i] = max > 28 ? 255 : 0;
    }
    return gray;
  }
  if (extreme / n > 0.85) {
    for (let i = 0; i < n; i += 1) {
      const max = Math.max(tracked[i * 3], tracked[i * 3 + 1], tracked[i * 3 + 2]);
      gray[i] = max > 200 ? 255 : 0;
    }
    return gray;
  }
  for (let i = 0; i < n; i += 1) {
    const diff = Math.abs(original[i * 3] - tracked[i * 3])
      + Math.abs(original[i * 3 + 1] - tracked[i * 3 + 1])
      + Math.abs(original[i * 3 + 2] - tracked[i * 3 + 2]);
    gray[i] = diff > 48 ? 255 : 0;
  }
  return gray;
}

function blurPatch(rgb, mask, w, h, x0, y0, x1, y1, radius) {
  const bw = x1 - x0;
  const bh = y1 - y0;
  const pixels = Buffer.alloc(bw * bh * 3);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const yA = Math.max(0, y - radius);
      const yZ = Math.min(h - 1, y + radius);
      const xA = Math.max(0, x - radius);
      const xZ = Math.min(w - 1, x + radius);
      for (let yy = yA; yy <= yZ; yy += 1) {
        const row = yy * w;
        for (let xx = xA; xx <= xZ; xx += 1) {
          if (mask[row + xx] >= 128) continue;
          const s = (row + xx) * 3;
          r += rgb[s];
          g += rgb[s + 1];
          b += rgb[s + 2];
          n += 1;
        }
      }
      const d = ((y - y0) * bw + (x - x0)) * 3;
      if (!n) {
        const s = (y * w + x) * 3;
        pixels[d] = rgb[s];
        pixels[d + 1] = rgb[s + 1];
        pixels[d + 2] = rgb[s + 2];
        continue;
      }
      pixels[d] = Math.round(r / n);
      pixels[d + 1] = Math.round(g / n);
      pixels[d + 2] = Math.round(b / n);
    }
  }
  return { pixels, x0, y0, bw };
}

function sampleBlur(blur, x, y) {
  const i = ((y - blur.y0) * blur.bw + (x - blur.x0)) * 3;
  return [blur.pixels[i], blur.pixels[i + 1], blur.pixels[i + 2]];
}

function holeOnRow(mask, w, y) {
  const row = y * w;
  let x0 = -1;
  for (let x = 0; x < w; x += 1) {
    if (mask[row + x] >= 128) {
      x0 = x;
      break;
    }
  }
  if (x0 < 0) return null;
  let x1 = x0;
  while (x1 < w && mask[row + x1] >= 128) x1 += 1;
  return { x0, x1 };
}

function borderCost(rgb, mask, w, y, x0, x1, shift) {
  let cost = 0;
  let n = 0;
  const row = y * w;
  for (let k = 1; k <= 6; k += 1) {
    const real = x0 - k;
    const pred = x0 - shift - k;
    if (real < 0 || pred < 0) return 1e9;
    if (mask[row + real] >= 128 || mask[row + pred] >= 128) return 1e9;
    const a = (row + real) * 3;
    const b = (row + pred) * 3;
    cost += Math.abs(rgb[a] - rgb[b]) + Math.abs(rgb[a + 1] - rgb[b + 1]) + Math.abs(rgb[a + 2] - rgb[b + 2]);
    n += 1;
  }
  for (let k = 0; k < 6; k += 1) {
    const real = x1 + k;
    const pred = x1 - shift + k;
    if (real >= w || pred < 0) return 1e9;
    if (mask[row + real] >= 128 || mask[row + pred] >= 128) continue;
    const a = (row + real) * 3;
    const b = (row + pred) * 3;
    cost += Math.abs(rgb[a] - rgb[b]) + Math.abs(rgb[a + 1] - rgb[b + 1]) + Math.abs(rgb[a + 2] - rgb[b + 2]);
    n += 1;
  }
  return n ? cost / n : 1e9;
}

function chooseShift(rgb, mask, w, minY, maxY) {
  const found = [];
  const step = Math.max(1, Math.floor((maxY - minY) / 6));
  for (let y = minY; y <= maxY; y += step) {
    const hole = holeOnRow(mask, w, y);
    if (!hole) continue;
    const span = hole.x1 - hole.x0;
    let bestShift = span;
    let bestCost = 1e9;
    const maxShift = Math.min(hole.x0 - 6, span + 30);
    for (let shift = span; shift <= maxShift; shift += 1) {
      const cost = borderCost(rgb, mask, w, y, hole.x0, hole.x1, shift);
      if (cost < bestCost) {
        bestCost = cost;
        bestShift = shift;
      }
    }
    found.push(bestShift);
  }
  if (!found.length) return 0;
  found.sort((a, b) => a - b);
  return found[Math.floor(found.length / 2)];
}

function fillFrame(rgb, mask, w, h, lockedShift = 0) {
  const out = Buffer.from(rgb);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      if (mask[row + x] < 128) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return out;
  const radius = 5;
  const pad = Math.max(48, (maxX - minX + 1) + 36);
  const bx0 = Math.max(0, minX - pad);
  const by0 = Math.max(0, minY - pad);
  const bx1 = Math.min(w, maxX + 1 + pad);
  const by1 = Math.min(h, maxY + 1 + pad);
  const blur = blurPatch(rgb, mask, w, h, bx0, by0, bx1, by1, radius);
  const picked = chooseShift(rgb, mask, w, minY, maxY);
  const clothShift = lockedShift > 0 ? lockedShift : picked;
  fillFrame.shift = clothShift || picked;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let x = 0;
    while (x < w) {
      if (mask[row + x] < 128) {
        x += 1;
        continue;
      }
      const x0 = x;
      while (x < w && mask[row + x] >= 128) x += 1;
      const x1 = x;
      const span = x1 - x0;
      let leftClear = 0;
      for (let i = x0 - 1; i >= bx0 && mask[row + i] < 128; i -= 1) leftClear += 1;
      let rightClear = 0;
      for (let i = x1; i < bx1 && mask[row + i] < 128; i += 1) rightClear += 1;
      const useLeft = leftClear >= rightClear ? leftClear > 0 : false;
      const clear = useLeft ? leftClear : rightClear;
      if (!clear) continue;
      const take = Math.max(1, Math.min(span, clear));
      const origin = useLeft ? x0 - take : x1;
      const leftX = x0 > 0 ? x0 - 1 : x1;
      const rightX = x1 < w ? x1 : x0 - 1;
      const lowL = sampleBlur(blur, Math.min(Math.max(leftX, bx0), bx1 - 1), y);
      const lowR = sampleBlur(blur, Math.min(Math.max(rightX, bx0), bx1 - 1), y);
      for (let i = 0; i < span; i += 1) {
        let sx = origin + (i % take);
        if (useLeft && clothShift >= span) {
          const aligned = x0 + i - clothShift;
          if (aligned >= bx0 && aligned < bx1 && mask[row + aligned] < 128) sx = aligned;
        }
        const sy = y;
        const src = (sy * w + sx) * 3;
        const lowS = sampleBlur(blur, sx, sy);
        const t = span <= 1 ? 0 : i / (span - 1);
        const dest = (row + x0 + i) * 3;
        for (let c = 0; c < 3; c += 1) {
          const low = lowL[c] * (1 - t) + lowR[c] * t;
          const detail = rgb[src + c] - lowS[c];
          out[dest + c] = Math.max(0, Math.min(255, Math.round(low + detail)));
        }
      }
    }
  }
  return out;
}

function makeReader(stream) {
  let buf = Buffer.alloc(0);
  let ended = false;
  let waiter = null;
  stream.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (waiter && buf.length >= waiter.size) {
      const { size, resolve } = waiter;
      waiter = null;
      const out = buf.subarray(0, size);
      buf = Buffer.from(buf.subarray(size));
      resolve(out);
    }
  });
  stream.on('end', () => {
    ended = true;
    if (waiter) {
      waiter.resolve(null);
      waiter = null;
    }
  });
  stream.on('error', () => {
    ended = true;
    if (waiter) {
      waiter.resolve(null);
      waiter = null;
    }
  });
  return function read(size) {
    if (buf.length >= size) {
      const out = buf.subarray(0, size);
      buf = Buffer.from(buf.subarray(size));
      return Promise.resolve(out);
    }
    if (ended) return Promise.resolve(null);
    return new Promise((resolve) => {
      waiter = { size, resolve };
    });
  };
}

async function maskRatios(maskFile, info) {
  const bin = ffmpegBin();
  const w = info.width;
  const h = info.height;
  const size = w * h;
  const proc = spawn(bin, [
    '-hide_banner', '-loglevel', 'error',
    '-i', maskFile,
    '-vf', `fps=2,scale=${w}:${h}:flags=neighbor,format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const read = makeReader(proc.stdout);
  const ratios = [];
  try {
    for (;;) {
      const frame = await read(size);
      if (!frame || frame.length < size) break;
      let on = 0;
      for (let i = 0; i < size; i += 1) if (frame[i] >= 28) on += 1;
      ratios.push(on / size);
      if (ratios.length >= 40) break;
    }
  } finally {
    proc.kill();
  }
  return ratios;
}

function keepWindows(ratios) {
  const spans = [];
  ratios.forEach((ratio, index) => {
    if (ratio > 0.5) return;
    if (ratio > 0.2) {
      throw new Error('追蹤把整片裙子都圈進去了。請只塗那條縫，縫本身可以很長。');
    }
    if (ratio <= 0.0004) return;
    const start = index / 2;
    const end = start + 0.5;
    const prev = spans[spans.length - 1];
    if (prev && start <= prev[1] + 0.01) prev[1] = end;
    else spans.push([start, end]);
  });
  return spans;
}

async function buildClothMask(videoPath, maskFile, info) {
  const ratios = await maskRatios(maskFile, info);
  if (!ratios.length) throw new Error('追蹤沒有對上這支影片，請再試一次。');
  const spans = keepWindows(ratios);
  if (!spans.length) throw new Error('沒有跟著塗過的地方走。請在開叉上塗滿，再試一次。');
  const keep = spans
    .map(([start, end]) => `gte(T\\,${start.toFixed(2)})*lt(T\\,${(end + 0.05).toFixed(2)})`)
    .join('+');
  const bin = ffmpegBin();
  const clean = path.join(os.tmpdir(), `moose-cloth-mask-${Date.now()}.mp4`);
  const made = spawnSync(bin, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', maskFile,
    '-vf', `scale=${info.width}:${info.height}:flags=neighbor,fps=${info.fps},format=gray,geq=lum='if(gte(lum(X\\,Y)\\,28)*(${keep})\\,255\\,0)'`,
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '18',
    clean,
  ], { windowsHide: true, encoding: 'utf8' });
  if (made.status !== 0 || !fs.existsSync(clean) || fs.statSync(clean).size < 1000) {
    try { fs.unlinkSync(clean); } catch { /* 略過 */ }
    throw new Error('修片組不回去，請再試一次。');
  }
  return {
    file: clean,
    start: spans[0][0],
    end: spans[spans.length - 1][1],
  };
}

function cutClip(bin, input, start, span, outFile) {
  return spawnSync(bin, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input,
    '-ss', start.toFixed(3),
    '-t', span.toFixed(3),
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '18',
    outFile,
  ], { windowsHide: true, encoding: 'utf8' });
}

function pasteCover(bin, videoPath, ltxPath, maskPath, info, start, span, outFile) {
  const ltxInfo = probe(ltxPath);
  const ratio = span / Math.max(0.1, ltxInfo.duration || span);
  const w = info.width;
  const h = info.height;
  const pre = start > 0.04;
  const post = start + span < info.duration - 0.04;
  const splits = 1 + (pre ? 1 : 0) + (post ? 1 : 0);
  const chains = [
    `[0:v]split=${splits}${pre ? '[pre0]' : ''}[base0]${post ? '[post0]' : ''}`,
    `[1:v]scale=${w}:${h}:flags=bilinear,setpts=PTS*${ratio.toFixed(4)},fps=${info.fps},trim=duration=${span.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[ltx]`,
    `[2:v]scale=${w}:${h}:flags=neighbor,fps=${info.fps},format=gray,trim=duration=${span.toFixed(3)},setpts=PTS-STARTPTS[msk]`,
    `[base0]trim=start=${start.toFixed(3)}:duration=${span.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[base]`,
    '[base][ltx][msk]maskedmerge[mid]',
  ];
  const pieces = [];
  if (pre) {
    chains.push(`[pre0]trim=0:${start.toFixed(3)},setpts=PTS-STARTPTS[pre]`);
    pieces.push('[pre]');
  }
  pieces.push('[mid]');
  if (post) {
    chains.push(`[post0]trim=${(start + span).toFixed(3)},setpts=PTS-STARTPTS[post]`);
    pieces.push('[post]');
  }
  chains.push(`${pieces.join('')}concat=n=${pieces.length}:v=1:a=0[v]`);
  const heard = spawnSync(bin, ['-hide_banner', '-i', videoPath], { encoding: 'utf8' });
  const withAudio = /Audio:/.test(`${heard.stderr || ''}`);
  return spawnSync(bin, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', videoPath,
    '-i', ltxPath,
    '-i', maskPath,
    '-filter_complex', chains.join(';'),
    '-map', '[v]',
    ...(withAudio ? ['-map', '0:a', '-c:a', 'copy'] : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '18',
    outFile,
  ], { windowsHide: true, encoding: 'utf8' });
}

const INPAINT_MODEL = 'fal-ai/ltx-2.3-quality/inpaint';

function inpaintPrompt(text) {
  const line = String(text || '').trim().slice(0, 400);
  const guard = 'Edit only the masked region. Keep legs, shoes, hands, face and the street unchanged.';
  if (!line) {
    return `Fill only the masked gap in the trench-coat skirt with the same surrounding coat cloth. Closed back, continuous hem, no slit, no vent, matching weave, folds and daylight. ${guard}`;
  }
  return `${line}. ${guard}`;
}

async function compose(videoPath, maskUrl, info, promptText) {
  const bin = ffmpegBin();
  if (!configured()) throw new Error('修片暫時無法使用，請稍後再試。');
  let maskFile = maskUrl;
  let downloaded = false;
  if (!fs.existsSync(maskUrl)) {
    maskFile = path.join(os.tmpdir(), `moose-mask-${Date.now()}.mp4`);
    const maskRes = await fetch(maskUrl);
    if (!maskRes.ok) throw new Error('追蹤結果下載失敗，請再試一次。');
    fs.writeFileSync(maskFile, Buffer.from(await maskRes.arrayBuffer()));
    downloaded = true;
  }
  const built = await buildClothMask(videoPath, maskFile, info);
  if (downloaded) {
    try { fs.unlinkSync(maskFile); } catch { /* 略過 */ }
  }
  const clothFile = built.file;
  let start = Math.max(0, built.start);
  let span = Math.min(info.duration, built.end) - start;
  if (span > 8) span = 8;
  const frames = Math.max(9, Math.min(241, Math.round((span * info.fps - 1) / 8) * 8 + 1));
  span = frames / info.fps;
  const clipFile = path.join(os.tmpdir(), `moose-clip-${Date.now()}.mp4`);
  const maskClip = path.join(os.tmpdir(), `moose-maskclip-${Date.now()}.mp4`);
  const cutVideo = cutClip(bin, videoPath, start, span, clipFile);
  const cutMask = cutClip(bin, clothFile, start, span, maskClip);
  try { fs.unlinkSync(clothFile); } catch { /* 略過 */ }
  if (cutVideo.status !== 0 || cutMask.status !== 0) {
    try { fs.unlinkSync(clipFile); } catch { /* 略過 */ }
    try { fs.unlinkSync(maskClip); } catch { /* 略過 */ }
    throw new Error('修片組不回去，請再試一次。');
  }
  const key = falKey();
  const videoUrl = await clipVideo.falUpload(key, fs.readFileSync(clipFile), 'video/mp4', 'patch.mp4');
  const maskVideoUrl = await clipVideo.falUpload(key, fs.readFileSync(maskClip), 'video/mp4', 'mask.mp4');
  try { fs.unlinkSync(clipFile); } catch { /* 略過 */ }
  const res = await fetch(`https://queue.fal.run/${INPAINT_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: inpaintPrompt(promptText),
      negative_prompt: 'back slit, center-back vent, kick pleat, split skirt, open hem, gap between legs, transparent skin, missing leg, checkerboard, extra limbs, changed face',
      video_url: videoUrl,
      mask_video_url: maskVideoUrl,
      video_strength: 1,
      num_frames: frames,
      frames_per_second: info.fps,
      generate_audio: false,
      enable_prompt_expansion: false,
      guidance_scale: 3,
    }),
  });
  const body = await res.json().catch(() => ({}));
  const requestId = body.request_id || body.requestId || '';
  if (!res.ok || !requestId) {
    const message = body.error || body.message || body.detail || `修補模型 ${res.status}`;
    throw new Error(typeof message === 'string' ? message : '修補模型沒有接上，請再試一次。');
  }
  const urls = clipVideo.queueUrls(INPAINT_MODEL, requestId, body);
  const job = { requestId, model: INPAINT_MODEL, statusUrl: urls.statusUrl, responseUrl: urls.responseUrl };
  let videoOut = '';
  for (let i = 0; i < 80; i += 1) {
    const peek = await clipVideo.check(job);
    if (peek.status === 'failed') throw new Error(peek.error || '修補模型沒有完成，請再試一次。');
    if (peek.status === 'done' && peek.videoUrl) {
      videoOut = peek.videoUrl;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  if (!videoOut) throw new Error('修補模型還在跑。請稍後再試，不要重按。');
  const rendered = await fetch(videoOut);
  if (!rendered.ok) throw new Error('修補結果下載失敗，請再試一次。');
  const rawFile = path.join(os.tmpdir(), `moose-ltx-${Date.now()}.mp4`);
  const outFile = path.join(os.tmpdir(), `moose-patched-${Date.now()}.mp4`);
  fs.writeFileSync(rawFile, Buffer.from(await rendered.arrayBuffer()));
  const mux = pasteCover(bin, videoPath, rawFile, maskClip, info, start, span, outFile);
  try { fs.unlinkSync(rawFile); } catch { /* 略過 */ }
  try { fs.unlinkSync(maskClip); } catch { /* 略過 */ }
  if (mux.status !== 0 || !fs.existsSync(outFile) || fs.statSync(outFile).size < 2000) {
    try { fs.unlinkSync(outFile); } catch { /* 略過 */ }
    throw new Error('修片組不回去，請再試一次。');
  }
  return outFile;
}

module.exports = { configured, probe, submitTrack, compose, fillFrame, maskFromTracked, buildClothMask };
