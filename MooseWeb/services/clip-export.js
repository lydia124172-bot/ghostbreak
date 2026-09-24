const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const clipStore = require('./clip-store');

function ffmpegBin() {
  try {
    const bin = require('ffmpeg-static');
    if (bin && fs.existsSync(bin)) return bin;
  } catch {
    /* 未安裝轉檔工具 */
  }
  return '';
}

function mp4Path(row) {
  return path.join(clipStore.MEDIA, `${row.id}.mp4`);
}

function alreadyMp4(row) {
  return /mp4/i.test(row.mime || '') || /\.mp4$/i.test(row.filename || '');
}

function convert(input, output) {
  const bin = ffmpegBin();
  if (!bin) return Promise.reject(new Error('no-ffmpeg'));
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', input,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-level', '4.1',
      '-preset', 'veryfast',
      '-crf', '20',
      '-r', '30',
      '-an',
      '-movflags', '+faststart',
      output,
    ];
    const proc = spawn(bin, args, { windowsHide: true });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) resolve(output);
      else reject(new Error('convert-failed'));
    });
  });
}

function runFfmpeg(args, output) {
  const bin = ffmpegBin();
  if (!bin) return Promise.reject(new Error('no-ffmpeg'));
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) resolve(output);
      else reject(new Error('convert-failed'));
    });
  });
}

async function remuxPlayable(buffer) {
  const srcBuf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (srcBuf.length < 200) return { buffer: srcBuf, mime: 'video/mp4' };
  const src = writeTemp('mw-in', srcBuf, 'mp4');
  const out = path.join(os.tmpdir(), `mw-play-${Date.now()}.mp4`);
  try {
    await runFfmpeg(['-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', out], out);
    const ready = fs.readFileSync(out);
    return { buffer: ready, mime: 'video/mp4' };
  } catch {
    try {
      await runFfmpeg([
        '-y', '-i', src,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        out,
      ], out);
      return { buffer: fs.readFileSync(out), mime: 'video/mp4' };
    } catch {
      return { buffer: srcBuf, mime: 'video/mp4' };
    }
  } finally {
    try { fs.unlinkSync(src); } catch { /* 略過 */ }
    try { fs.unlinkSync(out); } catch { /* 略過 */ }
  }
}

async function ensureMp4(id) {
  const row = clipStore.getMedia(id);
  if (!row || row.kind !== 'video') throw new Error('找不到短片');
  if (alreadyMp4(row)) return { ...row, mp4Full: row.full, mime: 'video/mp4' };
  const out = mp4Path(row);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) {
    return { ...row, mp4Full: out, mime: 'video/mp4' };
  }
  try {
    await convert(row.full, out);
    return { ...row, mp4Full: out, mime: 'video/mp4' };
  } catch {
    return { ...row, mp4Full: row.full, mime: row.mime || 'video/webm' };
  }
}

function writeTemp(prefix, buf, ext) {
  const full = path.join(require('os').tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
  fs.writeFileSync(full, buf);
  return full;
}

function extOf(mime) {
  if (/wav/i.test(mime || '')) return 'wav';
  if (/mp4|m4a|aac/i.test(mime || '')) return 'm4a';
  return 'mp3';
}

function mixAudio(music, voice) {
  const bin = ffmpegBin();
  if (!bin) return Promise.resolve(voice || music);
  if (!music || !voice) return Promise.resolve(voice || music);
  const musicPath = writeTemp('mw-m', music.buffer, extOf(music.mime));
  const voicePath = writeTemp('mw-v', voice.buffer, extOf(voice.mime));
  const outPath = path.join(require('os').tmpdir(), `mw-x-${Date.now()}.mp3`);
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', musicPath,
      '-i', voicePath,
      '-filter_complex',
      '[0:a]volume=0.22[a0];[1:a]volume=1[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a]',
      '-map', '[a]',
      '-t', '10',
      '-ac', '1',
      '-ar', '44100',
      '-b:a', '128k',
      outPath,
    ];
    const proc = spawn(bin, args, { windowsHide: true });
    proc.on('error', reject);
    proc.on('close', (code) => {
      try { fs.unlinkSync(musicPath); } catch { /* ignore */ }
      try { fs.unlinkSync(voicePath); } catch { /* ignore */ }
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        const buffer = fs.readFileSync(outPath);
        try { fs.unlinkSync(outPath); } catch { /* ignore */ }
        resolve({ buffer, mime: 'audio/mpeg' });
        return;
      }
      try { fs.unlinkSync(outPath); } catch { /* ignore */ }
      resolve(voice);
    });
  });
}

async function concatVideos(buffers) {
  const bin = ffmpegBin();
  if (!bin) throw new Error('短劇接片尚未開通。');
  const clips = (buffers || []).filter((buf) => buf && buf.length > 200);
  if (clips.length < 2) throw new Error('至少要兩鏡才能接成短劇。');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-drama-'));
  const list = path.join(dir, 'list.txt');
  const out = path.join(dir, 'out.mp4');
  try {
    const names = clips.map((buf, i) => {
      const full = path.join(dir, `${i}.mp4`);
      fs.writeFileSync(full, buf);
      return full;
    });
    fs.writeFileSync(list, names.map((full) => `file '${full.replace(/\\/g, '/')}'`).join('\n'));
    try {
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], out);
    } catch {
      await runFfmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', list,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        out,
      ], out);
    }
    return { buffer: fs.readFileSync(out), mime: 'video/mp4' };
  } finally {
    try {
      fs.readdirSync(dir).forEach((name) => {
        try { fs.unlinkSync(path.join(dir, name)); } catch { /* 略過 */ }
      });
      fs.rmdirSync(dir);
    } catch { /* 略過 */ }
  }
}

function sendDownload(res, filePath, mime, filename) {
  const abs = path.resolve(filePath);
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.download(abs, filename, { dotfiles: 'allow' });
}

module.exports = { ffmpegBin, ensureMp4, remuxPlayable, concatVideos, mixAudio, sendDownload };
