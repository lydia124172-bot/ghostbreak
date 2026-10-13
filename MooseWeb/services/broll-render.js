const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ffmpegBin, runFfmpeg } = require('./clip-export');
const clipTts = require('./clip-tts');
const youtubeCut = require('./youtube-cut');

const PREVIEW_NAME = 'broll-preview.mp4';

function previewPath(folder) {
  return path.join(folder, PREVIEW_NAME);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeDuration(file) {
  const bin = ffmpegBin();
  if (!bin || !fs.existsSync(file)) return Promise.resolve(0);
  return new Promise((resolve) => {
    const proc = spawn(bin, ['-i', file, '-f', 'null', '-'], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return resolve(0);
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    proc.on('error', () => resolve(0));
  });
}

function sceneDurationSec(scene) {
  return Math.max(2, Math.min(20, Number(scene.duration_sec) || 8));
}

function narrationChunks(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return [];
  const parts = [];
  let rest = line;
  while (rest.length > 280) {
    let cut = rest.lastIndexOf('。', 280);
    if (cut < 40) cut = rest.lastIndexOf('，', 280);
    if (cut < 40) cut = 280;
    else cut += 1;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

async function buildNarrationAudio(text, workDir, index) {
  const parts = narrationChunks(text);
  if (!parts.length || !clipTts.configured()) return null;

  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const { buffer, mime } = await clipTts.speak(parts[i], { cut: 'youtube' });
    const ext = /wav/i.test(mime) ? 'wav' : 'mp3';
    const raw = path.join(workDir, `narr-${String(index).padStart(2, '0')}-${i}.${ext}`);
    fs.writeFileSync(raw, buffer);
    files.push(raw);
    if (i < parts.length - 1) await sleep(450);
  }

  const spoken = path.join(workDir, `narr-${String(index).padStart(2, '0')}.wav`);
  if (files.length === 1) {
    await runFfmpeg(['-y', '-i', files[0], '-af', `atempo=${youtubeCut.PACE},highpass=f=80`, '-ar', '44100', '-ac', '1', spoken], spoken);
  } else {
    const list = path.join(workDir, `narr-${String(index).padStart(2, '0')}-list.txt`);
    fs.writeFileSync(
      list,
      files.map((full) => `file '${full.replace(/\\/g, '/')}'`).join('\n'),
      'utf8',
    );
    await runFfmpeg([
      '-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-af', `atempo=${youtubeCut.PACE},highpass=f=80`,
      '-ar', '44100', '-ac', '1',
      spoken,
    ], spoken);
  }
  const duration = await probeDuration(spoken);
  if (!(duration > 0.3)) return null;
  return { path: spoken, duration };
}

async function laySfx(voicePath, dest, kind) {
  const layers = youtubeCut.sfxFor(kind);
  if (!layers.length) {
    fs.copyFileSync(voicePath, dest);
    return dest;
  }
  const args = ['-y', '-i', voicePath];
  layers.forEach((layer) => {
    args.push('-f', 'lavfi', '-t', String(layer.seconds), '-i', `aevalsrc=${layer.expr}:s=44100`);
  });
  const tags = layers.map((layer, i) => {
    const id = i + 1;
    return `[${id}:a]volume=${layer.volume},adelay=${layer.delayMs}:all=1[s${id}]`;
  });
  const mixIns = ['[0:a]', ...layers.map((_, i) => `[s${i + 1}]`)].join('');
  const filter = `${tags.join(';')};${mixIns}amix=inputs=${layers.length + 1}:duration=first:dropout_transition=0:normalize=0[a]`;
  args.push('-filter_complex', filter, '-map', '[a]', '-ar', '44100', '-ac', '1', dest);
  await runFfmpeg(args, dest);
  return dest;
}

async function sourceIsStill(filePath) {
  const bin = ffmpegBin();
  if (!bin || !fs.existsSync(filePath)) return false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-still-'));
  const first = path.join(dir, 'a.png');
  const second = path.join(dir, 'b.png');
  try {
    await runFfmpeg(['-y', '-ss', '0.25', '-i', filePath, '-frames:v', '1', first], first);
    await runFfmpeg(['-y', '-ss', '1.4', '-i', filePath, '-frames:v', '1', second], second);
    const score = await new Promise((resolve) => {
      const proc = spawn(bin, [
        '-i', first, '-i', second,
        '-lavfi', 'blend=all_mode=difference,signalstats,metadata=print:file=-',
        '-f', 'null', '-',
      ], { windowsHide: true });
      let text = '';
      proc.stdout.on('data', (chunk) => { text += chunk; });
      proc.stderr.on('data', (chunk) => { text += chunk; });
      proc.on('close', () => {
        const match = text.match(/YAVG=([0-9.]+)/);
        resolve(match ? Number(match[1]) : 99);
      });
      proc.on('error', () => resolve(99));
    });
    return score < 4;
  } catch {
    return false;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 略過 */ }
  }
}

async function muxSceneSegment(videoSrc, audioPath, output, durationSec, moving, punch, index) {
  const dur = Math.round(Math.max(0.4, Number(durationSec) || 4) * 1000) / 1000;
  const args = [
    '-y',
    '-stream_loop', '-1',
    '-i', videoSrc,
  ];
  if (audioPath) {
    args.push('-i', audioPath);
  } else {
    args.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=mono');
  }
  args.push(
    '-t', String(dur),
    '-vf', youtubeCut.sceneFilters({ dur, moving, punch, index }),
    '-af', `volume=1.7,apad=pad_dur=0.4,atrim=duration=${dur},asetpts=PTS-STARTPTS`,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-shortest',
    '-movflags', '+faststart',
    output,
  );
  await runFfmpeg(args, output);
}

async function writeBed(dest, expr, seconds) {
  const dur = Math.max(1, Number(seconds) || 1).toFixed(2);
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', `aevalsrc=${expr}:s=44100:d=${dur}`,
    '-ac', '2', dest,
  ], dest);
}

