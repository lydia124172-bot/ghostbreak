const clipVideo = require('./clip-video');
const clipTts = require('./clip-tts');

function configured() {
  return clipVideo.configured();
}

function talkModel() {
  return process.env.FAL_TALK_MODEL || 'fal-ai/sync-lipsync/v3/image-to-video';
}

function creditCost() {
  return Number(process.env.FAL_TALK_CREDITS || 5) || 5;
}

function engine() {
  return configured() ? 'sync3' : '';
}

async function submit({ images, narration, voice }) {
  if (!configured()) throw new Error('數字人出鏡尚未開通。');
  const first = Array.isArray(images) ? images[0] : '';
  if (!first) throw new Error('請上傳一張正面出鏡照片');
  const file = clipVideo.parseDataUrl(first);
  const key = String(process.env.FAL_KEY || '').trim();
  const model = talkModel();
  let speech = voice && voice.buffer && voice.buffer.length ? voice : null;
  if (speech && !clipVideo.audioMimeOf(speech.mime)) throw new Error('口播音檔只接受 MP3 或 WAV');
  const line = String(narration || '').trim();
  if (line && !speech) speech = await clipTts.speak(line);
  if (!speech) throw new Error('請填旁白，或上傳口播音檔');
  const imageUrl = await clipVideo.falUpload(key, Buffer.from(file.b64, 'base64'), file.mime, 'face.jpg');
  const mime = clipVideo.audioMimeOf(speech.mime) || 'audio/mpeg';
  const audioUrl = await clipVideo.falUpload(key, speech.buffer, mime, mime === 'audio/wav' ? 'line.wav' : 'line.mp3');
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      audio_url: audioUrl,
    }),
  });
  const body = await res.json().catch(() => ({}));
  const requestId = body.request_id || body.requestId || '';
  if (!res.ok || !requestId) throw new Error(body.detail || body.error || body.message || '對嘴送出失敗');
  const base = `https://queue.fal.run/${model}/requests/${encodeURIComponent(requestId)}`;
  return {
    requestId,
    model,
    statusUrl: body.status_url || `${base}/status`,
    responseUrl: body.response_url || `${base}/response`,
  };
}

module.exports = { configured, engine, creditCost, submit };
