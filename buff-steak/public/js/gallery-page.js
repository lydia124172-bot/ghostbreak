async function loadGalleryPage() {
  const photoGrid = document.getElementById('photoGrid');
  const videoGrid = document.getElementById('videoGrid');
  if (!photoGrid || !videoGrid) return;

  try {
    let data = null;
    try {
      const res = await fetch('/api/gallery');
      if (res.ok) data = await res.json();
    } catch {}
    if (!data) {
      const res = await fetch('/data/gallery.json');
      data = await res.json();
    }

    const photos = (data.photos || []).filter((p) => p.src && String(p.src).trim());
    if (photos.length) {
      photoGrid.innerHTML = photos.map((p) => `
        <figure class="gallery-photo">
          <img src="${p.src}" alt="${p.caption || '八斧牛排'}" loading="lazy" />
          ${p.caption ? `<figcaption>${p.caption}</figcaption>` : ''}
        </figure>
      `).join('');
    } else {
      photoGrid.innerHTML = '<p class="text-mist text-sm col-span-full text-center">照片陸續更新中</p>';
    }

    const videos = (data.videos || []).filter((v) => v.url && String(v.url).trim());
    if (videos.length) {
      videoGrid.innerHTML = videos.map((v) => buildVideoHtml(v)).join('');
    } else {
      videoGrid.innerHTML = '<p class="text-mist text-sm col-span-full text-center">影片陸續更新中</p>';
    }
  } catch (err) {
    photoGrid.innerHTML = '<p class="text-mist text-sm text-center">影像暫時無法載入，請稍後再試</p>';
    videoGrid.innerHTML = '';
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', loadGalleryPage);
