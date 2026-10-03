const dressAgent = require('./dress-agent');

const RATIOS = ['3:4', '4:5', '9:16', '1:1', '16:9'];
const SIZES = ['1K', '2K'];

function configured() {
  return dressAgent.configured();
}

function cleanNote(note) {
  return String(note || '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function editPrompt(note) {
  return [
    'Image 1 is the photo to edit. Image 2 is the correct reference for the part named below.',
    `Replace only this part of image 1: ${note}`,
    'Copy that part from image 2, including its color, shape, and how it is fastened.',
    'Keep the same face, hair, pose, and everything that was not named.',
    'Do not add a buckle, bow, pocket, zipper, logo, or other piece that is not in image 2.',
    'Output one photoreal image.',
  ].join(' ');
}

async function edit({ image, reference, note, aspectRatio, imageSize }) {
  if (dressAgent.looksLikeJailbreak(note)) throw new Error('無法提供');
  const instruction = cleanNote(note);
  if (instruction.length < 2) throw new Error('請寫要改的是哪裡。');
  if (!image) throw new Error('請先上傳要改的圖。');
  if (!reference) throw new Error('請上傳要換成的正確圖。');
  const photo = dressAgent.parseDataUrl(image);
  const target = dressAgent.parseDataUrl(reference);
  const ratio = RATIOS.includes(aspectRatio) ? aspectRatio : '1:1';
  const size = SIZES.includes(imageSize) ? imageSize : '1K';
  try {
    return await dressAgent.generateImage([
      { text: editPrompt(instruction) },
      { inline_data: { mime_type: photo.mime, data: photo.b64 } },
      { inline_data: { mime_type: target.mime, data: target.b64 } },
    ], { aspectRatio: ratio, imageSize: size });
  } catch (err) {
    const message = String(err && err.message || '改圖失敗，請換一張清楚的圖再試。');
    throw new Error(message.replace(/換裝/g, '改圖').replace('請換一張清楚的全身或半身照再試。', '請換一張清楚的圖，或把要改的地方寫得再具體一點。'));
  }
}

module.exports = { configured, edit, RATIOS, SIZES };
