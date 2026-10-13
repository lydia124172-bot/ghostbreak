const fs = require('fs');
const os = require('os');
const path = require('path');
const { runFfmpeg } = require('./clip-export');

function configured() {
  return Boolean(String(process.env.PIXABAY_API_KEY || '').trim());
}

function searchPageUrl(query) {
  return `https://pixabay.com/videos/search/${encodeURIComponent(query)}/`;
}

function pickVideoUrl(videos) {
  if (!videos || typeof videos !== 'object') return null;
  const order = ['large', 'medium', 'small', 'tiny'];
  const candidates = [];
  for (const key of order) {
    const row = videos[key];
    if (row?.url && (row.width || 0) >= (row.height || 0)) {
      candidates.push(row);
    }
  }
  if (!candidates.length) {
    for (const key of order) {
      const row = videos[key];
      if (row?.url) candidates.push(row);
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.height || 0) - (a.height || 0));
  const hd = candidates.find((f) => (f.height || 0) <= 1080) || candidates[0];
  return hd?.url || null;
}

function clipSize(hit) {
  const videos = hit?.videos || {};
  return videos.large || videos.medium || videos.small || null;
}

const QUERY_STOP = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or', 'from', 'into', 'over', 'by',
  'close', 'up', 'shot', 'video', 'footage', 'graphic', 'animation', 'conceptual',
  'person', 'people', 'man', 'woman', 'human', 'hands', 'hand',
  'looking', 'showing', 'sitting', 'standing', 'holding', 'using', 'walking', 'moving', 'staring',
  'fast', 'slow', 'beautiful', 'dark', 'late', 'indoor', 'indoors', 'outdoor',
]);

const GENERIC = new Set([
  'desk', 'laptop', 'wooden', 'screen', 'computer', 'office', 'day', 'city', 'street', 'modern',
  'digital', 'data', 'code', 'light', 'lights', 'night', 'busy', 'room', 'camera', 'park', 'sunny',
  'view', 'background', 'concept', 'business', 'success', 'technology', 'abstract', 'content',
  'creator', 'vlogger', 'talking', 'smiling', 'happy', 'happily', 'working', 'time', 'future',
]);

function contentWords(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !QUERY_STOP.has(word));
}

function specificWords(text) {
  return contentWords(text).filter((word) => !GENERIC.has(word));
}

function tagOverlap(query, hit) {
  const wanted = specificWords(query);
  const tags = contentWords(hit?.tags);
  if (!wanted.length || !tags.length) return { count: 0, words: [] };
  const matched = wanted.filter((word) => tags.some((tag) => tag === word || tag.startsWith(word) || word.startsWith(tag)));
  return { count: matched.length, words: matched };
}

function scoreHit(hit, query) {
  const wanted = specificWords(query);
  const overlap = tagOverlap(query, hit);
  const need = wanted.length >= 2 ? 2 : 1;
  if (!wanted.length || overlap.count < need) return -1;
  const size = clipSize(hit);
  const width = size?.width || 0;
  const height = size?.height || 0;
  const duration = Number(hit?.duration) || 0;
  let score = overlap.count * 40;
  if (height >= 720 && width >= 1280) score += 8;
  if (width > height) score += 6;
  if (duration >= 5 && duration <= 40) score += 4;
  return score;
}

function searchPhrase(query) {
  const words = specificWords(query);
  const picked = (words.length ? words : contentWords(query)).slice(0, 3);
  return picked.join(' ') || String(query || '').trim();
}

