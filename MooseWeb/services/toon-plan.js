function configured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function withTimeout(ms, fn) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fn(ctrl.signal).finally(() => clearTimeout(timer));
}

function promptText(script) {
  return [
    '你是分鏡師。把使用者貼上的劇本切成橫式 16:9 動畫短劇分鏡。不要改劇情，不要加角色。',
    '輸出嚴格 JSON，不要 markdown：',
    '{"title":"8字內標題","shots":[{"say":"這鏡要念的原文","who":"旁白或角色","picture":"繁中畫面","motion":false,"prompt":""}]}',
    '規則：',
    '1. say 必須從劇本摘出，繁體中文，不要改寫成另一句。',
    '2. 6 到 12 鏡，依照劇本順序。',
    '3. 正好 4 鏡 motion 為 true。只挑有明確動作的鏡頭：手、摔、喝、縮、敲。其餘 motion 為 false，prompt 為空字串。',
    '4. motion 為 true 的 prompt 用英文，一段，描述 5 秒、一個動作、16:9。不要可讀名牌，不要多出的人。',
    '5. picture 用繁體中文，給剪輯的人看。',
    '7. who 只寫說話的人：角色自己說的話寫狐、獾、貓或熊。敘述句才寫旁白。不要把角色台詞也標成旁白。',
    '6. 若劇本出現這些角色，prompt 必須沿用對應外貌：',
    '資本狐：the same red fox with a cream muzzle, tall ears, narrow amber eyes, navy pinstripe suit, white shirt, and gold tie.',
    '背債獾：the same badger with a white stripe, black eye mask, thick round glasses, tired eyes, pinstripe vest, and brown tie.',
    '社畜貓：the same blue tabby cat with half-closed yellow eyes, heavy dark circles, a light blue shirt, and a loose striped tie.',
    '躺平熊：the same plump brown bear with a round friendly muzzle and cream board shorts printed with teal leaves.',
    '',
    '劇本：',
    script,
  ].join('\n');
}

function parsePlan(text) {
  const raw = String(text || '').trim().replace(/^```json\s*|\s*```$/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('切鏡結果無法解析');
  const data = JSON.parse(raw.slice(start, end + 1));
  const shots = Array.isArray(data.shots) ? data.shots : [];
  if (shots.length < 6 || shots.length > 12) throw new Error('這次沒有切成 6 到 12 鏡，請再按一次。');
  const clean = shots.map((shot, index) => {
    const say = String(shot.say || '').trim();
    const picture = String(shot.picture || '').trim();
    if (!say || !picture) throw new Error('有一鏡缺少台詞或畫面，請再按一次。');
    const motion = Boolean(shot.motion);
    const prompt = motion ? String(shot.prompt || '').trim() : '';
    if (motion && prompt.length < 20) throw new Error('要生片的鏡頭缺少英文提示詞，請再按一次。');
    return {
      n: index + 1,
      say: say.slice(0, 240),
      who: String(shot.who || '旁白').trim().slice(0, 20) || '旁白',
      picture: picture.slice(0, 240),
      motion,
      prompt: prompt.slice(0, 900),
    };
  });
  const moving = clean.filter((shot) => shot.motion);
  if (moving.length !== 4) throw new Error('這次沒有正好四段要動的鏡頭，請再按一次。');
  return {
    title: String(data.title || '動畫短劇').trim().slice(0, 24) || '動畫短劇',
    shots: clean,
  };
}

async function callGemini(script) {
  const key = process.env.GEMINI_API_KEY;
  const body = await withTimeout(45000, async (signal) => {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=' + encodeURIComponent(key), {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText(script) }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4000 },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || '切鏡服務暫時無法使用');
    return json;
  });
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n') || '';
  return parsePlan(text);
}

function publicError(err) {
  const message = String(err && err.message || '');
  if (/請貼|請再按|缺少|無法解析|6 到 12|四段/.test(message)) return message;
  if (err && err.name === 'AbortError') return '切鏡逾時，請再按一次。';
  return '切鏡失敗，請再按一次。';
}

async function plan(script) {
  const text = String(script || '').trim();
  if (text.length < 40) throw new Error('請貼上完整劇本。');
  if (text.length > 8000) throw new Error('劇本太長，請少於 8000 字。');
  if (!configured()) throw new Error('切鏡暫時無法使用，請稍後再試。');
  try {
    return await callGemini(text);
  } catch (err) {
    throw new Error(publicError(err));
  }
}

module.exports = { configured, plan };
