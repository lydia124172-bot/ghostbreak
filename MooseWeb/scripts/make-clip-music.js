const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const bin = require('ffmpeg-static');

const dir = path.join(__dirname, '..', 'public', 'clip-music');
const rawDir = path.join(dir, '_raw');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });

const TRACKS = [
  { id: 'bright', title: 'Feeling Happy', artist: 'Eugenio Mininni', url: 'https://assets.mixkit.co/music/5/5.mp3', start: 8 },
  { id: 'soft', title: 'Sweet September', artist: 'Arulo', url: 'https://assets.mixkit.co/music/282/282.mp3', start: 6 },
  { id: 'warm', title: 'Owies Ukulele', artist: 'Eugenio Mininni', url: 'https://assets.mixkit.co/music/1072/1072.mp3', start: 4 },
  { id: 'beat', title: 'C.B.P.D', artist: 'Arulo', url: 'https://assets.mixkit.co/music/400/400.mp3', start: 8 },
  { id: 'play', title: 'Smile', artist: 'Michael Ramir C.', url: 'https://assets.mixkit.co/music/1076/1076.mp3', start: 5 },
  { id: 'luxe', title: 'Cat Walk', artist: 'Arulo', url: 'https://assets.mixkit.co/music/371/371.mp3', start: 8 },
  { id: 'clear', title: 'Serene View', artist: 'Arulo', url: 'https://assets.mixkit.co/music/443/443.mp3', start: 6 },
  { id: 'night', title: 'Hazy After Hours', artist: 'Arulo', url: 'https://assets.mixkit.co/music/132/132.mp3', start: 10 },
  { id: 'film', title: 'Vastness', artist: 'Alejandro Magaña (A. M.)', url: 'https://assets.mixkit.co/music/184/184.mp3', start: 8 },
  { id: 'quiet', title: 'Sleepy Cat', artist: 'Alejandro Magaña (A. M.)', url: 'https://assets.mixkit.co/music/135/135.mp3', start: 8 },
];

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 20000) throw new Error(`${url} too small ${buf.length}`);
  fs.writeFileSync(dest, buf);
}

function cut(src, dest, start) {
  const res = spawnSync(bin, [
    '-y', '-ss', String(start), '-t', '10', '-i', src,
    '-af', 'afade=t=in:st=0:d=0.12,afade=t=out:st=9.4:d=0.55,volume=3,alimiter=limit=0.92',
    '-ac', '2', '-ar', '44100', '-b:a', '160k', dest,
  ], { windowsHide: true });
  if (res.status !== 0 || !fs.existsSync(dest) || fs.statSync(dest).size < 20000) {
    throw new Error(`${path.basename(dest)} ${(res.stderr || Buffer.from('')).toString().slice(-400)}`);
  }
}

(async () => {
  for (const row of TRACKS) {
    const raw = path.join(rawDir, `${row.id}.mp3`);
    const out = path.join(dir, `${row.id}.mp3`);
    process.stdout.write(`get ${row.id} ${row.title}… `);
    await download(row.url, raw);
    cut(raw, out, row.start);
    console.log(fs.statSync(out).size);
  }
  fs.writeFileSync(path.join(dir, 'CREDITS.txt'), [
    'Built-in beds are 10-second excerpts of Mixkit free stock music.',
    'License: https://mixkit.co/license/  (commercial use in videos; do not resell the audio files).',
    '',
    ...TRACKS.map((row) => `${row.id}.mp3 — ${row.title} — ${row.artist} — ${row.url}`),
    '',
  ].join('\n'));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
