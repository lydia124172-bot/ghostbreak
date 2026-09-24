const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const clipTts = require('./clip-tts');
const clipExport = require('./clip-export');

function ffmpegBin() {
  try {
    const bin = require('ffmpeg-static');
    if (bin && fs.existsSync(bin)) return bin;
  } catch {
    /* 略過 */
  }
  return '';
}

function prepareStill(buf) {
  const srcBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (srcBuf.length < 80) throw new Error('商品圖讀取失敗，請換一張 jpg 或 png。');
  const bin = ffmpegBin();
  if (!bin) return srcBuf;
  const src = path.join(os.tmpdir(), `moose-still-in-${Date.now()}.jpg`);
  const out = path.join(os.tmpdir(), `moose-still-out-${Date.now()}.jpg`);
  fs.writeFileSync(src, srcBuf);
  const vf = "scale='if(lt(min(iw\\,ih)\\,720)\\,720*iw/min(iw\\,ih)\\,iw)':'if(lt(min(iw\\,ih)\\,720)\\,720*ih/min(iw\\,ih)\\,ih)',scale='min(iw\\,1280)':'min(ih\\,1280)':force_original_aspect_ratio=decrease,format=yuvj420p";
  const first = spawnSync(bin, ['-y', '-i', src, '-vf', vf, '-q:v', '3', '-frames:v', '1', out], { windowsHide: true });
  if (first.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 2000) {
    spawnSync(bin, [
      '-y', '-i', src,
      '-vf', 'scale=720:720:force_original_aspect_ratio=increase,crop=720:720,format=yuvj420p',
      '-q:v', '3', '-frames:v', '1', out,
    ], { windowsHide: true });
  }
  try { fs.unlinkSync(src); } catch { /* 略過 */ }
  if (!fs.existsSync(out) || fs.statSync(out).size < 2000) {
    try { fs.unlinkSync(out); } catch { /* 略過 */ }
    throw new Error('商品圖讀取失敗，請換一張清楚的 jpg 或 png。');
  }
  const ready = fs.readFileSync(out);
  try { fs.unlinkSync(out); } catch { /* 略過 */ }
  return ready;
}

function falKey() {
  return String(process.env.FAL_KEY || '').trim();
}

function configured() {
  return Boolean(falKey());
}

function videoModel() {
  return process.env.FAL_VIDEO_MODEL || 'wan/v2.6/image-to-video';
}

function videoDuration(requested) {
  const raw = String(requested || process.env.FAL_VIDEO_DURATION || '5').trim();
  if (raw === '5' || raw === '10' || raw === '15') return raw;
  return '5';
}

function engine() {
  return configured() ? 'wan' : '';
}

function creditCost() {
  return Number(process.env.FAL_VIDEO_CREDITS || 3) || 3;
}

function parseDataUrl(url) {
  const m = String(url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) throw new Error('圖片格式不支援');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 6 * 1024 * 1024) throw new Error('單張圖請小於 6MB');
  return { mime: m[1], b64: m[2], url };
}

function motionPrompt({ product, price, hook, style }) {
  const name = product || 'the product in the first frame';
  const offer = [price, hook].filter(Boolean).join(', ');
  const scene = style === 'life'
    ? 'Slow luxury lifestyle move: soft window light, shallow depth of field, the product stays sharp and recognizable.'
    : 'Vertical 9:16 product ad like Minta/Magik: gentle handheld camera, the product is held or sits on a counter, natural motion, premium UGC feel.';
  return [
    `Animate this still into a ${videoDuration()}-second photoreal product commercial.`,
    scene,
    `Keep the exact same product: ${name}. Do not change packaging, logo, colors, or printed text.`,
    offer ? `Selling point: ${offer}.` : '',
    'No extra captions, subtitles, prices, watermarks, or new logos on screen.',
    'Single continuous shot. Cinematic lighting. No talking-head lip sync.',
  ].filter(Boolean).join(' ');
}

function falMessage(body, status) {
  const detail = body && body.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail[0]) {
    return detail[0].msg || detail[0].message || JSON.stringify(detail[0]);
  }
  return body.error || body.message || `生片服務 ${status}`;
}

