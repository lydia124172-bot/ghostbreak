const clipVideo = require('./clip-video');
const clipExport = require('./clip-export');

const DEMO_SCRIPT = [
  '角色：女，約二十八歲，黑長直髮，米色大衣，聲線平。男不入鏡，只在電話裡，聲線低。',
  '背景：雨夜巷口，便利商店的白燈，地面有積水，霓虹反在水上。三鏡都在這裡。',
  'SCENE 1',
  'VISUAL: 雨夜巷口，女人撐黑傘，霓虹反在積水上。',
  'LINE: 他說會回來。',
  'SCENE 2',
  'VISUAL: 便利商店燈下，她看著三年前的對話。',
  'LINE: 三年了。',
  'SCENE 3',
  'VISUAL: 她刪掉簡訊，收傘往巷外走。',
  'LINE: 這次換我先走。',
].join('\n');

function configured() {
  return clipVideo.configured() && Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

function creditCost() {
  return Number(process.env.FAL_DRAMA_CREDITS || 1) || 1;
}

function sceneDuration() {
  return '5';
}

function sceneCount() {
  return 3;
}

function parseScenes(script) {
  const body = String(script || '').trim();
  if (body.length < 20) throw new Error('請先有三鏡劇本，或按「AI 寫劇本」。');
  const blocks = body.split(/SCENE\s*[123]/i).slice(1);
  const scenes = blocks.slice(0, 3).map((block, i) => {
    const visual = (block.match(/VISUAL:\s*(.+)/i) || [])[1] || '';
    const line = (block.match(/LINE:\s*(.+)/i) || [])[1] || '';
    const visualText = String(visual).trim();
    const lineText = String(line).trim();
    if (visualText.length < 4) throw new Error(`第 ${i + 1} 鏡缺少畫面。請保留 VISUAL 與 LINE。`);
    return { visual: visualText.slice(0, 180), line: lineText.slice(0, 80) };
  });
  if (scenes.length < 3) throw new Error('劇本需要三鏡。請用 AI 寫，或依示範格式自己寫。');
  return scenes;
}

function lookOf(script) {
  const head = String(script || '').split(/SCENE\s*1/i)[0] || '';
  return head.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function imageDataUrl(part) {
  const raw = part && (part.inlineData || part.inline_data);
  if (!raw || !raw.data) return '';
  const mime = String(raw.mimeType || raw.mime_type || 'image/jpeg');
  const kind = /png/i.test(mime) ? 'png' : /webp/i.test(mime) ? 'webp' : 'jpeg';
  return `data:image/${kind};base64,${raw.data}`;
}

async function geminiImage(parts) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('短劇畫面尚未開通。');
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '9:16', imageSize: '1K' },
        },
      }),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `短劇畫面失敗 ${res.status}`);
  const image = (json.candidates?.[0]?.content?.parts || []).map(imageDataUrl).find(Boolean);
  if (!image) throw new Error('沒有產出畫面，請再試一次。');
  return image;
}

async function stillFromText(visual, look, castImage) {
  const prompt = [
    '直式 9:16 寫實短劇劇照，電影光，像一格分鏡。',
    castImage ? '附圖是主角。人數、臉、髮型、衣服都跟附圖一樣，不要換成別人。只改這一鏡的動作和站位。' : '',
    '不要任何文字、字幕、標題、浮水印。',
    look ? `角色與背景，三鏡都要一致：${look}` : '',
    `畫面：${visual}`,
  ].filter(Boolean).join('\n');
  const parts = [{ text: prompt }];
  if (castImage) {
    const file = clipVideo.parseDataUrl(castImage);
    parts.push({ inline_data: { mime_type: file.mime, data: file.b64 } });
  }
  return geminiImage(parts);
}

async function makeCast({ topic, notes, script, prompt: wanted }) {
  const line = String(wanted || '').trim().slice(0, 400);
  const look = lookOf(script);
  const title = String(topic || '').trim();
  const extra = String(notes || '').trim();
  if (!line && !look && title.length < 2) throw new Error('請先寫主角提示詞，或先填主題。');
  const prompt = [
    '直式 9:16 寫實定妝照。臉清楚，電影光。',
    line ? '人數、長相、衣服都照提示詞，不要改成別人。' : '沒有提示詞時，只生成一位主角。',
    '不要路人，不要文字、字幕、浮水印。',
    line ? `提示詞：${line}` : (look || `依主題設計這一位主角：${title}。`),
    !line && extra ? `補充：${extra}` : '',
  ].filter(Boolean).join('\n');
  const image = await geminiImage([{ text: prompt }]);
  return { image };
}

function scenePrompt(scene, look) {
  return [
    'Vertical 9:16 cinematic short-drama shot, 5 seconds, photoreal.',
    'Animate this still. Keep the same people, clothes, place, and lighting.',
    'Speak the Chinese line on camera in Mandarin. No captions, subtitles, prices, logos, or watermarks.',
    look ? `Keep this cast and place: ${look}` : '',
    `Scene: ${scene.visual}`,
    scene.line ? `Spoken line: 「${scene.line}」` : '',
  ].filter(Boolean).join('\n');
}

async function waitScene(job) {
  const started = Date.now();
  while (Date.now() - started < 6 * 60 * 1000) {
    const peek = await clipVideo.check(job);
    if (peek.status === 'failed') throw new Error(peek.error || '這一鏡失敗');
    if (peek.status === 'done' && peek.videoUrl) return peek.videoUrl;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error('這一鏡逾時。請不要重按。');
}

async function produce({ script, images, cast, onPhase }) {
  if (!configured()) throw new Error('AI 短劇尚未開通。');
  const scenes = parseScenes(script);
  const look = lookOf(script);
  const hero = String(cast || '').trim();
  const refs = Array.isArray(images) ? images : [];
  const clips = [];
  for (let i = 0; i < scenes.length; i += 1) {
    if (onPhase) onPhase(`第 ${i + 1} 鏡`);
    const still = refs[i] || await stillFromText(scenes[i].visual, look, hero);
    const submitted = await clipVideo.submit({
      images: [still],
      product: scenes[i].visual,
      hook: scenes[i].line,
      style: 'ugc',
      duration: sceneDuration(),
      prompt: scenePrompt(scenes[i], look),
      generateAudio: true,
    });
    const url = await waitScene(submitted);
    const file = await clipVideo.finish(url, { duration: sceneDuration() });
    clips.push(file.buffer);
  }
  if (onPhase) onPhase('接片中');
  const joined = await clipExport.concatVideos(clips);
  return {
    buffer: joined.buffer,
    mime: 'video/mp4',
    engine: 'drama',
    duration: String(Number(sceneDuration()) * scenes.length),
    scenes: scenes.length,
  };
}

module.exports = {
  DEMO_SCRIPT,
  configured,
  creditCost,
  sceneCount,
  sceneDuration,
  parseScenes,
  produce,
  makeCast,
};
