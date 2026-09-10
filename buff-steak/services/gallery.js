const fs = require('fs');
const path = require('path');

function env(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

const DATA_DIR = env('DATA_DIR') || path.join(__dirname, '..', 'data');
const GALLERY_FILE = path.join(DATA_DIR, 'gallery.json');
const DEFAULT_GALLERY = path.join(__dirname, '..', 'public', 'data', 'gallery.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultGallery() {
  return { photos: [], videos: [] };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadGallery() {
  ensureDataDir();
  if (fs.existsSync(GALLERY_FILE)) {
    const data = readJson(GALLERY_FILE);
    if (data && typeof data === 'object') {
      return {
        photos: Array.isArray(data.photos) ? data.photos : [],
        videos: Array.isArray(data.videos) ? data.videos : [],
      };
    }
  }

  const seeded = readJson(DEFAULT_GALLERY) || defaultGallery();
  const gallery = {
    photos: Array.isArray(seeded.photos) ? seeded.photos : [],
    videos: Array.isArray(seeded.videos) ? seeded.videos : [],
  };
  saveGallery(gallery);
  return gallery;
}

function saveGallery(gallery) {
  ensureDataDir();
  fs.writeFileSync(
    GALLERY_FILE,
    JSON.stringify(
      {
        photos: gallery.photos || [],
        videos: gallery.videos || [],
      },
      null,
      2
    ),
    'utf8'
  );
}

function isSupportedVideoUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[a-zA-Z0-9_-]{11}/.test(raw)) return true;
  if (/vimeo\.com\/\d+/.test(raw)) return true;
  return false;
}

function addVideo({ url, title, note }) {
  const gallery = loadGallery();
  const cleanUrl = String(url || '').trim();
  if (!isSupportedVideoUrl(cleanUrl)) {
    return { ok: false, error: '請貼上有效的 YouTube、Shorts 或 Vimeo 連結' };
  }
  const entry = {
    id: `V-${Date.now()}`,
    url: cleanUrl,
    title: String(title || '店內影片').trim() || '店內影片',
    note: String(note || '').trim(),
    createdAt: new Date().toISOString(),
  };
  gallery.videos.unshift(entry);
  saveGallery(gallery);
  return { ok: true, video: entry, gallery };
}

function removeVideo(id) {
  const gallery = loadGallery();
  const before = gallery.videos.length;
  gallery.videos = gallery.videos.filter((v) => v.id !== id);
  if (gallery.videos.length === before) {
    const idx = Number(id);
    if (Number.isInteger(idx) && idx >= 0 && idx < before) {
      gallery.videos.splice(idx, 1);
    } else {
      return { ok: false, error: '找不到這支影片' };
    }
  }
  saveGallery(gallery);
  return { ok: true, gallery };
}

module.exports = {
  loadGallery,
  saveGallery,
  addVideo,
  removeVideo,
  isSupportedVideoUrl,
};
