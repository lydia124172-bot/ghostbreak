const clipVideo = require('./clip-video');

const DEMO_SCRIPT = [
  '## 🎬 影片核心定位',
  '- **推薦時長**：15秒',
  '- **影片風格**：日系清新',
  '- **核心受眾**：想在家手沖的人',
  '',
  '## 📝 劇本分鏡表（表格呈現）',
  '| 秒數 | 畫面分鏡與運鏡描述 (Visual) | 旁白配音 (VO) | 背景音樂與音效 (BGM/SFX) |',
  '| --- | --- | --- | --- |',
  '| 00-03 | 鏡頭緩慢推近木桌上的手沖咖啡豆 | 「袋口一開，就是今天烘的。」 | 輕柔鋼琴漸入 |',
  '| 03-07 | 手撥開袋口，熱水注入濾杯 | 「香氣先出來，再慢慢沖。」 | 水流聲，節奏推進 |',
  '| 07-12 | 杯子端到窗邊，蒸汽升起 | 「不用等，今晚就寄出。」 | 音樂推向高點 |',
  '| 12-15 | 停在咖啡豆與窗光 | 「今天下單，今晚烘好寄出。」 | 音樂淡出 |',
  '',
  '## 💡 創作者叮嚀',
  '- **運鏡與剪輯建議**：運鏡放慢，不要在畫面上打字。',
].join('\n');

function falKey() {
  return String(process.env.FAL_KEY || '').trim();
}

function arkKey() {
  return String(process.env.ARK_API_KEY || '').trim();
}

function configured() {
  return Boolean(arkKey() || falKey());
}

function creditCost(duration) {
  return videoDuration(duration) === '15' ? 15 : 10;
}

function videoDuration(requested) {
  const raw = String(requested || process.env.FAL_STORY_DURATION || '10').trim();
  return raw === '15' ? '15' : '10';
}

function preferredProvider() {
  const forced = String(process.env.STORY_VIDEO_ENGINE || '').trim().toLowerCase();
  if (forced === 'fal' && falKey()) return 'fal';
  if (forced === 'byteplus' && arkKey()) return 'byteplus';
  if (arkKey()) return 'byteplus';
  if (falKey()) return 'fal';
  return '';
}

function i2vModel() {
  return process.env.FAL_STORY_MODEL || 'fal-ai/kling-video/v3/standard/image-to-video';
}

function t2vModel() {
  return process.env.FAL_STORY_T2V_MODEL || 'fal-ai/kling-video/v3/standard/text-to-video';
}

function isKling(model) {
  return /kling/i.test(String(model || ''));
}

function arkModel() {
  return process.env.ARK_STORY_MODEL || 'dreamina-seedance-2-0-fast-260128';
}

