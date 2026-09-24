const fs = require('fs');
const crypto = require('crypto');
const clipStore = require('./clip-store');
const { putAccount, accounts, putOauth, takeOauth, getMedia } = clipStore;

const LINK_HOSTS = {
  instagram: /(^|\.)instagram\.com$/i,
  threads: /(^|\.)threads\.(net|com)$/i,
  facebook: /(^|\.)(facebook\.com|fb\.com)$/i,
  tiktok: /(^|\.)tiktok\.com$/i,
};

const GRAPH = 'https://graph.facebook.com/v21.0';
const THREADS = 'https://graph.threads.net/v1.0';
const TIKTOK = 'https://open.tiktokapis.com';

function metaConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

function tiktokConfigured() {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

function publicHttps(origin) {
  return /^https:\/\//i.test(origin) && !/localhost|127\.0\.0\.1/i.test(origin);
}

function status(sid) {
  const acc = accounts(sid);
  return {
    metaApp: metaConfigured(),
    tiktokApp: tiktokConfigured(),
    facebook: Boolean(acc.facebook?.pageId),
    instagram: Boolean(acc.facebook?.igUserId),
    threads: Boolean(acc.facebook?.threadsUserId),
    tiktok: Boolean(acc.tiktok?.accessToken),
    pageName: acc.facebook?.pageName || '',
    igName: acc.facebook?.igName || '',
    tiktokName: acc.tiktok?.name || '',
    links: clipStore.getLinks(sid),
    queue: clipStore.listQueue(sid),
  };
}

function parseLink(kind, value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('@')) {
    const handle = raw.slice(1).replace(/[^\w.]/g, '');
    if (!handle) throw new Error('帳號名稱無效');
    if (kind === 'instagram') raw = `https://www.instagram.com/${handle}`;
    else if (kind === 'threads') raw = `https://www.threads.net/@${handle}`;
    else if (kind === 'tiktok') raw = `https://www.tiktok.com/@${handle}`;
    else raw = handle;
  }
  const maybeUrl = /^https?:\/\//i.test(raw) ? raw : (raw.includes('.') && !/\s/.test(raw) ? `https://${raw}` : '');
  if (maybeUrl) {
    try {
      const parsed = new URL(maybeUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const host = parsed.hostname.replace(/^www\./i, '');
        if (LINK_HOSTS[kind].test(host)) return parsed.toString();
      }
    } catch {
      /* 當作名稱保存 */
    }
  }
  return raw.slice(0, 80);
}

function saveLinks(sid, body) {
  const links = {
    instagram: parseLink('instagram', body?.instagram),
    threads: parseLink('threads', body?.threads),
    facebook: parseLink('facebook', body?.facebook),
    tiktok: parseLink('tiktok', body?.tiktok),
  };
  clipStore.putLinks(sid, links);
  return links;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    at: job.at,
    status: job.status,
    platforms: job.platforms,
    error: job.error || '',
    results: job.results || [],
  };
}

let ticking = false;

async function runJob(job) {
  clipStore.updateJob(job.id, { status: 'sending' });
  try {
    const results = await publish({
      sid: job.sid,
      origin: job.origin,
      platforms: job.platforms,
      caption: job.caption,
      imageIds: job.imageIds,
      videoId: job.videoId,
    });
    const allOk = results.length && results.every((row) => row.ok);
    clipStore.updateJob(job.id, {
      status: allOk ? 'sent' : 'error',
      results,
      error: allOk ? '' : results.filter((row) => !row.ok).map((row) => `${row.platform}：${row.error}`).join('／'),
      sentAt: new Date().toISOString(),
    });
    return clipStore.getJob(job.id);
  } catch (err) {
    clipStore.updateJob(job.id, { status: 'error', error: err.message || '發送失敗' });
    return clipStore.getJob(job.id);
  }
}

async function runDue() {
  if (ticking) return;
  ticking = true;
  try {
    for (const job of clipStore.dueJobs()) {
      await runJob(job);
    }
  } finally {
    ticking = false;
  }
}

