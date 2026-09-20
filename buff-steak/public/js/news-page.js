function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNewsDate(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return dateStr || '';
  return `${y}年${m}月${d}日`;
}

function renderNewsCard(item) {
  const body = escapeHtml(item.body).replace(/\n/g, '<br />');
  return `
    <article class="news-card menu-card">
      <time class="news-date" datetime="${escapeHtml(item.date)}">${formatNewsDate(item.date)}</time>
      <h3 class="news-title">${escapeHtml(item.title)}</h3>
      <p class="news-body">${body}</p>
    </article>
  `;
}

async function fetchNews() {
  try {
    const res = await fetch('/api/news');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.items)) return data.items;
    }
  } catch {}
  const res = await fetch('/data/news.json');
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

async function loadNewsBlock() {
  const root = document.getElementById('newsList');
  const hero = document.getElementById('heroNews');
  if (!root && !hero) return;
  const limit = Number(root?.getAttribute('data-news-limit') || 0);

  try {
    let items = await fetchNews();
    if (hero) {
      if (items[0]) {
        hero.innerHTML = `<a href="#news" class="hover:text-white transition">最新消息 · ${escapeHtml(items[0].title)} →</a>`;
      } else {
        hero.innerHTML = '';
      }
    }
    if (!root) return;
    if (limit > 0) items = items.slice(0, limit);

    if (!items.length) {
      root.innerHTML = '<p class="text-mist text-sm text-center">目前尚無最新消息</p>';
      return;
    }
    root.innerHTML = items.map(renderNewsCard).join('');
  } catch (err) {
    if (root) root.innerHTML = '<p class="text-mist text-sm text-center">最新消息暫時無法載入，請稍後再試</p>';
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', loadNewsBlock);
