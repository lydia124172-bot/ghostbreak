const clipVideo = require('./clip-video');
const clipExport = require('./clip-export');

const DEMO_SCRIPT = [
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

async function stillFromText(visual) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('短劇畫面尚未開通。');
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const prompt = [
    '直式 9:16 寫實短劇劇照，電影光，像一格分鏡。',
    '不要任何文字、字幕、標題、浮水印。',
    `畫面：${visual}`,
  ].join('\n');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '9:16', imageSize: '1K' },
        },
      }),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `短劇畫面失敗 ${res.status}`);
  const parts = json.candidates?.[0]?.content?.parts || [];
  const b64 = parts.map((part) => part.inlineData?.data || part.inline_data?.data).find(Boolean);
  if (!b64) throw new Error('沒有產出第鏡畫面，請再試一次。');
  return `data:image/jpeg;base64,${b64}`;
}

function scenePrompt(scene) {
  return [
    'Vertical 9:16 cinematic short-drama shot, 5 seconds, photoreal.',
    'Animate this still. Keep the same person, clothes, place, and lighting.',
    'Subtle natural motion only. No captions, subtitles, prices, or watermarks.',
    `Scene: ${scene.visual}`,
    scene.line ? `Spoken line, do not render as on-screen text: ${scene.line}` : '',
  ].filter(Boolean).join('\n');
}

async function waitScene(job) {
  const started = Date.now();
  while (Date.now() - started < 4 * 60 * 1000) {
    const peek = await clipVideo.check(job);
    if (peek.status === 'failed') throw new Error(peek.error || '這一鏡失敗');
    if (peek.status === 'done' && peek.videoUrl) return peek.videoUrl;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error('這一鏡逾時。請不要重按。');
}

async function produce({ script, images, onPhase }) {
  if (!configured()) throw new Error('AI 短劇尚未開通。');
  const scenes = parseScenes(script);
  const refs = Array.isArray(images) ? images.filter(Boolean) : [];
  const clips = [];
  for (let i = 0; i < scenes.length; i += 1) {
    if (onPhase) onPhase(`第 ${i + 1} 鏡`);
    const still = refs[i] || await stillFromText(scenes[i].visual);
    const submitted = await clipVideo.submit({
      images: [still],
      product: scenes[i].visual,
      hook: scenes[i].line,
      style: 'ugc',
      duration: sceneDuration(),
      prompt: scenePrompt(scenes[i]),
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
};
