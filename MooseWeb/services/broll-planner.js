const youtubeCut = require('./youtube-cut');

function configured() {
  return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
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

const VAGUE_QUERY_WORDS = new Set([
  'business', 'success', 'technology', 'modern', 'abstract', 'motivation', 'inspiration',
  'creative', 'digital', 'future', 'innovation', 'professional', 'corporate', 'startup',
  'beautiful', 'amazing', 'concept', 'background', 'cinematic', 'lifestyle', 'vlog',
]);

function hasCjk(text) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(text || ''));
}

function isVagueQuery(query) {
  const tokens = String(query || '').toLowerCase().split(/[\s,_-]+/).filter(Boolean);
  if (!tokens.length) return true;
  const concrete = tokens.filter((t) => !VAGUE_QUERY_WORDS.has(t) && t.length > 2);
  return concrete.length < 1;
}

function queryWarnings(searchQuery, searchAlt) {
  const q = String(searchQuery || '').trim();
  const warnings = [];
  if (hasCjk(q) || hasCjk(searchAlt)) {
    warnings.push('搜尋詞不可含中文；庫存站會把「星」當天文。請改成純英文畫面（例如 frustrated person facepalm）');
  }
  if (isVagueQuery(q)) {
    warnings.push('搜尋詞偏抽象，建議改成具體物品或動作');
  }
  return warnings.join('；');
}

function normalizeScenes(raw, scriptText) {
  if (!Array.isArray(raw)) throw new Error('分鏡格式錯誤');
  const scenes = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const index = Number(row.index) || scenes.length + 1;
    const narration = String(row.narration || row.text || '').trim();
    const visual = String(row.visual || row.scene || '').trim();
    const subjectEn = String(row.subject_en || row.subject || '').trim();
    const searchQuery = String(row.search_query || row.query || '').trim();
    const searchAlt = String(row.search_query_alt || row.query_alt || row.fallback_query || '').trim();
    let duration = Number(row.duration_sec || row.duration || 8);
    if (!Number.isFinite(duration)) duration = 8;
    duration = Math.min(20, Math.max(4, duration));
    if (!narration && !visual) continue;
    if (!searchQuery) throw new Error(`第 ${index} 鏡缺少英文 search_query`);
    scenes.push({
      index,
      narration: narration.slice(0, 800),
      visual: visual.slice(0, 400),
      subject_en: subjectEn.slice(0, 60),
      duration_sec: duration,
      search_query: searchQuery.slice(0, 80),
      search_query_alt: searchAlt.slice(0, 80),
      query_warning: queryWarnings(searchQuery, searchAlt),
    });
  }
  if (!scenes.length) throw new Error('沒有產出任何分鏡');
  if (scenes.length > 80) return scenes.slice(0, 80);
  return scenes;
}

async function planScenes(scriptText) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('未設定 GEMINI_API_KEY，無法分析文案');

  const body = String(scriptText || '').trim().slice(0, 14000);
  const prompt = [
    '你是 YouTube 長片剪輯助理。使用者會貼「旁白稿或改寫稿」（可能已改寫、不是逐字稿），用來規劃 B-roll，手上沒有影片素材。',
    '請依這份文字的意思切成多個連續鏡頭，每鏡對應一小段「建議口播重點」，方便之後用 Pexels 庫存影片搭配。',
    '規則：',
    '- 只輸出 JSON 陣列，不要 markdown、不要說明文字。',
    '- 每個元素：index、narration（繁體口播重點）、duration_sec（5～15）、visual（繁體：這一鏡畫面上「必須出現什麼物件／動作」，寫清楚）、subject_en（英文：這一鏡最重要的 1～3 個具體名詞，如 coffee cup / soldering iron / Google Flow app screen）、search_query（英文 3～7 詞，Pexels 搜影片；必須包含 subject_en 裡的具體物，可加上動作與景別，例如 "close up pour over coffee kettle"）、search_query_alt（英文備用搜尋，仍與同一物品相關但稍寬，例如找不到特寫就搜 "barista making coffee"）。',
    '- 鏡頭數：全文約每 40～80 字 1 鏡，至少 3 鏡，最多 40 鏡。',
    '- 順序與使用者文稿一致；narration 是剪輯對照，錄音可改口。',
    '- 禁止用空泛搜尋詞：不要用 business success technology inspiration cinematic abstract laptop desk screen office city skyline 來充數。',
    '- search_query 必須是這一句旁白裡觀眾該看到的那個東西，不能用比喻。旁白講細胞就搜 cell microscope，講科學家就搜 scientist microscope laboratory，講老年生活就搜 elderly couple walking。開場問候也要拍這支影片的主題，不要改拍筆電或桌面。',
    '- 這句沒有提到筆電、辦公室、文件、螢幕，就不准搜 laptop、desk、office、keyboard、monitor、document。旁白講缺電就搜電塔或發電廠，講晶片就搜晶片或伺服器機櫃，講股票就搜股票螢幕。',
    '- search_query、search_query_alt 必須「純英文」與半形空格，禁止任何中文、日文、韓文；禁止中英混寫（錯例：Frustrate派大星、angry海綿寶寶）。',
    '- 卡通角色、電影角色、明星、遊戲 IP（如派大星、海綿寶寶、漫威）：庫存站沒有版權畫面。visual 註明「用通用畫面代替」，search_query 只搜真人可拍的動作或物品（例：文案講派大星崩潰 → "person slapping forehead frustrated" / "cartoon style pink character" 仍可能沒有，優先用真人沮喪反應），禁止把角色中文名或譯名放進 search_query。',
    '- 文案若提到特定品牌／軟體／型號：subject_en 寫通用英文（laptop showing video editor）或該品類（smartphone on desk），不要虛構 Pexels 沒有的品牌畫面；visual 可註明「用類似介面代替」。',
    '- 只規劃影片素材，不要靜圖。',
    youtubeCut.plannerExtra(),
    '',
    '使用者提供的文稿（原文或改寫均可）：',
    body,
  ].join('\n');

  const models = ['gemini-flash-lite-latest', 'gemini-3.6-flash'];
  let lastErr = null;
  for (const model of models) {
    try {
      const json = await withTimeout(90000, async (signal) => {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.35,
                maxOutputTokens: 8192,
                responseMimeType: 'application/json',
              },
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`);
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : parsed.scenes || parsed.shots;
      });
      return normalizeScenes(json, body);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('分鏡分析失敗');
}

module.exports = { configured, planScenes, isVagueQuery, hasCjk, queryWarnings };
