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

const PLAYBOOKS = [
  {
    id: 'drama',
    title: '作短劇／短影音',
    keys: ['短劇', '做劇', '作劇', '拍劇', '微電影', '短影音', '拍片', '影片', '劇本', '演戲', 'tiktok', '抖音', 'reels'],
    lead: '短劇通常要拆四段：劇本、畫面、聲音、剪接。下列為常見組合，不是唯一做法。',
    combos: [
      {
        name: '完整生成組合',
        fit: '要先快速做出一集樣片，再決定要不要實拍。',
        stack: [
          { tool: 'ChatGPT', role: '分集大綱、對白、分鏡提示' },
          { tool: 'Runway', role: '鏡頭與短片生成' },
          { tool: 'ElevenLabs', role: '角色配音' },
          { tool: 'Suno', role: '片頭片尾配樂' },
        ],
        plus: ['從文字到畫面、聲音可在同一流程完成。', '適合先驗證故事好不好看。'],
        minus: ['人物臉孔與動作仍易不一致。', '商用授權與肖像權要逐項核對。', '成片質感通常仍需人工剪接。'],
      },
      {
        name: '實拍為主組合',
        fit: '已有拍攝，只要加速腳本、封面與配樂。',
        stack: [
          { tool: 'Claude', role: '劇本潤稿、對白節奏' },
          { tool: 'Canva', role: '封面、字幕版型、片尾卡' },
          { tool: 'Suno', role: '配樂草稿' },
          { tool: 'ElevenLabs', role: '旁白或配角聲線' },
        ],
        plus: ['畫面仍由實拍控制，風格較穩。', '工具學習成本較低。'],
        minus: ['拍攝與剪接仍要人力。', '配音若與口型對不齊，要再修。'],
      },
      {
        name: '海報先行組合',
        fit: '先做角色與海報測試點閱，再投入拍片。',
        stack: [
          { tool: 'ChatGPT', role: '角色設定與一句鉤子' },
          { tool: 'Midjourney', role: '角色與場景氛圍圖' },
          { tool: 'Ideogram', role: '帶劇名文字的海報' },
          { tool: 'Canva', role: '輸出各平台封面尺寸' },
        ],
        plus: ['未開拍就能測標題與視覺。', '圖上文字可用 Ideogram 補齊。'],
        minus: ['還沒有成片，無法驗證演技與節奏。', '角色圖要反覆對齊同一張臉。'],
      },
    ],
  },
  {
    id: 'site',
    title: '做網站／寫程式',
    keys: ['網站', '架站', '官網', '寫程式', '程式', 'app', '落地頁', 'saas'],
    lead: '先分「只要頁面」與「要改現有專案」。',
    combos: [
      {
        name: '專案內改碼',
        fit: '已有網站或程式，要改功能、修錯誤。',
        stack: [
          { tool: 'Cursor', role: '在專案裡改程式與查錯' },
          { tool: 'Claude', role: '長檔案說明與架構討論' },
        ],
        plus: ['可直接對現有檔案動手。', '方便核對前後差異。'],
        minus: ['仍需人決定需求與上線。', '沒有專案檔時發揮有限。'],
      },
      {
        name: '先出畫面再補功能',
        fit: '從零開始，先要看得見的頁面。',
        stack: [
          { tool: 'ChatGPT', role: '頁面結構與文案' },
          { tool: 'v0', role: '介面草稿' },
          { tool: 'Cursor', role: '接到可上線的程式' },
        ],
        plus: ['畫面來得快，方便對風格。', '之後可接到真實專案。'],
        minus: ['草稿與正式站常要再對一次。', '金流、後台仍要另外做。'],
      },
    ],
  },
  {
    id: 'deck',
    title: '做簡報',
    keys: ['簡報', 'ppt', '投影片', '提案', 'pitch'],
    lead: '簡報可先寫大綱，再交給排版工具。',
    combos: [
      {
        name: '一次出簡報',
        fit: '時間短，先要可投影的版本。',
        stack: [
          { tool: 'ChatGPT', role: '大綱與逐頁重點' },
          { tool: 'Gamma', role: '直接生成簡報頁' },
        ],
        plus: ['從題目到頁面最快。', '適合內部討論稿。'],
        minus: ['版型常偏制式。', '數據與來源仍要人核對。'],
      },
      {
        name: '文件後再做成簡報',
        fit: '已有報告或會議紀錄。',
        stack: [
          { tool: 'Claude', role: '濃縮長文成頁面重點' },
          { tool: 'Microsoft Copilot', role: '在 PowerPoint 裡整理' },
        ],
        plus: ['較能沿用原文語氣。', '人在熟悉的 Office 裡改。'],
        minus: ['要有 Microsoft 環境。', '視覺設計空間較小。'],
      },
    ],
  },
  {
    id: 'sell',
    title: '帶貨／電商內容',
    keys: ['帶貨', '電商', '蝦皮', '直播賣', '商品', '上架'],
    lead: '帶貨常要文案、封面與短片，再接到實際上架。',
    combos: [
      {
        name: '內容產線',
        fit: '要穩定產出商品文案與短片素材。',
        stack: [
          { tool: 'ChatGPT', role: '賣點、標題、直播講稿' },
          { tool: 'Canva', role: '封面與賣場圖' },
          { tool: 'Runway', role: '商品短片輔助' },
        ],
        plus: ['同一商品可快速出多組素材。', '適合測試標題。'],
        minus: ['商品實拍仍較可信。', '平台規範與禁詞要另外查。'],
      },
    ],
  },
  {
    id: 'write',
    title: '寫文案／長文',
    keys: ['文案', '寫文章', '部落格', '稿', '腳本'],
    lead: '先決定要不要引述資料。',
    combos: [
      {
        name: '先查再寫',
        fit: '內容需要出處或最新資訊。',
        stack: [
          { tool: 'Perplexity', role: '帶出處蒐集' },
          { tool: 'Claude', role: '整理成長文' },
        ],
        plus: ['較容易回頭核對來源。', '長文結構較穩。'],
        minus: ['出處仍要點進去確認。', '不能取代專業審查。'],
      },
      {
        name: '依自己的資料寫',
        fit: '已有講義、逐字稿或品牌文件。',
        stack: [
          { tool: 'NotebookLM', role: '只根據你上傳的資料回答' },
          { tool: 'Notion AI', role: '放回筆記系統整理' },
        ],
        plus: ['較不容易寫出文件裡沒有的內容。', '適合內部知識。'],
        minus: ['資料沒上傳就答不出。', '文筆仍要人定稿。'],
      },
    ],
  },
];

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toolByName(name) {
  return TOOLS.find((row) => row.name === name);
}

