const pexelsStock = require('./pexels-stock');
const pixabayStock = require('./pixabay-stock');

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ''));
}

function tidyQuery(text) {
  const drop = new Set([
    'a', 'an', 'the', 'of', 'in', 'on', 'at', 'for', 'to', 'and', 'or', 'with',
    'video', 'videos', 'photo', 'photos', 'image', 'images', 'picture', 'clip', 'footage',
    'horizontal', 'vertical', 'commercial', 'free', 'stock',
  ]);
  const words = String(text || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word && !drop.has(word.toLowerCase()));
  return words.slice(0, 8).join(' ');
}

function safeHttp(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function licenseFor(source) {
  return {
    label: '可商用',
    note: `${source} 免費授權，可商用。請保留來源頁。畫面若有商標或可辨識的人，上架前再確認。`,
  };
}

function wordsOf(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

function glossaryPlan(raw) {
  const wantsRoyalty = /女王|皇后|公主|國王/.test(raw);
  const wantsSnow = /雪|冰|冬天|霜|凍結/.test(raw);
  const wantsStage = /舞台|戲劇|話劇|跳舞|舞蹈|公演/.test(raw);
  const woman = /女|姐|她/.test(raw);
  const query = [];
  const must = [];
  const ban = [];
  const talking = /口播|旁白|對鏡|對鏡頭|對著鏡頭/.test(raw) && !wantsStage;
  if (/御姐|御姊/.test(raw) && !wantsRoyalty) {
    must.push('woman');
    ban.push('queen', 'princess', 'crown', 'king', 'fairy', 'fantasy', 'cosplay');
  }
  if (talking) {
    must.push('woman');
    ban.push('theater', 'theatre', 'stage', 'monologue', 'dance', 'dancing', 'performance', 'actor', 'play');
  }
  const cool = /冷感|高冷|冷豔|冷艷|冷臉|冷脸|冷淡/.test(raw) && !wantsSnow && !wantsRoyalty;
  if (cool) ban.push('snow', 'ice', 'winter', 'frost', 'frozen', 'queen');
  if (talking || /御姐|御姊/.test(raw) || cool) {
    ban.push('phone', 'mobile', 'car', 'christmas', 'singing', 'singer', 'guitar', 'bikini', 'swimsuit', 'boat', 'ship');
  }
  if ((/御姐|御姊/.test(raw) || cool) && woman) query.push('serious woman');
  else if (talking) query.push(woman ? 'woman presenting' : 'person presenting');
  else if (/御姐|御姊/.test(raw) || cool) query.push('serious woman');
  if (!query.length) return null;
  return {
    query: query[0],
    must: [...new Set(must)],
    any: [],
    ban: [...new Set(ban)],
  };
}

async function modelQuery(raw) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return '';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: [
              '把使用者要的畫面改成庫存網站搜得到的英文。只回 JSON：{"query":"2到4個英文詞"}。',
              '只寫畫面上看得到的人、物、動作。御姐是成熟女性，不是 queen。口播是對鏡頭說話，不是 theater、stage、monologue。冷感是神情，不是 snow 或 ice。',
              '不要加使用者沒講的 laptop、desk、office、city、queen、snow。',
              raw.slice(0, 180),
            ].join('\n'),
          }],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 80, responseMimeType: 'application/json' },
      }),
    },
  );
  const data = await res.json();
  const out = data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('') || '';
  const parsed = JSON.parse(out);
  return tidyQuery(parsed.query || '');
}

