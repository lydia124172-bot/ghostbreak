function formatPrice(raw) {
  const n = Number(String(raw || '').replace(/[^\d]/g, ''));
  if (!n) return '';
  return `NT$ ${n.toLocaleString('en-US')}`;
}

const ORIGINS = [
  { key: '日本', aliases: ['日本', 'Japan', '日貨'] },
  { key: '韓國', aliases: ['韓國', '韩国', 'Korea', '韓貨', '韩货'] },
  { key: '中國', aliases: ['中國', '中国', 'China'] },
  { key: '泰國', aliases: ['泰國', '泰国', 'Thailand', '泰貨', '泰货'] },
  { key: '台灣', aliases: ['台灣', '台湾', 'Taiwan', '臺灣'] },
];

const CATEGORIES = [
  { key: '食品零食', words: ['零食', '餅乾', '饼干', '糖果', '巧克力', '堅果', '食品', '點心', '海苔', '果乾'] },
  { key: '茶葉飲品', words: ['茶', '咖啡', '飲', '果汁', '蜂蜜'] },
  { key: '居家生活', words: ['居家', '香氛', '毛巾', '織品', '皂', '蠟燭', '收納', '器皿', '鍋'] },
];

const DEFAULT_BADGE = '紫瑄老闆親測推薦';

function originKeys() {
  return ORIGINS.flatMap((row) => row.aliases);
}

function parseVideo(raw) {
  const yt = String(raw || '').match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/i);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = String(raw || '').match(/https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  const file = String(raw || '').match(/https?:\/\/\S+\.(?:mp4|webm)(?:\?\S*)?/i);
  return file ? file[0] : '';
}

function isVideoLine(line) {
  return /youtube\.com|youtu\.be|vimeo\.com|\.mp4|\.webm/i.test(line);
}

function parseBadge(name, raw) {
  const tagged = String(name || '').match(/^【([^】]+)】/);
  if (tagged && !originKeys().includes(tagged[1])) return tagged[1].slice(0, 24);
  const line = String(raw || '').match(/【(紫瑄[^】]{0,20})】/);
  if (line) return line[1].slice(0, 24);
  return DEFAULT_BADGE;
}

function parsePerk(name, raw) {
  const inName = String(name || '').match(/[（(](附[^）)]{1,40})[）)]/);
  if (inName) return inName[1].trim();
  const line = String(raw || '').split(/\r?\n/).map((s) => s.trim()).find((s) => /^附[:：]/.test(s));
  if (line) return line.replace(/^附[:：]\s*/, '').trim().slice(0, 40);
  return '';
}

function displayName({ name, badge, perk }) {
  const base = String(name || '').trim();
  if (!base) return '';
  if (/【.+】/.test(base)) return base.slice(0, 120);
  const mark = badge || DEFAULT_BADGE;
  const extra = perk ? `（${perk}）` : '';
  return `【${mark}】${base}${extra}`.slice(0, 120);
}

function parseListing(text, filename = '') {
  const raw = String(text || '').replace(/\u3000/g, ' ').trim();
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  let origin = '';
  for (const row of ORIGINS) {
    if (row.aliases.some((alias) => raw.includes(alias))) {
      origin = row.key;
      break;
    }
  }

  const priceMatch = raw.match(/(?:NT\$?|TWD|售價[:：\s]*|價格[:：\s]*|＄|\$)\s*[\d,]+/i)
    || raw.match(/[\d,]{2,}\s*元/);
  const price = priceMatch ? formatPrice(priceMatch[0]) : '';

  let stock = '有貨';
  if (/缺貨|售完|完售|暫停/.test(raw)) stock = '缺貨';

  let category = '';
  for (const row of CATEGORIES) {
    if (row.words.some((word) => raw.includes(word))) {
      category = row.key;
      break;
    }
  }

  const skipLine = (line) => {
    if (!line) return true;
    if (originKeys().includes(line)) return true;
    if (/^(有貨|缺貨|售完|完售)$/.test(line)) return true;
    if (isVideoLine(line)) return true;
    if (/^附[:：]/.test(line)) return true;
    if (priceMatch && line.replace(/\s/g, '') === priceMatch[0].replace(/\s/g, '')) return true;
    if (/^(售價|價格)[:：]?\s*[\d,$NT元,，.\s]+$/.test(line)) return true;
    return false;
  };

  let name = lines.find((line) => !skipLine(line)) || '';
  name = name
    .replace(/^[【\[]\s*(日本|韓國|韩国|中國|中国|泰國|泰国|台灣|台湾|臺灣)\s*[】\]]\s*/, '')
    .replace(/(?:NT\$?|TWD|＄|\$)\s*[\d,]+/i, '')
    .replace(/[\d,]{2,}\s*元/, '')
    .replace(/[|｜]\s*$/, '')
    .trim()
    .slice(0, 120);

  if (!name) {
    const fromFile = String(filename || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    name = fromFile.slice(0, 120);
  }

  const video = parseVideo(raw);
  const badge = parseBadge(name, raw);
  const perk = parsePerk(name, raw);
  const summary = raw || name;
  return {
    origin,
    category,
    name,
    price,
    stock,
    summary,
    video,
    badge,
    perk,
    displayName: displayName({ name, badge, perk }),
  };
}

module.exports = { parseListing, formatPrice, displayName, parseVideo, DEFAULT_BADGE };