async function searchVideos(query, perPage = 20, options = {}) {
  const key = String(process.env.PIXABAY_API_KEY || '').trim();
  if (!key) return null;
  const url = new URL('https://pixabay.com/api/videos/');
  url.searchParams.set('key', key);
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', String(Math.min(50, Math.max(3, perPage))));
  url.searchParams.set('video_type', 'film');
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('order', 'popular');
  if (options.editorsChoice) url.searchParams.set('editors_choice', 'true');
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pixabay ${res.status}`);
  return Array.isArray(data.hits) ? data.hits : [];
}

async function frameAccepts(filePath, scene) {
  const frame = path.join(os.tmpdir(), `mw-broll-frame-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  try {
    await runFfmpeg(['-y', '-ss', '0.5', '-i', filePath, '-frames:v', '1', '-q:v', '3', frame], frame);
    if (!fs.existsSync(frame)) return false;
    const key = String(process.env.GEMINI_API_KEY || '').trim();
    if (!key) return false;
    const prompt = [
      `旁白：「${String(scene.narration || '').replace(/\s+/g, ' ').slice(0, 180)}」`,
      `這一鏡必須看到：${String(scene.visual || scene.subject_en || '').replace(/\s+/g, ' ').slice(0, 180)}`,
      '這張圖有沒有清楚拍到旁白在講的那個東西？',
      '如果拍到的是別的東西（網路線或交換器特寫、雲朵、飛機、筆電鍵盤、辦公室文件、主機板當科技壁紙），而旁白不是在講那些，回答 no。',
      '只回答 yes 或 no。',
    ].join('\n');
    const models = ['gemini-flash-lite-latest', 'gemini-3.6-flash'];
    for (const model of models) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: prompt },
                { inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(frame).toString('base64') } },
              ],
            }],
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) continue;
      const text = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join(' ').trim();
      if (/^yes\b/i.test(text)) return true;
      if (/^no\b/i.test(text)) return false;
    }
    return false;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(frame); } catch { /* 略過 */ }
  }
}

async function downloadFile(fileUrl, destPath) {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`下載失敗 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 50000) throw new Error('檔案太小，可能不是有效影片');
  if (buf.length > 120 * 1024 * 1024) throw new Error('影片超過 120MB，請換一支或手動下載');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return destPath;
}

async function fetchSceneVideo(scene, clipsDir, fileName, options = {}) {
  const usedIds = options.usedIds || new Set();
  const queries = [
    scene.search_query,
    scene.search_query_alt,
    scene.subject_en,
  ]
    .map((q) => String(q || '').trim())
    .filter((q, i, arr) => q && arr.indexOf(q) === i);

  let lastUrl = searchPageUrl(scene.search_query || 'video');
  for (const query of queries) {
    lastUrl = searchPageUrl(query);
    const phrase = searchPhrase(query);
    const hits = await searchVideos(phrase, 20);
    const ranked = (hits || [])
      .filter((hit) => hit?.id && !usedIds.has(String(hit.id)))
      .map((hit) => ({ hit, score: scoreHit(hit, query) }))
      .filter((row) => row.score >= 40)
      .sort((a, b) => b.score - a.score);
    const candidates = ranked.slice(0, 3);
    for (const row of candidates) {
      const hit = row.hit;
      const fileUrl = pickVideoUrl(hit.videos);
      if (!fileUrl) continue;
      const localPath = path.join(clipsDir, fileName);
      try {
        await downloadFile(fileUrl, localPath);
        const accepts = await frameAccepts(localPath, scene);
        if (!accepts) {
          try { fs.unlinkSync(localPath); } catch { /* 略過 */ }
          continue;
        }
        const overlap = tagOverlap(query, hit);
        return {
          ok: true,
          local_file: path.basename(localPath),
          pexels_page: hit.pageURL || searchPageUrl(phrase),
          photographer: hit.user || null,
          search_url: searchPageUrl(query),
          matched_query: query,
          matched_tags: overlap.words.join(', '),
          stock_id: String(hit.id),
          stock_provider: 'pixabay',
        };
      } catch {
        try { fs.unlinkSync(localPath); } catch { /* 略過 */ }
        continue;
      }
    }
  }
  return {
    ok: false,
    search_url: lastUrl,
    search_url_alt: scene.search_query_alt ? searchPageUrl(scene.search_query_alt) : null,
    message: '找不到和這句旁白對得上的素材，請用搜尋連結手動挑',
    stock_provider: 'pixabay',
  };
}

module.exports = {
  configured,
  searchPageUrl,
  fetchSceneVideo,
  frameAccepts,
};
