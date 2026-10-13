const fs = require('fs');
const path = require('path');

const VOICE_PROMPT = fs.readFileSync(path.join(__dirname, 'story-prompt-voice.txt'), 'utf8');
const TALK_PROMPT = fs.readFileSync(path.join(__dirname, 'story-prompt-talk.txt'), 'utf8');

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

function scriptMode(requested) {
  return requested === 'talk' ? 'talk' : 'voice';
}

function promptText(input) {
  const base = scriptMode(input && input.mode) === 'talk' ? TALK_PROMPT : VOICE_PROMPT;
  const seconds = input && input.duration === '15' ? '15' : '10';
  const note = [`用戶指定時長：${seconds}秒。`];
  if (input && input.product) note.push(`商品名稱：${input.product}`);
  if (input && input.notes) note.push(`想強調的賣點：${input.notes}`);
  if (scriptMode(input && input.mode) === 'talk') {
    note.push('台詞要好聽、乾淨、有質感，像熟人輕聲聊天。用清楚的中文，不要太台的講法，不要俚語、不要鄉土梗、不要誇張口頭禪。可以有一點幽默，但不要粗話、不要罵人、不要羞辱外表、不要低俗笑話。');
  }
  return `${base}\n\n${note.join('\n')}`;
}

function cleanScript(text) {
  const body = String(text || '')
    .replace(/^```[\w]*\s*|\s*```$/g, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (body.length < 12) throw new Error('沒有產出劇本');
  return body.slice(0, 4000);
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

async function viaOpenAI({ product, notes, images, duration, mode }) {
  const content = [{ type: 'text', text: promptText({ product, notes, duration, mode }) }];
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

function visibleAnswer(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => part && part.text && !part.thought).map((part) => part.text).join('\n');
}

async function callGemini(model, parts, thinkingLevel) {
  const key = process.env.GEMINI_API_KEY;
  const generationConfig = { maxOutputTokens: 8192 };
  if (thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel };
  const body = await withTimeout(75000, async (signal) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `寫稿服務 ${res.status}`);
    const reason = json.candidates?.[0]?.finishReason;
    if (reason && reason !== 'STOP' && !visibleAnswer(json)) {
      throw new Error(`寫稿未完成 ${reason}`);
    }
    return json;
  });
  const text = visibleAnswer(body);
  if (text.trim().length < 12) throw new Error('寫稿未完成 EMPTY');
  return cleanScript(text);
}

function busyGemini(err) {
  return Boolean(err && (err.name === 'AbortError' || /high demand|overloaded|unavailable|UNAVAILABLE|429|503|AbortError|寫稿未完成/i.test(err.message)));
}

async function viaGemini({ product, notes, images, duration, mode }) {
  const parts = [];
  (images || []).slice(0, 2).forEach((url) => {
    const file = parseDataUrl(url);
    parts.push({ inline_data: { mime_type: file.mime, data: file.b64 } });
  });
  parts.push({ text: promptText({ product, notes, duration, mode }) });
  const model = 'gemini-3.6-flash';
  let lastErr;
  for (const level of ['high', 'medium']) {
    try {
      return await callGemini(model, parts, level);
    } catch (err) {
      lastErr = err;
      if (!busyGemini(err) && !/thinking|invalid/i.test(err.message)) throw err;
    }
  }
  const fallbacks = [
    process.env.GEMINI_VISION_MODEL || 'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
  ];
  for (const name of [...new Set(fallbacks)]) {
    try {
      return await callGemini(name, parts, 'medium');
    } catch (err) {
      lastErr = err;
      if (!busyGemini(err)) throw err;
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

async function writeScript({ product, notes, images, duration, mode }) {
  const name = String(product || '').trim();
  const pics = Array.isArray(images) ? images.filter(Boolean) : [];
  const seconds = duration === '15' ? '15' : '10';
  const picked = scriptMode(mode);
  if (!name && !pics.length) throw new Error('請先填商品名稱，或上傳商品圖。');
  try {
    if (process.env.OPENAI_API_KEY) return { script: await viaOpenAI({ product: name, notes, images: pics, duration: seconds, mode: picked }) };
    if (process.env.GEMINI_API_KEY) return { script: await viaGemini({ product: name, notes, images: pics, duration: seconds, mode: picked }) };
    throw new Error('寫稿暫時無法使用，請稍後再試。');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('寫稿逾時，請再試一次');
    throw new Error(publicError(err));
  }
}

module.exports = { configured, writeScript };
