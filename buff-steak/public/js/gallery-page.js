async function loadGalleryPage() {
  const photoGrid = document.getElementById('photoGrid');
  const videoGrid = document.getElementById('videoGrid');
  if (!photoGrid || !videoGrid) return;

  try {
    const res = await fetch('/data/gallery.json');
    const data = await res.json();

    const photos = (data.photos || []).filter((p) => p.src && String(p.src).trim());
    if (photos.length) {
      photoGrid.innerHTML = photos.map((p) => `
        <figure class="gallery-photo">
          <img src="${p.src}" alt="${p.caption || '八斧牛排'}" loading="lazy" />
          ${p.caption ? `<figcaption>${p.caption}</figcaption>` : ''}
        </figure>
      `).join('');
    } else {
      photoGrid.innerHTML = '<p class="text-mist text-sm col-span-full text-center">尚無照片，請編輯 data/gallery.json 或將圖片放入 images/gallery/</p>';
    }

    const videos = (data.videos || []).filter((v) => v.url && String(v.url).trim());
    if (videos.length) {
      videoGrid.innerHTML = videos.map((v) => buildVideoHtml(v)).join('');
    } else {
      videoGrid.innerHTML = '<p class="text-mist text-sm col-span-full">尚無影片。請編輯 <code class="text-xs bg-black/30 px-1 rounded">public/data/gallery.json</code>，在 videos 貼上 YouTube 連結。</p>';
    }
  } catch (err) {
    photoGrid.innerHTML = '<p class="text-mist text-sm">無法載入相簿設定</p>';
    videoGrid.innerHTML = '';
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', loadGalleryPage);
