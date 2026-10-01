const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const key = String(process.env.FAL_KEY || '').trim();
if (!key) {
  console.log('missing video key');
  process.exit(1);
}

const prompt = [
  'Vertical 9:16 cinematic product commercial, 15 seconds, photoreal, premium lighting.',
  'Follow this script beat by beat. No on-screen captions, subtitles, prices, logos, or watermarks.',
  'Keep a bag of pour-over coffee beans recognizable.',
  'SCRIPT:',
  '晨光從窗邊進來，木桌上放著一袋剛烘好的手沖咖啡豆。',
  '手撥開袋口，深焙香氣散開。熱水緩緩注入濾杯，液面慢慢漲起。',
  '最後端起杯子靠近窗邊，蒸汽在光裡轉了一下。',
  '旁白：今天下單，今晚烘好寄出。',
].join('\n');

const model = 'bytedance/seedance-2.0/fast/text-to-video';

(async () => {
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      resolution: '720p',
      duration: '15',
      aspect_ratio: '9:16',
      generate_audio: true,
      bitrate_mode: 'standard',
    }),
  });
  const body = await res.json().catch(() => ({}));
  const requestId = body.request_id || '';
  if (!res.ok || !requestId) {
    console.log('submit failed', res.status);
    process.exit(1);
  }
  console.log('queued');
  const statusUrl = body.status_url;
  const responseUrl = body.response_url;
  const started = Date.now();
  while (Date.now() - started < 8 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const st = await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } });
    const sj = await st.json().catch(() => ({}));
    const flag = String(sj.status || '').toUpperCase();
    console.log(flag || 'waiting');
    if (flag === 'COMPLETED' || flag === 'COMPLETE') {
      const done = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
      const dj = await done.json().catch(() => ({}));
      const url = dj.video && dj.video.url;
      if (!url) {
        console.log('no file');
        process.exit(1);
      }
      const vid = await fetch(url);
      const buf = Buffer.from(await vid.arrayBuffer());
      const outDir = path.join(__dirname, '..', 'public', 'story-demo');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'demo.mp4'), buf);
      console.log('saved', buf.length);
      process.exit(0);
    }
    if (flag === 'FAILED' || flag === 'CANCELLED' || flag === 'CANCELED') {
      console.log('failed');
      process.exit(1);
    }
  }
  console.log('timeout');
  process.exit(1);
})().catch((err) => {
  console.log(err && err.message ? err.message : 'error');
  process.exit(1);
});
