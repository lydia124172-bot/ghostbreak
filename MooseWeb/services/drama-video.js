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

function tidy(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function parseScenes(script) {
  const body = String(script || '').trim();
  if (body.length < 20) throw new Error('請先有三鏡劇本，或按「AI 寫劇本」。');
  const blocks = body.split(/SCENE\s*[123]/i).slice(1);
  const scenes = blocks.slice(0, 3).map((block, i) => {
    const shot = tidy((block.match(/鏡位\s*[:：]\s*(.+)/i) || [])[1]);
    const picture = tidy((block.match(/畫面\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:對話|LINE|視覺|SCENE)|$)/i) || [])[1]);
    const visualSame = tidy((block.match(/VISUAL[^:\n：]{0,8}[:：]\s*(.+)/i) || [])[1]);
    const visual = [shot, picture || visualSame].filter(Boolean).join(' ').slice(0, 400);
    const quoted = (block.match(/[「"]([^」"]{2,120})[」"]/) || [])[1];
    const lineSame = tidy((block.match(/LINE[^:\n：]{0,8}[:：]\s*(.+)/i) || [])[1]);
    const line = tidy(quoted || lineSame).slice(0, 120);
    if (visual.length < 4) throw new Error(`第 ${i + 1} 鏡缺少畫面。請保留畫面或 VISUAL。`);
    return { visual, line };
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

async function geminiImage(parts, imageSize) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('短劇畫面尚未開通。');
  const model = 'gemini-3-pro-image';
  const size = imageSize === '1K' ? '1K' : '2K';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '9:16', imageSize: size },
        },
      }),
      signal: AbortSignal.timeout(120000),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json.error?.message || `短劇畫面失敗 ${res.status}`;
    if (size === '2K' && /invalid|imageSize|2K/i.test(message)) return geminiImage(parts, '1K');
    throw new Error(message);
  }
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

function castList(cast) {
  const list = Array.isArray(cast) ? cast : (cast ? [cast] : []);
  return list.map((item) => {
    if (typeof item === 'string') return { role: 'lead', image: item };
    return { role: String(item && item.role || 'other'), image: String(item && item.image || '') };
  }).filter((item) => item.image).slice(0, 4);
}

