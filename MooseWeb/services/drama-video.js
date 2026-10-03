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

function peopleOf(text) {
  return String(text || '')
    .replace(/^角色\s*[:：]\s*/, '')
    .split(/[。\n；;]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8 && !/^背景/.test(part))
    .slice(0, 2);
}

function castSource({ prompt, script }) {
  const line = String(prompt || '').trim();
  if (line) return line.slice(0, 400);
  const head = lookOf(script);
  const role = head.match(/角色\s*[:：]\s*([\s\S]*?)(?=背景\s*[:：]|$)/);
  return String(role ? role[1] : '').trim().slice(0, 400);
}

async function stillFromText(visual, look, castImages) {
  const heroes = (Array.isArray(castImages) ? castImages : []).filter(Boolean).slice(0, 2);
  const prompt = [
    '直式 9:16 寫實短劇劇照，電影光，像一格分鏡。',
    heroes.length ? `附圖是主角，一位一張，共 ${heroes.length} 位。臉、髮型、衣服都跟對應的附圖一樣，不要換成別人。只改這一鏡的動作和站位。` : '',
    '不要任何文字、字幕、標題、浮水印。',
    look ? `角色與背景，三鏡都要一致：${look}` : '',
    `畫面：${visual}`,
  ].filter(Boolean).join('\n');
  const parts = [{ text: prompt }];
  heroes.forEach((url) => {
    const file = clipVideo.parseDataUrl(url);
    parts.push({ inline_data: { mime_type: file.mime, data: file.b64 } });
  });
  return geminiImage(parts);
}

function placeOf(script) {
  const head = lookOf(script);
  const found = head.match(/背景\s*[:：]\s*([\s\S]*)/);
  return found ? found[1].replace(/\s+/g, ' ').trim().slice(0, 180) : '';
}

function pickPeople(text, who) {
  const people = peopleOf(text);
  const pool = people.length ? people : (String(text || '').trim() ? [String(text).trim()] : []);
  if (who === 'both') return pool.slice(0, 2);
  if (who === 'female') return pool[1] ? [pool[1]] : [];
  return pool[0] ? [pool[0]] : [];
}

async function optimizeCastText(source, place) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const raw = String(source || '').trim();
  if (!key || raw.length < 2) return raw;
  const ask = [
    '你在幫寫實人像生圖寫提示詞。把這一位的短句擴成可直接生圖的繁體中文。',
    '只寫這一位。禁止再寫另一個人。',
    '客人寫到的年齡、髮型、衣服、聲線必須原樣保留，不要換成大衣、西裝、別的髮型。',
    '沒寫的才補五官和膚質。要像定妝照：臉清楚、電影光，不要過度磨皮，不要奇幻。',
    place ? `場景必須沿用這句，不要改成攝影棚或其他地方：${place}` : '不要自作主張換成攝影棚。',
    '只輸出一段。不要寒暄，不要標題。',
    `這一位：${raw}`,
  ].join('\n');
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: ask }] }],
          generationConfig: { maxOutputTokens: 800 },
        }),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return raw;
    const text = (json.candidates?.[0]?.content?.parts || [])
      .filter((part) => part && part.text && !part.thought)
      .map((part) => part.text)
      .join('\n')
      .trim();
    return text.slice(0, 500) || raw;
  } catch {
    return raw;
  }
}

async function makeCast({ topic, notes, script, prompt: wanted, who }) {
  const pickedWho = who === 'female' || who === 'both' ? who : 'male';
  const typed = String(wanted || '').trim();
  const roleText = castSource({ prompt: '', script });
  const source = typed || roleText;
  const title = String(topic || '').trim();
  const extra = String(notes || '').trim();
  if (!source && title.length < 2) throw new Error('請先寫主角提示詞，或先填主題。');
  const chosen = pickPeople(source || `${title}。${extra}`, pickedWho);
  if (!chosen.length) throw new Error('沒有這一位。男主是角色第一位，女主是第二位。');
  const place = placeOf(script);
  const optimized = [];
  const images = [];
  for (const person of chosen) {
    const line = await optimizeCastText(person, place);
    optimized.push(line);
    images.push(await geminiImage([{
      text: [
        '直式 9:16 寫實定妝照。只畫這一位，半身到大腿，臉清楚，電影光。',
        '不要其他路人，不要文字、字幕、浮水印。',
        '衣服和髮型必須照下面這句，不要換成別的衣服或髮型。',
        place ? `場景必須是：${place}。不要改成攝影棚、辦公室或其他地方。` : '',
        `這一位：${line}`,
      ].filter(Boolean).join('\n'),
    }]));
  }
  return { images, prompt: optimized.join('\n') };
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
  const heroes = (Array.isArray(cast) ? cast : (cast ? [cast] : [])).filter(Boolean).slice(0, 2);
  const refs = Array.isArray(images) ? images : [];
  const clips = [];
  for (let i = 0; i < scenes.length; i += 1) {
    if (onPhase) onPhase(`第 ${i + 1} 鏡`);
    const still = refs[i] || await stillFromText(scenes[i].visual, look, heroes);
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
