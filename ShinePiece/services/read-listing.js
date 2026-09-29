const MODELS = ['gemini-flash-lite-latest', 'gemini-3.6-flash'];

const PROMPT = `你是台灣選物店「瑄品集選」的上架助理。圖片是批發商或廠商給的商品資訊截圖（可能是簡體字、表格或聊天截圖）。
請讀出商品資訊，改寫成正式、自然的繁體中文，只回傳 JSON：
{"name":"商品名稱","origin":"產地","price":數字或null,"lines":["商品介紹重點"],"note":"給老闆的提醒"}
規則：
- name：簡潔的商品名稱（含品牌、品名、容量或尺寸），不要加【】標籤，不超過 40 字。
- origin：只能是「日本」「韓國」「中國」「泰國」「台灣」之一；圖中沒寫就填空字串，不要猜。
- price：圖中「售價、建議售價、零售價」的新台幣數字。如果只有批發價、進價、成本或外幣，填 null，並在 note 說明。絕對不要自己編價格。
- lines：3 到 6 行，每行一個重點（規格、材質、尺寸、容量、特色、使用方式、保存方式），每行不超過 40 字；只寫圖中有的資訊，不要誇大或加入療效宣稱。
- 簡體字一律轉為繁體，大陸用語改為台灣用語。
- 不要寫出批發價、進價、廠商聯絡方式、電話、帳號。
- note：看不清楚、缺價格或需要老闆確認的地方，一句話；沒有就填空字串。`;

function configured() {
  return Boolean(process.env.GEMINI_API_KEY);
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

function parseImage(url) {
  const m = String(url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) throw new Error('圖片格式不支援，請用 JPG、PNG 或 WEBP。');
  if (Buffer.from(m[2], 'base64').length > 4 * 1024 * 1024) throw new Error('單張圖請小於 4MB。');
  return { mime: m[1], b64: m[2] };
}

async function ask(model, images) {
  const parts = [{ text: PROMPT }];
  images.forEach((img, i) => parts.push({ text: `圖${i + 1}：` }, { inline_data: { mime_type: img.mime, data: img.b64 } }));
  const body = await withTimeout(40000, async (signal) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json' },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `讀圖服務 ${res.status}`);
    return json;
  });
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('沒有讀到商品資訊');
  return JSON.parse(match[0]);
}

function toListing(data) {
  const name = String(data.name || '').replace(/[【】]/g, '').trim().slice(0, 60);
  if (!name) throw new Error('沒有讀到商品名稱，請換一張更清楚的截圖。');
  const origin = ['日本', '韓國', '中國', '泰國', '台灣'].includes(data.origin) ? data.origin : '';
  const price = Number(data.price) > 0 ? Math.round(Number(data.price)) : 0;
  const lines = (Array.isArray(data.lines) ? data.lines : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 6);
  const text = [
    `【紫瑄老闆親測推薦】${name}`,
    origin,
    price ? `售價 NT$ ${price.toLocaleString('en-US')}` : '',
    ...lines,
  ].filter(Boolean).join('\n');
  let note = String(data.note || '').trim().slice(0, 120);
  if (!price) note = note || '截圖裡沒有找到售價，請自己補上「售價 NT$ 數字」。';
  return { text, note };
}

async function readListing(images) {
  if (!configured()) throw new Error('讀圖功能還沒設定 AI 金鑰。');
  const list = (Array.isArray(images) ? images : []).filter(Boolean);
  if (!list.length) throw new Error('請先放商品資訊截圖。');
  if (list.length > 4) throw new Error('資訊截圖最多四張。');
  const parsed = list.map(parseImage);
  let lastErr;
  for (const model of MODELS) {
    try {
      return toListing(await ask(model, parsed));
    } catch (err) {
      lastErr = err;
      if (/商品名稱/.test(err.message)) throw err;
    }
  }
  console.error('[read-listing]', lastErr && lastErr.message);
  if (lastErr && lastErr.name === 'AbortError') throw new Error('讀圖逾時，請再試一次。');
  throw new Error('讀圖失敗，請換一張更清楚的截圖再試。');
}

module.exports = { configured, readListing };
