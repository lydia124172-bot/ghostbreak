const TRADES = [
  {
    id: 'resto',
    name: '餐飲店家',
    lead: '先對齊菜單、訂位與外帶怎麼賣，再決定官網、LINE 與留單要接哪一段。',
    items: [
      { name: '堂食套餐', note: '分店、座位與當日供應要能對外說明。' },
      { name: '外帶', note: '客人要知道取餐方式與等候時間。' },
      { name: '訂位', note: '時段、人數與是否需確認，不能只留電話。' },
      { name: '當日公告', note: '公休、活動、售完要能自己更新。' },
    ],
    systems: [
      {
        name: '官網訂位',
        need: '客人從搜尋或名片進來，能看菜單、選時段、留下訂位。',
        saas: '品牌官網（八斧牛排式：分店、訂位、公告）',
        status: '已上線',
        href: 'https://steak.bafuholdings.com/',
      },
      {
        name: 'LINE 官方帳號',
        need: '詢問訂位、外帶與營業時間，要有固定回覆入口。',
        saas: '目前以 LINE 官方帳號人工回覆，尚未做成店家後台。',
        status: '籌備中',
        href: '/hire',
      },
      {
        name: '留單通知',
        need: '網頁留下姓名與需求後，店家立刻收到 LINE 或 Email，並回覆已收到。',
        saas: '店家留單與回覆',
        status: '籌備中',
        href: '/saas',
      },
    ],
  },
  {
    id: 'studio',
    name: '工作室／個人品牌',
    lead: '課程、諮詢與作品要能被看見，留資後要跟得上，而不是只發社群。',
    items: [
      { name: '課程或工作坊', note: '班次、對象與報名入口要寫清楚。' },
      { name: '諮詢或一對一', note: '時段與適合誰，避免無效來回。' },
      { name: '作品展示', note: '案例要能連到下一步，而不是相簿而已。' },
      { name: '預約', note: '客人留下聯絡方式後，要有人跟進。' },
    ],
    systems: [
      {
        name: '作品頁',
        need: '對外展示案例與服務範圍，導向諮詢。',
        saas: '品牌官網（接案）',
        status: '已上線',
        href: '/hire',
      },
      {
        name: '留資表單',
        need: '姓名、需求與聯絡方式進名單，而不是私訊才算數。',
        saas: '企業獲客助理',
        status: '籌備中',
        href: '/saas',
      },
      {
        name: 'LINE 跟進',
        need: '表單或官方帳號進來的詢問，要通知負責人並可回覆已收到。',
        saas: '企業獲客助理',
        status: '籌備中',
        href: '/saas',
      },
    ],
  },
  {
    id: 'creator',
    name: '短影音／帶貨',
    lead: '內容、上架與成交要分開看。先有導流，再把人收到自己的名單。',
    items: [
      { name: '腳本與短片', note: '為商品或人設產出可發的內容。' },
      { name: '商品上架', note: '標題、賣點與賣場連結要能對上庫存。' },
      { name: '直播成交', note: '講稿、連結與下單路徑要在開播前備好。' },
    ],
    systems: [
      {
        name: '內容導流',
        need: '先對該用哪些 AI 做腳本、封面與短片，再發到平台。',
        saas: 'MooseWeb AI research engine',
        status: '已上線',
        href: '/research',
      },
      {
        name: '商品短片發文',
        need: '商品圖做成直式短片與文案，下載後自己發到社群。',
        saas: 'MooseClip 商品短片（商店連接與自動發文建置中）',
        status: '已上線',
        href: '/clip',
      },
      {
        name: '模特兒換裝',
        need: '上傳模特兒照與衣服圖，做成換裝靜態圖，供選款參考。',
        saas: '模特兒換裝（與商品短片進階圖共用 1 點）',
        status: '已上線',
        href: '/dress',
      },
      {
        name: '直播講稿',
        need: '開播前先備好行業或商品的講稿、鉤子與收尾。',
        saas: '直播稿智能體',
        status: '已上線',
        href: '/live',
      },
      {
        name: '個人IP與頻道',
        need: '貼簡介，先定自己是誰，再寫四週每日攻略與各平台怎麼拍。',
        saas: '個人IP智能體',
        status: '已上線',
        href: '/ip',
      },
      {
        name: '熱問短片',
        need: '填行業，查現在常問的題與國外新思維，整理成可拍短片的清單。',
        saas: '熱問短片智能體',
        status: '已上線',
        href: '/hot',
      },
      {
        name: '劇本質感廣告',
        need: '貼上分鏡或旁白，做成較有質感的廣告。目前建置中。',
        saas: 'StoryClip 劇本廣告（建置中）',
        status: '建置中',
        href: '/story',
      },
      {
        name: 'AI 短劇一鍵',
        need: '填主題，寫三鏡並接成一支短劇。',
        saas: 'DramaClip AI短劇（建置中）',
        status: '建置中',
        href: '/drama',
      },
      {
        name: '賣場連結',
        need: '平台內成交仍走蝦皮、TikTok 等既有賣場。',
        saas: 'AI 短影音電商／帶貨課（教學，不是交易系統）',
        status: '籌備中',
        href: '/courses',
      },
      {
        name: '名單回收',
        need: '從影片或簡介把人導到自己的落地頁留單，避免名單只留在平台。',
        saas: '內容轉留單落地頁',
        status: '尚缺',
        href: '/hire',
      },
    ],
  },
  {
    id: 'service',
    name: '到府服務',
    lead: '打掃、造型、維修要先對服務項目與地區，再決定需求怎麼進來、案子怎麼派。',
    items: [
      { name: '居家打掃', note: '空間、時段與是否含加價項目。' },
      { name: '化妝造型', note: '場次、風格與出發前確認。' },
      { name: '到府維修', note: '故障類型、地址與可否當日。' },
    ],
    systems: [
      {
        name: '發需求',
        need: '需求方說明服務、地區與時間，留下聯絡方式。',
        saas: '找人幫忙（需求留單）',
        status: '已上線',
        href: '/match#demand',
      },
      {
        name: '接案登記',
        need: '服務方登記項目與區域，通過後才接到通知。',
        saas: '找人幫忙（服務方登記）',
        status: '已上線',
        href: '/match#supply',
      },
      {
        name: '專人聯繫',
        need: '目前由專人配對，尚未開放雙方自行配對或自動派單。',
        saas: '找人幫忙',
        status: '籌備中',
        href: '/match',
      },
    ],
  },
];

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function tradeById(id) {
  return TRADES.find((row) => row.id === id) || TRADES[0];
}

