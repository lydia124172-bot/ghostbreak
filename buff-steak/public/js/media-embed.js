/**
 * 將影片連結轉成可嵌入的 iframe（YouTube / Shorts / Vimeo）
 */
function parseVideoEmbed(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;

  let match = raw.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (match) {
    return {
      type: 'iframe',
      src: `https://www.youtube.com/embed/${match[1]}?rel=0`,
      title: 'YouTube 影片',
    };
  }

  match = raw.match(/vimeo\.com\/(\d+)/);
  if (match) {
    return {
      type: 'iframe',
      src: `https://player.vimeo.com/video/${match[1]}`,
      title: 'Vimeo 影片',
    };
  }

  if (/^https?:\/\//i.test(raw)) {
    return { type: 'link', href: raw };
  }

  return null;
}

function buildVideoHtml(item) {
  const embed = parseVideoEmbed(item.url);
  const title = item.title || '影片';
  const note = item.note ? `<p class="text-xs text-mist mt-2">${item.note}</p>` : '';

  if (!embed) {
    return `<div class="menu-card text-sm text-mist">尚未設定影片連結</div>`;
  }

  if (embed.type === 'iframe') {
    return `
      <div class="video-card">
        <p class="text-sm text-gold mb-3">${title}</p>
        <div class="video-embed">
          <iframe src="${embed.src}" title="${title}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>
        </div>
        ${note}
      </div>`;
  }

  return `
    <div class="menu-card">
      <p class="text-sm font-semibold mb-2">${title}</p>
      <a href="${embed.href}" target="_blank" rel="noopener" class="text-gold text-sm underline">開啟影片連結 →</a>
      ${note}
    </div>`;
}