function publicError(err) {
  const message = String(err && err.message || '');
  if (/exhausted balance|user is locked|insufficient.*(balance|credit)|top up your balance/i.test(message)) {
    return '生片錢包餘額不足。這不是網站方案點數。請到 fal 帳單加值後再試。';
  }
  if (/unauthorized|forbidden|invalid.*key|401|403/i.test(message)) {
    return '生片金鑰無效，請稍後再試或透過 LINE 聯繫。';
  }
  if (/too small|240x240|image_too_small|min_width|min_height/i.test(message)) {
    return '商品圖太小。請換一張至少 240×240 的清楚商品圖，不要用縮小圖或截圖邊角。';
  }
  if (/image|url|prompt|duration|resolution|validation|unprocessable|422/i.test(message)) {
    return '商品圖或設定不被生片服務接受。請換一張清楚的商品圖再試。';
  }
  return message && !/fetch|aborted|ECONN|ETIMEDOUT/i.test(message)
    ? message
    : '圖生視頻失敗。請不要重按。';
}

function videoUrlOf(body) {
  if (!body || typeof body !== 'object') return '';
  return body.video?.url
    || body.video_url
    || body.data?.video?.url
    || body.response?.video?.url
    || body.json_output?.video?.url
    || '';
}

async function withTimeout(ms, fn) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

function queueUrls(model, requestId, submitted = {}) {
  const base = `https://queue.fal.run/${model}/requests/${encodeURIComponent(requestId)}`;
  return {
    statusUrl: submitted.status_url || submitted.statusUrl || `${base}/status`,
    responseUrl: submitted.response_url || submitted.responseUrl || `${base}/response`,
  };
}

async function falGet(url, key) {
  const res = await fetch(url, { headers: { Authorization: `Key ${key}` } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function falResult(model, key, requestId, responseUrl) {
  const url = responseUrl || queueUrls(model, requestId).responseUrl;
  const done = await falGet(url, key);
  if (!done.ok) throw new Error(falMessage(done.body, done.status));
  return done.body;
}

async function falWait(model, key, requestId, ms, urls = {}) {
  const { statusUrl, responseUrl } = queueUrls(model, requestId, urls);
  const started = Date.now();
  while (Date.now() - started < ms) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const st = await falGet(statusUrl, key);
    const flag = String(st.body.status || st.body.state || '').toUpperCase();
    const ready = videoUrlOf(st.body);
    if (ready) return { video: { url: ready } };
    if (flag === 'COMPLETED' || flag === 'COMPLETE' || flag === 'SUCCESS' || flag === 'OK') {
      return falResult(model, key, requestId, responseUrl);
    }
    if (flag === 'FAILED' || flag === 'CANCELLED' || flag === 'CANCELED') {
      throw new Error(st.body.error || falMessage(st.body, st.status));
    }
    if (!st.ok) {
      const done = await falGet(responseUrl, key);
      if (done.ok && videoUrlOf(done.body)) return done.body;
    }
  }
  try {
    const last = await falResult(model, key, requestId, responseUrl);
    if (videoUrlOf(last)) return last;
  } catch {
    /* still waiting */
  }
  const err = new Error('aborted');
  err.name = 'AbortError';
  throw err;
}

async function falUpload(key, buf, mime, name) {
  const init = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: mime, file_name: name }),
  });
  const issued = await init.json().catch(() => ({}));
  if (!init.ok || !issued.upload_url || !issued.file_url) {
    throw new Error(publicError(new Error(falMessage(issued, init.status))));
  }
  const put = await fetch(issued.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: buf,
  });
  if (!put.ok) throw new Error('配樂上傳失敗');
  return issued.file_url;
}

