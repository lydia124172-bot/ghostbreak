function configured() {
  return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

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
  if (/請先|小於|格式|無法提供/.test(message)) return message;
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

function promptText(note) {
  const extra = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return [
    '第一張是模特兒。第二張是衣服或配件。把第二張的服裝穿到第一張的人身上。',
    '必須像同一個人：臉、髮型、體型、膚色、姿勢盡量不變。只換衣服與必要的配件。',
    '服裝的顏色、版型、花紋、材質要跟第二張一致，不要換成別件。',
    '不要小孩、不要裸露、不要色情、不要加字、不要浮水印、不要假品牌標。',
    extra ? `客人補充：${extra}` : '沒有其他補充，依兩張圖完成換裝。',
    '只輸出一張圖。',
  ].join('\n');
}

async function dress({ model, cloth, note }) {
  if (!configured()) throw new Error('換裝暫時無法使用，請稍後再試。');
  if (looksLikeJailbreak(note)) throw new Error('無法提供');
  const person = parseDataUrl(model);
  const garment = parseDataUrl(cloth);
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
                contents: [{
                  role: 'user',
                  parts: [
                    { text: promptText(note) },
                    { inline_data: { mime_type: person.mime, data: person.b64 } },
                    { inline_data: { mime_type: garment.mime, data: garment.b64 } },
                  ],
                }],
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
  const parts = json.candidates?.[0]?.content?.parts || [];
  const image = parts.map(partImage).find(Boolean);
  if (!image) throw new Error('沒有產出圖片，請換一張清楚的全身或半身照再試。');
  return { image };
}

module.exports = { configured, dress };
