const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'journal.json');

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function loadPosts() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function savePosts(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
}

function makeSlug(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function safeImage(raw) {
  const u = String(raw || '').trim();
  if (!u || u.length > 300 || u.includes('..')) return '';
  if (/^https:\/\/[^\s"'<>]+$/i.test(u) || /^\/uploads\/products\/[A-Za-z0-9._-]+$/.test(u) || /^\/images\/[A-Za-z0-9._-]+$/.test(u)) return u;
  return '';
}

function isPublished(post) {
  return post.status === 'published';
}

function publishedPosts() {
  return loadPosts()
    .filter(isPublished)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

function findPublished(slug) {
  return publishedPosts().find((row) => row.slug === slug) || null;
}

function savePost(input) {
  const list = loadPosts();
  const idx = input.id ? list.findIndex((row) => row.id === input.id) : -1;
  const prev = idx >= 0 ? list[idx] : null;
  const title = String(input.title || '').trim().slice(0, 100);
  const body = String(input.body || '').replace(/\r\n/g, '\n').trim().slice(0, 50000);
  if (!title) fail('請填文章標題');
  if (!body) fail('請填文章內容');
  const slug = makeSlug(input.slug) || makeSlug(title);
  if (!slug) fail('網址代稱只能用中英文或數字');
  if (list.some((row, i) => i !== idx && row.slug === slug)) fail('這個網址代稱已經有文章在用，請換一個');
  const status = input.status === 'published' ? 'published' : 'draft';
  const now = new Date().toISOString();
  const post = {
    id: prev ? prev.id : `J-${Date.now()}`,
    slug,
    title,
    summary: String(input.summary || '').trim().replace(/\s+/g, ' ').slice(0, 160),
    cover: safeImage(input.cover),
    keywords: String(input.keywords || '').trim().slice(0, 200),
    body,
    status,
    createdAt: prev ? prev.createdAt : now,
    publishedAt: status === 'published' ? (prev && prev.publishedAt) || now : (prev && prev.publishedAt) || '',
    updatedAt: now,
  };
  if (idx >= 0) list[idx] = post;
  else list.unshift(post);
  savePosts(list);
  return post;
}

function removePost(id) {
  savePosts(loadPosts().filter((row) => row.id !== id));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, (_m, label, href) => {
    const external = /^https?:\/\//i.test(href);
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  return out;
}

function renderBody(body) {
  const blocks = String(body || '').split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return '';
    const first = lines[0];
    const img = first.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (lines.length === 1 && img) {
      const src = safeImage(img[2]);
      if (!src) return '';
      const cap = img[1] ? `<figcaption>${escapeHtml(img[1])}</figcaption>` : '';
      return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(img[1])}" loading="lazy">${cap}</figure>`;
    }
    if (/^###\s+/.test(first) && lines.length === 1) return `<h3>${inline(first.replace(/^###\s+/, ''))}</h3>`;
    if (/^##\s+/.test(first) && lines.length === 1) return `<h2>${inline(first.replace(/^##\s+/, ''))}</h2>`;
    if (lines.every((line) => /^[-・•]\s*/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^[-・•]\s*/, ''))}</li>`).join('')}</ul>`;
    }
    if (lines.every((line) => /^>\s?/.test(line))) {
      return `<blockquote>${lines.map((line) => inline(line.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

function plainText(body) {
  return String(body || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*・•-]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function describe(post) {
  return post.summary || plainText(post.body).slice(0, 150);
}

function firstImage(post) {
  if (post.cover) return post.cover;
  const m = String(post.body || '').match(/!\[[^\]]*\]\(([^)\s]+)\)/);
  return m ? safeImage(m[1]) : '';
}

function absolute(origin, url) {
  if (!url) return `${origin}/og.jpg`;
  return /^https?:\/\//i.test(url) ? url : `${origin}${url}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function shell({ title, description, canonical, image, type = 'website', jsonLd, main, page }) {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="${type}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <link rel="icon" href="/logo.png" type="image/png" />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Noto+Sans+TC:wght@400;500;600&family=Noto+Serif+TC:wght@500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/site.css?v=24" />
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body data-page="${page}">
  <div data-shell="header"></div>
  <main class="wrap journal">
${main}
  </main>
  <div data-shell="footer"></div>
  <script src="/js/site.js?v=19"></script>
</body>
</html>`;
}

function renderList(origin, siteName) {
  const posts = publishedPosts();
  const items = posts.map((post) => {
    const img = firstImage(post);
    return `
    <article class="journal-card">
      ${img ? `<a class="journal-thumb" href="/journal/${encodeURIComponent(post.slug)}"><img src="${escapeHtml(img)}" alt="${escapeHtml(post.title)}" loading="lazy"></a>` : ''}
      <div>
        <p class="news-title">${escapeHtml(formatDate(post.publishedAt))}</p>
        <h2><a href="/journal/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
        <p class="lead">${escapeHtml(describe(post))}</p>
        <a class="more" href="/journal/${encodeURIComponent(post.slug)}">閱讀全文</a>
      </div>
    </article>`;
  }).join('') || '<p class="empty-note">第一篇部落格準備中。</p>';
  const description = `${siteName}主編部落格：一位教了二十六年英文的牛排館老闆，分享日本、韓國、泰國、台灣的生活好物、使用心得與挑選眼光。`;
  return shell({
    title: `主編部落格 — ${siteName}`,
    description,
    canonical: `${origin}/journal`,
    image: `${origin}/og.jpg`,
    page: 'journal',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: `${siteName}主編部落格`,
      url: `${origin}/journal`,
      description,
      blogPost: posts.slice(0, 20).map((post) => ({
        '@type': 'BlogPosting',
        headline: post.title,
        url: `${origin}/journal/${encodeURIComponent(post.slug)}`,
        datePublished: post.publishedAt,
      })),
    },
    main: `
    <section class="page-head">
      <p class="issue-folio"><span>JOURNAL</span><span>主編部落格</span></p>
      <h1>主編部落格</h1>
      <p class="lead">用過的，才寫下來。好物背後的故事、使用心得與挑選眼光。</p>
    </section>
    <section class="journal-list">${items}
    </section>`,
  });
}

function renderPost(post, origin, siteName) {
  const url = `${origin}/journal/${encodeURIComponent(post.slug)}`;
  const description = describe(post);
  const image = absolute(origin, firstImage(post));
  const others = publishedPosts().filter((row) => row.id !== post.id).slice(0, 3);
  const more = others.length ? `
    <aside class="journal-more">
      <h2>更多文章</h2>
      <ul>${others.map((row) => `<li><a href="/journal/${encodeURIComponent(row.slug)}">${escapeHtml(row.title)}</a></li>`).join('')}</ul>
    </aside>` : '';
  return shell({
    title: `${post.title} — ${siteName}`,
    description,
    canonical: url,
    image,
    type: 'article',
    page: 'journal',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description,
      image: [image],
      datePublished: post.publishedAt,
      dateModified: post.updatedAt || post.publishedAt,
      keywords: post.keywords || undefined,
      mainEntityOfPage: url,
      author: { '@type': 'Person', name: '紫瑄' },
      publisher: { '@type': 'Organization', name: siteName, logo: { '@type': 'ImageObject', url: `${origin}/logo.png` } },
    },
    main: `
    <article class="journal-post">
      <p class="issue-folio"><span><a href="/journal">主編部落格</a></span><span>${escapeHtml(formatDate(post.publishedAt))}</span></p>
      <h1>${escapeHtml(post.title)}</h1>
      ${post.summary ? `<p class="lead">${escapeHtml(post.summary)}</p>` : ''}
      ${post.cover ? `<img class="journal-cover" src="${escapeHtml(post.cover)}" alt="${escapeHtml(post.title)}">` : ''}
      <div class="journal-body">
${renderBody(post.body)}
      </div>
      <p class="journal-cta"><a class="btn btn-ink" href="/issue">看本月開箱</a>　<a class="more" href="/journal">回部落格列表</a></p>
    </article>${more}`,
  });
}

module.exports = {
  loadPosts,
  publishedPosts,
  findPublished,
  savePost,
  removePost,
  renderList,
  renderPost,
};
