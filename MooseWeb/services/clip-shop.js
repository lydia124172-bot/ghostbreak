const crypto = require('crypto');
const clipStore = require('./clip-store');

function assertHttpUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch {
    throw new Error('網址無效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只接受 http 或 https');
  const host = url.hostname.toLowerCase();
  if (host === '169.254.169.254' || host.endsWith('.metadata.google.internal')) {
    throw new Error('不允許此網址');
  }
  return url.toString();
}

function getByPath(obj, path) {
  if (!path) return obj;
  return String(path).split('.').reduce((cur, key) => {
    if (cur == null) return undefined;
    return /^\d+$/.test(key) ? cur[Number(key)] : cur[key];
  }, obj);
}

function money(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (Number.isFinite(n)) return `特價 ${n} 元`;
  return String(value);
}

function pushUrl(list, value) {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) list.push(value);
  else if (value && typeof value === 'string' && value.startsWith('/')) list.push(value);
  else if (value && typeof value === 'object') {
    if (value.src) pushUrl(list, value.src);
    else if (value.url) pushUrl(list, value.url);
  }
}

function imagesOf(row, imageKey) {
  const urls = [];
  if (imageKey) {
    const raw = getByPath(row, imageKey);
    if (Array.isArray(raw)) raw.forEach((item) => pushUrl(urls, item));
    else pushUrl(urls, raw);
  }
  pushUrl(urls, row.image);
  pushUrl(urls, row.featured_image);
  if (Array.isArray(row.images)) row.images.forEach((item) => pushUrl(urls, item));
  return [...new Set(urls)].slice(0, 5);
}

function asList(data, listKey) {
  if (Array.isArray(data)) return data;
  if (listKey && Array.isArray(getByPath(data, listKey))) return getByPath(data, listKey);
  if (Array.isArray(data.products)) return data.products;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  throw new Error('回傳不是商品列表。請改對應欄位，或改用通用 API 對應。');
}

function publicShop(shop) {
  if (!shop) return { connected: false };
  return {
    connected: true,
    kind: shop.kind,
    label: shop.label || shop.kind,
    installed: Boolean(shop.installed),
  };
}

function demoProducts(origin) {
  const base = String(origin || '').replace(/\/$/, '');
  return [
    {
      id: 'demo-coffee',
      title: '手沖咖啡豆 200g',
      price: '特價 380 元',
      url: `${base}/clip`,
      images: [
        `${base}/clip-demo/product-1.jpg`,
        `${base}/clip-demo/product-2.jpg`,
        `${base}/clip-demo/product-3.jpg`,
      ],
    },
    {
      id: 'demo-model',
      title: '日常情境示範',
      price: '看圖說故事',
      url: `${base}/clip`,
      images: [`${base}/clip-demo/model.jpg`],
    },
  ];
}

function mapRow(row, shop, index) {
  const titleKey = shop.titleKey || 'title';
  const priceKey = shop.priceKey || 'price';
  const imageKey = shop.imageKey || '';
  const urlKey = shop.urlKey || 'url';
  const title = String(getByPath(row, titleKey) || row.name || row.title || `商品 ${index + 1}`).slice(0, 80);
  const price = money(getByPath(row, priceKey) || row.price || row.variants?.[0]?.price);
  const id = String(row.id || row.handle || row.sku || title);
  const url = String(getByPath(row, urlKey) || row.permalink || row.url || '');
  const images = imagesOf(row, imageKey);
  if (row.image && row.image.src) images.unshift(row.image.src);
  if (Array.isArray(row.variants) && row.variants[0]?.price && !price) {
    /* already handled */
  }
  return {
    id,
    title,
    price: price || money(row.variants?.[0]?.price),
    url,
    images: [...new Set(images)].slice(0, 5),
  };
}

async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`商店回傳 ${res.status}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('商店回傳不是 JSON');
    }
  } finally {
    clearTimeout(timer);
  }
}

function shopifyAppConfigured() {
  return Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
}

function shopifyHost(input) {
  let host = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) throw new Error('請填 Shopify 網域，例如 store.myshopify.com');
  if (!host.includes('.')) host = `${host}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) {
    throw new Error('請填 xxx.myshopify.com');
  }
  return host;
}

function shopifyUrl(shop) {
  const host = shopifyHost(shop.shopDomain);
  return `https://${host}/admin/api/2024-10/products.json?limit=30`;
}

function verifyShopifyHmac(query, secret) {
  const hmac = String(query.hmac || '');
  const rest = { ...query };
  delete rest.hmac;
  delete rest.signature;
  const message = Object.keys(rest).sort().map((key) => {
    const val = rest[key];
    return `${key}=${Array.isArray(val) ? val.join(',') : val}`;
  }).join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(hmac, 'utf8'));
  } catch {
    return false;
  }
}

function shopifyInstallUrl(origin, sid, shopInput, query) {
  if (!shopifyAppConfigured()) return null;
  if (query && query.hmac && !verifyShopifyHmac(query, process.env.SHOPIFY_API_SECRET)) {
    throw new Error('Shopify 安裝驗證失敗');
  }
  const host = shopifyHost(shopInput || query?.shop);
  const state = crypto.randomBytes(16).toString('hex');
  clipStore.putOauth(state, { sid, platform: 'shopify', shop: host });
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY,
    scope: 'read_products',
    redirect_uri: `${origin}/api/clip/shop/oauth/shopify/callback`,
    state,
  });
  return `https://${host}/admin/oauth/authorize?${params}`;
}

