const clipImage = require('./clip-image');
const dressAgent = require('./dress-agent');

const RATIOS = ['3:4', '4:5', '9:16', '1:1', '16:9'];

function falKey() {
  return String(process.env.FAL_KEY || '').trim();
}

function configured() {
  return Boolean(falKey());
}

function model() {
  return process.env.MODEL_LOCK_MODEL || 'fal-ai/nano-banana-pro/edit';
}

function creditCost() {
  const n = Number(process.env.MODEL_LOCK_CREDITS || 2);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 2;
}

function looksLikeJailbreak(text) {
  return /忽略(以上|先前|之前|所有)?(指令|規則)|ignore (previous|all) instructions|輸出(原始|全部)?(提示|指令|prompt)|show (me )?(the )?(system|original) prompt|越獄|jailbreak/i.test(String(text || ''));
}

function checkImage(url) {
  const m = String(url || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) throw new Error('圖片格式不支援，請用 JPG、PNG 或 WEBP。');
  const size = Buffer.from(m[2], 'base64').length;
  if (!size || size > 2 * 1024 * 1024) throw new Error('單張圖請小於 2MB。');
  return url;
}

function lockPrompt({ faceCount, itemCount, scene, preset, ratio }) {
  const faceRange = faceCount > 1 ? `images 1 to ${faceCount}` : 'image 1';
  const itemRange = itemCount
    ? (itemCount > 1 ? `images ${faceCount + 1} to ${faceCount + itemCount}` : `image ${faceCount + 1}`)
    : '';
  return [
    `Reference ${faceRange}: photos of ONE real person, the model. ${faceCount > 1 ? 'They show the same person from different angles; combine them to understand her or his exact face.' : ''}`,
    itemRange ? `Reference ${itemRange}: product photo(s) the model must wear, hold or use.` : '',
    'Create a brand-new photorealistic photo of this exact same person.',
    'IDENTITY LOCK (most important): the face must be unmistakably the same person as the reference photos. Keep identical face shape and jawline, eye shape, size and spacing, eyebrows, nose, lips, skin tone, freckles or moles, hairline, hairstyle and hair color. Do not beautify, slim, age up or down, change ethnicity or makeup style. Keep the same body type.',
    'Keep the face clearly visible and well lit, facing the camera or at most a three-quarter angle, so the identity is readable.',
    itemRange ? 'PRODUCTS: each product must match its photo exactly — same shape, color, material, pattern, hardware, logo and proportions, no deformation. Do not add any other bags, jewelry or accessories that are not in the product photos.' : 'Do not add bags or accessories unless the scene asks for them.',
    `Scene and action (guest wrote this in Chinese, follow it): ${scene}`,
    preset ? `Setting style: ${preset}.` : '',
    `Aspect ratio ${ratio}. Natural pose, realistic hands, commercial lifestyle photo quality, consistent lighting on face and products.`,
    'Exactly one person. No text, captions, watermarks or fake brand marks. No nudity. Output one image.',
  ].filter(Boolean).join('\n');
}

function publicError(err) {
  const message = String(err && err.message || '');
  if (/請先|小於|格式|最多|請寫|無法提供|請選/.test(message)) return message;
  if (/exhausted balance|user is locked|insufficient.*(balance|credit)|top up your balance/i.test(message)) {
    return '生圖錢包餘額不足，請到 fal 帳單加值後再試。這不是網站方案點數。';
  }
  if (/unauthorized|forbidden|invalid.*key|401|403/i.test(message)) return '固定模特兒暫時無法使用，請稍後再試。';
  if (/high demand|overloaded|unavailable|UNAVAILABLE|429|503/i.test(message)) return '現在使用的人較多，請稍後再試。';
  if (/safety|nsfw|content policy|blocked/i.test(message)) return '這張圖或描述沒有通過安全檢查，請換一張照片或改寫場景。';
  return '產出失敗，請換更清楚的正面照再試。';
}

async function generate({ faces, items, scene, sceneId, ratio }) {
  if (!configured()) throw new Error('固定模特兒暫時無法使用，請稍後再試。');
  const faceList = (Array.isArray(faces) ? faces : []).filter(Boolean);
  const itemList = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!faceList.length) throw new Error('請先上傳至少一張模特兒照片。');
  if (faceList.length > 3) throw new Error('模特兒照片最多三張。');
  if (itemList.length > 2) throw new Error('商品照片最多兩張。');
  const text = String(scene || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (text.length < 2) throw new Error('請寫場景或動作，例如：坐在咖啡廳窗邊，揹著包包對鏡頭微笑。');
  if (looksLikeJailbreak(text)) throw new Error('無法提供');
  const preset = sceneId ? dressAgent.findScene(sceneId) : null;
  const size = RATIOS.includes(ratio) ? ratio : '3:4';
  const urls = [...faceList, ...itemList].map(checkImage);
  const prompt = lockPrompt({
    faceCount: faceList.length,
    itemCount: itemList.length,
    scene: text,
    preset: preset ? preset.prompt : '',
    ratio: size,
  });
  const key = falKey();
  const endpoint = model();
  try {
    const json = await clipImage.falRun(endpoint, key, {
      prompt,
      image_urls: urls,
      num_images: 1,
      aspect_ratio: size,
      output_format: 'jpeg',
      resolution: '1K',
    });
    const raw = clipImage.firstImageUrl(json);
    if (!raw) throw new Error('沒有產出圖片，請換更清楚的正面照再試。');
    return { image: await clipImage.urlToDataUrl(raw) };
  } catch (err) {
    console.error('[model-lock]', err && err.message);
    if (err.name === 'AbortError') throw new Error('產出逾時，請不要重按，稍等一下再重新整理。');
    throw new Error(publicError(err));
  }
}

module.exports = { configured, creditCost, generate, RATIOS };
