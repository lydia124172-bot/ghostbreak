function geminiConfigured() {
  return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

function falConfigured() {
  return Boolean(String(process.env.FAL_KEY || '').trim());
}

function useFal() {
  return falConfigured() && String(process.env.CLIP_IMAGE_ENGINE || '').trim() === 'fal';
}

function configured() {
  return useFal() || geminiConfigured();
}

function falModel() {
  return process.env.FAL_IMAGE_MODEL || 'fal-ai/bytedance/seedream/v4/edit';
}

function engine() {
  if (useFal()) {
    return falModel().includes('seedream') ? 'seedream' : 'flux';
  }
  if (geminiConfigured()) return 'gemini';
  return '';
}

function parseDataUrl(url) {
  const m = String(url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) throw new Error('圖片格式不支援');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 2 * 1024 * 1024) throw new Error('單張圖請小於 2MB');
  return { mime: m[1], b64: m[2] };
}

function promptText({ product, style }) {
  const scene = style === 'ugc'
    ? '直式 9:16，像 Magik／Minta 的 UGC：浴室或廚房一角、窗光、手機隨手拍的高級感，商品在前景被拿著或放在台面，淺景深。'
    : style === 'life'
      ? '4:5 生活情境：大理石或木桌、布料、水珠或蒸汽，雜誌廣告光，商品是主角。'
      : '4:5 精品靜物：暗色或奶油背景、輪廓光、材質清楚，不要網拍白底複製。';
  return [
    '重繪一張高質感電商廣告圖，不要只是把原圖變清楚。',
    '必須是新的場景與打光，像品牌廣告，不是銳化修圖。',
    '商品外型、包裝印刷、顏色必須與原圖一致，不可換成別牌。',
    product ? `商品：${product}` : '依圖判斷商品。',
    scene,
    '畫面零後加文字：不准字幕、問句、價錢、浮水印。原廠包裝字可留。',
    '只輸出圖像。',
  ].filter(Boolean).join('\n');
}

function falPrompt({ product, style }) {
  const scene = style === 'ugc'
    ? 'Vertical 9:16 UGC lifestyle photo: bathroom or kitchen corner, window light, shallow depth of field, product in the foreground on a counter or held, premium phone-snapshot look.'
    : style === 'life'
      ? '3:4 lifestyle advertisement: marble or wood table, fabric, water droplets or steam, magazine lighting, product is the hero.'
      : '3:4 luxury still life: dark or cream backdrop, rim light, materials sharp, not a white-background catalog shot.';
  const name = product ? `The product is: ${product}.` : 'Identify the product from the reference image.';
  return [
    'Edit the reference photo into a new high-end ecommerce advertisement.',
    'Change the scene and lighting completely. Do not just sharpen or clean the original photo.',
    'Keep the exact same product: shape, packaging print, colors, logo, and label text. Do not swap brands.',
    name,
    scene,
    'No added captions, prices, slogans, or watermarks. Factory packaging text may remain.',
  ].join(' ');
}

function publicError(err) {
  const message = String(err && err.message || '');
  if (/exhausted balance|user is locked|insufficient.*(balance|credit)|top up your balance/i.test(message)) {
    return '生圖錢包餘額不足或還沒入帳。這不是網站方案點數。請到 fal 帳單確認後再試。免費排版仍可使用。';
  }
  if (/unauthorized|forbidden|invalid.*key|401|403/i.test(message)) {
    return '進階生圖金鑰無效，請稍後再試或透過 LINE 聯繫。';
  }
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(message)) {
    return '進階生圖暫時無法使用。免費排版仍可使用，稍後再試或透過 LINE 聯繫。';
  }
  if (/high demand|overloaded|unavailable|try again later|UNAVAILABLE|503/i.test(message)) {
    return '現在使用的人較多，請稍後再試。免費排版仍可使用。';
  }
  return '進階生圖失敗，請換一張圖再試。';
}

function falMessage(body, status) {
  const detail = body && body.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail[0]) {
    return detail[0].msg || detail[0].message || JSON.stringify(detail[0]);
  }
  return body.error || body.message || `生圖服務 ${status}`;
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

