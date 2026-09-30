const crypto = require('crypto');
const tree = require('../data/tree');

const MODELS = ['gemini-flash-lite-latest', 'gemini-3.6-flash'];

function secret() {
  return String(process.env.LINE_CHANNEL_SECRET || '').trim();
}

function accessToken() {
  return String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
}

function configured() {
  return Boolean(secret() && accessToken());
}

function verifySignature(rawBody, signature) {
  if (!rawBody || !signature || !secret()) return false;
  const expected = crypto.createHmac('sha256', secret()).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function planSummary() {
  return (tree.plans || [])
    .filter((p) => (p.product || 'mooseclip') === 'mooseclip')
    .map((p) => `・${p.name}：${p.priceLabel}（${p.quota || ''}）`)
    .join('\n');
}

function rules(origin) {
  return [
    {
      words: ['價格', '價錢', '方案', '多少錢', '費用', '收費', '訂閱'],
      reply: () => `麋鹿網商品短片方案：\n${planSummary()}\n\n付費方案可選每月自動續約，隨時可取消。\n線上付款：${origin}/account`,
    },
    {
      words: ['網站', '架站', '官網', '做網頁', '接案'],
      reply: () => `我們可以幫你做有會員、訂單、庫存和金流的品牌官網，也能做部落格 SEO。\n作品與諮詢：${origin}/\n留下需求，我們會盡快回覆你！`,
    },
    {
      words: ['課程', '上課', '教學', '開課'],
      reply: () => `課程資訊整理中，開課時會第一時間在這裡通知你。\n想先了解可以留言你最想學的主題喔！`,
    },
    {
      words: ['真人', '客服', '找人', '老闆'],
      reply: () => '好的！真人客服看到訊息會盡快回覆你，請把問題直接留在這裡。',
    },
  ];
}

async function askAi(text, origin) {
  if (!process.env.GEMINI_API_KEY) return '';
  const prompt = `你是「麋鹿網」LINE 官方帳號的客服小幫手。麋鹿網提供 AI 商品短片、模特換裝、劇本廣告等工具，也幫店家做品牌官網。
方案：
${planSummary()}
網站：${origin}/
規則：繁體中文、台灣用語、親切簡短（150 字內）、不用 Markdown。不知道的事不要編，請對方輸入「真人」由客服回覆。不要承諾折扣或價格以外的優惠。

客人說：${text.slice(0, 500)}`;
  for (const model of MODELS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || `AI ${res.status}`);
      const out = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
      if (out) return out.slice(0, 1000);
    } catch (err) {
      console.error('[line-bot ai]', err.message);
    } finally {
      clearTimeout(timer);
    }
  }
  return '';
}

async function replyFor(text, origin) {
  const msg = String(text || '').trim();
  const hit = rules(origin).find((r) => r.words.some((w) => msg.includes(w)));
  if (hit) return hit.reply();
  const ai = await askAi(msg, origin);
  return ai || `謝謝你的訊息！我們會盡快回覆你。\n也可以先看看：${origin}/`;
}

async function sendReply(replyToken, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken()}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) console.error('[line-bot reply]', res.status, await res.text().catch(() => ''));
}

async function handleEvents(events, origin) {
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev.replyToken) continue;
    if (ev.type === 'follow') {
      await sendReply(ev.replyToken, `歡迎加入麋鹿網！\n輸入「方案」看價格、「網站」了解架站、「真人」找客服。\n${origin}/`);
    } else if (ev.type === 'message' && ev.message?.type === 'text') {
      await sendReply(ev.replyToken, await replyFor(ev.message.text, origin));
    }
  }
}

module.exports = { configured, verifySignature, handleEvents, replyFor };
