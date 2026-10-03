function configured() {
  return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

const SCENES = [
  { id: 'white', name: '棚拍白牆', hint: '乾淨白底', prompt: 'clean photography studio with seamless white backdrop, soft even light, commercial catalog look' },
  { id: 'gray', name: '柔光灰底', hint: '中性棚拍', prompt: 'soft gray seamless studio backdrop, gentle softbox lighting, premium apparel lookbook' },
  { id: 'cafe', name: '咖啡廳窗邊', hint: '暖色生活', prompt: 'bright cafe window seat, warm daylight, shallow depth of field, lifestyle fashion photo' },
  { id: 'wood', name: '木桌生活感', hint: '居家自然', prompt: 'warm wooden interior with natural window light, cozy lifestyle setting, magazine quality' },
  { id: 'street', name: '街邊日常', hint: '城市街景', prompt: 'clean city street sidewalk in soft daylight, blurred urban background, modern street style' },
  { id: 'office', name: '明亮辦公', hint: '簡潔室內', prompt: 'bright modern office interior, clean walls and soft daylight, professional lifestyle photo' },
  { id: 'outdoor', name: '戶外草地', hint: '自然綠意', prompt: 'open outdoor park with soft green bokeh, natural sunlight, fresh lifestyle fashion photo' },
  { id: 'marble', name: '大理石台面', hint: '精品棚感', prompt: 'elegant marble surface and soft cream backdrop, luxury product-apparel lighting, Adobe Express style commercial polish' },
];

function looksLikeJailbreak(text) {
  return /忽略(以上|先前|之前|所有)?(指令|規則)|ignore (previous|all) instructions|輸出(原始|全部)?(提示|指令|prompt)|show (me )?(the )?(system|original) prompt|越獄|jailbreak/i.test(String(text || ''));
}

function parseDataUrl(url) {
  const m = String(url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) throw new Error('圖片格式不支援，請用 JPG、PNG 或 WEBP。');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 2 * 1024 * 1024) throw new Error('單張圖請小於 2MB。');
  return { mime: m[1], b64: m[2] };
}

function partImage(part) {
  const inline = part.inlineData || part.inline_data;
  if (!inline || !inline.data) return '';
  const mime = inline.mimeType || inline.mime_type || 'image/png';
  return `data:${mime};base64,${inline.data}`;
}

function publicError(err) {
  const message = String(err && err.message || '');
  if (/請先|小於|格式|無法提供|請選/.test(message)) return message;
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(message)) return '換裝暫時無法使用，請稍後再試。';
  if (/high demand|overloaded|unavailable|UNAVAILABLE|503/i.test(message)) return '現在使用的人較多，請稍後再試。';
  if (/API[_ ]?KEY|PERMISSION|billing|401|403/i.test(message)) return '換裝暫時無法使用，請稍後再試。';
  return '換裝失敗，請換一張清楚的全身或半身照再試。';
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

function findScene(id) {
  return SCENES.find((row) => row.id === id) || null;
}

function publicScenes() {
  return SCENES.map(({ id, name, hint }) => ({ id, name, hint }));
}

function directPrompt(note) {
  const extra = cleanNote(note);
  return [
    'Put the exact clothes from images 2 and 3 onto the person in image 1.',
    'Keep the same face, hair, skin, and pose. Change only the clothes.',
    'Copy the garment as photographed: color, cut, buttons, pockets, collar, sleeves, and the belt, including how it is tied.',
    'Do not add a buckle, bow, pocket, zipper, or other piece that is not in the clothing photos.',
    extra ? `Guest note, use it only when it matches the clothing photos: ${extra}` : '',
    'One photoreal commercial photo.',
  ].filter(Boolean).join(' ');
}

function cleanNote(note) {
  return String(note || '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function cleanPrompt(text, max) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parsePromptJson(text) {
  const stripped = String(text || '').trim().replace(/^```json\s*|\s*```$/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  const raw = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
  const data = JSON.parse(raw);
  const positive = String(data.positive || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  const negative = String(data.negative || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  if (positive.length < 40 || negative.length < 20) throw new Error('提示詞太短');
  return { positive, negative };
}

function fallbackPrompts(note) {
  return {
    positive: directPrompt(note),
    negative: 'different person, changed face, clothing details that are not in the clothing photos',
  };
}

async function compilePrompts(note, garments, required) {
  const extra = cleanNote(note);
  if (!extra) {
    if (required) throw new Error('請先寫一句描述，再優化提示詞。');
    return fallbackPrompts('');
  }
  const system = [
    'Look at the two clothing photos. Write the image prompt you would use yourself.',
    'Return only JSON: {"positive":"","negative":""}. English. No explanation.',
    'positive is one short paragraph: same person, wear both garments, and describe the belt, buttons, pockets, and collar exactly as they appear in the photos.',
    'negative is one short line of changes that would make the clothes wrong.',
    'If the guest note conflicts with the photos, follow the photos.',
    `Guest note: ${extra}`,
  ].join('\n');
  const parts = [
    { text: system },
    ...garments.map((row) => ({ inline_data: { mime_type: row.mime, data: row.b64 } })),
  ];
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  let lastErr;
  for (const model of ['gemini-3.6-flash', 'gemini-flash-lite-latest']) {
    try {
      const json = await withTimeout(20000, async (signal) => {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 1200, responseMimeType: 'application/json' },
            }),
          },
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message || `提示詞服務 ${res.status}`);
        return body;
      });
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
      return parsePromptJson(text);
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError') break;
    }
  }
  console.log('[dress] prompt compile skipped', lastErr && lastErr.message);
  if (required) throw new Error('提示詞暫時無法整理，請稍後再按一次。');
  return fallbackPrompts(extra);
}

