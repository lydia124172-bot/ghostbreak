const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'clip-music');

const PICKS = [
  { id: 'none', name: '無配樂', summary: '不加音樂', file: '' },
  { id: 'bright', name: '明亮', summary: '帶貨、節奏清楚', file: 'bright.mp3' },
  { id: 'soft', name: '柔和', summary: '生活感', file: 'soft.mp3' },
  { id: 'warm', name: '溫暖', summary: '餐飲、手作', file: 'warm.mp3' },
  { id: 'beat', name: '節奏', summary: '較有拍點', file: 'beat.mp3' },
  { id: 'play', name: '活潑', summary: '輕快、跳色', file: 'play.mp3' },
  { id: 'luxe', name: '高級', summary: '保養、飾品', file: 'luxe.mp3' },
  { id: 'clear', name: '清透', summary: '保養、清潔', file: 'clear.mp3' },
  { id: 'night', name: '夜感', summary: '潮流、穿搭', file: 'night.mp3' },
  { id: 'film', name: '電影', summary: '較有畫面感', file: 'film.mp3' },
  { id: 'quiet', name: '極簡', summary: '幾乎只墊底', file: 'quiet.mp3' },
];

function list() {
  return PICKS.map(({ id, name, summary }) => ({ id, name, summary }));
}

function loadPick(id) {
  const pick = PICKS.find((row) => row.id === id);
  if (!pick || !pick.file) return null;
  const full = path.join(DIR, pick.file);
  if (!fs.existsSync(full)) return null;
  return { buffer: fs.readFileSync(full), mime: 'audio/mpeg' };
}

module.exports = { list, loadPick };
