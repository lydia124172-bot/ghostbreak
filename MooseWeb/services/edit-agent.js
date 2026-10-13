const dressAgent = require('./dress-agent');

const RATIOS = ['3:4', '4:5', '9:16', '1:1', '16:9'];
const SIZES = ['1K', '2K'];

function configured() {
  return dressAgent.configured();
}

function cleanNote(note) {
  return String(note || '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function editPrompt(note, hasReference) {
  const keep = 'Keep the same person, face, hair, hands, pose, background, framing, and lighting. Change only the named part. Do not invent a slit, vent, buckle, zipper, logo, extra pocket, or extra limb.';
  if (hasReference) {
    return [
      'Image 1 is the photo to edit. Image 2 is the real product reference.',
      `Change only this part of image 1: ${note}`,
      'Make that part match image 2, including its construction, color, and how it is fastened.',
      'If image 2 shows a closed hem, keep that hem closed. Do not add an opening that image 2 does not have.',
      keep,
      'Output one photoreal image.',
    ].join(' ');
  }
  return [
    'Edit this one photo.',
    `Change only this part: ${note}`,
    'Rebuild that part from the surrounding cloth, color, and light already in this photo.',
    keep,
    'Output one photoreal image.',
  ].join(' ');
}

async function edit({ image, reference, note, aspectRatio, imageSize }) {
  if (dressAgent.looksLikeJailbreak(note)) throw new Error('無法提供');
  const instruction = cleanNote(note);
  if (instruction.length < 2) throw new Error('請寫要改的是哪裡。');
  if (!image) throw new Error('請先上傳要改的圖。');
  const photo = dressAgent.parseDataUrl(image);
  const target = reference ? dressAgent.parseDataUrl(reference) : null;
  const ratio = RATIOS.includes(aspectRatio) ? aspectRatio : '3:4';
  const size = SIZES.includes(imageSize) ? imageSize : '1K';
  const parts = [
    { text: editPrompt(instruction, Boolean(target)) },
    { inline_data: { mime_type: photo.mime, data: photo.b64 } },
  ];
  if (target) parts.push({ inline_data: { mime_type: target.mime, data: target.b64 } });
  try {
    return await dressAgent.generateImage(parts, { aspectRatio: ratio, imageSize: size });
  } catch (err) {
    const message = String(err && err.message || '改圖失敗，請換一張清楚的圖再試。');
    throw new Error(message.replace(/換裝/g, '改圖').replace('請換一張清楚的全身或半身照再試。', '請換一張清楚的圖，或把要改的地方寫得再具體一點。'));
  }
}

module.exports = { configured, edit, RATIOS, SIZES };