async function searchPlan(text) {
  const raw = String(text || '').trim();
  const known = glossaryPlan(raw);
  if (known) return known;
  if (!hasCjk(raw)) {
    return { query: tidyQuery(raw) || raw.slice(0, 80), must: [], any: [], ban: [] };
  }
  try {
    const query = await modelQuery(raw);
    if (query && !hasCjk(query)) return { query, must: [], any: [], ban: [] };
  } catch {
    /* 改用翻譯 */
  }
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(raw.slice(0, 180))}&langpair=zh-TW|en`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const data = await res.json().catch(() => ({}));
  const translated = String(data.responseData?.translatedText || '').trim();
  const query = !translated || /mymemory warning/i.test(translated) || hasCjk(translated)
    ? tidyQuery(raw) || raw.slice(0, 80)
    : tidyQuery(translated) || translated.slice(0, 80);
  return { query, must: [], any: [], ban: [] };
}

function keepHit(item, plan) {
  const tags = wordsOf(`${item.tags || ''} ${item.title || ''}`);
  if (plan.ban.some((word) => tags.includes(word))) return -1;
  let score = 0;
  for (const word of wordsOf(plan.query)) {
    if (tags.some((tag) => tag === word || tag.startsWith(word) || word.startsWith(tag))) score += 3;
  }
  for (const word of plan.must) {
    if (tags.some((tag) => tag === word || tag.startsWith(word))) score += 4;
  }
  if (plan.any.length) {
    const hit = plan.any.some((word) => tags.some((tag) => tag === word || tag.startsWith(word)));
    if (!hit) return -1;
    score += 6;
  }
  if (plan.must.includes('woman') && !tags.some((tag) => ['woman', 'women', 'female', 'girl', 'lady', 'businesswoman'].includes(tag))) return -1;
  return score;
}

async function pexelsImages(query) {
  const key = String(process.env.PEXELS_API_KEY || '').trim();
  if (!key) return [];
  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '24');
  url.searchParams.set('orientation', 'landscape');
  const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(12000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pexels 圖片 ${res.status}`);
  const license = licenseFor('Pexels');
  return (data.photos || []).map((photo) => ({
    id: `pexels-${photo.id}`,
    kind: 'image',
    tags: photo.alt || '',
    title: photo.alt || 'Pexels 圖片',
    thumb: safeHttp(photo.src?.medium),
    fileUrl: safeHttp(photo.src?.large || photo.src?.original),
    pageUrl: safeHttp(photo.url),
    creator: photo.photographer || '',
    source: 'Pexels',
    license: license.label,
    licenseNote: license.note,
  })).filter((item) => item.fileUrl);
}

