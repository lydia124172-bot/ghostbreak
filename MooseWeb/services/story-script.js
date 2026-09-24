function configured() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}

function parseDataUrl(url) {
  const m = String(url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) throw new Error('圖片格式不支援');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 2 * 1024 * 1024) throw new Error('單張圖請小於 2MB');
  return { mime: m[1], b64: m[2] };
}

function promptText({ product, notes }) {
  return [
    '你是台灣電商質感短片編劇。請寫一支約 10 秒、直式 9:16 的商品廣告劇本。',
    '語言：繁體中文（台灣，不可簡體）。不要寒暄、不要標題、不要 JSON、不要 markdown。',
    '直接輸出 4 至 8 行劇本。每一行一個鏡頭或一句旁白。',
    '結構：開場看見商品 → 使用或細節 → 收尾一句賣點。',
    '要寫「不要字幕、不要浮水印」。旁白用「旁白：」開頭。',
    '有圖就必須對應圖中真實外觀、顏色與使用情境，不可換成別的商品。',
    product ? `商品：${product}` : '商品名稱未填，請依圖判斷。',
    notes ? `補充賣點：${notes}` : '',
    '全文 80 至 420 字。不要說自己是 AI。',
  ].filter(Boolean).join('\n');
}

function cleanScript(text) {
  const body = String(text || '')
    .replace(/^```[\w]*\s*|\s*```$/g, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (body.length < 12) throw new Error('沒有產出劇本');
  return body.slice(0, 1200);
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

async function viaOpenAI({ product, notes, images }) {
  const content = [{ type: 'text', text: promptText({ product, notes }) }];
  (images || []).slice(0, 2).forEach((url) => {
    parseDataUrl(url);
    content.push({ type: 'image_url', image_url: { url, detail: 'low' } });
  });
  const body = await withTimeout(28000, async (signal) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
        temperature: 0.6,
        messages: [{ role: 'user', content }],
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `寫稿服務 ${res.status}`);
    return json;
  });
  return cleanScript(body.choices?.[0]?.message?.content);
}

async function callGemini(model, parts) {
  const key = process.env.GEMINI_API_KEY;
  const body = await withTimeout(16000, async (signal) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: /flash-lite/i.test(model)
          ? { temperature: 0.6, maxOutputTokens: 700 }
          : { temperature: 0.6, maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `寫稿服務 ${res.status}`);
    return json;
  });
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
  return cleanScript(text);
}

async function viaGemini({ product, notes, images }) {
  const parts = [{ text: promptText({ product, notes }) }];
  (images || []).slice(0, 2).forEach((url) => {
    const file = parseDataUrl(url);
    parts.push({ inline_data: { mime_type: file.mime, data: file.b64 } });
  });
  const models = [
    'gemini-flash-lite-latest',
    process.env.GEMINI_VISION_MODEL || 'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
  ];
  let lastErr;
  for (const model of [...new Set(models)]) {
    try {
      return await callGemini(model, parts);
    } catch (err) {
      lastErr = err;
      if (/high demand|overloaded|unavailable|UNAVAILABLE|429|503|AbortError/i.test(err.message) || err.name === 'AbortError') {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('寫稿暫時無法使用，請稍後再試。');
}

function publicError(err) {
  const message = String(err && err.message || '');
  if (/請先|圖片格式|小於|沒有產出/.test(message)) return message;
  if (/high demand|overloaded|unavailable|try again later|UNAVAILABLE|429|503/i.test(message)) {
    return '現在使用的人較多，請稍後再試，或先自己寫劇本。';
  }
  if (/API[_ ]?KEY|PERMISSION|billing|quota|RESOURCE_EXHAUSTED/i.test(message)) {
    return '寫稿暫時無法使用，請稍後再試。';
  }
  return '寫稿失敗，請稍後再試或自行填劇本。';
}

async function writeScript({ product, notes, images }) {
  const name = String(product || '').trim();
  const pics = Array.isArray(images) ? images.filter(Boolean) : [];
  if (!name && !pics.length) throw new Error('請先填商品名稱，或上傳商品圖。');
  try {
    if (process.env.OPENAI_API_KEY) return { script: await viaOpenAI({ product: name, notes, images: pics }) };
    if (process.env.GEMINI_API_KEY) return { script: await viaGemini({ product: name, notes, images: pics }) };
    throw new Error('寫稿暫時無法使用，請稍後再試。');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('寫稿逾時，請再試一次');
    throw new Error(publicError(err));
  }
}

module.exports = { configured, writeScript };