function imagePrompt(prompts) {
  return [
    prompts.positive,
    prompts.negative ? `Avoid: ${prompts.negative}` : '',
    'Image 1 is the person. Images 2 and 3 are the clothes. Output one image.',
  ].filter(Boolean).join('\n');
}

function bgPrompt(scene, note) {
  const extra = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return [
    'Keep the person and clothing from the photo exactly the same: face, hair, body, pose, outfit colors, buttons, pockets, and belt. Do not add a buckle, zipper, pocket, or logo that is not already in the photo.',
    'Only replace the background. Clean cutout edges, natural contact shadows, commercial Adobe Express quality.',
    `New background: ${scene.prompt}.`,
    'Soft natural light, photoreal, lifestyle fashion look. No fantasy, no clutter, no extra people.',
    'No captions, watermarks, logos, or on-screen text.',
    extra ? `Guest note: ${extra}` : '',
    'Output one image only.',
  ].filter(Boolean).join('\n');
}

const RATIOS = ['3:4', '4:5', '9:16', '1:1', '16:9'];
const SIZES = ['1K', '2K'];

function imageOptions(input) {
  const aspectRatio = RATIOS.includes(input && input.aspectRatio) ? input.aspectRatio : '3:4';
  const imageSize = SIZES.includes(input && input.imageSize) ? input.imageSize : '1K';
  return { aspectRatio, imageSize };
}

async function generateImage(parts, options) {
  if (!configured()) throw new Error('換裝暫時無法使用，請稍後再試。');
  const modelName = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const picked = imageOptions(options);
  const sizes = [picked.imageSize, picked.imageSize === '2K' ? '1K' : '2K'];
  let json;
  let usedSize = picked.imageSize;
  try {
    let lastErr;
    for (const imageSize of [...new Set(sizes)]) {
      try {
        json = await withTimeout(50000, async (signal) => {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(key)}`,
            {
              method: 'POST',
              signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts }],
                generationConfig: {
                  responseModalities: ['TEXT', 'IMAGE'],
                  imageConfig: { aspectRatio: picked.aspectRatio, imageSize },
                },
              }),
            },
          );
          const body = await res.json();
          if (!res.ok) throw new Error(body.error?.message || `換裝服務 ${res.status}`);
          return body;
        });
        usedSize = imageSize;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (err.name === 'AbortError') throw err;
        if (!/invalid|imageSize|2K|1K/i.test(err.message || '')) throw err;
      }
    }
    if (!json) throw lastErr || new Error('換裝失敗');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('產出逾時，請不要重按。');
    throw new Error(publicError(err));
  }
  const out = (json.candidates?.[0]?.content?.parts || []).map(partImage).find(Boolean);
  if (!out) throw new Error('沒有產出圖片，請換一張清楚的全身或半身照再試。');
  return { image: out, imageSize: usedSize, aspectRatio: picked.aspectRatio };
}

async function optimize({ cloth, cloth2, note }) {
  if (looksLikeJailbreak(note)) throw new Error('無法提供');
  if (!cleanNote(note)) throw new Error('請先寫一句描述，再優化提示詞。');
  if (!cloth || !cloth2) throw new Error('請先選兩張衣服圖，再優化提示詞。');
  const garment = parseDataUrl(cloth);
  const garment2 = parseDataUrl(cloth2);
  return compilePrompts(note, [garment, garment2], true);
}

async function dress({ model, cloth, cloth2, note, positive, negative, aspectRatio, imageSize }) {
  if (looksLikeJailbreak([note, positive, negative].join(' '))) throw new Error('無法提供');
  if (!model || !cloth || !cloth2) throw new Error('請上傳模特兒照與兩張衣服圖。');
  const person = parseDataUrl(model);
  const garment = parseDataUrl(cloth);
  const garment2 = parseDataUrl(cloth2);
  const pos = cleanPrompt(positive, 900);
  const neg = cleanPrompt(negative, 700);
  const prompts = pos
    ? { positive: pos, negative: neg }
    : { positive: directPrompt(note), negative: '' };
  return generateImage([
    { text: imagePrompt(prompts) },
    { inline_data: { mime_type: person.mime, data: person.b64 } },
    { inline_data: { mime_type: garment.mime, data: garment.b64 } },
    { inline_data: { mime_type: garment2.mime, data: garment2.b64 } },
  ], { aspectRatio, imageSize });
}

async function changeBg({ image, sceneId, note, aspectRatio, imageSize }) {
  if (looksLikeJailbreak(note)) throw new Error('無法提供');
  const scene = findScene(sceneId);
  if (!scene) throw new Error('請選擇背景場景。');
  const photo = parseDataUrl(image);
  return generateImage([
    { text: bgPrompt(scene, note) },
    { inline_data: { mime_type: photo.mime, data: photo.b64 } },
  ], { aspectRatio, imageSize });
}

module.exports = { configured, dress, optimize, changeBg, publicScenes, findScene, generateImage, parseDataUrl, looksLikeJailbreak };
