const dressAgent = require('./dress-agent');

const WORKFLOWS = [
  { id: 'free', name: '自由對話', hint: '照你寫的做', ratio: '1:1', prompt: 'Follow the guest request as one finished commercial graphic.' },
  { id: 'ad', name: '電商廣告', hint: '賣點與價格', ratio: '4:5', prompt: 'A vertical e-commerce ad. Product is the hero. Include one benefit, the price only if the guest wrote one, and one call-to-action. Leave breathing room.' },
  { id: 'banner', name: '網站橫幅', hint: '寬幅主視覺', ratio: '16:9', prompt: 'A wide website hero banner. Headline on one side, product or scene on the other, readable at a glance on a desktop.' },
  { id: 'social', name: '社群貼文', hint: 'IG 與臉書', ratio: '1:1', prompt: 'A square social post for Instagram and Facebook. Strong first glance, short headline, subject clearly visible.' },
  { id: 'poster', name: '活動海報', hint: '時間地點標題', ratio: '3:4', prompt: 'An event poster. Hierarchy is title, date, place, then one visual. Type must stay legible.' },
  { id: 'product', name: '商品主圖', hint: '乾淨棚拍', ratio: '1:1', prompt: 'A clean marketplace main image. Product centered, soft studio light, uncluttered background. No extra slogans unless the guest asked for text.' },
  { id: 'text', name: '精準改字', hint: '只換圖裡的字', ratio: '', prompt: '' },
  { id: 'inpaint', name: '局部重繪', hint: '塗掉的地方才改', ratio: '', prompt: '' },
  { id: 'mockup', name: '場景套用', hint: '衣服、手機、包裝', ratio: '4:5', prompt: '' },
];

const STYLES = [
  { id: 'keep', name: '維持原樣', prompt: '' },
  { id: 'photo', name: '商業攝影', prompt: 'commercial photography, realistic, soft studio light, sharp product detail' },
  { id: '3d', name: '3D 插畫', prompt: 'polished 3D illustration, soft clay and glossy materials, clean studio lighting' },
  { id: 'flat', name: '扁平設計', prompt: 'flat vector graphic design, bold shapes, limited palette, poster layout' },
  { id: 'ink', name: '水墨留白', prompt: 'East Asian ink wash with generous negative space and a refined contemporary layout' },
  { id: 'pop', name: '波普亮色', prompt: 'pop art commercial graphic, saturated colors, bold shapes' },
  { id: 'minimal', name: '極簡', prompt: 'minimal luxury layout, lots of white space, one focal object' },
  { id: 'neon', name: '夜市霓虹', prompt: 'night market neon, warm Asian street atmosphere, glossy signage, cinematic' },
  { id: 'magazine', name: '雜誌封面', prompt: 'editorial magazine cover, strong headline hierarchy, fashion photography' },
];

const MOCKUPS = [
  { id: 'shirt', name: 'T-shirt', prompt: 'a photoreal t-shirt, the artwork printed cleanly on the fabric, natural folds' },
  { id: 'phone', name: '手機畫面', prompt: 'a photoreal smartphone in a hand, the artwork filling the screen' },
  { id: 'wall', name: '街頭海報', prompt: 'the artwork as a street poster on a clean wall in daylight' },
  { id: 'pack', name: '包裝', prompt: 'the artwork applied to a product box or pouch, studio lighting' },
  { id: 'web', name: '網站首屏', prompt: 'a desktop browser on a desk, the artwork as the website hero' },
];

const RATIOS = ['1:1', '4:5', '3:4', '9:16', '16:9', '4:3', '3:2'];
const SIZES = ['1K', '2K'];

function configured() {
  return dressAgent.configured();
}

function findRow(list, id) {
  return list.find((row) => row.id === id) || null;
}

function clean(text, max) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseImage(url) {
  const m = String(url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) throw new Error('圖片格式不支援，請用 JPG、PNG 或 WEBP。');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 6 * 1024 * 1024) throw new Error('單張圖請小於 6MB。');
  return { mime: m[1], b64: m[2] };
}

function soften(err) {
  const message = String(err && err.message || '設計失敗，請把需求寫得再具體一點。');
  return message
    .replace(/換裝/g, '設計')
    .replace('請換一張清楚的全身或半身照再試。', '請換一張清楚的圖，或把要改的地方寫得再具體一點。');
}

