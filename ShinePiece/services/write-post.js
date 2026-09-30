const MODELS = ['gemini-flash-lite-latest', 'gemini-3.6-flash'];

const PROMPT = `你是台灣選物店「瑄品集選」的主編，幫老闆紫瑄寫部落格文章草稿，目的是讓客人在 Google 搜尋時找到這篇文章。
語氣：親切、像朋友分享，繁體中文、台灣用語，第一人稱「我」。
只回傳 JSON：
{"title":"標題","summary":"摘要","keywords":"關鍵字1,關鍵字2","body":"內文"}
規則：
- title：包含主要關鍵字，自然好點，不超過 32 字。
- summary：一到兩句，不超過 80 字，會顯示在 Google 搜尋結果。
- keywords：3 到 6 個客人會搜尋的詞，用半形逗號分隔。
- body：800 到 1200 字，用以下格式：
  段落之間空一行；小標題用「## 」開頭；清單每行用「- 」開頭；重點可用 **粗體**。
  至少 3 個 ## 小標題，最後一段邀請讀者到店裡逛逛或私訊詢問。
- 不要編造價格、成分、療效或醫療宣稱，不要寫「最便宜」「第一名」這類無法證明的話。
- 不要放圖片語法和網址。`;

function configured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function ask(model, topic, notes) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\n文章主題：${topic}${notes ? `\n老闆補充的重點：${notes}` : ''}` }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `AI 服務 ${res.status}`);
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI 沒有回傳文章');
    return JSON.parse(match[0]);
  } finally {
    clearTimeout(timer);
  }
}

function clean(data) {
  const title = String(data.title || '').trim().slice(0, 60);
  const body = String(data.body || '').replace(/\r/g, '').trim().slice(0, 20000);
  if (!title || body.length < 200) throw new Error('AI 寫的內容太短');
  return {
    title,
    summary: String(data.summary || '').trim().slice(0, 160),
    keywords: String(data.keywords || '').replace(/，/g, ',').trim().slice(0, 120),
    body,
  };
}

async function writePost(topic, notes) {
  if (!configured()) throw new Error('AI 功能還沒設定金鑰。');
  topic = String(topic || '').trim().slice(0, 100);
  notes = String(notes || '').trim().slice(0, 1000);
  if (!topic) throw new Error('請先寫文章主題。');
  let lastErr;
  for (const model of MODELS) {
    try {
      return clean(await ask(model, topic, notes));
    } catch (err) {
      lastErr = err;
    }
  }
  console.error('[write-post]', lastErr && lastErr.message);
  if (lastErr && lastErr.name === 'AbortError') throw new Error('AI 寫太久了，請再試一次。');
  throw new Error('AI 暫時寫不出來，請稍後再試。');
}

module.exports = { configured, writePost };