function matchesTool(tool, query, cat) {
  if (cat && cat !== '全部' && tool.cat !== cat) return false;
  if (!query) return true;
  const hay = `${tool.name} ${tool.maker} ${tool.cat} ${tool.use}`.toLowerCase();
  return query.split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

function matchPlaybooks(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return [];
  return PLAYBOOKS.filter((book) => book.keys.some((key) => text.includes(key.toLowerCase())));
}

function comboCard(combo, index) {
  const steps = combo.stack.map((step) => {
    const tool = toolByName(step.tool);
    const href = tool ? tool.href : '#';
    return `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(step.tool)}</a><span>${escapeHtml(step.role)}</span></li>`;
  }).join('');
  return `
    <article class="combo-card">
      <p class="meta">組合 ${index + 1}</p>
      <h3>${escapeHtml(combo.name)}</h3>
      <p class="combo-fit">${escapeHtml(combo.fit)}</p>
      <ol class="combo-stack">${steps}</ol>
      <div class="combo-pros">
        <div>
          <h4>優點</h4>
          <ul>${combo.plus.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>
        </div>
        <div>
          <h4>缺點</h4>
          <ul>${combo.minus.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>
        </div>
      </div>
    </article>
  `;
}

function playbookBlock(book) {
  return `
    <section class="playbook">
      <p class="kicker">配對結果</p>
      <h2>${escapeHtml(book.title)}</h2>
      <p class="lead">${escapeHtml(book.lead)}</p>
      <div class="combo-list">${book.combos.map(comboCard).join('')}</div>
    </section>
  `;
}

function toolCard(tool) {
  return `
    <article class="card research-card">
      <p class="meta">${escapeHtml(tool.cat)} · ${escapeHtml(tool.maker)}</p>
      <h3>${escapeHtml(tool.name)}</h3>
      <p>${escapeHtml(tool.use)}</p>
      <a class="btn btn-cream" href="${escapeHtml(tool.href)}" target="_blank" rel="noopener">開啟官網</a>
    </article>
  `;
}

function render() {
  const raw = (document.getElementById('q').value || '').trim();
  const query = raw.toLowerCase();
  const cat = document.querySelector('.filter-btn.active')?.dataset.cat || '全部';
  const books = cat === '全部' ? matchPlaybooks(raw) : [];
  const list = TOOLS.filter((tool) => matchesTool(tool, query, cat));
  const count = document.getElementById('count');
  const combos = document.getElementById('combos');
  const results = document.getElementById('results');

  if (books.length) {
    count.textContent = `為「${raw}」配對 ${books.reduce((n, book) => n + book.combos.length, 0)} 種組合`;
    combos.innerHTML = books.map(playbookBlock).join('');
    results.innerHTML = list.map(toolCard).join('');
    return;
  }

  combos.innerHTML = '';
  count.textContent = list.length
    ? `顯示 ${list.length} 項工具`
    : (raw ? '沒有直接配對。可改寫用途，例如「我想作短劇」。' : '輸入用途後，會先出現組合與優缺點。');
  results.innerHTML = list.length
    ? list.map(toolCard).join('')
    : (raw ? '<p class="lead">沒有符合的項目。可改關鍵字，或透過 LINE 詢問適用情境。</p>' : '');
}

document.getElementById('filters').innerHTML = CATS.map((cat, i) => (
  `<button class="filter-btn${i === 0 ? ' active' : ''}" type="button" data-cat="${cat}">${cat}</button>`
)).join('');

document.getElementById('examples').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-q]');
  if (!btn) return;
  document.getElementById('q').value = btn.dataset.q;
  document.querySelectorAll('.filter-btn').forEach((el) => el.classList.toggle('active', el.dataset.cat === '全部'));
  render();
});

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
