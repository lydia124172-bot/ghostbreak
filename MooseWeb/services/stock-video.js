const pexelsStock = require('./pexels-stock');
const pixabayStock = require('./pixabay-stock');

function configured() {
  return pexelsStock.configured() || pixabayStock.configured();
}

function providers() {
  return {
    pexels: pexelsStock.configured(),
    pixabay: pixabayStock.configured(),
  };
}

function searchPageUrl(query) {
  if (pexelsStock.configured()) return pexelsStock.searchPageUrl(query);
  if (pixabayStock.configured()) return pixabayStock.searchPageUrl(query);
  return pexelsStock.searchPageUrl(query);
}

async function fetchSceneVideo(scene, clipsDir, fileName, options = {}) {
  const queries = [
    scene.search_query,
    scene.search_query_alt,
    scene.subject_en,
  ]
    .map((q) => String(q || '').trim())
    .filter((q, i, arr) => q && arr.indexOf(q) === i);

  let lastFail = null;
  if (pexelsStock.configured()) {
    const result = await pexelsStock.fetchSceneVideo(scene, clipsDir, fileName);
    if (result.ok) return { ...result, stock_provider: 'pexels' };
    lastFail = result;
  }

  if (pixabayStock.configured()) {
    const result = await pixabayStock.fetchSceneVideo(scene, clipsDir, fileName, options);
    if (result.ok) return result;
    lastFail = result;
  }

  if (lastFail) return lastFail;

  return {
    ok: false,
    search_url: searchPageUrl(scene.search_query || 'video'),
    search_url_alt: scene.search_query_alt ? searchPageUrl(scene.search_query_alt) : null,
    message: '自動下載未命中，請用搜尋連結手動挑片',
  };
}

module.exports = {
  configured,
  providers,
  searchPageUrl,
  fetchSceneVideo,
  pexelsStock,
  pixabayStock,
};
