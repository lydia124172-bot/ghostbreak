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

const BASE_POSITIVE = [
  '第一張是模特兒，第二張與第三張是要一起穿上的衣服。兩件都穿上，不要只穿其中一件。',
  '必須是同一個人：眉、眼、鼻、唇、臉型、下顎、膚色、髮型、髮色、年齡感跟第一張一致。',
  '體型與姿勢維持第一張，只換衣服。',
  '衣服的顏色、版型、花紋、材質、鈕扣顆數、口袋、領型、袖口、開襟、腰帶打法跟衣服圖一致。',
  '質感乾淨、商業、能上架。只輸出一張圖。',
].join('');

const BASE_NEGATIVE = [
  '換臉，美顏，瘦臉，改妝，改五官，變成別人，改姿勢，大轉身，漏穿其中一件，換成別件衣服，',
  '衣服圖沒有的金屬扣環，皮帶頭，拉鍊，額外口袋，額外鈕扣，品牌標，',
  '布帶打結被改成扣環，文字，浮水印，裸露，色情，小孩，奇幻風。',
].join('');

function cleanNote(note) {
  return String(note || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function parsePromptJson(text) {
  const raw = String(text || '').trim().replace(/^```json\s*|\s*```$/g, '').trim();
  const data = JSON.parse(raw);
  const positive = String(data.positive || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  const negative = String(data.negative || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  if (positive.length < 40 || negative.length < 20) throw new Error('提示詞太短');
  return { positive, negative };
}

function fallbackPrompts(note) {
  const extra = cleanNote(note);
  return {
    positive: extra ? `${BASE_POSITIVE}客人要：${extra}` : BASE_POSITIVE,
    negative: BASE_NEGATIVE,
  };
}

async function compilePrompts(note, garments) {
  const extra = cleanNote(note);
  const system = [
    '你是換裝提示詞編輯。只輸出 JSON：{"positive":"","negative":""}。不要解釋。',
    '正向寫畫面必須出現的事。負向寫畫面禁止出現的事。兩邊用繁體中文，具體、短句、不得互相矛盾。',
    '正向必須保留：同一張臉、兩件衣服都穿上、顏色版型花紋材質鈕扣口袋腰帶打法跟衣服圖一致、商業試衣、只出一張圖。',
    '負向必須保留：換臉、美顏、改五官、漏件、換成別件、多畫金屬扣環、皮帶頭、拉鍊、額外口袋、額外鈕扣、假品牌、文字、浮水印、裸露、小孩。',
    '客人寫「不要某物」：該物只放負向，正向改寫成衣服圖上實際有的做法。',
    '客人寫「要某效果」：放進正向，負向排除相反效果。',
    '不准添加客人沒說的新場景、新姿勢或新配件。看衣服圖，不要把圖上沒有的扣環寫進正向。',
    '後面兩張圖依序是衣服圖一、衣服圖二，不是模特兒。',
    extra ? `客人指示：${extra}` : '客人沒有額外指示。',
  ].join('\n');
  const parts = [
    { text: system },
    ...garments.map((row) => ({ inline_data: { mime_type: row.mime, data: row.b64 } })),
  ];
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  let lastErr;
  for (const model of ['gemini-flash-lite-latest', 'gemini-3.6-flash']) {
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
  return fallbackPrompts(extra);
}

function imagePrompt(prompts) {
  return [
    `正向提示詞：${prompts.positive}`,
    `負向提示詞：${prompts.negative}`,
    '只輸出一張圖。第一張是模特兒，第二張與第三張是衣服。',
  ].join('\n');
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

async function generateImage(parts) {
  if (!configured()) throw new Error('換裝暫時無法使用，請稍後再試。');
  const modelName = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const sizes = [process.env.GEMINI_IMAGE_SIZE || '1K', '2K'];
  let json;
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
                  imageConfig: { aspectRatio: '3:4', imageSize },
                },
              }),
            },
          );
          const body = await res.json();
          if (!res.ok) throw new Error(body.error?.message || `換裝服務 ${res.status}`);
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
    if (!json) throw lastErr || new Error('換裝失敗');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('產出逾時，請不要重按。');
    throw new Error(publicError(err));
  }
  const out = (json.candidates?.[0]?.content?.parts || []).map(partImage).find(Boolean);
  if (!out) throw new Error('沒有產出圖片，請換一張清楚的全身或半身照再試。');
  return { image: out };
}

async function dress({ model, cloth, cloth2, note }) {
  if (looksLikeJailbreak(note)) throw new Error('無法提供');
  if (!model || !cloth || !cloth2) throw new Error('請上傳模特兒照與兩張衣服圖。');
  const person = parseDataUrl(model);
  const garment = parseDataUrl(cloth);
  const garment2 = parseDataUrl(cloth2);
  const prompts = await compilePrompts(note, [garment, garment2]);
  return generateImage([
    { text: imagePrompt(prompts) },
    { inline_data: { mime_type: person.mime, data: person.b64 } },
    { inline_data: { mime_type: garment.mime, data: garment.b64 } },
    { inline_data: { mime_type: garment2.mime, data: garment2.b64 } },
  ]);
}

async function changeBg({ image, sceneId, note }) {
  if (looksLikeJailbreak(note)) throw new Error('無法提供');
  const scene = findScene(sceneId);
  if (!scene) throw new Error('請選擇背景場景。');
  const photo = parseDataUrl(image);
  return generateImage([
    { text: bgPrompt(scene, note) },
    { inline_data: { mime_type: photo.mime, data: photo.b64 } },
  ]);
}

module.exports = { configured, dress, changeBg, publicScenes, findScene };
