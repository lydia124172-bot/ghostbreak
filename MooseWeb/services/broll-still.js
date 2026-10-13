const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffmpegBin, runFfmpeg } = require('./clip-export');

function configured() {
  return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

function partImage(part) {
  const inline = part.inlineData || part.inline_data;
  if (!inline || !inline.data) return null;
  const mime = inline.mimeType || inline.mime_type || 'image/png';
  return { mime, buffer: Buffer.from(inline.data, 'base64') };
}

function promptFor(scene) {
  const visual = String(scene.visual || '').trim();
  const line = String(scene.narration || '').replace(/\s+/g, ' ').trim().slice(0, 280);
  return [
    'Photorealistic 16:9 cinematic still for a YouTube video.',
    'No text, no captions, no subtitles, no watermark, no logos.',
    visual ? `The picture must show: ${visual}` : '',
    line ? `The spoken line is: ${line}` : '',
    'Show the concrete subject of that sentence. Do not substitute a laptop, desk, or city skyline.',
  ].filter(Boolean).join('\n');
}

async function generateImage(scene) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('未設定 GEMINI_API_KEY');
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptFor(scene) }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
        },
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `生圖服務 ${res.status}`);
  const parts = body.candidates?.[0]?.content?.parts || [];
  const image = parts.map(partImage).find(Boolean);
  if (!image) throw new Error('沒有產出圖片');
  return image;
}

async function stillToVideo(imagePath, destPath) {
  const bin = ffmpegBin();
  if (!bin) throw new Error('本機缺少 ffmpeg，無法把生成圖做成鏡頭。');
  await runFfmpeg([
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-t', '15',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-an',
    destPath,
  ], destPath);
}

async function generateSceneClip(scene, destPath) {
  const image = await generateImage(scene);
  const ext = /png/i.test(image.mime) ? 'png' : 'jpg';
  const still = path.join(os.tmpdir(), `mw-broll-still-${Date.now()}.${ext}`);
  fs.writeFileSync(still, image.buffer);
  try {
    await stillToVideo(still, destPath);
  } finally {
    try { fs.unlinkSync(still); } catch { /* 略過 */ }
  }
}

module.exports = { configured, generateSceneClip };
