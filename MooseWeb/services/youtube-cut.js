// 長片 B-roll 的固定出片規格。下次合成直接讀這裡，不要另寫一套溫柔口播。
// 不使用明星迷因、悲傷青蛙，也不使用 Windows 系統音；那些換成自製故障字、黑白閃切、錯誤窗和合成音效。

const PACE = 1.08;
const PUNCH_GAP_SEC = 17;
const FONT = 'C\\\\:/Windows/Fonts/msjhbd.ttc';

const VOICE = [
  '台灣華語。人設是高智商、毫無情感波動的冷感御姐，像沒有表情的 AI 總裁，或冷眼旁觀的哲學家姐姐。',
  '禁止甜美客服音、溫柔說書音、輕聲、微笑、慢條斯理。',
  '語速偏快，字字清晰。',
  '專業術語要篤定、冷靜，帶一點不屑。',
  '諷刺句的最後三個字故意放慢，聲音下沉。',
  '遇到極度荒謬的職場現象，加一聲極短、輕蔑的氣音「哼」，不要笑出聲。',
].join('');

const CONCEPTS = [
  '慢性情緒耗竭', '習得性無助', '系統性超載', '注意力經濟', '倖存者偏差', '鄧寧克魯格',
  '組織熵增', '囚徒困境', '達克效應', '勞動異化', '西西弗斯', '零和博弈', '確認偏誤',
  '沉沒成本', '過濾氣泡', '錯失恐懼', '損失趨避', '現狀偏差', '認知失調', '棘輪效應',
  '巴納姆效應', '黑盒子效應', '擬真理論', '破窗效應', '錨定效應', '從眾效應', '權威效應',
  '稀缺效應', '峰終定律', '煤氣燈效應',
].sort((a, b) => b.length - a.length);

function voiceInstructions() {
  return VOICE;
}

function geminiLine(line) {
  return `用又快又冷、帶點不屑的台灣女聲唸，不要甜美，不要把這句指示唸出來：${line}`;
}

function openaiSpec() {
  return { voice: 'ash', instructions: VOICE };
}

