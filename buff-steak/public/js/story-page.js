async function loadStoryPage() {
  const root = document.getElementById('storyContent');
  if (!root) return;

  try {
    const res = await fetch('/data/story.json');
    const data = await res.json();

    document.getElementById('storyTitle').textContent = data.title || '八斧的起源';
    document.getElementById('storySubtitle').textContent = data.subtitle || '';
    document.getElementById('storyLead').textContent = data.lead || '';

    const sections = (data.sections || []).map((s) => `
      <section class="mb-8">
        <h2 class="text-gold text-lg font-semibold mb-3">${s.heading}</h2>
        <p class="text-mist text-sm leading-relaxed">${s.body}</p>
      </section>
    `).join('');

    const highlights = (data.highlights || []).map((h) =>
      `<span class="inline-block px-3 py-1 rounded-full border border-line text-xs text-mist mr-2 mb-2">${h}</span>`
    ).join('');

    const founderNote = data.founderNote
      ? `<p class="text-center text-xs text-mist mt-6 tracking-wider">${data.founderNote}</p>`
      : '';

    root.innerHTML = `
      ${sections}
      ${highlights ? `<div class="mt-10 pt-6 border-t border-line text-center">${highlights}</div>` : ''}
      ${founderNote}
    `;
  } catch (err) {
    root.innerHTML = '<p class="text-mist text-sm">無法載入故事內容，請檢查 data/story.json</p>';
  }
}

document.addEventListener('DOMContentLoaded', loadStoryPage);