async function writeBumper(dest) {
  const sting = youtubeCut.sfxFor('section')[0];
  await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x14060c:s=1920x1080:r=30:d=0.45',
    '-f', 'lavfi', '-t', String(sting.seconds), '-i', `aevalsrc=${sting.expr}:s=44100`,
    '-vf', youtubeCut.bumperFilters(),
    '-map', '0:v:0', '-map', '1:a:0',
    '-t', '0.45',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-shortest', '-movflags', '+faststart',
    dest,
  ], dest);
}

async function mixScore(videoPath, dest, totalSec) {
  const beds = youtubeCut.bedPlan(totalSec);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-broll-bed-'));
  const files = [];
  for (const bed of beds) {
    const file = path.join(dir, `bed-${bed.id}.wav`);
    await writeBed(file, bed.expr, bed.seconds);
    const gained = path.join(dir, `bed-${bed.id}-g.wav`);
    await runFfmpeg(['-y', '-i', file, '-af', `volume=${bed.gain}`, gained], gained);
    files.push(gained);
  }
  const list = path.join(dir, 'bed-list.txt');
  fs.writeFileSync(list, files.map((file) => `file '${file.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  const bed = path.join(dir, 'bed.wav');
  const bedDur = beds.reduce((sum, row) => sum + row.seconds, 0);
  await runFfmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-af', 'afade=t=in:st=0:d=0.4,afade=t=out:st=' + Math.max(0, bedDur - 1.1).toFixed(2) + ':d=1',
    bed,
  ], bed);
  await runFfmpeg([
    '-y', '-i', videoPath, '-i', bed,
    '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]',
    '-map', '0:v:0', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    dest,
  ], dest);
}

async function renderPreview(folder, scenes, onProgress) {
  const bin = ffmpegBin();
  if (!bin) throw new Error('本機缺少 ffmpeg，無法合成影片。');

  const clipsDir = path.join(folder, 'clips');
  const ordered = [...scenes].sort((a, b) => Number(a.index) - Number(b.index));
  const withFiles = ordered.filter((s) => {
    if (!s.local_file) return false;
    return fs.existsSync(path.join(clipsDir, s.local_file));
  });
  if (withFiles.length < 1) throw new Error('尚無可合成的鏡頭，請先下載素材。');

  const withTts = clipTts.configured();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-broll-'));
  const segments = [];
  let totalSec = 0;
  let voiced = 0;
  let lastPunchAt = -youtubeCut.PUNCH_GAP_SEC;
  let prevSection = '';
  try {
    for (let i = 0; i < withFiles.length; i++) {
      const scene = withFiles[i];
      const section = youtubeCut.sectionAt(i, withFiles.length);
      if (prevSection && section !== prevSection) {
        const bumper = path.join(work, `bump-${section}.mp4`);
        try {
          await writeBumper(bumper);
          segments.push(bumper);
          totalSec += 0.45;
          lastPunchAt = totalSec;
        } catch { /* 過場失敗就直接接下一鏡 */ }
      }
      prevSection = section;
      let dur = sceneDurationSec(scene);
      if (onProgress) {
        onProgress({
          step: i + 1,
          total: withFiles.length,
          message: withTts
            ? `第 ${i + 1}/${withFiles.length} 鏡：旁白語音與畫面…`
            : `正在處理第 ${i + 1}/${withFiles.length} 鏡…`,
        });
      }

      let audioPath = null;
      if (withTts && scene.narration) {
        try {
          const spoken = await buildNarrationAudio(scene.narration, work, scene.index);
          if (spoken) {
            audioPath = spoken.path;
            dur = spoken.duration + 0.12;
            voiced += 1;
          }
          await sleep(450);
        } catch (err) {
          if (onProgress) {
            onProgress({
              message: `第 ${i + 1} 鏡旁白失敗（${err.message || '略過'}），該鏡僅畫面。`,
            });
          }
        }
      }

      const punch = youtubeCut.punchFor(scene.narration, totalSec - lastPunchAt);
      if (punch && audioPath) {
        const punched = path.join(work, `punch-${String(i + 1).padStart(2, '0')}.wav`);
        try {
          await laySfx(audioPath, punched, punch.kind);
          audioPath = punched;
        } catch { /* 音效失敗就只留旁白 */ }
      }
      if (punch) lastPunchAt = totalSec;

      const src = path.join(clipsDir, scene.local_file);
      const moving = scene.stock_provider === 'gemini-still' || await sourceIsStill(src);
      const seg = path.join(work, `seg-${String(i + 1).padStart(2, '0')}.mp4`);
      await muxSceneSegment(src, audioPath, seg, dur, moving, punch, scene.index);
      segments.push(seg);
      totalSec += dur;
    }

    if (withTts && voiced < 1) {
      throw new Error('旁白語音沒有產出，預覽片沒有覆蓋。');
    }

    const list = path.join(work, 'concat.txt');
    fs.writeFileSync(
      list,
      segments.map((full) => `file '${full.replace(/\\/g, '/')}'`).join('\n'),
      'utf8',
    );
    const out = previewPath(folder);
    if (onProgress) {
      onProgress({
        message: withTts ? '正在接成一支含旁白的影片…' : '正在接成一支影片…',
      });
    }
    const joined = path.join(work, 'joined.mp4');
    await runFfmpeg([
      '-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart', joined,
    ], joined);
    if (onProgress) onProgress({ message: '正在鋪上冷感電子配樂…' });
    try {
      await mixScore(joined, out, totalSec);
    } catch (err) {
      fs.copyFileSync(joined, out);
    }
    return {
      file: PREVIEW_NAME,
      scene_count: withFiles.length,
      with_tts: withTts,
      duration_sec: totalSec,
    };
  } finally {
    try {
      for (const name of fs.readdirSync(work)) {
        try { fs.unlinkSync(path.join(work, name)); } catch { /* 略過 */ }
      }
      fs.rmdirSync(work);
    } catch { /* 略過 */ }
  }
}

module.exports = { PREVIEW_NAME, previewPath, renderPreview };
