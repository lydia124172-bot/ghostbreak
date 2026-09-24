function configured() {
  return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
}

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function rateOf(mime) {
  const m = String(mime || '').match(/rate=(\d+)/i);
  return m ? Number(m[1]) : 24000;
}

async function speak(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) throw new Error('請先填旁白');
  if (line.length > 280) throw new Error('旁白請在 280 字內，約 10 秒口播');
  if (!configured()) throw new Error('旁白語音尚未開通。也可改傳口播音檔。');
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
  const key = process.env.GEMINI_API_KEY;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `請用自然的台灣華語口播，語氣清楚、節奏偏快，不要加音效：${line}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || 'Kore' } },
        },
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || '旁白語音失敗');
  const part = json.candidates?.[0]?.content?.parts?.find((row) => row.inlineData || row.inline_data) || {};
  const blob = part.inlineData || part.inline_data || {};
  const b64 = blob.data;
  const mime = blob.mimeType || blob.mime_type || '';
  if (!b64) throw new Error('旁白語音沒有音檔');
  const raw = Buffer.from(b64, 'base64');
  if (/wav/i.test(mime)) return { buffer: raw, mime: 'audio/wav' };
  if (/mpeg|mp3/i.test(mime)) return { buffer: raw, mime: 'audio/mpeg' };
  return { buffer: pcmToWav(raw, rateOf(mime)), mime: 'audio/wav' };
}

module.exports = { configured, speak };