function parseLines(text) {
  const stripped = String(text || '').trim().replace(/^```json\s*|\s*```$/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  const raw = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
  const data = JSON.parse(raw);
  const rows = Array.isArray(data.lines) ? data.lines : [];
  return rows.map((row) => {
    const label = clean(row && row.text, 80);
    if (!label) return null;
    const num = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    };
    const x = num(row.x);
    const y = num(row.y);
    const w = num(row.w);
    const h = num(row.h);
    const hasBox = [x, y, w, h].every((n) => n !== null)
      && w >= 2 && h >= 2 && w <= 85 && h <= 60
      && x <= 90 && y <= 90
      && x + w <= 105 && y + h <= 105;
    return hasBox ? { text: label, x, y, w, h } : { text: label };
  }).filter(Boolean).slice(0, 12);
}

async function readText(image) {
  if (!configured()) throw new Error('讀字暫時無法使用，請稍後再試。');
  const photo = parseImage(image);
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const prompt = [
    'Read every distinct piece of visible text in this image. Traditional Chinese must be copied exactly.',
    'Return only JSON: {"lines":[{"text":"","x":0,"y":0,"w":0,"h":0}]}',
    'x is the percent from the left edge, y from the top edge, w the width percent, h the height percent. A short headline near the upper left looks like {"text":"限時優惠","x":7,"y":18,"w":32,"h":12}. Do not set every number to 100.',
    'Do not translate, do not invent text, and do not add words that are not visible.',
    'If there is no text, return {"lines":[]}.',
  ].join(' ');
  const parts = [
    { text: prompt },
    { inline_data: { mime_type: photo.mime, data: photo.b64 } },
  ];
  const models = ['gemini-flash-lite-latest', 'gemini-3.6-flash'];
  let lastErr;
  for (const model of models) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1200, responseMimeType: 'application/json' },
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || `讀字服務 ${res.status}`);
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
      return { lines: parseLines(text) };
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError') break;
    } finally {
      clearTimeout(timer);
    }
  }
  const message = String(lastErr && lastErr.message || '');
  if (/quota|429|RESOURCE_EXHAUSTED/i.test(message)) throw new Error('讀字暫時無法使用，請稍後再試。圖已經顯示，請自己填原本的字。');
  throw new Error('沒讀出圖上的字。圖已經顯示，請自己填原本的字。');
}

function publicCatalog() {
  return {
    workflows: WORKFLOWS.map(({ id, name, hint, ratio }) => ({ id, name, hint, ratio })),
    styles: STYLES.map(({ id, name }) => ({ id, name })),
    mockups: MOCKUPS.map(({ id, name }) => ({ id, name })),
    ratios: RATIOS.slice(),
    sizes: SIZES.slice(),
  };
}

const KEEP_BODY = 'Keep the same camera framing as image 1. Do not zoom in and do not crop. Every person must remain fully connected and as complete as they are in image 1. Never cut through a head, neck, chest, waist, arm, or hand, and never output a severed half body.';

function styleLine(style) {
  return style && style.prompt
    ? `Visual style: ${style.prompt}.`
    : 'Keep the existing visual style unless the guest asked to change it.';
}

