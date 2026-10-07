import { mock } from './mock.js';
// Vercel serverless: dukung Apify live kalau env APIFY_API_TOKEN diisi di dashboard Vercel.
// Tambahkan di Vercel → Project → Settings → Environment Variables:
//   APIFY_API_TOKEN = apify_api_xxx...  (+ TIKTOK_ACTOR, SHOPEE_ACTOR opsional)
const BASE = 'https://api.apify.com/v2';
async function runActor(actorId, input, token, wait = 90) {
  const r = await fetch(`${BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  });
  if (!r.ok) throw new Error('run ' + r.status);
  const run = (await r.json()).data;
  const t0 = Date.now();
  let status = run.status, ds = run.defaultDatasetId;
  while (['RUNNING', 'READY'].includes(status)) {
    if (Date.now() - t0 > wait * 1000) break;
    await new Promise(x => setTimeout(x, 4000));
    const s = await fetch(`${BASE}/actor-runs/${run.id}?token=${token}`).then(x => x.json());
    status = s.data.status; ds = s.data.defaultDatasetId;
  }
  if (status !== 'SUCCEEDED') throw new Error('status ' + status);
  return fetch(`${BASE}/datasets/${ds}/items?format=json&clean=true&token=${token}`).then(x => x.json());
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { platform = 'tiktok', q = 'serum', limit = '30', market = 'id', region = 'MY', mode = 'search' } = req.query || {};
  const n = Math.min(+limit || 30, 50);
  const token = process.env.APIFY_API_TOKEN || '';
  if (!token.startsWith('apify_api_')) return res.status(200).json({ source: 'mock-no-token', hint: 'Isi APIFY_API_TOKEN di Vercel env untuk live.', platform, data: mock(platform, q, n) });
  try {
    let items = [];
    if (platform === 'shopee') {
      items = await runActor(process.env.SHOPEE_ACTOR || 'zen-studio/shopee-product-scraper', { searchTerms: [q], market, maxProducts: n, enrich: false }, token);
      items = items.slice(0, n).map((x, i) => ({ title: x.title || q + ' #' + (i+1), price: +(x.price ?? 0), sold: +(x.sold ?? x.historicalSold ?? 0), shop: x.shopName || 'Shopee' }));
    } else if (mode === 'trending') {
      items = await runActor(process.env.TIKTOK_TRENDING_ACTOR || 'apivault_labs/tiktok-shop-scraper', { trending: true, trendingLimit: n }, token, 120);
      items = items.slice(0, n).map(x => ({ title: x.title, price: +x.price || 0, sold: +x.soldCount || 0, shop: x.shopName || 'TikTok Shop' }));
    } else {
      items = await runActor(process.env.TIKTOK_ACTOR || 'sian.agency/tiktok-shop-scraper', { operation: 'searchProducts', keyword: q, region, maxPages: Math.ceil(n/20) }, token);
      items = items.slice(0, n).map((x, i) => ({ title: x.title || q + ' #' + (i+1), price: +x.price || 0, sold: +x.soldCount || 0, shop: x.shopName || 'TikTok Shop' }));
    }
    return res.status(200).json({ source: 'apify-live-vercel', platform, data: items });
  } catch (e) {
    return res.status(200).json({ source: 'mock-fallback-error', error: String(e).slice(0, 200), platform, data: mock(platform, q, n) });
  }
}
