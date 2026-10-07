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

module.exports = { hasToken, runActorSync, searchTikTok, trendingTikTok, searchShopee };