function firstImageUrl(body) {
  if (!body || typeof body !== 'object') return '';
  if (typeof body.image === 'string' && body.image.startsWith('data:image/')) return body.image;
  if (typeof body.image === 'string' && /^https?:\/\//.test(body.image)) return body.image;
  return body.images?.[0]?.url || body.image?.url || body.data?.images?.[0]?.url || body.output?.images?.[0]?.url || '';
}

function partImage(part) {
  const inline = part.inlineData || part.inline_data;
  if (!inline || !inline.data) return '';
  const mime = inline.mimeType || inline.mime_type || 'image/png';
  return `data:${mime};base64,${inline.data}`;
}

async function urlToDataUrl(url, signal) {
  if (String(url || '').startsWith('data:image/')) return url;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('無法下載生圖結果');
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type') || 'image/jpeg';
  const safe = mime.startsWith('image/') ? mime.split(';')[0] : 'image/jpeg';
  return `data:${safe};base64,${buf.toString('base64')}`;
}

async function falResult(model, key, requestId) {
  const headers = {
    Authorization: `Key ${key}`,
    'Content-Type': 'application/json',
  };
  const done = await fetch(`https://queue.fal.run/${model}/requests/${encodeURIComponent(requestId)}`, { headers });
  const body = await done.json().catch(() => ({}));
  if (!done.ok) throw new Error(falMessage(body, done.status));
  return body;
}

async function falWait(model, key, requestId, ms) {
  const headers = {
    Authorization: `Key ${key}`,
    'Content-Type': 'application/json',
  };
  const started = Date.now();
  while (Date.now() - started < ms) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const st = await fetch(`https://queue.fal.run/${model}/requests/${encodeURIComponent(requestId)}/status`, { headers });
    const status = await st.json().catch(() => ({}));
    const flag = String(status.status || status.state || '').toUpperCase();
    const ready = firstImageUrl(status);
    if (ready) return { images: [{ url: ready }] };
    if (flag === 'COMPLETED' || flag === 'COMPLETE' || flag === 'SUCCESS' || flag === 'OK') {
      return falResult(model, key, requestId);
    }
    if (flag === 'FAILED' || flag === 'CANCELLED' || flag === 'CANCELED') {
      throw new Error(status.error || falMessage(status, st.status));
    }
  }
  try {
    const last = await falResult(model, key, requestId);
    if (last.images?.[0]?.url) return last;
  } catch {
    /* still waiting */
  }
  const err = new Error('aborted');
  err.name = 'AbortError';
  throw err;
}

async function latestPaidImage(model, key) {
  const res = await fetch(`https://api.fal.ai/v1/models/requests/by-endpoint?endpoint_id=${encodeURIComponent(model)}&expand=payloads&limit=5&status=success`, {
    headers: { Authorization: `Key ${key}` },
  });
  const body = await res.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const item of items) {
    const ended = Date.parse(item.ended_at || item.started_at || '') || 0;
    if (ended && ended < cutoff) continue;
    const url = firstImageUrl(item.json_output) || item.json_output?.images?.[0]?.url;
    if (url) return { images: [{ url }] };
  }
  return null;
}

async function falRun(model, key, payload) {
  const headers = {
    Authorization: `Key ${key}`,
    'Content-Type': 'application/json',
  };
  let body = {};
  try {
    const res = await withTimeout(120000, (signal) => fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    }));
    body = await res.json().catch(() => ({}));
    const ready = firstImageUrl(body);
    if (ready) return { images: [{ url: ready }] };
    if (body.request_id) return falWait(model, key, body.request_id, 180000);
    if (!res.ok) throw new Error(falMessage(body, res.status));
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  }
  const paid = await latestPaidImage(model, key);
  if (paid) return paid;
  const fail = new Error('aborted');
  fail.name = 'AbortError';
  throw fail;
}

