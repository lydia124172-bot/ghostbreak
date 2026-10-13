const fs = require('fs');
const path = require('path');

function configured() {
  return Boolean(String(process.env.PEXELS_API_KEY || '').trim());
}

function searchPageUrl(query) {
  return `https://www.pexels.com/search/videos/${encodeURIComponent(query)}/`;
}

function pickVideoFile(video) {
  const files = Array.isArray(video.video_files) ? video.video_files : [];
  const mp4 = files.filter((f) => String(f.file_type || '').includes('mp4') && f.link);
  if (!mp4.length) return null;
  mp4.sort((a, b) => (b.height || 0) - (a.height || 0));
  const hd = mp4.find((f) => (f.height || 0) <= 1080) || mp4[0];
  return hd;
}

async function searchVideos(query, perPage = 5) {
  const key = String(process.env.PEXELS_API_KEY || '').trim();
  if (!key) return null;
  const url = new URL('https://api.pexels.com/videos/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('orientation', 'landscape');
  const res = await fetch(url, { headers: { Authorization: key } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pexels ${res.status}`);
  return Array.isArray(data.videos) ? data.videos : [];
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

async function fetchSceneVideo(scene, clipsDir, fileName) {
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
    const videos = await searchVideos(query, 10);
    if (!videos.length) continue;
    for (const video of videos) {
      const file = pickVideoFile(video);
      if (!file?.link) continue;
      try {
        const localPath = path.join(clipsDir, fileName);
        await downloadFile(file.link, localPath);
        return {
          ok: true,
          local_file: path.basename(localPath),
          pexels_page: video.url,
          photographer: video.user?.name,
          search_url: searchPageUrl(query),
          matched_query: query,
        };
      } catch {
        continue;
      }
    }
  }
  return {
    ok: false,
    search_url: lastUrl,
    search_url_alt: scene.search_query_alt ? searchPageUrl(scene.search_query_alt) : null,
    message: '自動下載未命中，請用主／備搜尋連結手動挑與「畫面說明」一致的影片',
  };
}

module.exports = {
  configured,
  searchPageUrl,
  fetchSceneVideo,
};
