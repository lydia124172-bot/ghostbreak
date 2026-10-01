/**
 * 匯出錄影教案到桌面。執行：node scripts/export-course-teaching-plans.js
 * 產出 .html（用瀏覽器開）與 .txt（用記事本開），不要用 Acrobat 開 .md。
 */
const fs = require('fs');
const path = require('path');
const courses = require('../data/courses-full').filter((c) => c.listed !== false);

const OUT = path.join(process.env.USERPROFILE || '', 'Desktop', '麋鹿網課程教案');

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function recordingBlock(course, lesson) {
  const mins = course.duration?.includes('3') ? 150 : course.duration?.includes('2') ? 120 : 90;
  return {
    title: `第 ${lesson.no} 堂：${lesson.title}`,
    mins,
    summary: lesson.summary,
    courseTitle: course.title,
    lessonNo: lesson.no,
    lessonTitle: lesson.title,
  };
}

function coursePlain(c) {
  const lines = [
    c.title,
    `錄影用教案　麋鹿網　${new Date().toISOString().slice(0, 10)}`,
    '',
    '【課程資訊】',
    `適合對象：${c.audience}`,
    `堂數：${c.sessionLabel}`,
    `單堂：${c.duration}`,
    `形式：${c.format}`,
    `費用：${c.priceLabel}（${c.earlyBirdLabel}）`,
    `狀態：${c.status}`,
    '',
    '【課程簡介】',
    c.summary,
    '',
    c.detail,
    '',
    '【學員成果】',
    ...(c.outcomes || []).map((o) => `・${o}`),
    '',
    '【包含內容】',
    ...(c.features || []).map((f) => `・${f}`),
    '',
    '【全課錄影節奏建議】',
    '・每堂開播前 5 分鐘：測試麥克風與螢幕 1920×1080',
    '・螢幕錄影＋人像小窗（可選），字幕可後製',
    '・每堂檔名：第NN堂-關鍵字.mp4',
    '',
    '══════════════════════════════════════',
    '分堂教案',
    '══════════════════════════════════════',
    '',
  ];
  (c.lessons || []).forEach((lesson) => {
    const b = recordingBlock(c, lesson);
    lines.push(b.title);
    lines.push(`建議錄影長度：約 ${b.mins} 分鐘`);
    lines.push(`本堂目標：${b.summary}`);
    lines.push('');
    lines.push('1. 開場（約 3 分鐘）');
    lines.push(`・問候，重述課程「${c.title}」`);
    lines.push(`・說明第 ${b.lessonNo} 堂要完成的成果`);
    lines.push('・提醒學員準備筆記與可實作草稿');
    lines.push('');
    lines.push('2. 教學主體（約 70%）');
    lines.push('・真實案例帶做');
    lines.push('・每 15 分鐘小結一次');
    lines.push('・示範時口播每一步');
    lines.push(`・本堂重點：${b.summary}`);
    lines.push('');
    lines.push('3. 實作段（約 20%）');
    lines.push('・學員當場做一小段或布置作業');
    lines.push('');
    lines.push('4. 收尾（約 3 分鐘）');
    lines.push('・三個關鍵句、預告下一堂、報名／LINE');
    lines.push('');
    lines.push('【學員作業】');
    lines.push(`・依「${b.lessonTitle}」完成可交付草稿`);
    lines.push('');
    lines.push('──────────────────────────────────────');
    lines.push('');
  });
  lines.push('【結業錄影（可選）】');
  lines.push('・回顧關鍵字、導流下一階、收集見證');
  lines.push('');
  return lines.join('\r\n');
}

function lessonHtml(course, lesson) {
  const b = recordingBlock(course, lesson);
  return `
  <section class="lesson">
    <h3>${esc(b.title)}</h3>
    <p><strong>建議錄影長度</strong>：約 ${b.mins} 分鐘</p>
    <p><strong>本堂目標</strong>：${esc(b.summary)}</p>
    <h4>1. 開場（約 3 分鐘）</h4>
    <ul>
      <li>問候，重述課程「${esc(course.title)}」</li>
      <li>說明第 ${b.lessonNo} 堂要完成的成果</li>
      <li>提醒學員準備筆記與可實作草稿</li>
    </ul>
    <h4>2. 教學主體（約 70%）</h4>
    <ul>
      <li>真實案例帶做，不要只念定義</li>
      <li>每 15 分鐘小結一次</li>
      <li>示範時口播畫面上每一步</li>
      <li>本堂重點：${esc(b.summary)}</li>
    </ul>
    <h4>3. 實作段（約 20%）</h4>
    <ul>
      <li>學員 10～15 分鐘當場做一小段（或布置作業）</li>
    </ul>
    <h4>4. 收尾（約 3 分鐘）</h4>
    <ul>
      <li>總結三句、預告下一堂、LINE／表單報名</li>
    </ul>
    <p><strong>學員作業</strong>：依「${esc(b.lessonTitle)}」完成可交付草稿。</p>
  </section>`;
}