function arkBase() {
  return String(process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');
}

function engine() {
  if (!configured()) return '';
  if (preferredProvider() === 'byteplus') return 'seedance';
  return isKling(i2vModel()) ? 'kling' : 'seedance';
}

function filmScript(script) {
  return String(script || '').split(/##\s*💡/)[0].trim();
}

function storyPrompt({ script, product, duration }) {
  const body = String(script || '').trim();
  if (body.length < 12) throw new Error('請貼上至少一段劇本，或先上傳圖片寫劇本。');
  if (body.length > 4000) throw new Error('劇本請在 4,000 字內。');
  const name = String(product || '').trim();
  const seconds = videoDuration(duration);
  return [
    `Vertical 9:16 cinematic product commercial, about ${seconds} seconds, photoreal, premium lighting.`,
    'Follow only the filled table rows, in time order. Speak the quoted Chinese lines on camera.',
    'Ignore headings, editing tips, and bracket instructions. Do not render them as captions.',
    'Music notes are mood only. No on-screen captions, subtitles, prices, logos, title cards, or watermarks.',
    name ? `Keep this product recognizable: ${name}.` : '',
    'SCRIPT:',
    filmScript(body),
  ].filter(Boolean).join('\n');
}

async function submitFal({ script, images, product, duration: wanted }) {
  if (!falKey()) throw new Error('劇本廣告尚未開通。');
  const first = Array.isArray(images) ? images[0] : '';
  const duration = videoDuration(wanted);
  const prompt = storyPrompt({ script, product, duration });
  let model = t2vModel();
  const payload = {
    prompt,
    duration,
    generate_audio: true,
  };
  if (first) {
    const file = clipVideo.parseDataUrl(first);
    const still = clipVideo.prepareStill(Buffer.from(file.b64, 'base64'), { ratio: '9:16' });
    model = i2vModel();
    if (isKling(model)) {
      payload.start_image_url = await clipVideo.falUpload(falKey(), still, 'image/jpeg', 'story.jpg');
      payload.shot_type = 'intelligent';
      payload.negative_prompt = 'blur, distort, low quality, subtitles, captions, watermark, logos, on-screen text';
    } else {
      payload.image_url = await clipVideo.falUpload(falKey(), still, 'image/jpeg', 'story.jpg');
      payload.resolution = '720p';
      payload.aspect_ratio = '9:16';
      payload.bitrate_mode = 'standard';
    }
  } else if (isKling(model)) {
    payload.aspect_ratio = '9:16';
    payload.shot_type = 'intelligent';
    payload.negative_prompt = 'blur, distort, low quality, subtitles, captions, watermark, logos, on-screen text';
  } else {
    payload.resolution = '720p';
    payload.aspect_ratio = '9:16';
    payload.bitrate_mode = 'standard';
  }
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  const requestId = body.request_id || body.requestId || '';
  if (!res.ok || !requestId) {
    throw new Error('劇本或圖片不被接受。請改寫劇本，或換一張較清楚的商品圖。不要連續重按。');
  }
  const urls = clipVideo.queueUrls(model, requestId, body);
  return {
    requestId,
    model,
    duration,
    engine: isKling(model) ? 'kling' : 'seedance',
    provider: 'fal',
    statusUrl: urls.statusUrl,
    responseUrl: urls.responseUrl,
  };
}

async function imageUrlForArk(first) {
  if (!first) return '';
  const file = clipVideo.parseDataUrl(first);
  const still = clipVideo.prepareStill(Buffer.from(file.b64, 'base64'));
  if (falKey()) {
    try {
      return await clipVideo.falUpload(falKey(), still, 'image/jpeg', 'story.jpg');
    } catch {
      /* 改用資料網址 */
    }
  }
  return `data:image/jpeg;base64,${still.toString('base64')}`;
}

async function submitArk({ script, images, product, duration: wanted }) {
  if (!arkKey()) throw new Error('劇本廣告尚未開通。');
  const first = Array.isArray(images) ? images[0] : '';
  const duration = Number(videoDuration(wanted));
  const prompt = storyPrompt({ script, product, duration: String(duration) });
  const content = [{ type: 'text', text: prompt }];
  if (first) {
    content.push({
      type: 'image_url',
      image_url: { url: await imageUrlForArk(first) },
    });
  }
  const res = await fetch(`${arkBase()}/contents/generations/tasks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${arkKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: arkModel(),
      content,
      ratio: '9:16',
      duration,
      resolution: '720p',
      generate_audio: true,
      watermark: false,
    }),
  });
  const body = await res.json().catch(() => ({}));
  const requestId = body.id || body.task_id || '';
  if (!res.ok || !requestId) {
    throw new Error('劇本或圖片不被接受。請改寫劇本，或換一張較清楚的商品圖。不要連續重按。');
  }
  return {
    requestId,
    model: arkModel(),
    duration: String(duration),
    engine: 'seedance',
    provider: 'byteplus',
    statusUrl: `${arkBase()}/contents/generations/tasks/${encodeURIComponent(requestId)}`,
    responseUrl: `${arkBase()}/contents/generations/tasks/${encodeURIComponent(requestId)}`,
  };
}

async function submit(opts) {
  if (!configured()) throw new Error('劇本廣告尚未開通。');
  const provider = preferredProvider();
  if (provider === 'byteplus') return submitArk(opts);
  return submitFal(opts);
}

function arkVideoUrl(body) {
  return body && body.content && body.content.video_url ? body.content.video_url : '';
}

async function checkArk(job) {
  const requestId = job && job.requestId;
  if (!requestId) return { status: 'failed', error: '找不到生片工作' };
  const res = await fetch(`${arkBase()}/contents/generations/tasks/${encodeURIComponent(requestId)}`, {
    headers: { Authorization: `Bearer ${arkKey()}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  const flag = String(body.status || '').toLowerCase();
  const url = arkVideoUrl(body);
  if (url) return { status: 'done', videoUrl: url };
  if (flag === 'succeeded' || flag === 'success') {
    return { status: 'failed', error: '生片做完了，但沒有片子可下載。請不要重按。' };
  }
  if (flag === 'failed' || flag === 'cancelled' || flag === 'canceled' || flag === 'expired') {
    return { status: 'failed', error: '生片失敗。請改寫劇本或換圖再試，不要連續重按。' };
  }
  if (flag === 'running') return { status: 'running' };
  return { status: 'queued' };
}

async function check(job) {
  if ((job && job.provider) === 'byteplus') return checkArk(job);
  return clipVideo.check(job);
}

async function recoverRecent() {
  if (preferredProvider() === 'byteplus') return null;
  if (!falKey()) return null;
  for (const model of [i2vModel(), t2vModel()]) {
    const paid = await clipVideo.recoverRecent(model);
    if (paid && paid.buffer) return { ...paid, engine: isKling(model) ? 'kling' : 'seedance', duration: videoDuration() };
  }
  return null;
}

module.exports = {
  DEMO_SCRIPT,
  configured,
  engine,
  creditCost,
  videoDuration,
  preferredProvider,
  submit,
  check,
  finish: clipVideo.finish,
  recoverRecent,
};