function cleanTitle(text) {
  return String(text || '').replace(/[%'\\:]/g, '').trim();
}

function conceptIn(narration) {
  const line = String(narration || '');
  const named = CONCEPTS.find((term) => line.includes(term));
  if (named) return named;
  const quoted = line.match(/「([^」]{2,8})」/);
  return quoted ? cleanTitle(quoted[1]) : '';
}

function roastIn(narration) {
  return /哼|荒謬|開會|加班|打卡|匯報|周會|週會|空轉|形式主義|無效會議|確認了/.test(String(narration || ''));
}

function punchFor(narration, sinceLastSec) {
  const title = conceptIn(narration);
  if (title) return { kind: 'term', title };
  if (roastIn(narration)) return { kind: 'roast', title: '' };
  if (Number(sinceLastSec) >= PUNCH_GAP_SEC) return { kind: 'tick', title: '' };
  return null;
}

function sectionAt(index, count) {
  const p = (Number(index) + 0.5) / Math.max(1, Number(count) || 1);
  if (p < 0.12) return 'hook';
  if (p < 0.70) return 'main';
  if (p < 0.86) return 'reflect';
  return 'outro';
}

function glitchTitle(term) {
  const text = cleanTitle(term);
  if (!text) return '';
  const base = `fontfile=${FONT}:text='${text}':fontsize=96:borderw=4:bordercolor=black`;
  const flicker = "enable='between(t,0.12,0.28)+between(t,0.42,0.50)'";
  return [
    `drawtext=${base}:fontcolor=0x00ffff:x=(w-text_w)/2-16:y=(h-text_h)/2-8:${flicker}`,
    `drawtext=${base}:fontcolor=0xff22aa:x=(w-text_w)/2+14:y=(h-text_h)/2+8:${flicker}`,
    `drawtext=${base}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,0.18,2.4)'`,
  ].join(',');
}

function sceneFilters({ dur, moving, punch, index }) {
  const seconds = Number(dur) || 4;
  const slide = Number(index) % 2
    ? 'clip(56*t,0,in_w-out_w)'
    : 'clip((in_w-out_w)-56*t,0,in_w-out_w)';
  const base = moving
    ? [
      "scale=w='trunc(1920*min(1.34,1.05+0.05*t)/2)*2':h='trunc(1080*min(1.34,1.05+0.05*t)/2)*2':eval=frame",
      `crop=1920:1080:x='${slide}':y='clip((in_h-out_h)*0.35+24*t,0,in_h-out_h)'`,
      'fps=30',
      'format=yuv420p',
      `trim=duration=${seconds}`,
      'setpts=PTS-STARTPTS',
    ].join(',')
    : `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,trim=duration=${seconds},setpts=PTS-STARTPTS`;
  const fx = [];
  if (punch && punch.kind === 'roast') fx.push("hue=s=0:enable='between(t,0.12,0.7)'");
  if (punch && punch.kind === 'tick') fx.push("eq=brightness=0.2:enable='between(t,0.08,0.18)'");
  if (punch && punch.title) fx.push(glitchTitle(punch.title));
  return [base, ...fx].filter(Boolean).join(',');
}

function sfxFor(kind) {
  if (kind === 'term') {
    return [
      { expr: '0.95*sin(2*PI*42*t)*exp(-5*t)', seconds: 0.7, delayMs: 80, volume: 1.15 },
      { expr: '0.28*sin(2*PI*(280+3600*t)*t)*exp(-2.4*t)', seconds: 0.55, delayMs: 160, volume: 0.8 },
    ];
  }
  if (kind === 'roast') {
    return [
      { expr: '0.8*sin(2*PI*2100*t)*exp(-48*t)', seconds: 0.22, delayMs: 120, volume: 1 },
      { expr: '0.18*sin(2*PI*1700*t)*sin(2*PI*53*t)*exp(-5*t)', seconds: 0.32, delayMs: 170, volume: 0.65 },
    ];
  }
  if (kind === 'tick') {
    return [
      { expr: '0.3*sin(2*PI*(400+5000*t)*t)*exp(-3*t)', seconds: 0.4, delayMs: 60, volume: 0.75 },
    ];
  }
  if (kind === 'section') {
    return [
      { expr: '0.5*sin(2*PI*(920-700*t)*t)*exp(-3.4*t)', seconds: 0.42, delayMs: 0, volume: 0.9 },
    ];
  }
  return [];
}

function bedPlan(totalSec) {
  const dur = Math.max(12, Number(totalSec) || 12);
  const hook = Math.max(8, dur * 0.12);
  const main = Math.max(12, dur * 0.58);
  const reflect = Math.max(8, dur * 0.16);
  const outro = Math.max(6, dur - hook - main - reflect);
  return [
    {
      id: 'hook',
      seconds: hook,
      gain: 0.42,
      expr: '0.5*sin(2*PI*46*t)*(0.58+0.42*sin(2*PI*0.16*t))',
    },
    {
      id: 'main',
      seconds: main,
      gain: 0.38,
      expr: '0.46*sin(2*PI*58*t)*sin(2*PI*1.6*t)*sin(2*PI*1.6*t)+0.1*sin(2*PI*196*t)*sin(2*PI*3.2*t)*sin(2*PI*3.2*t)+0.04*sin(2*PI*2500*t)*sin(2*PI*1.6*t)*sin(2*PI*1.6*t)',
    },
    {
      id: 'reflect',
      seconds: reflect,
      gain: 0.2,
      expr: '0.16*sin(2*PI*220*t)*(0.4+0.6*sin(2*PI*0.08*t))+0.08*sin(2*PI*277*t)*(0.4+0.6*sin(2*PI*0.07*t))',
    },
    {
      id: 'outro',
      seconds: outro,
      gain: 0.4,
      expr: '0.5*sin(2*PI*82*t)*sin(2*PI*2.2*t)*sin(2*PI*2.2*t)+0.14*sin(2*PI*164*t)*sin(2*PI*2.2*t)*sin(2*PI*2.2*t)+0.05*sin(2*PI*3300*t)*sin(2*PI*4.4*t)*sin(2*PI*4.4*t)',
    },
  ];
}

function bumperFilters() {
  const box = [
    'drawbox=x=520:y=340:w=880:h=400:color=white@0.94:t=fill',
    'drawbox=x=520:y=340:w=880:h=64:color=0xb42323:t=fill',
  ].join(',');
  const title = `fontfile=${FONT}:fontsize=42:x=(w-text_w)/2:borderw=0`;
  return [
    box,
    `drawtext=${title}:text='ERROR':fontcolor=white:y=352`,
    `drawtext=${title}:text='進入下一階段':fontcolor=0x1a1a1a:y=500`,
  ].join(',');
}

function plannerExtra() {
  return [
    '- 出片風格已鎖定為冷、快、緊。narration 保留專有名詞原字，例如囚徒困境、達克效應，不要改成「這個概念」。',
    '- 不要把旁白改寫成溫柔、療癒、慢節奏或客服口吻。',
    '- 每一鏡優先找會動的具體動作。靜物只在這句話確實在講那個東西時才用。',
  ].join('\n');
}

module.exports = {
  PACE,
  PUNCH_GAP_SEC,
  voiceInstructions,
  geminiLine,
  openaiSpec,
  conceptIn,
  roastIn,
  punchFor,
  sectionAt,
  sceneFilters,
  sfxFor,
  bedPlan,
  bumperFilters,
  plannerExtra,
};
