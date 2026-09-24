function configured() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
}

function promptText({ product, price, hook, style }) {
  const kind = style === 'life' ? '情境圖貼文' : style === 'grid' ? '賣點拼圖貼文' : '商品口播／短影片貼文';
  return [
    '你是台灣電商社群文案助手。請看商品圖片，用繁體中文（台灣，不可簡體）寫可直接發文的文案。',
    `貼文形式：${kind}`,
    product ? `商品名稱（可修正）：${product}` : '商品名稱未填，請依圖判斷。',
    price ? `價格或賣點：${price}` : '',
    hook ? `封面句：${hook}` : '',
    '輸出嚴格為一段 JSON，不要 markdown：',
    '{"product":"品名","price":"價格或賣點","hook":"24字內封面句","caption":"發文全文"}',
    'caption 規則：',
    '1. 依圖說出商品是什麼、材質或用法、為什麼現在要買。',
    '2. 開頭可用 🔥✈️👉🛒 等一行一句，像社群帶貨貼文。',
    '3. 末行加 4 至 8 個繁中 hashtag。',
    '4. 全文 80 至 420 字，不要英文為主，不要說自己是 AI。',
  ].filter(Boolean).join('\n');
}

function parseDataUrl(url) {
  const m = String(url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) throw new Error('圖片格式不支援');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 2 * 1024 * 1024) throw new Error('單張圖請小於 2MB');
  return { mime: m[1], b64: m[2] };
}

function parseModelJson(text) {
  const raw = String(text || '').trim().replace(/^```json\s*|\s*```$/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('識圖結果無法解析');
  const data = JSON.parse(raw.slice(start, end + 1));
  const caption = String(data.caption || data.text || '').trim();
  if (!caption) throw new Error('沒有產出文案');
  return {
    product: String(data.product || '').trim().slice(0, 40),
    price: String(data.price || '').trim().slice(0, 40),
    hook: String(data.hook || '').trim().slice(0, 24),
    caption: caption.slice(0, 2000),
  };
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

async function viaOpenAI(images, meta) {
  const content = [{ type: 'text', text: promptText(meta) }];
  images.slice(0, 3).forEach((url) => {
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
        temperature: 0.5,
        messages: [{ role: 'user', content }],
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `識圖服務 ${res.status}`);
    return json;
  });
  return parseModelJson(body.choices?.[0]?.message?.content);
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
          ? { temperature: 0.5, maxOutputTokens: 700 }
          : { temperature: 0.5, maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `識圖服務 ${res.status}`);
    return json;
  });
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
  return parseModelJson(text);
}

async function viaGemini(images, meta) {
  const parts = [{ text: promptText(meta) }];
  images.slice(0, 3).forEach((url) => {
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
  throw lastErr || new Error('識圖暫時無法使用，請稍後再試。');
}

function publicError(err) {
  const message = String(err && err.message || '');
  if (/請先選|圖片格式|小於|無法解析|沒有產出/.test(message)) return message;
  if (/high demand|overloaded|unavailable|try again later|UNAVAILABLE|429|503/i.test(message)) {
    return '現在使用的人較多，請稍後再試。也可先自行填文案再產出。';
  }
  if (/API[_ ]?KEY|PERMISSION|billing|quota|RESOURCE_EXHAUSTED/i.test(message)) {
    return '識圖暫時無法使用，請稍後再試。';
  }
  return '識圖失敗，請稍後再試或自行填文案。';
}

async function writeCaption({ images, product, price, hook, style }) {
  if (!Array.isArray(images) || !images.length) throw new Error('請先選商品圖');
  const meta = { product, price, hook, style };
  try {
    if (process.env.OPENAI_API_KEY) return await viaOpenAI(images, meta);
    if (process.env.GEMINI_API_KEY) return await viaGemini(images, meta);
    throw new Error('識圖暫時無法使用，請稍後再試。');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('識圖逾時，請再試一次');
    throw new Error(publicError(err));
  }
}

function localMusicPrompt({ product, price, hook, narration }) {
  const name = product || 'a featured product';
  const extra = [price, hook, narration].filter(Boolean).join('. ');
  return [
    `10-second instrumental commercial jingle for ${name}.`,
    'Upbeat, clean, modern Taiwan ecommerce ad, no lyrics, no vocals, no rap.',
    'Catchy melody in the first 2 seconds, light percussion, bright synth or acoustic pluck, fade out at 10 seconds.',
    'Mood: confident, fresh, premium but friendly.',
    extra ? `Context: ${extra}.` : '',
  ].filter(Boolean).join(' ');
}

async function writeMusicPrompt({ product, price, hook, narration }) {
  const meta = { product, price, hook, narration };
  const fallback = localMusicPrompt(meta);
  if (!process.env.GEMINI_API_KEY) return { prompt: fallback, style: '明亮、節奏快、無歌詞的 10 秒廣告配樂' };
  try {
    const key = process.env.GEMINI_API_KEY;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: [
              'Write a Suno music prompt for a 10-second product advertisement.',
              'Output strict JSON only: {"prompt":"...","style":"..."}',
              'prompt: English, 1 short paragraph, instrumental, no vocals, ready to paste into Suno.',
              'style: Traditional Chinese Taiwan, 20 words or fewer, describe the feel.',
              product ? `Product: ${product}` : 'Product inferred as general ecommerce.',
              price ? `Offer: ${price}` : '',
              hook ? `Hook: ${hook}` : '',
              narration ? `Narration mood: ${narration}` : '',
            ].filter(Boolean).join('\n'),
          }],
        }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 280, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const json = await res.json();
    if (!res.ok) return { prompt: fallback, style: '明亮、節奏快、無歌詞的 10 秒廣告配樂' };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
    const raw = String(text || '').trim().replace(/^```json\s*|\s*```$/g, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const data = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : {};
    const prompt = String(data.prompt || '').trim();
    return {
      prompt: (prompt || fallback).slice(0, 800),
      style: String(data.style || '明亮、節奏快、無歌詞的 10 秒廣告配樂').slice(0, 80),
    };
  } catch {
    return { prompt: fallback, style: '明亮、節奏快、無歌詞的 10 秒廣告配樂' };
  }
}

module.exports = { configured, writeCaption, writeMusicPrompt };