function statusClass(status) {
  if (status === '已上線') return 'status-ok';
  if (status === '尚缺') return 'status-err';
  return 'map-status-wait';
}

function renderTrades(activeId) {
  document.getElementById('trades').innerHTML = TRADES.map((trade) => (
    `<button class="example-btn${trade.id === activeId ? ' active' : ''}" type="button" data-trade="${trade.id}">${escapeHtml(trade.name)}</button>`
  )).join('');
}

function renderMap(trade) {
  const items = trade.items.map((item) => (
    `<li><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.note)}</span></li>`
  )).join('');
  const systems = trade.systems.map((row) => {
    const link = row.href
      ? `<a href="${escapeHtml(row.href)}">${escapeHtml(row.saas)}</a>`
      : escapeHtml(row.saas);
    return `
      <article class="map-row">
        <div>
          <p class="meta">獲客系統</p>
          <h3>${escapeHtml(row.name)}</h3>
          <p>${escapeHtml(row.need)}</p>
        </div>
        <div>
          <p class="meta">對應 SaaS</p>
          <p class="map-saas">${link}</p>
          <p class="${statusClass(row.status)}">${escapeHtml(row.status)}</p>
        </div>
      </article>
    `;
  }).join('');
  document.getElementById('map').innerHTML = `
    <article class="combo-card map-card">
      <p class="meta">行業</p>
      <h2>${escapeHtml(trade.name)}</h2>
      <p class="combo-fit">${escapeHtml(trade.lead)}</p>
      <h3>服務內容／品項</h3>
      <ul class="map-items">${items}</ul>
      <h3>要會的獲客系統</h3>
      <div class="map-systems">${systems}</div>
    </article>
  `;
}

function currentTrade() {
  const id = (location.hash || '').replace(/^#/, '');
  return tradeById(id);
}

function show(trade) {
  if (location.hash.replace(/^#/, '') !== trade.id) {
    history.replaceState(null, '', `#${trade.id}`);
  }
  renderTrades(trade.id);
  renderMap(trade);
}

document.getElementById('trades').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-trade]');
  if (!btn) return;
  show(tradeById(btn.dataset.trade));
});

window.addEventListener('hashchange', () => show(currentTrade()));
show(currentTrade());