async function finishShopifyOauth(origin, query) {
  if (!shopifyAppConfigured()) throw new Error('尚未設定 Shopify 應用');
  if (query.error) throw new Error(String(query.error_description || query.error));
  if (!verifyShopifyHmac(query, process.env.SHOPIFY_API_SECRET)) {
    throw new Error('Shopify 授權驗證失敗');
  }
  const row = clipStore.takeOauth(query.state);
  if (!row || row.platform !== 'shopify') throw new Error('授權已過期，請再安裝一次');
  const host = shopifyHost(query.shop || row.shop);
  if (!query.code) throw new Error('Shopify 授權未完成');
  const res = await fetch(`https://${host}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code: query.code,
    }),
  });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { throw new Error('Shopify 授權失敗'); }
  if (!res.ok || !body.access_token) throw new Error(body.error || 'Shopify 授權失敗');
  clipStore.putShop(row.sid, {
    kind: 'shopify',
    shopDomain: host,
    token: body.access_token,
    label: host,
    installed: true,
    connectedAt: new Date().toISOString(),
  });
  return row.sid;
}

function wooUrl(shop) {
  const base = assertHttpUrl(shop.baseUrl).replace(/\/$/, '');
  return `${base}/wp-json/wc/v3/products?per_page=30`;
}

async function loadRemote(shop) {
  if (shop.kind === 'shopify') {
    const data = await fetchJson(shopifyUrl(shop), {
      'X-Shopify-Access-Token': shop.token || '',
      Accept: 'application/json',
    });
    return asList(data, 'products').map((row, i) => mapRow({
      ...row,
      price: row.variants?.[0]?.price,
      image: row.image,
      images: row.images,
      url: row.handle ? `https://${String(shop.shopDomain || '').replace(/^https?:\/\//, '')}/products/${row.handle}` : '',
    }, { ...shop, titleKey: 'title', priceKey: 'price' }, i));
  }
  if (shop.kind === 'woocommerce') {
    const key = shop.key || '';
    const secret = shop.secret || '';
    const basic = Buffer.from(`${key}:${secret}`).toString('base64');
    const data = await fetchJson(wooUrl(shop), {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
    });
    return asList(data, '').map((row, i) => mapRow({
      ...row,
      title: row.name,
      url: row.permalink,
    }, { ...shop, titleKey: 'name', priceKey: 'price', imageKey: 'images.0.src' }, i));
  }
  const listUrl = assertHttpUrl(shop.listUrl);
  const headers = { Accept: 'application/json' };
  if (shop.token) headers.Authorization = shop.token.includes(' ') ? shop.token : `Bearer ${shop.token}`;
  const data = await fetchJson(listUrl, headers);
  return asList(data, shop.listKey || '').slice(0, 40).map((row, i) => mapRow(row, shop, i));
}

function connect(sid, body, origin) {
  const kind = String(body?.kind || '').trim();
  if (!['demo', 'generic', 'shopify', 'woocommerce'].includes(kind)) {
    throw new Error('請選擇商店類型');
  }
  const shop = { kind, connectedAt: new Date().toISOString() };
  if (kind === 'demo') {
    shop.label = '示範商店';
  } else if (kind === 'shopify') {
    shop.shopDomain = shopifyHost(body.shopDomain);
    shop.token = String(body.token || '').trim();
    shop.label = shop.shopDomain;
    if (!shop.token) throw new Error('請填 Shopify Admin API token，或改按「安裝到 Shopify」');
  } else if (kind === 'woocommerce') {
    shop.baseUrl = assertHttpUrl(body.baseUrl);
    shop.key = String(body.key || '').trim();
    shop.secret = String(body.secret || '').trim();
    shop.label = shop.baseUrl;
    if (!shop.key || !shop.secret) throw new Error('請填 WooCommerce 金鑰');
  } else {
    shop.listUrl = assertHttpUrl(body.listUrl);
    shop.token = String(body.token || '').trim();
    shop.listKey = String(body.listKey || '').trim();
    shop.titleKey = String(body.titleKey || 'title').trim() || 'title';
    shop.priceKey = String(body.priceKey || 'price').trim() || 'price';
    shop.imageKey = String(body.imageKey || '').trim();
    shop.urlKey = String(body.urlKey || 'url').trim();
    shop.label = shop.listUrl;
  }
  clipStore.putShop(sid, shop);
  return shop;
}

async function products(sid, origin) {
  const shop = clipStore.getShop(sid);
  if (!shop) throw new Error('尚未連接商店。也可直接上傳圖片，不必接商店。');
  const rows = shop.kind === 'demo' ? demoProducts(origin) : await loadRemote(shop);
  const list = rows.filter((row) => row.title).slice(0, 40);
  clipStore.putShopProducts(sid, list);
  return list.map((row) => ({
    id: row.id,
    title: row.title,
    price: row.price,
    url: row.url,
    image: row.images[0] || '',
    images: row.images,
  }));
}

function status(sid) {
  return {
    ...publicShop(clipStore.getShop(sid)),
    shopifyApp: shopifyAppConfigured(),
  };
}

function disconnect(sid) {
  clipStore.putShop(sid, null);
  clipStore.putShopProducts(sid, []);
}

function findProduct(sid, id) {
  return clipStore.getShopProducts(sid).find((row) => String(row.id) === String(id)) || null;
}

function allowedImage(sid, src) {
  const want = String(src || '');
  return clipStore.getShopProducts(sid).some((row) => (row.images || []).includes(want));
}

async function fetchImage(sid, src) {
  if (!allowedImage(sid, src)) throw new Error('圖片不在已載入的商品裡');
  const url = assertHttpUrl(src);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('商品圖下載失敗');
    const mime = res.headers.get('content-type') || 'image/jpeg';
    if (!mime.startsWith('image/')) throw new Error('不是圖片');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error('圖片太大');
    return { mime, buf };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  connect,
  products,
  status,
  disconnect,
  findProduct,
  fetchImage,
  shopifyAppConfigured,
  shopifyInstallUrl,
  finishShopifyOauth,
};
