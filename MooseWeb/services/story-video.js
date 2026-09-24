const clipVideo = require('./clip-video');

const DEMO_SCRIPT = [
  '晨光從窗邊進來，木桌上放著一袋剛烘好的手沖咖啡豆。',
  '手撥開袋口，深焙香氣散開。熱水緩緩注入濾杯，液面慢慢漲起。',
  '最後端起杯子靠近窗邊，蒸汽在光裡轉了一下。',
  '不要字幕、不要浮水印。旁白：今天下單，今晚烘好寄出。',
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

function creditCost() {
  return Number(process.env.FAL_STORY_CREDITS || 1) || 1;
}

function videoDuration() {
  const raw = String(process.env.FAL_STORY_DURATION || '10').trim();
  const n = Number(raw);
  if (n >= 4 && n <= 15) return String(n);
  return '10';
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
  return process.env.FAL_STORY_MODEL || 'bytedance/seedance-2.0/fast/image-to-video';
}

function t2vModel() {
  return process.env.FAL_STORY_T2V_MODEL || 'bytedance/seedance-2.0/fast/text-to-video';
}

function arkModel() {
  return process.env.ARK_STORY_MODEL || 'dreamina-seedance-2-0-fast-260128';
}

function arkBase() {
  return String(process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');
}

function engine() {
  return configured() ? 'seedance' : '';
}

function storyPrompt({ script, product }) {
  const body = String(script || '').trim();
  if (body.length < 12) throw new Error('請貼上至少一段劇本，寫分鏡或旁白即可。');
  if (body.length > 1200) throw new Error('劇本請在 1,200 字內。');
  const name = String(product || '').trim();
  return [
    `Vertical 9:16 cinematic product commercial, about ${videoDuration()} seconds, photoreal, premium lighting.`,
    'Follow this script beat by beat. Single premium ad. No on-screen captions, subtitles, prices, logos, or watermarks.',
    name ? `Keep this product recognizable: ${name}.` : '',
    'SCRIPT:',
    body,
  ].filter(Boolean).join('\n');
}

async function submitFal({ script, images, product }) {
  if (!falKey()) throw new Error('劇本廣告尚未開通。');
  const first = Array.isArray(images) ? images[0] : '';
  const duration = videoDuration();
  const prompt = storyPrompt({ script, product });
  const payload = {
    prompt,
    resolution: '720p',
    duration,
    aspect_ratio: '9:16',
    generate_audio: true,
    bitrate_mode: 'standard',
  };
  let model = t2vModel();
  if (first) {
    const file = clipVideo.parseDataUrl(first);
    const still = clipVideo.prepareStill(Buffer.from(file.b64, 'base64'));
    payload.image_url = await clipVideo.falUpload(falKey(), still, 'image/jpeg', 'story.jpg');
    model = i2vModel();
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
    engine: 'seedance',
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

async function submitArk({ script, images, product }) {
  if (!arkKey()) throw new Error('劇本廣告尚未開通。');
  const first = Array.isArray(images) ? images[0] : '';
  const duration = Number(videoDuration());
  const prompt = storyPrompt({ script, product });
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
    if (paid && paid.buffer) return { ...paid, engine: 'seedance', duration: videoDuration() };
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