async function pexelsVideos(query) {
  const key = String(process.env.PEXELS_API_KEY || '').trim();
  if (!key) return [];
  const url = new URL('https://api.pexels.com/videos/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '24');
  url.searchParams.set('orientation', 'landscape');
  const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(12000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pexels 影片 ${res.status}`);
  const license = licenseFor('Pexels');
  return (data.videos || []).map((video) => {
    const files = (video.video_files || []).filter((file) => safeHttp(file.link) && String(file.file_type || '').includes('mp4'));
    files.sort((a, b) => Math.abs((a.height || 0) - 720) - Math.abs((b.height || 0) - 720));
    const fileUrl = safeHttp(files[0]?.link);
    return {
      id: `pexels-video-${video.id}`,
      kind: 'video',
      tags: video.user?.name || '',
      title: video.user?.name ? `${video.user.name} 的影片` : 'Pexels 影片',
      thumb: safeHttp(video.image),
      fileUrl,
      pageUrl: safeHttp(video.url),
      creator: video.user?.name || '',
      source: 'Pexels',
      license: license.label,
      licenseNote: license.note,
    };
  }).filter((item) => item.fileUrl);
}

async function pixabayImages(query) {
  const key = String(process.env.PIXABAY_API_KEY || '').trim();
  if (!key) return [];
  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', key);
  url.searchParams.set('q', query.slice(0, 100));
  url.searchParams.set('image_type', 'photo');
  url.searchParams.set('orientation', 'horizontal');
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('per_page', '40');
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pixabay 圖片 ${res.status}`);
  const license = licenseFor('Pixabay');
  return (data.hits || []).map((hit) => ({
    id: `pixabay-${hit.id}`,
    kind: 'image',
    tags: hit.tags || '',
    title: shortTags(hit.tags) || 'Pixabay 圖片',
    thumb: safeHttp(hit.webformatURL || hit.previewURL),
    fileUrl: safeHttp(hit.largeImageURL || hit.webformatURL),
    pageUrl: safeHttp(hit.pageURL),
    creator: hit.user || '',
    source: 'Pixabay',
    license: license.label,
    licenseNote: license.note,
  })).filter((item) => item.fileUrl);
}

async function pixabayVideos(query) {
  const key = String(process.env.PIXABAY_API_KEY || '').trim();
  if (!key) return [];
  const url = new URL('https://pixabay.com/api/videos/');
  url.searchParams.set('key', key);
  url.searchParams.set('q', query.slice(0, 100));
  url.searchParams.set('video_type', 'film');
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('per_page', '40');
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pixabay 影片 ${res.status}`);
  const license = licenseFor('Pixabay');
  return (data.hits || []).map((hit) => {
    const clips = Object.values(hit.videos || {}).filter((clip) => safeHttp(clip?.url));
    clips.sort((a, b) => Math.abs((a.height || 0) - 720) - Math.abs((b.height || 0) - 720));
    const clip = clips[0];
    return {
      id: `pixabay-video-${hit.id}`,
      kind: 'video',
      tags: hit.tags || '',
      title: shortTags(hit.tags) || 'Pixabay 影片',
      thumb: safeHttp(clip?.thumbnail),
      fileUrl: safeHttp(clip?.url),
      pageUrl: safeHttp(hit.pageURL),
      creator: hit.user || '',
      source: 'Pixabay',
      license: license.label,
      licenseNote: license.note,
    };
  }).filter((item) => item.fileUrl);
}

async function collect(task, warnings, label) {
  try {
    return await task;
  } catch (err) {
    warnings.push(`${label}這次沒有回應。`);
    return [];
  }
}

function shortTags(tags) {
  const uniqueTags = [];
  for (const part of String(tags || '').split(',')) {
    const tag = part.trim();
    if (!tag || uniqueTags.some((item) => item.toLowerCase() === tag.toLowerCase())) continue;
    uniqueTags.push(tag);
    if (uniqueTags.length >= 4) break;
  }
  return uniqueTags.join(', ');
}

function rankHits(items, plan) {
  return items
    .map((item) => ({ item, score: keepHit(item, plan) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.item);
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.pageUrl || item.fileUrl;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function search({ text, kind = 'auto' }) {
  const plan = await searchPlan(text);
  if (!plan.query) throw new Error('請描述畫面上要出現的東西。');
  if (!pexelsStock.configured() && !pixabayStock.configured()) {
    throw new Error('請先在 .env 設定 PIXABAY_API_KEY 或 PEXELS_API_KEY。');
  }
  const wantImage = kind !== 'video';
  const wantVideo = kind !== 'image';
  const warnings = [];
  const [pexelsPhoto, pixabayPhoto, pexelsClip, pixabayClip] = await Promise.all([
    wantImage ? collect(pexelsImages(plan.query), warnings, 'Pexels 圖片') : [],
    wantImage ? collect(pixabayImages(plan.query), warnings, 'Pixabay 圖片') : [],
    wantVideo ? collect(pexelsVideos(plan.query), warnings, 'Pexels 影片') : [],
    wantVideo ? collect(pixabayVideos(plan.query), warnings, 'Pixabay 影片') : [],
  ]);
  const sources = [];
  if (pexelsStock.configured()) sources.push('Pexels');
  if (pixabayStock.configured()) sources.push('Pixabay');
  const images = unique(rankHits([...pexelsPhoto, ...pixabayPhoto], plan)).slice(0, 8);
  const videos = unique(rankHits([...pexelsClip, ...pixabayClip], plan)).slice(0, 8);
  if (!images.length && !videos.length) {
    warnings.push('沒有夠接近的畫面。試著寫畫面上看得到的人，例如：冷臉女性對鏡頭說話。');
  }
  return {
    query: plan.query,
    note: `用「${plan.query}」找可商用${wantImage && wantVideo ? '圖片和影片' : wantVideo ? '影片' : '圖片'}。舞台、冰雪、女王這類對不上的結果已拿掉。`,
    warnings,
    images,
    videos,
  };
}

module.exports = { search };
