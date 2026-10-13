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

function promptText({ topic, notes, language, style }) {
  const english = language === 'en';
  const anime = style === 'anime';
  const look = english
    ? (anime
      ? 'Every VISUAL is a Japanese anime film frame: clean line art, cel shading. Do not describe real people, photographs, or live action.'
      : 'Every VISUAL is a photoreal cinematic frame that can be filmed.')
    : (anime
      ? '每一鏡 VISUAL 都是日本動畫電影畫面：乾淨線條、賽璐璐上色。不要寫成真人照片、寫實攝影或真人演員。'
      : '每一鏡 VISUAL 都是寫實、可拍的電影畫面。');
  const speech = english
    ? 'Every LINE is one spoken English sentence of at most 12 words, short enough to say in 5 seconds. Shot 1, shot 2, and shot 3 are all English. Do not write Chinese dialogue in any shot. The last LINE must be a complete sentence, not a cut-off phrase.'
    : '三句 LINE 全部是一句繁體中文台詞，每句最多 18 個字，5 秒要說得完。第 1 鏡、第 2 鏡、第 3 鏡都說中文。不要寫英文對白。最後一句必須是說完的句子，不要寫到一半。';
  return [
    english
      ? 'You are a short-drama writer. Write a vertical 9:16 AI short drama: 3 shots, about 5 seconds each, about 15 seconds total.'
      : '你是台灣短劇編劇。請寫一支直式 9:16、三鏡、每鏡約 5 秒、全長約 15 秒的 AI 短劇。',
    english
      ? 'Keep these labels exactly: 角色： 背景： SCENE VISUAL: LINE:. No greeting, no JSON, no markdown.'
      : '不要寒暄、不要 JSON、不要 markdown。',
    look,
    speech,
    english
      ? 'Write two header lines, then three shots. Do not skip a line.'
      : '先寫兩行，再寫三鏡，一行都不要少。',
    english
      ? 'First line starts with 角色： and names at most two people, with age, hair, clothes, and voice. The same people appear in all three shots. Write this description in English.'
      : '第一行以「角色：」開頭，寫出出場的人，最多兩人，含年齡感、髮型、衣服、聲線。三鏡是同一批人。這一行用繁體中文。',
    english
      ? 'Second line starts with 背景： and names one place only: time, light, floor, and main objects. Do not change location. Write this description in English.'
      : '第二行以「背景：」開頭，只寫一個地點，含時間、光線、地面、主要物件。三鏡不換地方。這一行用繁體中文。',
    'SCENE 1',
    english ? 'VISUAL: (the picture)' : 'VISUAL: （畫面）',
    english ? 'LINE: (one English sentence)' : 'LINE: （一句中文台詞）',
    'SCENE 2',
    'VISUAL: …',
    english ? 'LINE: (one English sentence)' : 'LINE: （一句中文台詞）',
    'SCENE 3',
    'VISUAL: …',
    english ? 'LINE: (one English sentence)' : 'LINE: （一句中文台詞）',
    english
      ? 'Give the story a beginning, turn, and ending. No product ad, no subtitles, do not say you are an AI.'
      : '主題要有起承轉合。不要商品硬廣、不要字幕說明、不要寫自己是 AI。',
    `主題：${topic}`,
    notes ? `補充：${notes}` : '',
  ].filter(Boolean).join('\n');
}

function cleanScript(text) {
  const body = String(text || '')
    .replace(/^```[\w]*\s*|\s*```$/g, '')
    .trim();
  if (!/角色\s*[:：]/.test(body) || !/背景\s*[:：]/.test(body)) throw new Error('沒有寫出角色或背景');
  if (!/SCENE\s*1/i.test(body) || !/SCENE\s*3/i.test(body)) throw new Error('沒有產出三鏡劇本');
  return body.slice(0, 2400);
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
  const body = await withTimeout(30000, async (signal) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: /flash-lite/i.test(model)
          ? { temperature: 0.7, maxOutputTokens: 1600 }
          : { temperature: 0.7, maxOutputTokens: 1600, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `寫稿服務 ${res.status}`);
    return json;
  });
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
  return cleanScript(text);
}

async function viaGemini({ topic, notes, images, language, style }) {
  const parts = [{ text: promptText({ topic, notes, language, style }) }];
  (images || []).filter(Boolean).slice(0, 3).forEach((url) => {
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
  if (/請先|圖片格式|小於|沒有產出|沒有寫出|主題/.test(message)) return message;
  if (/high demand|overloaded|unavailable|try again later|UNAVAILABLE|429|503/i.test(message)) {
    return '現在使用的人較多，請稍後再試，或先自己寫三鏡。';
  }
  return '寫稿失敗，請稍後再試或自行填劇本。';
}

async function writeScript({ topic, notes, images, language, style }) {
  const title = String(topic || '').trim();
  const speech = language === 'en' ? 'en' : 'zh';
  const look = style === 'anime' ? 'anime' : 'live';
  if (title.length < 2) throw new Error('請先填短劇主題。');
  try {
    if (process.env.GEMINI_API_KEY) return { script: await viaGemini({ topic: title, notes, images, language: speech, style: look }) };
    throw new Error('寫稿暫時無法使用，請稍後再試。');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('寫稿逾時，請再試一次');
    throw new Error(publicError(err));
  }
}

module.exports = { configured, writeScript };
