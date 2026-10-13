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

function prepareStill(buf, options) {
  const srcBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (srcBuf.length < 80) throw new Error('商品圖讀取失敗，請換一張 jpg 或 png。');
  const bin = ffmpegBin();
  if (!bin) return srcBuf;
  const opts = options && typeof options === 'object' ? options : {};
  const resolution = videoResolution(opts.resolution);
  const framed = framePixels(opts.ratio, resolution);
  const hd = resolution === '1080p';
  const short = hd ? 1080 : 720;
  const long = hd ? 1920 : 1280;
  const src = path.join(os.tmpdir(), `moose-still-in-${Date.now()}.jpg`);
  const out = path.join(os.tmpdir(), `moose-still-out-${Date.now()}.jpg`);
  fs.writeFileSync(src, srcBuf);
  const vf = framed
    ? `scale=${framed[0]}:${framed[1]}:force_original_aspect_ratio=increase,crop=${framed[0]}:${framed[1]},format=yuvj420p`
    : `scale='if(lt(min(iw\\,ih)\\,${short})\\,${short}*iw/min(iw\\,ih)\\,iw)':'if(lt(min(iw\\,ih)\\,${short})\\,${short}*ih/min(iw\\,ih)\\,ih)',scale='min(iw\\,${long})':'min(ih\\,${long})':force_original_aspect_ratio=decrease,format=yuvj420p`;
  const first = spawnSync(bin, ['-y', '-i', src, '-vf', vf, '-q:v', '3', '-frames:v', '1', out], { windowsHide: true });
  if (first.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 2000) {
    const fallback = framed
      ? `scale=${framed[0]}:${framed[1]}:force_original_aspect_ratio=increase,crop=${framed[0]}:${framed[1]},format=yuvj420p`
      : `scale=${short}:${short}:force_original_aspect_ratio=increase,crop=${short}:${short},format=yuvj420p`;
    spawnSync(bin, [
      '-y', '-i', src,
      '-vf', fallback,
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
  const forced = String(process.env.FAL_VIDEO_MODEL || '').trim();
  if (forced) return forced;
  return 'fal-ai/kling-video/v3/standard/image-to-video';
}

function videoEngine(model) {
  const name = String(model || '');
  if (/kling/i.test(name)) return 'kling';
  if (/seedance/i.test(name)) return 'seedance';
  return 'wan';
}

function videoDuration(requested) {
  const raw = String(requested || process.env.FAL_VIDEO_DURATION || '5').trim();
  if (raw === '5' || raw === '10' || raw === '15') return raw;
  return '5';
}

function videoResolution(requested) {
  return String(requested || '').trim() === '1080p' ? '1080p' : '720p';
}

function frameRatio(requested) {
  const raw = String(requested || '').trim();
  if (raw === '3:4' || raw === '4:5' || raw === '9:16' || raw === '1:1' || raw === '16:9') return raw;
  return '';
}

function evenPx(n) {
  const v = Math.round(Number(n) || 0);
  return Math.max(2, v - (v % 2));
}

function framePixels(ratio, resolution) {
  const picked = frameRatio(ratio);
  if (!picked) return null;
  const hd = videoResolution(resolution) === '1080p';
  const short = hd ? 1080 : 720;
  const long = hd ? 1920 : 1280;
  if (picked === '1:1') return [short, short];
  if (picked === '16:9') return [long, short];
  if (picked === '9:16') return [short, long];
  if (picked === '3:4') return [evenPx(long * 3 / 4), long];
  if (picked === '4:5') return [evenPx(long * 4 / 5), long];
  return null;
}

function engine() {
  return configured() ? 'kling' : '';
}

function creditCost(duration) {
  const sec = videoDuration(duration);
  if (sec === '15') return 9;
  if (sec === '10') return 6;
  return 3;
}

function parseDataUrl(url) {
  const m = String(url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) throw new Error('圖片格式不支援');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 6 * 1024 * 1024) throw new Error('單張圖請小於 6MB');
  return { mime: m[1], b64: m[2], url };
}

function motionPrompt({ product, price, hook, style, duration: wanted }) {
  const name = product || 'the product in the first frame';
  const offer = [price, hook].filter(Boolean).join(', ');
  const sec = videoDuration(wanted);
  const scene = style === 'life'
    ? 'Soft window light, shallow depth of field. Motion comes from environment (steam, pour, fabric, leaves) not from punching the camera forward.'
    : 'Authentic UGC product ad: phone-held feel with a slow side arc or orbit (about 15–30 degrees), light parallax between product and background.';
  return [
    `Photoreal ${sec}-second vertical 9:16 ad. The input image is the first frame; match it exactly.`,
    scene,
    'Camera must NOT do a simple zoom in/out, Ken Burns, or dolly push on a face. Prefer lateral move, orbit, or locked tripod with only the scene animating.',
    `Hero product: ${name}. Packaging, logo, colors, and on-pack text stay pixel-stable.`,
    offer ? `Selling point: ${offer}.` : '',
    'If a person is visible: keep the same face, hair, and outfit from the first frame. They walk slowly and turn during the clip so the clothing can be seen. Do not freeze the pose. Do not add a buckle or bow that is not already in the first frame.',
    garmentTurnRule(),
    'No new captions, subtitles, prices, watermarks, or logos. Single continuous shot. No lip-sync talking head.',
  ].filter(Boolean).join(' ');
}

function garmentTurnRule() {
  return 'The person may turn. During the entire turn, in every frame, do not invent a back slit, center-back vent, kick pleat, parted hem, or open seam. The hem must not split halfway through the turn and must not split at the end. If the back is closed or not shown, keep the skirt and coat as one continuous closed panel the whole time.';
}

function wantsStillBody(text) {
  return /不要動|別動|保持不動|維持不動|不要轉身|別轉身|不要轉頭|頭不要動|do not move|don't move|stay still|keep still/i.test(String(text || ''));
}

function stillBodyRule() {
  return 'The body must stay still for the whole clip. Lock the torso, shoulders, head angle, and pose exactly to the first frame. Do not turn the head, look away, lean, stand, or walk. Only the facial expression may change.';
}

function moveLines({ duration, garmentNote, motion, facts }) {
  const note = String(garmentNote || '').trim();
  const action = String(motion || '').trim();
  const still = wantsStillBody(`${note}\n${action}`);
  const lines = [
    `Animate this still into a ${duration}-second photoreal clip.`,
    'Keep the same subject, face, product, colors, and details from the first frame.',
    'Do not add text, logos, watermarks, or objects that are not already in the still.',
    still ? stillBodyRule() : garmentTurnRule(),
  ];
  if (facts) lines.push(`Product reference, copy this construction exactly when any hidden side appears: ${facts}`);
  if (note) {
    lines.push(still
      ? `User instruction, obey in every frame: ${note}`
      : `Garment instruction for the whole clip, including every frame of a turn: ${note}`);
  }
  if (action) {
    lines.push(still
      ? `Expression only, while the body and head stay locked to the first frame: ${action}. Do not turn or shift the body to perform it.`
      : `Action, performed continuously for the whole clip: ${action}. This body motion is requested. Do not freeze the pose.`);
  } else {
    lines.push(still
      ? 'No requested action. Keep the body and head pose completely still.'
      : 'No requested action. Gentle camera move and natural motion in fabric, hair, or background only. Keep the pose.');
  }
  lines.push(still
    ? 'No captions, subtitles, watermarks, or on-screen text. Single continuous shot. The head keeps the same angle as the first frame.'
    : 'No captions, subtitles, watermarks, or on-screen text. No lip-sync talking. Single continuous shot.');
  return { prompt: lines.join(' '), stillBody: still };
}

function garmentShowsSlit(facts) {
  const text = String(facts || '');
  if (/no slit|no vent|closed back|continuous hem|without a slit|without a vent/i.test(text)) return false;
  return /\bslit\b|\bvent\b|kick pleat|parted hem/i.test(text);
}

function negativeMotionPrompt() {
  return [
    'zoom in, zoom out, ken burns, dolly zoom, push in, pull back only',
    'face morphing, identity change, different person, distorted face, warped eyes, extra teeth',
    'subtitles, captions, watermark, extra logos, on-screen text',
    'warped packaging, melted label, low quality, blurry product',
    'extra hands, extra fingers, deformed hands',
  ].join(', ');
}

function cleanGarmentFacts(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 420);
  if (line.length < 12) return '';
  if (/ignore (previous|all)|system prompt|jailbreak|忽略(以上|先前)/i.test(line)) return '';
  return line;
}

function garmentRef(url) {
  const m = String(url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 4 * 1024 * 1024) return null;
  return { mime: m[1], b64: m[2] };
}

async function garmentFacts(images) {
  const refs = (Array.isArray(images) ? images : [images]).map(garmentRef).filter(Boolean).slice(0, 2);
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!refs.length || !key) return '';
  const ask = [
    'Look at the clothing product photo(s). These are the real garment, not a model pose.',
    'Reply with one English sentence under 70 words.',
    'State only construction a video must copy when the clothes turn: back slit or no back slit, vents, whether the hem is closed, belt tie versus buckle, buttons, pockets, collar.',
    'If the back is a closed panel, say "closed back, no slit, no vent, continuous hem".',
    'Do not describe the person, background, or camera.',
  ].join(' ');
  const parts = [
    { text: ask },
    ...refs.map((row) => ({ inline_data: { mime_type: row.mime, data: row.b64 } })),
  ];
  const models = ['gemini-flash-lite-latest', 'gemini-3.6-flash'];
  for (const model of models) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 220 },
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message || `商品比對 ${res.status}`);
      const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text).join(' ') || '';
      const facts = cleanGarmentFacts(text);
      if (facts) return facts;
    } catch (err) {
      console.log('[garment-facts] skipped', model, err && err.message);
    } finally {
      clearTimeout(timer);
    }
  }
  return '';
}