async function fetchPublicAudio(url) {
  const href = String(url || '').trim();
  if (!href) return null;
  if (!/^https:\/\//i.test(href)) throw new Error('配樂網址須為 https');
  if (/suno\.(com|ai)\//i.test(href)) {
    throw new Error('Suno 分享連結是網頁，不是音檔。免費方案下載額度用完就要付費。請升級後下載 MP3，或改傳你已有的音檔。');
  }
  const res = await fetch(href, { redirect: 'follow' });
  const type = String(res.headers.get('content-type') || '');
  if (!res.ok) throw new Error('配樂網址無法讀取');
  if (/text\/html/i.test(type) || (!/audio\/|octet-stream|mpeg|wav/i.test(type) && !/\.(mp3|wav)(\?|$)/i.test(href))) {
    throw new Error('這不是可下載的 MP3／WAV。請貼音檔網址，不要貼分享頁。');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 8 * 1024 * 1024) throw new Error('配樂請小於 8MB');
  return { buffer: buf, mime: /wav/i.test(type + href) ? 'audio/wav' : 'audio/mpeg' };
}

function audioMimeOf(mime) {
  const raw = String(mime || '').toLowerCase();
  if (raw.includes('wav')) return 'audio/wav';
  if (raw.includes('mpeg') || raw.includes('mp3')) return 'audio/mpeg';
  return '';
}

async function submit({ images, product, price, hook, style, audio, audioUrl, voice, narration, duration: wanted, prompt }) {
  if (!configured()) throw new Error('圖生視頻尚未開通。');
  const first = Array.isArray(images) ? images[0] : '';
  if (!first) throw new Error('請先選商品圖');
  const file = parseDataUrl(first);
  const key = falKey();
  const model = videoModel();
  const duration = videoDuration(wanted);
  const still = prepareStill(Buffer.from(file.b64, 'base64'));
  const imageUrl = await falUpload(key, still, 'image/jpeg', 'product.jpg');
  const payload = {
    prompt: prompt || motionPrompt({ product: product || '商品', price, hook, style }),
    image_url: imageUrl,
    resolution: '720p',
    duration,
    enable_prompt_expansion: true,
    multi_shots: false,
    negative_prompt: 'subtitles, captions, watermark, extra logos, warped packaging, extra hands, low quality',
  };
  let music = audio && audio.buffer && audio.buffer.length ? audio : null;
  if (!music && audioUrl) music = await fetchPublicAudio(audioUrl);
  let speech = voice && voice.buffer && voice.buffer.length ? voice : null;
  if (music && music.buffer.length > 8 * 1024 * 1024) throw new Error('配樂請小於 8MB');
  if (speech && speech.buffer.length > 8 * 1024 * 1024) throw new Error('口播音檔請小於 8MB');
  if (music && !audioMimeOf(music.mime)) throw new Error('配樂只接受 MP3 或 WAV');
  if (speech && !audioMimeOf(speech.mime)) throw new Error('口播音檔只接受 MP3 或 WAV');
  const line = String(narration || '').trim();
  if (line && !speech) {
    try {
      speech = await clipTts.speak(line);
    } catch (err) {
      console.log('[clip-video] tts skipped', err && err.message);
      speech = null;
    }
  }
  if (music && speech) {
    const mixed = await clipExport.mixAudio(music, speech);
    payload.audio_url = await falUpload(key, mixed.buffer, audioMimeOf(mixed.mime) || 'audio/mpeg', 'mix.mp3');
  } else if (speech || music) {
    const one = speech || music;
    const mime = audioMimeOf(one.mime) || 'audio/mpeg';
    payload.audio_url = await falUpload(key, one.buffer, mime, mime === 'audio/wav' ? 'track.wav' : 'track.mp3');
  }
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  const requestId = body.request_id || body.requestId || '';
  if (!res.ok || !requestId) throw new Error(publicError(new Error(falMessage(body, res.status))));
  const urls = queueUrls(model, requestId, body);
  return { requestId, model, duration, statusUrl: urls.statusUrl, responseUrl: urls.responseUrl };
}

async function check(job) {
  const requestId = typeof job === 'string' ? job : job && job.requestId;
  if (!requestId) return { status: 'failed', error: '找不到生片工作' };
  const key = falKey();
  const model = (job && job.model) || videoModel();
  const { statusUrl, responseUrl } = queueUrls(model, requestId, job || {});
  const st = await falGet(statusUrl, key);
  const flag = String(st.body.status || st.body.state || '').toUpperCase();
  const ready = videoUrlOf(st.body);
  if (ready) return { status: 'done', videoUrl: ready };
  if (flag === 'COMPLETED' || flag === 'COMPLETE' || flag === 'SUCCESS' || flag === 'OK') {
    if (st.body.error || st.body.error_type) {
      return { status: 'failed', error: publicError(new Error(st.body.error || st.body.error_type)) };
    }
    const done = await falGet(responseUrl, key);
    const url = videoUrlOf(done.body);
    if (url) return { status: 'done', videoUrl: url };
    const extras = [
      `https://queue.fal.run/${model}/requests/${encodeURIComponent(requestId)}/response`,
      `https://queue.fal.run/${model}/requests/${encodeURIComponent(requestId)}`,
    ];
    let reason = falMessage(done.body, done.status);
    for (const href of extras) {
      if (href === responseUrl) continue;
      const alt = await falGet(href, key);
      const altUrl = videoUrlOf(alt.body);
      if (altUrl) return { status: 'done', videoUrl: altUrl };
      reason = reason || falMessage(alt.body, alt.status);
    }
    return { status: 'failed', error: publicError(new Error(reason || '生片做完了，但沒有片子可下載。請換一張較大、較清楚的商品圖再試。')) };
  }
  if (flag === 'FAILED' || flag === 'CANCELLED' || flag === 'CANCELED') {
    return { status: 'failed', error: publicError(new Error(st.body.error || falMessage(st.body, st.status))) };
  }
  if (flag === 'IN_PROGRESS' || flag === 'PROCESSING') return { status: 'running' };
  if (flag === 'IN_QUEUE' || flag === 'QUEUED') return { status: 'queued' };
  if (!st.ok) {
    const done = await falGet(responseUrl, key);
    const url = videoUrlOf(done.body);
    if (url) return { status: 'done', videoUrl: url };
    if (done.ok && (done.body.error || done.body.detail)) {
      return { status: 'failed', error: publicError(new Error(falMessage(done.body, done.status))) };
    }
    return { status: 'queued' };
  }
  return { status: 'queued' };
}

async function finish(url, meta = {}) {
  const fileOut = await downloadVideo(url);
  const playable = await clipExport.remuxPlayable(fileOut.buffer);
  return {
    buffer: playable.buffer,
    mime: playable.mime || 'video/mp4',
    engine: meta.engine || 'wan',
    duration: meta.duration || videoDuration(),
  };
}

async function latestPaidVideo(model, key) {
  const res = await fetch(`https://api.fal.ai/v1/models/requests/by-endpoint?endpoint_id=${encodeURIComponent(model)}&expand=payloads&limit=5&status=success`, {
    headers: { Authorization: `Key ${key}` },
  });
  const body = await res.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const item of items) {
    const ended = Date.parse(item.ended_at || item.started_at || '') || 0;
    if (ended && ended < cutoff) continue;
    const url = videoUrlOf(item.json_output);
    if (url) return { video: { url } };
  }
  return null;
}

