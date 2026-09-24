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

function promptText({ topic, notes }) {
  return [
    '你是台灣短劇編劇。請寫一支直式 9:16、三鏡、每鏡約 5 秒、全長約 15 秒的 AI 短劇。',
    '語言：繁體中文（台灣，不可簡體）。不要寒暄、不要 JSON、不要 markdown。',
    '嚴格用下面三塊，一行都不要少：',
    'SCENE 1',
    'VISUAL: （畫面，寫實、可拍）',
    'LINE: （一句旁白或對白）',
    'SCENE 2',
    'VISUAL: …',
    'LINE: …',
    'SCENE 3',
    'VISUAL: …',
    'LINE: …',
    '主題要有起承轉合。不要商品硬廣、不要字幕說明、不要寫自己是 AI。',
    `主題：${topic}`,
    notes ? `補充：${notes}` : '',
  ].filter(Boolean).join('\n');
}

function cleanScript(text) {
  const body = String(text || '')
    .replace(/^```[\w]*\s*|\s*```$/g, '')
    .trim();
  if (!/SCENE\s*1/i.test(body) || !/SCENE\s*3/i.test(body)) throw new Error('沒有產出三鏡劇本');
  return body.slice(0, 1600);
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
          ? { temperature: 0.7, maxOutputTokens: 800 }
          : { temperature: 0.7, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `寫稿服務 ${res.status}`);
    return json;
  });
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
  return cleanScript(text);
}

async function viaGemini({ topic, notes, images }) {
  const parts = [{ text: promptText({ topic, notes }) }];
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
  if (/請先|圖片格式|小於|沒有產出|主題/.test(message)) return message;
  if (/high demand|overloaded|unavailable|try again later|UNAVAILABLE|429|503/i.test(message)) {
    return '現在使用的人較多，請稍後再試，或先自己寫三鏡。';
  }
  return '寫稿失敗，請稍後再試或自行填劇本。';
}

async function writeScript({ topic, notes, images }) {
  const title = String(topic || '').trim();
  if (title.length < 2) throw new Error('請先填短劇主題。');
  try {
    if (process.env.GEMINI_API_KEY) return { script: await viaGemini({ topic: title, notes, images }) };
    throw new Error('寫稿暫時無法使用，請稍後再試。');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('寫稿逾時，請再試一次');
    throw new Error(publicError(err));
  }
}

module.exports = { configured, writeScript };
