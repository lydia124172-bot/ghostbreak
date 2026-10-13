const fs = require('fs');
const path = require('path');
const brollPlanner = require('./broll-planner');
const stockVideo = require('./stock-video');
const brollRender = require('./broll-render');
const brollStill = require('./broll-still');
const clipTts = require('./clip-tts');

function statusPath(folder) {
  return path.join(folder, 'status.json');
}

function writeStatus(folder, patch) {
  const file = statusPath(folder);
  let state = {};
  if (fs.existsSync(file)) {
    try {
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      state = {};
    }
  }
  Object.assign(state, patch);
  fs.writeFileSync(file, JSON.stringify(state, null, 0), 'utf8');
  return state;
}

function buildManifestMarkdown(scenes, hasApi) {
  const lines = [
    '# 文案配素材對照表',
    '',
    hasApi
      ? '已嘗試用 Pexels／Pixabay API 自動下載（發片時請依各鏡來源標註作者，見 pexels_page）。'
      : '**未設定 PEXELS_API_KEY 或 PIXABAY_API_KEY**：請用每鏡搜尋連結手動下載影片，檔名建議與 local_file 一致。',
    '',
    '| 鏡 | 建議秒數 | 口播重點（可改寫） | 搜尋詞 | 素材 |',
    '|---:|---:|---|---|---|',
  ];
  for (const scene of scenes) {
    const mat = scene.local_file
      ? `clips/${scene.local_file}`
      : (scene.pexels_search_url || scene.search_url || '—');
    const narr = String(scene.narration || '').replace(/\|/g, '｜').replace(/\n/g, ' ');
    lines.push(
      `| ${scene.index} | ${scene.duration_sec} | ${narr.slice(0, 120)} | ${scene.search_query} | ${mat} |`,
    );
  }
  return lines.join('\n');
}

async function runJob(folder, scriptText) {
  writeStatus(folder, {
    status: 'running',
    progress: 8,
    message: '正在用 AI 把文案切成鏡頭…',
    scenes: [],
  });

  const scenes = await brollPlanner.planScenes(scriptText);
  writeStatus(folder, { progress: 35, message: `已規劃 ${scenes.length} 個鏡頭，正在處理素材…`, scenes });

  const clipsDir = path.join(folder, 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });
  const hasApi = stockVideo.configured();
  const usedIds = new Set();
  let downloaded = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const progress = 35 + Math.floor((i / scenes.length) * 55);
    writeStatus(folder, {
      progress,
      message: hasApi
        ? `正在下載第 ${i + 1}/${scenes.length} 鏡影片…`
        : `正在產生第 ${i + 1}/${scenes.length} 鏡搜尋連結…`,
      scenes,
    });

    scene.local_file = null;
    if (await applySceneDownload(scene, clipsDir, hasApi, usedIds)) downloaded += 1;
    if (hasApi && i < scenes.length - 1) await sleep(350);
  }

  const message = hasApi
    ? `完成：${downloaded}/${scenes.length} 鏡已自動下載影片，其餘請用搜尋連結手動補上。`
    : `完成：已產生 ${scenes.length} 鏡分鏡與 Pexels 搜尋連結，請手動下載影片（未使用圖片）。`;

  persistArtifacts(folder, scenes, hasApi, downloaded);
  const basePatch = {
    scenes,
    downloaded_count: downloaded,
    pexels_api: hasApi,
  };

  if (downloaded > 0) {
    try {
      await renderPreviewJob(folder, scenes);
    } catch (err) {
      writeStatus(folder, {
        ...basePatch,
        status: 'done',
        progress: 100,
        message: `${message} 自動合成預覽片失敗：${err.message || '未知錯誤'}（可手動按「合成預覽片」重試）。`,
        preview_error: err.message || '合成失敗',
      });
    }
    return;
  }

  writeStatus(folder, {
    ...basePatch,
    status: 'done',
    progress: 100,
    message,
  });
}