function courseHtml(c) {
  const lessons = (c.lessons || []).map((lesson) => lessonHtml(c, lesson)).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(c.title)} — 錄影教案</title>
  <style>
    body { font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; line-height: 1.65; max-width: 820px; margin: 0 auto; padding: 32px 20px 64px; color: #1a1a1a; }
    h1 { font-size: 1.5rem; border-bottom: 2px solid #b87333; padding-bottom: 8px; }
    h2 { margin-top: 2rem; font-size: 1.15rem; }
    h3 { margin-top: 1.5rem; color: #5c3d2e; }
    h4 { margin-bottom: 0.35rem; }
    .meta { background: #f5f2ed; border-radius: 12px; padding: 16px 20px; margin: 20px 0; }
    .meta dt { font-weight: 600; margin-top: 8px; }
    .meta dd { margin: 4px 0 0; }
    ul { padding-left: 1.25rem; }
    .lesson { border-top: 1px solid #ddd; padding-top: 1.25rem; margin-top: 1.25rem; }
    @media print { body { max-width: none; } }
  </style>
</head>
<body>
  <p class="note">麋鹿網錄影教案 · ${new Date().toISOString().slice(0, 10)} · 用瀏覽器開啟，可按 Ctrl+P 存成 PDF</p>
  <h1>${esc(c.title)}</h1>
  <dl class="meta">
    <dt>適合對象</dt><dd>${esc(c.audience)}</dd>
    <dt>堂數</dt><dd>${esc(c.sessionLabel)} · ${esc(c.duration)}</dd>
    <dt>形式</dt><dd>${esc(c.format)}</dd>
    <dt>費用</dt><dd>${esc(c.priceLabel)}（${esc(c.earlyBirdLabel)}）</dd>
  </dl>
  <h2>課程簡介</h2>
  <p>${esc(c.summary)}</p>
  <p>${esc(c.detail)}</p>
  <h2>學員成果</h2>
  <ul>${(c.outcomes || []).map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
  <h2>包含內容</h2>
  <ul>${(c.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
  <h2>分堂教案</h2>
  ${lessons}
  <h2>結業錄影（可選）</h2>
  <ul>
    <li>回顧全課關鍵字</li>
    <li>導流下一階課程或付費工具</li>
    <li>收集學員見證</li>
  </ul>
</body>
</html>`;
}

function indexHtml() {
  const items = courses.map((c) => `
    <li><a href="${esc(c.id)}.html"><strong>${esc(c.title)}</strong></a><br>
    <span class="sub">${esc(c.sessionLabel)} · ${esc(c.priceLabel)}</span></li>`).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <title>麋鹿網課程教案</title>
  <style>
    body { font-family: "Microsoft JhengHei", sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
    h1 { font-size: 1.4rem; }
    .tip { background: #fff8e6; border: 1px solid #e6d5a8; padding: 14px 18px; border-radius: 10px; margin-bottom: 24px; }
    a { color: #8b4513; }
    .sub { color: #666; font-size: 0.95rem; }
    li { margin-bottom: 16px; }
  </style>
</head>
<body>
  <h1>麋鹿網課程教案</h1>
  <p class="tip"><strong>怎麼開？</strong>點下面課程名稱，會用瀏覽器打開。不要用 Adobe 開 .md。<br>
  若要 PDF：在教案頁按 <kbd>Ctrl</kbd>+<kbd>P</kbd> → 選「另存為 PDF」。</p>
  <ol>${items}</ol>
</body>
</html>`;
}

const readmeTxt = [
  '麋鹿網課程教案 — 怎麼開檔案',
  '',
  '1. 雙擊「打開教案.html」→ 用瀏覽器（Edge / Chrome）看全部課程',
  '2. 或雙擊各課的 .html（例如 web-ai.html）',
  '3. 也可用記事本開 .txt 檔',
  '',
  '不要用 Adobe Acrobat 開 .md，Acrobat 只能開 PDF。',
  '要 PDF：瀏覽器開 .html 後按 Ctrl+P → 另存為 PDF',
  '',
].join('\r\n');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

fs.writeFileSync(path.join(OUT, '打開教案.html'), indexHtml(), 'utf8');
fs.writeFileSync(path.join(OUT, '請先看這裡.txt'), '\uFEFF' + readmeTxt, 'utf8');

courses.forEach((c) => {
  const plain = coursePlain(c);
  fs.writeFileSync(path.join(OUT, `${c.id}.html`), courseHtml(c), 'utf8');
  fs.writeFileSync(path.join(OUT, `${c.id}.txt`), '\uFEFF' + plain, 'utf8');
});

// 移除容易誤開的 .md
try {
  fs.readdirSync(OUT).filter((f) => f.endsWith('.md')).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
} catch { /* ignore */ }

console.log(`已寫入 ${OUT}`);
console.log(`請雙擊「打開教案.html」`);