async function schedule({ sid, origin, platforms, caption, imageIds, videoId, at, links }) {
  if (links) saveLinks(sid, links);
  const when = Date.parse(at);
  if (!Number.isFinite(when)) throw new Error('請選擇發送時間');
  if (when > Date.now() + 90 * 86400000) throw new Error('預約最長 90 天');
  const dest = Array.isArray(platforms) ? platforms.filter(Boolean) : [];
  if (!dest.length) throw new Error('請至少選一個平台，或先貼上對應帳號連結');
  const images = (imageIds || []).map(getMedia).filter((row) => row && row.sid === sid);
  const video = videoId ? getMedia(videoId) : null;
  if (video && video.sid !== sid) throw new Error('短片不屬於此工作階段');
  if (!images.length && !video) throw new Error('請先產出畫面與文案');
  const job = clipStore.addJob({
    id: `job-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    sid,
    origin,
    platforms: dest,
    caption: String(caption || '').slice(0, 2000),
    imageIds: images.map((row) => row.id),
    videoId: video ? video.id : '',
    at: new Date(when).toISOString(),
    status: 'queued',
    createdAt: new Date().toISOString(),
  });
  if (when <= Date.now() + 20000) {
    return { immediate: true, job: publicJob(await runJob(job)) };
  }
  return { queued: true, job: publicJob(job) };
}

function metaAuthUrl(origin, sid) {
  if (!metaConfigured()) return null;
  const state = crypto.randomBytes(16).toString('hex');
  putOauth(state, { sid, platform: 'meta' });
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: `${origin}/api/clip/oauth/meta/callback`,
    state,
    response_type: 'code',
    scope: [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'pages_manage_engagement',
      'instagram_basic',
      'instagram_content_publish',
      'business_management',
      'threads_basic',
      'threads_content_publish',
    ].join(','),
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

function tiktokAuthUrl(origin, sid) {
  if (!tiktokConfigured()) return null;
  const state = crypto.randomBytes(16).toString('hex');
  putOauth(state, { sid, platform: 'tiktok' });
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    redirect_uri: `${origin}/api/clip/oauth/tiktok/callback`,
    state,
    response_type: 'code',
    scope: 'user.info.basic,video.upload,video.publish',
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok || body.error || body.error_code) {
    const msg = body.error?.message || body.error?.error_description || body.message || text.slice(0, 240);
    throw new Error(msg);
  }
  return body;
}

async function finishMeta(origin, sid, code) {
  const redirect = `${origin}/api/clip/oauth/meta/callback`;
  const token = await jsonFetch(`${GRAPH}/oauth/access_token?${new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: redirect,
    code,
  })}`);
  let access = token.access_token;
  try {
    const longLived = await jsonFetch(`${GRAPH}/oauth/access_token?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: access,
    })}`);
    access = longLived.access_token || access;
  } catch {
    /* 開發模式可能無法換成長期權杖 */
  }
  const pages = await jsonFetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(access)}`);
  const page = (pages.data || [])[0];
  if (!page) throw new Error('這個 Meta 帳號沒有粉絲專頁。發文需要粉專。');
  let threadsUserId = '';
  try {
    const me = await jsonFetch(`${THREADS}/me?fields=id,username&access_token=${encodeURIComponent(access)}`);
    threadsUserId = me.id || '';
  } catch {
    threadsUserId = '';
  }
  putAccount(sid, 'facebook', {
    userToken: access,
    pageId: page.id,
    pageName: page.name,
    pageToken: page.access_token,
    igUserId: page.instagram_business_account?.id || '',
    igName: page.instagram_business_account?.username || '',
    threadsUserId,
  });
}

async function finishTiktok(origin, sid, code) {
  const body = await jsonFetch(`${TIKTOK}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${origin}/api/clip/oauth/tiktok/callback`,
    }),
  });
  const token = body.data || body;
  putAccount(sid, 'tiktok', {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    openId: token.open_id,
    name: token.open_id || 'TikTok',
  });
}

async function handleOauth(platform, origin, query) {
  const row = takeOauth(query.state);
  if (!row || row.platform !== platform) throw new Error('授權已過期，請再連一次。');
  if (query.error) throw new Error(query.error_description || query.error);
  if (!query.code) throw new Error('沒有授權碼。');
  if (platform === 'meta') await finishMeta(origin, row.sid, query.code);
  if (platform === 'tiktok') await finishTiktok(origin, row.sid, query.code);
  return row.sid;
}

function mediaUrl(origin, id) {
  return `${origin}/api/clip/media/${id}`;
}