function persistArtifacts(folder, scenes, hasApi, downloaded) {
  const manifest = {
    created_at: new Date().toISOString(),
    scene_count: scenes.length,
    downloaded_count: downloaded,
    pexels_api: hasApi,
    scenes,
  };
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(folder, '對照表.md'),
    buildManifestMarkdown(scenes, hasApi),
    'utf8',
  );
}

function countDownloaded(scenes) {
  return scenes.filter((s) => s.local_file).length;
}

function sceneFileName(scene) {
  return scene.local_file || `scene-${String(scene.index).padStart(2, '0')}.mp4`;
}

async function applySceneDownload(scene, clipsDir, hasApi, usedIds) {
  const fileName = sceneFileName(scene);
  scene.pexels_search_url = stockVideo.searchPageUrl(scene.search_query);
  scene.pexels_search_url_alt = scene.search_query_alt
    ? stockVideo.searchPageUrl(scene.search_query_alt)
    : null;

  if (!hasApi) {
    scene.fetch_note = '請用主／備搜尋連結手動下載 landscape 影片，檔名建議 ' + fileName
      + (scene.query_warning ? '；' + scene.query_warning : '');
    return false;
  }

  const localPath = path.join(clipsDir, fileName);
  if (scene.local_file && fs.existsSync(localPath)) return true;

  const result = await stockVideo.fetchSceneVideo(scene, clipsDir, fileName, { usedIds });
  scene.pexels_page = result.pexels_page || null;
  scene.photographer = result.photographer || null;
  if (result.ok) {
    scene.local_file = result.local_file;
    scene.matched_query = result.matched_query || scene.search_query;
    scene.matched_tags = result.matched_tags || '';
    if (result.stock_id && usedIds) usedIds.add(String(result.stock_id));
    scene.fetch_note = '';
    return true;
  }
  if (brollStill.configured()) {
    try {
      await brollStill.generateSceneClip(scene, localPath);
      scene.local_file = fileName;
      scene.matched_tags = '';
      scene.stock_provider = 'gemini-still';
      scene.fetch_note = '素材庫沒有對題影片，已依旁白生成畫面';
      return true;
    } catch (err) {
      scene.fetch_note = `${result.message}；生成畫面也失敗：${err.message || '未知錯誤'}`;
      return false;
    }
  }
  scene.local_file = null;
  scene.fetch_note = result.message;
  if (result.search_url_alt) scene.pexels_search_url_alt = result.search_url_alt;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadAllScenes(folder) {
  if (!stockVideo.configured()) {
    throw new Error('請在 .env 設定 PIXABAY_API_KEY 或 PEXELS_API_KEY，才能一鍵下載。');
  }
  const state = JSON.parse(fs.readFileSync(statusPath(folder), 'utf8'));
  const scenes = state.scenes || [];
  if (!scenes.length) throw new Error('尚無分鏡，請先分析文案。');

  const clipsDir = path.join(folder, 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });
  const hasApi = true;
  let downloaded = countDownloaded(scenes);

  writeStatus(folder, {
    status: 'running',
    progress: 5,
    message: `準備下載 ${scenes.length} 鏡…`,
    scenes,
    downloaded_count: downloaded,
    pexels_api: true,
  });

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const progress = 5 + Math.floor(((i + 1) / scenes.length) * 90);
    writeStatus(folder, {
      progress,
      message: `正在下載第 ${i + 1}/${scenes.length} 鏡…`,
      scenes,
    });
    const had = Boolean(scene.local_file && fs.existsSync(path.join(clipsDir, scene.local_file)));
    const ok = await applySceneDownload(scene, clipsDir, hasApi);
    if (ok && !had) downloaded += 1;
    scenes[i] = scene;
    if (i < scenes.length - 1) await sleep(350);
  }

  persistArtifacts(folder, scenes, hasApi, downloaded);
  writeStatus(folder, {
    status: 'done',
    progress: 100,
    message: `完成：${downloaded}/${scenes.length} 鏡已有本機影片，其餘請改關鍵字後重試。`,
    scenes,
    downloaded_count: downloaded,
    pexels_api: true,
  });
  if (downloaded > 0) {
    try {
      await renderPreviewJob(folder, scenes);
    } catch (err) {
      writeStatus(folder, {
        status: 'done',
        preview_error: err.message || '合成失敗',
        message: `下載完成，但自動合成失敗：${err.message || '未知錯誤'}。請按「合成預覽片」重試。`,
      });
    }
  }
  return { downloaded, scene_count: scenes.length };
}