async function stillFromText(visual, look, castImages, castPrompt) {
  const heroes = castList(castImages);
  const labels = heroes.map((item, index) => {
    const name = item.role === 'female' ? '女主' : item.role === 'male' ? '男主' : '其他人';
    return `第${index + 1}張是${name}`;
  }).join('，');
  const prompt = [
    '直式 9:16 寫實短劇劇照，電影光，像一格分鏡。',
    heroes.length ? `附圖${labels}。臉型、五官、髮型、衣服跟對應的附圖一樣，不要換成別人。` : '',
    heroes.some((item) => item.role === 'other') ? '這一鏡的畫面若寫到其他人，用對應的附圖。這一鏡沒寫到的人不要硬加進來。' : '',
    castPrompt ? `這是誰：${castPrompt}。只鎖定這個人的年齡、臉、髮型、衣服。不要把這段裡的一種表情用在每一鏡。` : '',
    '這一鏡的表情、情緒、身體狀態必須照下面的畫面。可以笑、哭、怒、累、受傷、狼狽。三鏡不要同一張臉。',
    '不要任何文字、字幕、標題、浮水印。',
    look ? `角色與地點只用來認人和認場景，表情以這一鏡為準：${look}` : '',
    `這一鏡的畫面：${visual}`,
  ].filter(Boolean).join('\n');
  const parts = [{ text: prompt }];
  heroes.forEach((item) => {
    const file = clipVideo.parseDataUrl(item.image);
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
  if (who === 'female') {
    const hit = pool.find((part) => /女/.test(part));
    return [hit || pool[pool.length - 1] || pool[0]].filter(Boolean);
  }
  const hit = pool.find((part) => /男/.test(part) && !/女/.test(part));
  const notWoman = pool.find((part) => !/女|她/.test(part));
  return [hit || notWoman || pool[0]].filter(Boolean);
}

function guessGender(text) {
  const line = String(text || '');
  if (/女性|女生|女人|女主/.test(line) && !/男性|男生|男人|男主/.test(line)) return 'female';
  if (/男性|男生|男人|男主/.test(line) && !/女性|女生|女人|女主/.test(line)) return 'male';
  if (/女/.test(line) && !/男/.test(line)) return 'female';
  if (/男/.test(line) && !/女/.test(line)) return 'male';
  const female = /及肩|長髮|長直|披肩|微捲|波浪|絲質睡衣|睡衣|洋裝|裙/.test(line);
  const male = /寸頭|平頭|短寸|鬍|西裝/.test(line);
  if (female && !male) return 'female';
  if (male && !female) return 'male';
  return '';
}

function genderFor(person, who) {
  const guessed = guessGender(person);
  if (who === 'female') return 'female';
  if (who === 'male') return 'male';
  return guessed || 'open';
}

function forceGender(text, gender) {
  let line = String(text || '').trim();
  if (gender === 'open') return line;
  if (gender === 'male') {
    line = line
      .replace(/女性/g, '男性')
      .replace(/女生/g, '男生')
      .replace(/女人/g, '男人')
      .replace(/女孩/g, '男孩')
      .replace(/她/g, '他');
    if (!/男/.test(line)) line = `成年男性。${line}`;
  } else if (gender === 'female') {
    line = line
      .replace(/男性/g, '女性')
      .replace(/男生/g, '女生')
      .replace(/男人/g, '女人')
      .replace(/男孩/g, '女孩');
    if (!/女/.test(line)) line = `成年女性。${line}`;
  }
  return line;
}

function appealLock(appeal, gender) {
  if (appeal === 'rough') {
    return '臉要不好看、不討喜。可以疲憊、粗糙、黑眼圈、膚色不均。不要畫成俊男美女。五官仍要清楚。';
  }
  const lead = gender === 'female' ? '女主角' : gender === 'open' ? '這一位' : '男主角';
  return `臉要好看，像電影${lead}。五官端正、膚色乾淨均匀、眼神有神。禁止疲憊、黑眼圈、傷痕、蠟黃、油膩、邋遢。光線要討好這張臉。仍是寫實照片，不要塑膠網紅臉。`;
}

function genderLock(gender) {
  if (gender === 'open') return '性別照原文。原文沒寫男或女，就不要改成另一性。';
  if (gender === 'female') {
    return '這一位是成年女性。必須畫成女人，女性的臉和身形。禁止畫成男人。adult woman, female face, not a man.';
  }
  return '這一位是成年男性。必須畫成男人，男性的臉、喉結和身形。畫面裡只能有這個男人。禁止畫成女人，禁止長髮女生，禁止女性化。adult man, male face, not a woman.';
}

async function optimizeCastText(source, place, gender, appeal) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const raw = String(source || '').trim();
  if (!key || raw.length < 2) return raw;
  const ask = [
    '你在幫寫實人像生圖寫提示詞。把這一位的短句擴成可直接生圖的一段繁體中文。',
    '第一句只寫「女性。」或「男性。」，依這個人的名字和描述判斷，不要判反，也不要換成另一個人。',
    '年齡、髮長、髮型、衣服顏色和款式必須跟原文一樣。短寸頭就寫短寸頭，及肩微捲就寫及肩微捲，絲質睡衣不要改成襯衫。',
    genderLock(gender),
    appealLock(appeal, gender),
    appeal === 'rough'
      ? '客人寫到的疲憊、粗糙可以留下。'
      : '這次要好看。即使原文寫疲憊、憔悴、傷痕，也不要寫進提示詞。',
    '只寫這一位。禁止再寫另一個人。',
    '客人寫到的年齡、髮型、衣服必須原樣保留，不要換成大衣、西裝、別的髮型。',
    '沒寫的才補五官。要像定妝照：臉清楚、電影光。',
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

async function makeCast({ topic, notes, script, prompt: wanted, who, appeal }) {
  const pickedWho = who === 'female' || who === 'both' || who === 'other' ? who : 'male';
  const pickedAppeal = appeal === 'rough' ? 'rough' : 'pretty';
  const typed = String(wanted || '').trim();
  const roleText = castSource({ prompt: '', script });
  const source = typed || roleText;
  const title = String(topic || '').trim();
  const extra = String(notes || '').trim();
  if (!source && title.length < 2) throw new Error('請先寫主角提示詞，或先填主題。');
  const chosen = pickedWho === 'other'
    ? [String(typed || source || `${title}。${extra}`).trim()].filter((line) => line.length >= 2)
    : pickPeople(source || `${title}。${extra}`, pickedWho);
  if (!chosen.length) throw new Error('沒有這一位。請先寫主角，或先讓劇本裡有角色。');
  const place = placeOf(script);
  const optimized = [];
  const images = [];
  const roles = [];
  for (let index = 0; index < chosen.length; index += 1) {
    let gender = genderFor(chosen[index], pickedWho);
    let line = await optimizeCastText(chosen[index], place, gender, pickedAppeal);
    const seen = guessGender(line) || guessGender(chosen[index]);
    if ((pickedWho === 'both' || pickedWho === 'other') && seen) gender = seen;
    line = forceGender(line, gender);
    optimized.push(line);
    roles.push(gender === 'female' ? 'female' : gender === 'male' ? 'male' : 'other');
    images.push(await geminiImage([{
      text: [
        genderLock(gender),
        appealLock(pickedAppeal, gender),
        '直式 9:16 寫實電影定妝照，2K。只畫這一位，半身，臉清楚。',
        '85mm 鏡頭。不要其他路人，不要文字、字幕、浮水印。',
        '髮長、髮型和衣服必須完全照原文。短寸頭就畫短寸頭，及肩微捲就畫及肩微捲，長直髮才披在肩上。不要改成另一種髮型，也不要換成別的衣服。',
        pickedAppeal === 'rough' ? '臉的氣質可以照原文的疲憊或粗糙。' : '臉要好看。原文若寫疲憊、傷痕、難看，這次不要畫。',
        `原文：${chosen[index]}`,
        `可補的細節：${line}`,
        place ? `場景必須是：${place}。不要改成攝影棚、辦公室或其他地方。` : '',
        genderLock(gender),
      ].filter(Boolean).join('\n'),
    }]));
  }
  return { images, prompt: optimized.join('\n\n'), roles };
}

function scenePrompt(scene, look, castPrompt) {
  return [
    'Vertical 9:16 cinematic short-drama shot, 5 seconds, photoreal.',
    'Animate this still. Keep the same face, hair, and clothes.',
    'Let the expression, emotion, and body state follow this scene. Do not hold one frozen look.',
    'Speak the Chinese line on camera in Mandarin. No captions, subtitles, prices, logos, or watermarks.',
    castPrompt ? `Same person: ${castPrompt}` : '',
    look ? `Same cast and place: ${look}` : '',
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

async function produce({ script, images, cast, castPrompt, onPhase }) {
  if (!configured()) throw new Error('AI 短劇尚未開通。');
  const scenes = parseScenes(script);
  const look = lookOf(script);
  const heroes = castList(cast);
  const leadPrompt = String(castPrompt || '').trim().slice(0, 800);
  const refs = Array.isArray(images) ? images : [];
  const clips = [];
  for (let i = 0; i < scenes.length; i += 1) {
    if (onPhase) onPhase(`第 ${i + 1} 鏡`);
    const still = refs[i] || await stillFromText(scenes[i].visual, look, heroes, leadPrompt);
    const submitted = await clipVideo.submit({
      images: [still],
      product: scenes[i].visual,
      hook: scenes[i].line,
      style: 'ugc',
      duration: sceneDuration(),
      prompt: scenePrompt(scenes[i], look, leadPrompt),
      generateAudio: true,
    });
    const url = await waitScene(submitted);
    const file = await clipVideo.finish(url, { duration: sceneDuration() });
    clips.push(file.buffer);
  }
  if (onPhase) onPhase('接片中');
  const joined = await clipExport.concatVideos(clips);
  const playable = await clipExport.remuxPlayable(joined.buffer);
  return {
    buffer: playable.buffer,
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