async function publishFacebook(acc, caption, images) {
  if (!acc.pageId || !acc.pageToken) throw new Error('尚未連接 Facebook 粉專。');
  const first = images[0];
  const form = new FormData();
  form.append('caption', caption);
  form.append('published', 'true');
  form.append('source', new Blob([fs.readFileSync(first.full)], { type: first.mime || 'image/jpeg' }), first.filename);
  const body = await jsonFetch(`${GRAPH}/${acc.pageId}/photos?access_token=${encodeURIComponent(acc.pageToken)}`, {
    method: 'POST',
    body: form,
  });
  return { id: body.id || body.post_id };
}

async function publishInstagram(origin, acc, caption, imageId) {
  if (!acc.igUserId || !acc.pageToken) throw new Error('粉專尚未綁定 Instagram 專業帳號。');
  if (!publicHttps(origin)) throw new Error('Instagram 需要正式 https 網址才能取圖。請在 moose.bafuholdings.com 發送。');
  const created = await jsonFetch(`${GRAPH}/${acc.igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      image_url: mediaUrl(origin, imageId),
      caption,
      access_token: acc.pageToken,
    }),
  });
  const published = await jsonFetch(`${GRAPH}/${acc.igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      creation_id: created.id,
      access_token: acc.pageToken,
    }),
  });
  return { id: published.id };
}

async function publishThreads(origin, acc, caption, imageId) {
  const token = acc.userToken;
  if (!acc.threadsUserId || !token) throw new Error('尚未取得 Threads 發文權限。請重新連接 Meta。');
  if (!publicHttps(origin)) throw new Error('Threads 需要正式 https 網址才能取圖。請在 moose.bafuholdings.com 發送。');
  const created = await jsonFetch(`${THREADS}/${acc.threadsUserId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      media_type: 'IMAGE',
      image_url: mediaUrl(origin, imageId),
      text: caption,
      access_token: token,
    }),
  });
  const published = await jsonFetch(`${THREADS}/${acc.threadsUserId}/threads_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      creation_id: created.id,
      access_token: token,
    }),
  });
  return { id: published.id };
}

async function publishTiktok(acc, caption, video) {
  if (!acc.accessToken) throw new Error('尚未連接 TikTok。');
  if (!video) throw new Error('TikTok 需要短片檔。請先產出短片。');
  const buf = fs.readFileSync(video.full);
  const init = await jsonFetch(`${TIKTOK}/v2/post/publish/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${acc.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 150),
        privacy_level: 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: buf.length,
        chunk_size: buf.length,
        total_chunk_count: 1,
      },
    }),
  });
  const payload = init.data || init;
  const uploadUrl = payload.upload_url;
  if (!uploadUrl) throw new Error('TikTok 未回傳上傳位置。請確認應用已通過發文審核。');
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': video.mime || 'video/webm',
      'Content-Length': String(buf.length),
    },
    body: buf,
  });
  if (!put.ok) throw new Error(`TikTok 上傳失敗（${put.status}）。直式片若為 webm，平台可能要求 mp4。`);
  return { id: payload.publish_id || 'tiktok' };
}

async function publish({ sid, origin, platforms, caption, imageIds, videoId }) {
  const acc = accounts(sid);
  const images = (imageIds || []).map(getMedia).filter(Boolean);
  const video = videoId ? getMedia(videoId) : null;
  if (!platforms.length) throw new Error('請至少選一個平台。');
  if (!images.length && !video) throw new Error('請先產出短片或上傳商品圖。');
  const results = [];
  for (const platform of platforms) {
    try {
      if (platform === 'facebook') results.push({ platform, ok: true, ...(await publishFacebook(acc.facebook || {}, caption, images)) });
      else if (platform === 'instagram') results.push({ platform, ok: true, ...(await publishInstagram(origin, acc.facebook || {}, caption, images[0].id)) });
      else if (platform === 'threads') results.push({ platform, ok: true, ...(await publishThreads(origin, acc.facebook || {}, caption, images[0].id)) });
      else if (platform === 'tiktok') results.push({ platform, ok: true, ...(await publishTiktok(acc.tiktok || {}, caption, video)) });
      else results.push({ platform, ok: false, error: '不支援的平台' });
    } catch (err) {
      results.push({ platform, ok: false, error: err.message || String(err) });
    }
  }
  return results;
}

module.exports = {
  metaConfigured,
  tiktokConfigured,
  status,
  metaAuthUrl,
  tiktokAuthUrl,
  handleOauth,
  publish,
  saveLinks,
  schedule,
  runDue,
};