function buildJob(input) {
  const workflow = findRow(WORKFLOWS, input.workflow) || WORKFLOWS[0];
  const style = findRow(STYLES, input.style) || STYLES[0];
  const mockup = findRow(MOCKUPS, input.mockup);
  const note = clean(input.note, 800);
  const from = clean(input.from, 200);
  const to = clean(input.to, 200);
  const photo = input.image ? parseImage(input.image) : null;
  const marked = input.marked ? parseImage(input.marked) : null;
  if (dressAgent.looksLikeJailbreak([note, from, to].join(' '))) throw new Error('無法提供');

  if (workflow.id === 'text') {
    if (!photo) throw new Error('請先上傳要改字的圖，或先做出一張再改。');
    if (!to) throw new Error('請寫上要換成的正確文字。');
    return {
      reply: '已依你寫的字重畫這一張。其他畫面盡量留著。字若仍有缺筆，把正確句子再貼一次。',
      text: [
        'Edit image 1. Change only the written words.',
        from ? `Find this text: "${from}".` : 'Find the main headline or the text the guest is correcting.',
        `Replace it with this exact text, every character complete: "${to}".`,
        'The text is Traditional Chinese. Do not omit strokes, do not invent characters, do not translate it, and do not add extra words.',
        'Keep the same people, products, layout, colors, and lighting.',
        KEEP_BODY,
        note ? `Extra instruction: ${note}` : '',
        'Output one image.',
      ].filter(Boolean).join(' '),
      images: [photo],
    };
  }

  if (workflow.id === 'inpaint') {
    if (!photo || !marked) throw new Error('請在圖上塗出要改的地方。');
    const logo = input.reference ? parseImage(input.reference) : null;
    const instruction = note || (logo ? 'Place the attached artwork into the marked region.' : '');
    if (instruction.length < 2) throw new Error('請寫塗掉的地方要改成什麼，或上傳要放上的圖。');
    return {
      reply: logo ? '已把你附的圖放進塗掉的那一塊。沒塗到的地方留著。' : '已只改你塗掉的那一塊。沒塗到的地方盡量留著。',
      text: [
        'Image 1 is the design to edit. Image 2 is the same picture with bright magenta paint marking the only region that may change.',
        logo ? 'Image 3 is the logo or artwork to place into that marked region only. Do not replace the whole picture with image 3.' : '',
        `Change only the marked region: ${instruction}`,
        'Erase every trace of the magenta paint. Everything outside the marked region stays identical, including faces, products, and any Traditional Chinese text.',
        KEEP_BODY,
        style.prompt ? styleLine(style) : '',
        'Output one image.',
      ].filter(Boolean).join(' '),
      images: logo ? [photo, marked, logo] : [photo, marked],
    };
  }

  if (workflow.id === 'mockup') {
    if (!photo) throw new Error('請先上傳設計圖，或先做出一張再套用。');
    if (!mockup) throw new Error('請選擇要套上的場景。');
    return {
      reply: `已把這張設計套到${mockup.name}。`,
      text: [
        'Image 1 is a finished design.',
        `Place it into this real-world scene: ${mockup.prompt}.`,
        'Keep the artwork recognizable. Do not rewrite its text.',
        note ? `Guest note: ${note}` : '',
        'Photoreal. Output one image.',
      ].filter(Boolean).join(' '),
      images: [photo],
    };
  }

  if (note.length < 2) throw new Error('請寫這張圖要呈現什麼。');

  if (photo) {
    return {
      reply: `已照「${workflow.name}」改這一張。下一句會接著改這張，不必重新上傳。`,
      text: [
        'Image 1 is the current design. Revise it. Keep anything the guest did not ask to change.',
        'Do not turn a person into a cropped half body. If the guest did not ask to zoom or change the crop, keep image 1 framing and show the same amount of each person.',
        `Workflow: ${workflow.prompt}`,
        styleLine(style),
        `Guest request: ${note}`,
        'Any new or remaining Traditional Chinese must be complete and correct. Do not add slogans the guest did not write.',
        'Output one image.',
      ].join(' '),
      images: [photo],
    };
  }

  return {
    reply: `已照「${workflow.name}」做出這一張。下一句會接著改這張，不必重新上傳。`,
    text: [
      'Create one original commercial graphic for audiences in Taiwan and Hong Kong.',
      `Workflow: ${workflow.prompt}`,
      styleLine(style),
      `Guest request: ${note}`,
      'If a person appears, show a natural connected body. Do not crop through the chest or waist.',
      'If the guest included words to print, render that Traditional Chinese exactly, every character complete. Do not invent extra slogans, watermarks, or logos.',
      'Output one image.',
    ].join(' '),
    images: [],
  };
}

async function design(input) {
  const workflow = findRow(WORKFLOWS, input.workflow) || WORKFLOWS[0];
  const ratio = RATIOS.includes(input.aspectRatio)
    ? input.aspectRatio
    : (workflow.ratio || '1:1');
  const size = SIZES.includes(input.imageSize) ? input.imageSize : '1K';
  const job = buildJob(input);
  const parts = [
    { text: job.text },
    ...job.images.map((row) => ({ inline_data: { mime_type: row.mime, data: row.b64 } })),
  ];
  try {
    const result = await dressAgent.generateImage(parts, { aspectRatio: ratio, imageSize: size });
    return { ...result, reply: job.reply };
  } catch (err) {
    throw new Error(soften(err));
  }
}

module.exports = { configured, design, readText, publicCatalog, RATIOS, SIZES };