function promptExpansionEnabled() {
  return String(process.env.FAL_VIDEO_PROMPT_EXPANSION || '').trim() === '1';
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

async function attachGarmentReference(payload, key, referenceImages, facts, kind, stillBody) {
  if (kind !== 'kling' || stillBody) return payload;
  const refs = (Array.isArray(referenceImages) ? referenceImages : []).filter(Boolean).slice(0, 3);
  if (!refs.length) return payload;
  const urls = [];
  for (const ref of refs) {
    try {
      const parsed = parseDataUrl(ref);
      const buf = prepareStill(Buffer.from(parsed.b64, 'base64'), { resolution: '720p' });
      urls.push(await falUpload(key, buf, 'image/jpeg', 'garment.jpg'));
    } catch (err) {
      console.log('[clip-video] garment ref skipped', err && err.message);
    }
  }
  if (!urls.length) return payload;
  payload.elements = [{
    frontal_image_url: urls[0],
    reference_image_urls: urls,
  }];
  payload.cfg_scale = 0.8;
  const closed = !garmentShowsSlit(facts);
  payload.prompt = [
    payload.prompt,
    'The turn is required and must be performed. @Element1 is the real garment, not a final pose.',
    closed
      ? 'In every frame while turning, from the side through the back, keep the skirt and coat hem closed like @Element1. A slit, vent, or gap must not appear halfway through the turn and must not appear at the end.'
      : 'In every frame while turning, copy only the openings already visible in @Element1. Do not add another slit on the way around.',
  ].join(' ');
  if (closed && payload.negative_prompt) {
    payload.negative_prompt = `${payload.negative_prompt}, back slit, center-back vent, kick pleat, parted hem, split skirt, open vent, hem gap while turning`;
  }
  console.log('[clip-video] garment reference attached', closed ? 'closed hem' : 'keep existing opening');
  return payload;
}

async function submit({ images, product, price, hook, style, audio, audioUrl, voice, narration, duration: wanted, prompt, resolution: wantedResolution, ratio, generateAudio, referenceImages, garmentFacts: facts, stillBody }) {
  if (!configured()) throw new Error('圖生視頻尚未開通。');
  const first = Array.isArray(images) ? images[0] : '';
  if (!first) throw new Error('請先選商品圖');
  const file = parseDataUrl(first);
  const key = falKey();
  const duration = videoDuration(wanted);
  const resolution = videoResolution(wantedResolution);
  const model = videoModel();
  const kind = videoEngine(model);
  const still = prepareStill(Buffer.from(file.b64, 'base64'), { ratio, resolution: kind === 'wan' ? resolution : '720p' });
  const imageUrl = await falUpload(key, still, 'image/jpeg', 'product.jpg');
  const promptText = prompt || motionPrompt({ product: product || '商品', price, hook, style, duration });
  const withAudio = Boolean(generateAudio);
  const payload = kind === 'kling'
    ? {
      prompt: promptText,
      start_image_url: imageUrl,
      duration,
      generate_audio: withAudio,
      negative_prompt: negativeMotionPrompt(),
    }
    : kind === 'seedance'
      ? {
        prompt: promptText,
        image_url: imageUrl,
        resolution: /\/fast\//.test(model) ? '720p' : resolution,
        duration,
        aspect_ratio: 'auto',
        generate_audio: withAudio,
      }
      : {
        prompt: promptText,
        image_url: imageUrl,
        resolution,
        duration,
        enable_prompt_expansion: promptExpansionEnabled(),
        multi_shots: false,
        negative_prompt: negativeMotionPrompt(),
      };
  await attachGarmentReference(payload, key, referenceImages, facts, kind, Boolean(stillBody));
  if (stillBody && payload.negative_prompt) {
    payload.negative_prompt += ', head turn, looking away, looking aside, body turn, rotating torso, rotating shoulders, leaning, standing up, walking, changing seat position';
  }
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
  let audioPath = '';
  if (music && speech) {
    const mixed = await clipExport.mixAudio(music, speech);
    if (kind !== 'wan') audioPath = writeAudioTemp(mixed.buffer, mixed.mime);
    else payload.audio_url = await falUpload(key, mixed.buffer, audioMimeOf(mixed.mime) || 'audio/mpeg', 'mix.mp3');
  } else if (speech || music) {
    const one = speech || music;
    const mime = audioMimeOf(one.mime) || 'audio/mpeg';
    if (kind !== 'wan') audioPath = writeAudioTemp(one.buffer, mime);
    else payload.audio_url = await falUpload(key, one.buffer, mime, mime === 'audio/wav' ? 'track.wav' : 'track.mp3');
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
  return { requestId, model, duration, resolution: payload.resolution || '720p', audioPath, statusUrl: urls.statusUrl, responseUrl: urls.responseUrl };
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

function writeAudioTemp(buf, mime) {
  const ext = /wav/i.test(mime || '') ? 'wav' : 'mp3';
  const full = path.join(os.tmpdir(), `moose-audio-${Date.now()}.${ext}`);
  fs.writeFileSync(full, buf);
  return full;
}

function muxOntoVideo(videoBuf, audioPath) {
  if (!audioPath || !fs.existsSync(audioPath)) return videoBuf;
  const bin = ffmpegBin();
  if (!bin) return videoBuf;
  const src = path.join(os.tmpdir(), `moose-vid-${Date.now()}.mp4`);
  const out = path.join(os.tmpdir(), `moose-vid-audio-${Date.now()}.mp4`);
  fs.writeFileSync(src, videoBuf);
  const result = spawnSync(bin, [
    '-y', '-i', src, '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-shortest',
    '-movflags', '+faststart', out,
  ], { windowsHide: true });
  let ready = videoBuf;
  if (result.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 2000) ready = fs.readFileSync(out);
  try { fs.unlinkSync(src); } catch { /* 略過 */ }
  try { fs.unlinkSync(out); } catch { /* 略過 */ }
  try { fs.unlinkSync(audioPath); } catch { /* 略過 */ }
  return ready;
}

async function finish(url, meta = {}) {
  const fileOut = await downloadVideo(url);
  const withAudio = muxOntoVideo(fileOut.buffer, meta.audioPath);
  const playable = await clipExport.remuxPlayable(withAudio);
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
  const payload = videoEngine(model) === 'kling'
    ? {
      prompt: motionPrompt({ product: product || '商品', price, hook, style }),
      start_image_url: imageUrl,
      duration,
      generate_audio: false,
      negative_prompt: negativeMotionPrompt(),
    }
    : {
      prompt: motionPrompt({ product: product || '商品', price, hook, style }),
      image_url: imageUrl,
      resolution: '720p',
      duration,
      enable_prompt_expansion: promptExpansionEnabled(),
      multi_shots: false,
      negative_prompt: negativeMotionPrompt(),
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

module.exports = { configured, engine, creditCost, videoDuration, videoResolution, frameRatio, videoModel, videoEngine, submit, check, finish, render, recoverRecent, falUpload, parseDataUrl, audioMimeOf, prepareStill, latestPaidVideo, videoUrlOf, queueUrls, falGet, garmentTurnRule, garmentFacts, wantsStillBody, stillBodyRule, moveLines };
