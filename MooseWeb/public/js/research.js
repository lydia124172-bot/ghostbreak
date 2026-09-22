const CATS = ['全部', '對話寫作', '搜尋研究', '寫程式', '生圖設計', '影片聲音', '辦公自動化'];

const TOOLS = [
  { name: 'ChatGPT', maker: 'OpenAI', cat: '對話寫作', use: '通用對話、寫稿、整理與逐步說明。', href: 'https://chatgpt.com/' },
  { name: 'Claude', maker: 'Anthropic', cat: '對話寫作', use: '長文閱讀、分析與較謹慎的書面回答。', href: 'https://claude.ai/' },
  { name: 'Gemini', maker: 'Google', cat: '對話寫作', use: '與 Google 搜尋、文件與信箱連動的對話。', href: 'https://gemini.google.com/' },
  { name: 'Grok', maker: 'xAI', cat: '對話寫作', use: '偏即時資訊與社群脈絡的對話。', href: 'https://grok.com/' },
  { name: 'Perplexity', maker: 'Perplexity', cat: '搜尋研究', use: '帶出處的問答，適合先核對資料再往下做。', href: 'https://www.perplexity.ai/' },
  { name: 'NotebookLM', maker: 'Google', cat: '搜尋研究', use: '依你上傳的文件做筆記、提問與摘要。', href: 'https://notebooklm.google.com/' },
  { name: 'Cursor', maker: 'Anysphere', cat: '寫程式', use: '在專案裡改程式、查錯誤、補測試。', href: 'https://cursor.com/' },
  { name: 'GitHub Copilot', maker: 'GitHub', cat: '寫程式', use: '編輯器內補全與函式建議。', href: 'https://github.com/features/copilot' },
  { name: 'v0', maker: 'Vercel', cat: '寫程式', use: '用文字先做出介面與前端草稿。', href: 'https://v0.dev/' },
  { name: 'Midjourney', maker: 'Midjourney', cat: '生圖設計', use: '風格化圖像與概念視覺。', href: 'https://www.midjourney.com/' },
  { name: 'Ideogram', maker: 'Ideogram', cat: '生圖設計', use: '圖上需要清楚文字時較穩。', href: 'https://ideogram.ai/' },
  { name: 'Canva', maker: 'Canva', cat: '生圖設計', use: '海報、社群圖與簡報版型，含 AI 輔助。', href: 'https://www.canva.com/' },
  { name: 'Runway', maker: 'Runway', cat: '影片聲音', use: '短片生成、去背與剪輯輔助。', href: 'https://runwayml.com/' },
  { name: 'ElevenLabs', maker: 'ElevenLabs', cat: '影片聲音', use: '語音合成與配音草稿。', href: 'https://elevenlabs.io/' },
  { name: 'Suno', maker: 'Suno', cat: '影片聲音', use: '依文字生成歌曲與配樂草稿。', href: 'https://suno.com/' },
  { name: 'Notion AI', maker: 'Notion', cat: '辦公自動化', use: '筆記、會議紀錄與頁面整理。', href: 'https://www.notion.so/product/ai' },
  { name: 'Gamma', maker: 'Gamma', cat: '辦公自動化', use: '簡報與說明頁草稿。', href: 'https://gamma.app/' },
  { name: 'Microsoft Copilot', maker: 'Microsoft', cat: '辦公自動化', use: 'Word、Excel、Outlook 內的撰寫與整理。', href: 'https://copilot.microsoft.com/' },
];

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function matches(tool, query, cat) {
  if (cat && cat !== '全部' && tool.cat !== cat) return false;
  if (!query) return true;
  const hay = `${tool.name} ${tool.maker} ${tool.cat} ${tool.use}`.toLowerCase();
  return query.split(/\s+/).every((word) => hay.includes(word));
}

function render() {
  const query = (document.getElementById('q').value || '').trim().toLowerCase();
  const cat = document.querySelector('.filter-btn.active')?.dataset.cat || '全部';
  const list = TOOLS.filter((tool) => matches(tool, query, cat));
  const root = document.getElementById('results');
  const count = document.getElementById('count');
  count.textContent = list.length ? `顯示 ${list.length} 項` : '沒有符合的項目';
  root.innerHTML = list.length
    ? list.map((tool) => `
      <article class="card research-card">
        <p class="meta">${escapeHtml(tool.cat)} · ${escapeHtml(tool.maker)}</p>
        <h3>${escapeHtml(tool.name)}</h3>
        <p>${escapeHtml(tool.use)}</p>
        <a class="btn btn-cream" href="${escapeHtml(tool.href)}" target="_blank" rel="noopener">開啟官網</a>
      </article>
    `).join('')
    : `<p class="lead">沒有符合的項目。可改關鍵字，或透過 LINE 詢問適用情境。</p>`;
}

document.getElementById('filters').innerHTML = CATS.map((cat, i) => (
  `<button class="filter-btn${i === 0 ? ' active' : ''}" type="button" data-cat="${cat}">${cat}</button>`
)).join('');

document.getElementById('filters').addEventListener('click', (event) => {
  const btn = event.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach((el) => el.classList.toggle('active', el === btn));
  render();
});

document.getElementById('q').addEventListener('input', render);
document.getElementById('researchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  render();
});

render();