async function downloadVideo(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('無法下載短片');
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type') || 'video/mp4';
  return { buffer: buf, mime: mime.startsWith('video/') ? mime.split(';')[0] : 'video/mp4' };
}

async function render({ images, product, price, hook, style }) {
  if (!configured()) throw new Error('圖生視頻尚未開通。');
  const first = Array.isArray(images) ? images[0] : '';
  if (!first) throw new Error('請先選商品圖');
  const file = parseDataUrl(first);
  const key = falKey();
  const model = videoModel();
  const duration = videoDuration();
  const still = prepareStill(Buffer.from(file.b64, 'base64'));
  const imageUrl = await falUpload(key, still, 'image/jpeg', 'product.jpg');
  const payload = {
    prompt: motionPrompt({ product: product || '商品', price, hook, style }),
    image_url: imageUrl,
    resolution: '720p',
    duration,
    enable_prompt_expansion: true,
    multi_shots: false,
    negative_prompt: 'subtitles, captions, watermark, extra logos, warped packaging, extra hands, low quality',
  };
  let json;
  try {
    const res = await withTimeout(240000, (signal) => fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    }));
    json = await res.json().catch(() => ({}));
    if (!videoUrlOf(json) && json.request_id) json = await falWait(model, key, json.request_id, 180000, json);
    if (!videoUrlOf(json) && !res.ok) throw new Error(falMessage(json, res.status));
  } catch (err) {
    if (err.name !== 'AbortError' && !/失敗|無效|餘額|金鑰/.test(err.message || '')) {
      /* try recover below */
    } else if (err.name !== 'AbortError') {
      throw new Error(publicError(err));
    }
  }
  if (!videoUrlOf(json)) {
    const paid = await latestPaidVideo(model, key);
    if (paid) json = paid;
  }
  const raw = videoUrlOf(json);
  if (!raw) throw new Error('生片逾時。請不要重按。');
  const fileOut = await downloadVideo(raw);
  return {
    ...fileOut,
    engine: 'wan',
    duration,
    recovered: !json.seed,
  };
}

async function recoverRecent(model) {
  if (!configured()) return null;
  const used = model || videoModel();
  const paid = await latestPaidVideo(used, falKey());
  const raw = videoUrlOf(paid);
  if (!raw) return null;
  const fileOut = await downloadVideo(raw);
  return {
    ...fileOut,
    engine: /seedance/i.test(used) ? 'seedance' : 'wan',
    duration: videoDuration(),
    recovered: true,
    model: used,
  };
}

module.exports = { configured, engine, creditCost, videoDuration, submit, check, finish, render, recoverRecent, falUpload, parseDataUrl, audioMimeOf, prepareStill, latestPaidVideo, videoUrlOf, queueUrls, falGet };
