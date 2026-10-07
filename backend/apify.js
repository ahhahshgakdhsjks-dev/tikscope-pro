// TikScope Pro — konektor Apify (pakai fetch bawaan Node 18+, tanpa SDK tambahan)
// Dukung: TikTok Shop search + trending, Shopee search. Normalisasi ke format frontend.
const APIFY_BASE = 'https://api.apify.com/v2';

function token() { return process.env.APIFY_API_TOKEN || ''; }
function hasToken() { const t = token(); return t.startsWith('apify_api_') && t.length > 20; }

// Jalankan actor synchronously dan kembalikan items (tunggu sampai FINISHED)
async function runActorSync(actorId, input, timeoutSec = 120) {
  const t = token();
  if (!hasToken()) throw new Error('APIFY_API_TOKEN belum diisi (format apify_api_...)');
  const runRes = await fetch(`${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${t}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input })
  });
  if (!runRes.ok) throw new Error('Apify run gagal: ' + runRes.status + ' ' + (await runRes.text()).slice(0, 300));
  const run = (await runRes.json()).data;
  const deadline = Date.now() + timeoutSec * 1000;
  let status = run.status, datasetId = run.defaultDatasetId;
  while (['RUNNING', 'READY'].includes(status)) {
    if (Date.now() > deadline) throw new Error('Apify timeout >' + timeoutSec + 's (runId ' + run.id + ')');
    await new Promise(r => setTimeout(r, 4000));
    const s = await fetch(`${APIFY_BASE}/actor-runs/${run.id}?token=${t}`).then(r => r.json());
    status = s.data.status; datasetId = s.data.defaultDatasetId;
  }
  if (status !== 'SUCCEEDED') throw new Error('Apify run status: ' + status + ' (runId ' + run.id + ')');
  const items = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?format=json&clean=true&token=${t}`).then(r => r.json());
  return { runId: run.id, items: Array.isArray(items) ? items : [] };
}

// --- TikTok Shop: sian.agency/tiktok-shop-scraper, operation searchProducts ---
// input resmi: { operation:'searchProducts', keyword, region:'MY', maxPages:2, sortBy?... }
// region ID tidak didukung actor ini (dihapus 26-08-2026) → auto-fallback ke MY + flag di notes.
async function searchTikTok(keyword, region = 'ID', limit = 30) {
  const actor = process.env.TIKTOK_ACTOR || 'sian.agency/tiktok-shop-scraper';
  let effRegion = (region || 'ID').toUpperCase();
  let notes = '';
  if (['ID', 'UK', 'GB'].includes(effRegion)) { effRegion = 'MY'; notes = 'Region ID tidak didukung actor sian.agency (per 26-08-2026), dipakai MY sebagai proxy tren SEA.'; }
  const maxPages = Math.min(5, Math.max(1, Math.ceil(limit / 20)));
  const { runId, items } = await runActorSync(actor, { operation: 'searchProducts', keyword, region: effRegion, maxPages });
  return { runId, notes, data: items.slice(0, limit).map((x, i) => ({
    title: x.title || x.productName || x.name || (keyword + ' #' + (i + 1)),
    price: +(x.price ?? x.minPrice ?? 0),
    sold: +(x.soldCount ?? x.unitsSold ?? x.sales ?? 0),
    shop: (x.shopName || x.sellerName || x.storeName || 'TikTok Shop'),
    rating: +(x.rating || 0), reviews: +(x.reviewCount || 0),
    url: x.productUrl || x.url || '', image: x.imageUrl || x.thumbnail || '',
    category: x.category || '', region: effRegion
  }))};
}

// --- TikTok trending winner: apivault_labs/tiktok-shop-scraper { trending:true, trendingLimit } ---
async function trendingTikTok(limit = 30) {
  const actor = process.env.TIKTOK_TRENDING_ACTOR || 'apivault_labs/tiktok-shop-scraper';
  const { runId, items } = await runActorSync(actor, { trending: true, trendingLimit: Math.min(limit, 50) }, 150);
  return { runId, data: items.slice(0, limit).map(x => ({
    title: x.title || 'Trending', price: +(x.price ?? 0), sold: +(x.soldCount ?? 0),
    shop: x.shopName || 'TikTok Shop', rating: +(x.rating || 0), reviews: 0,
    url: x.productUrl || '', image: '', category: '', gmv: +(x.gmvEstimate || 0), rank: x.rank
  }))};
}