async function renderPreviewJob(folder, scenes) {
  const list = scenes || JSON.parse(fs.readFileSync(statusPath(folder), 'utf8')).scenes || [];
  writeStatus(folder, {
    status: 'rendering',
    progress: 5,
    message: clipTts.configured()
      ? '正在依各鏡口播合成旁白並接片…'
      : '正在把各鏡接成一支預覽片（無配音）…',
    scenes: list,
  });
  const rendered = await brollRender.renderPreview(folder, list, (p) => {
    const progress = p.total
      ? 5 + Math.floor((p.step / p.total) * 88)
      : 92;
    writeStatus(folder, {
      status: 'rendering',
      progress,
      message: p.message || '合成中…',
      scenes: list,
    });
  });
  const totalSec = Number(rendered && rendered.duration_sec) || list.reduce((n, s) => n + (Number(s.duration_sec) || 8), 0);
  const prev = JSON.parse(fs.readFileSync(statusPath(folder), 'utf8'));
  writeStatus(folder, {
    ...prev,
    status: 'done',
    progress: 100,
    preview_ready: true,
    preview_file: brollRender.PREVIEW_NAME,
    preview_error: null,
    message: clipTts.configured()
      ? `預覽片已合成（約 ${Math.round(totalSec)} 秒，每一鏡畫面跟這句旁白一樣長）。可播放或下載 broll-preview.mp4。`
      : `預覽片已合成（約 ${Math.round(totalSec)} 秒，僅畫面）。請設定 GEMINI_API_KEY 後重新合成以加入旁白。`,
    scenes: list,
  });
}

async function ressearchScene(folder, sceneIndex, searchQuery) {
  const query = String(searchQuery || '').trim().slice(0, 120);
  if (query.length < 2) throw new Error('搜尋詞太短');

  const state = JSON.parse(fs.readFileSync(statusPath(folder), 'utf8'));
  const scenes = state.scenes || [];
  const idx = scenes.findIndex((s) => Number(s.index) === Number(sceneIndex));
  if (idx < 0) throw new Error('找不到這一鏡');

  const scene = scenes[idx];
  scene.search_query = query;
  scene.query_warning = brollPlanner.queryWarnings(query, scene.search_query_alt);
  scene.matched_query = null;
  scene.pexels_page = null;
  scene.photographer = null;
  scene.local_file = null;

  const hasApi = stockVideo.configured();
  const clipsDir = path.join(folder, 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });

  if (hasApi) {
    writeStatus(folder, { scenes, message: `第 ${scene.index} 鏡：重新搜尋「${query}」…` });
    await applySceneDownload(scene, clipsDir, hasApi);
  } else {
    const fileName = sceneFileName(scene);
    scene.pexels_search_url = stockVideo.searchPageUrl(query);
    scene.fetch_note = '已更新搜尋詞，請點「Pexels 預覽」手動挑片，檔名建議 ' + fileName;
  }

  scenes[idx] = scene;
  const downloaded = countDownloaded(scenes);
  persistArtifacts(folder, scenes, hasApi, downloaded);
  writeStatus(folder, {
    status: 'done',
    scenes,
    downloaded_count: downloaded,
    message: hasApi
      ? `第 ${scene.index} 鏡已更新${scene.local_file ? '並下載' : '（請手動挑片）'}`
      : `第 ${scene.index} 鏡搜尋詞已更新`,
  });
  return scene;
}

module.exports = { runJob, writeStatus, ressearchScene, downloadAllScenes, renderPreviewJob };