async function viaFal({ images, product, style }) {
  const first = Array.isArray(images) ? images[0] : '';
  if (!first) throw new Error('請先選商品圖');
  parseDataUrl(first);
  const key = String(process.env.FAL_KEY || '').trim();
  const model = falModel();
  const ratio = style === 'ugc' ? '9:16' : '4:5';
  const prompt = falPrompt({ product, style });
  let payload;
  if (model.includes('seedream')) {
    payload = {
      prompt,
      image_urls: [first],
      image_size: style === 'ugc' ? 'portrait_16_9' : 'portrait_4_3',
      num_images: 1,
      max_images: 1,
      enhance_prompt_mode: 'fast',
    };
  } else if (model.includes('flux-pro/kontext')) {
    payload = {
      prompt,
      image_url: first,
      aspect_ratio: ratio === '4:5' ? '3:4' : ratio,
      output_format: 'jpeg',
      safety_tolerance: '4',
    };
  } else {
    payload = {
      prompt,
      image_url: first,
      num_inference_steps: 20,
      guidance_scale: 2.5,
      acceleration: 'high',
      resolution_mode: ratio,
      output_format: 'jpeg',
    };
  }
  try {
    const json = await falRun(model, key, payload);
    const raw = firstImageUrl(json);
    if (!raw) throw new Error('沒有產出圖片，請換一張圖再試。');
    const image = await urlToDataUrl(raw);
    return { image, engine: engine() };
  } catch (err) {
    const paid = await latestPaidImage(model, key);
    const raw = paid ? firstImageUrl(paid) : '';
    if (raw) return { image: await urlToDataUrl(raw), engine: engine(), recovered: true };
    if (err.name === 'AbortError') throw new Error('生圖逾時。請不要重按。');
    throw new Error(publicError(err));
  }
}

async function recoverRecent() {
  if (!falConfigured()) return null;
  const key = String(process.env.FAL_KEY || '').trim();
  const paid = await latestPaidImage(falModel(), key);
  const raw = paid ? firstImageUrl(paid) : '';
  if (!raw) return null;
  return { image: await urlToDataUrl(raw), engine: engine(), recovered: true };
}

async function viaGemini({ images, product, style }) {
  if (!geminiConfigured()) throw new Error('進階生圖暫時無法使用，請稍後再試或透過 LINE 聯繫。');
  const first = Array.isArray(images) ? images[0] : '';
  if (!first) throw new Error('請先選商品圖');
  const file = parseDataUrl(first);
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const ratio = style === 'ugc' ? '9:16' : '4:5';
  const sizes = [process.env.GEMINI_IMAGE_SIZE || '2K', '1K'];
  let json;
  try {
    let lastErr;
    for (const imageSize of [...new Set(sizes)]) {
      try {
        json = await withTimeout(45000, async (signal) => {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
            {
              method: 'POST',
              signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  role: 'user',
                  parts: [
                    { text: promptText({ product, style }) },
                    { inline_data: { mime_type: file.mime, data: file.b64 } },
                  ],
                }],
                generationConfig: {
                  responseModalities: ['TEXT', 'IMAGE'],
                  imageConfig: { aspectRatio: ratio, imageSize },
                },
              }),
            },
          );
          const body = await res.json();
          if (!res.ok) throw new Error(body.error?.message || `生圖服務 ${res.status}`);
          return body;
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (err.name === 'AbortError') throw err;
        if (!/invalid|imageSize|2K/i.test(err.message || '')) throw err;
      }
    }
    if (!json) throw lastErr || new Error('進階生圖失敗');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('生圖逾時，請再試一次');
    throw new Error(publicError(err));
  }
  const parts = json.candidates?.[0]?.content?.parts || [];
  const image = parts.map(partImage).find(Boolean);
  if (!image) throw new Error('沒有產出圖片，請換一張圖再試。');
  return { image, engine: 'gemini' };
}

async function enhance({ images, product, price, hook, style }) {
  if (useFal()) return viaFal({ images, product, style });
  return viaGemini({ images, product, price, hook, style });
}

module.exports = { configured, engine, enhance, recoverRecent };