// --- Shopee: zen-studio/shopee-product-scraper { searchTerms:[kw], market:'id', maxProducts } ---
// market: id, my, ph, th, vn, sg, tw, br
async function searchShopee(keyword, market = 'id', limit = 30) {
  const actor = process.env.SHOPEE_ACTOR || 'zen-studio/shopee-product-scraper';
  const { runId, items } = await runActorSync(actor, {
    searchTerms: [keyword], market: (market || 'id').toLowerCase(),
    maxProducts: Math.min(limit, 100), enrich: false
  }, 150);
  return { runId, data: items.slice(0, limit).map((x, i) => ({
    title: x.title || x.name || (keyword + ' #' + (i + 1)),
    price: +(x.price ?? x.finalPrice ?? 0),
    sold: +(x.sold ?? x.soldCount ?? x.historicalSold ?? 0),
    shop: x.shopName || x.sellerName || 'Shopee',
    rating: +(x.ratingStar || x.rating || 0), reviews: +(x.ratingCount || x.reviewCount || 0),
    url: x.url || '', image: x.image || '', category: '', market
  }))};
}

// --- TikTok Shop INDONESIA (region ID) ---
// kulqiz/tiktok-shop-scraper: storefront shop-id.tokopedia.com, $0.99/1k.
// PENTING: storefront ID tidak punya keyword search publik → mode kategori + URL detail.
// Untuk "search keyword": sweep kategori (maxProducts) lalu filter judul client-side.
// Input resmi: { crawlCategories, startUrl, maxProducts, crawlSubcategories, productUrls[],
//   includeReviews, maxReviews, minSold, minRating, minPrice, maxPrice }
async function sweepTikTokID_Kulqiz({ maxProducts = 150, minSold = 0, minRating = 0, categoryUrl = '', productUrls = [], includeReviews = false } = {}) {
  const actor = process.env.TIKTOK_ID_ACTOR || 'kulqiz/tiktok-shop-scraper';
  const input = productUrls.length
    ? { productUrls, includeReviews, maxReviews: 20 }
    : { crawlCategories: !categoryUrl, startUrl: categoryUrl || 'https://shop-id.tokopedia.com/',
        maxProducts: Math.min(maxProducts, 2000), crawlSubcategories: false, minSold, minRating };
  const { runId, items } = await runActorSync(actor, input, 300);
  return { runId, actor, data: items.map(x => ({
    title: x.title || 'Produk ID', price: +(x.sale_price_value ?? String(x.sale_price || '0').replace(/[^0-9]/g, '') ?? 0),
    sold: +(x.sold_count ?? 0), shop: x.shop_name || 'TikTok Shop ID',
    rating: +(x.rating || 0), reviews: +(x.review_count || 0),
    url: x.url || '', image: x.image || '', brand: x.brand || '', region: 'ID'
  }))};
}

// silentflow/tiktok-shop-scraper: region 'id'. Keyword search US-only → untuk ID pakai
// categoryUrls (format shop.tiktok.com/id/c/...) atau productUrls. 40+ fields, $4.50-5.50/1k.
// Input resmi: { productUrls[], searchKeywords[] (US saja), categoryUrls[], region, maxItems, debugMode }
async function scrapeTikTokID_Silentflow({ categoryUrls = [], productUrls = [], maxItems = 50 } = {}) {
  const actor = process.env.TIKTOK_ID_SILENTFLOW || 'silentflow/tiktok-shop-scraper';
  const { runId, items } = await runActorSync(actor, { productUrls, categoryUrls, region: 'id', maxItems }, 240);
  return { runId, actor, data: items.map(x => ({
    title: x.title || x.product_name || 'Produk ID',
    price: +(x.discounted_price ?? x.price ?? 0), sold: +(x.sold_count ?? x.sales_count ?? 0),
    shop: x.seller_name || x.shop_name || 'TikTok Shop ID',
    rating: +(x.rating || 0), reviews: +(x.review_count ?? x.rating_count ?? 0),
    url: x.product_url || x.productUrl || '', image: x.image || x.image_url || '', region: 'ID'
  }))};
}

// "Search" keyword di storefront ID: sweep kulqiz (termurah) + filter judul lokal.
// Fallback dikerjakan caller (server.js → MY proxy) bila hasil kosong.
async function searchTikTokID(keyword, limit = 30) {
  const sweep = await sweepTikTokID_Kulqiz({ maxProducts: Math.min(limit * 4, 300) });
  const q = (keyword || '').toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const scored = sweep.data.map(p => {
    const t = (p.title || '').toLowerCase();
    const hit = words.filter(w => t.includes(w)).length;
    return { p, hit };
  }).filter(x => x.hit > 0).sort((a, b) => b.hit - a.hit || b.p.sold - a.p.sold);
  return { runId: sweep.runId, actor: sweep.actor,
    notes: `Sweep ID ${sweep.data.length} produk, cocok keyword ${scored.length}. Storefront ID tidak ada keyword search publik, jadi difilter lokal.`,
    data: scored.slice(0, limit).map(x => x.p) };
}

module.exports = { hasToken, runActorSync, searchTikTok, trendingTikTok, searchShopee, sweepTikTokID_Kulqiz, scrapeTikTokID_Silentflow, searchTikTokID };
