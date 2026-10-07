// TikScope Pro — konektor Bright Data (Scraper API + Datasets)
// Docs: https://docs.brightdata.com/datasets/scrapers/tiktok/introduction
// Cara dapat key: brightdata.com → Login → Control Panel → API token (format: <32 hex> atau brd_...)
// Gratis: 5.000 credits/bulan, tanpa kartu kredit.
// Pola resmi sync (max 20 URL): POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=XXX&format=json
//   Header: Authorization: Bearer API_KEY, Content-Type: application/json
//   Body: [{ "url": "https://www.tiktok.com/..." }]
const BD = 'https://api.brightdata.com/datasets/v3';
function key(){ return process.env.BRIGHTDATA_API_KEY || ''; }
function hasKey(){ return key().length >= 16; }

// Scrape sync: kirim list URL produk/search, terima JSON terstruktur langsung.
// datasetId contoh TikTok Shop by keyword & Shopee — ganti di .env sesuai kolektor lo
// (Bright Data tidak punya 1 dataset-id global; tiap kolektor punya id gd_... sendiri)
async function scrapeSync(datasetId, urls, format = 'json') {
  if (!hasKey()) throw new Error('BRIGHTDATA_API_KEY belum diisi di backend/.env');
  if (!datasetId || !datasetId.startsWith('gd_')) throw new Error('dataset_id belum diset (format gd_...). Buat kolektor di Bright Data → copy dataset ID ke .env');
  const r = await fetch(`${BD}/scrape?dataset_id=${encodeURIComponent(datasetId)}&format=${format}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key(), 'Content-Type': 'application/json' },
    body: JSON.stringify(urls.slice(0, 20).map(u => ({ url: u })))
  });
  if (!r.ok) throw new Error('Bright Data ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  return Array.isArray(j) ? j : [j];
}

// Mode async untuk 20+ URL: trigger → poll snapshot sampai ready (dipakai kalau limit > 20)
async function scrapeAsync(datasetId, urls) {
  if (!hasKey()) throw new Error('BRIGHTDATA_API_KEY belum diisi');
  const trig = await fetch(`${BD}/trigger?dataset_id=${encodeURIComponent(datasetId)}&format=json`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + key(), 'Content-Type': 'application/json' },
    body: JSON.stringify(urls.slice(0, 5000).map(u => ({ url: u })))
  }).then(r => r.json());
  const snap = trig.snapshot_id;
  for (let i = 0; i < 30; i++) {
    await new Promise(x => setTimeout(x, 10000));
    const st = await fetch(`${BD}/progress/${snap}`, { headers: { Authorization: 'Bearer ' + key() } }).then(r => r.json());
    if (st.status === 'ready') break;
  }
  return fetch(`${BD}/snapshot/${snap}?format=json`, { headers: { Authorization: 'Bearer ' + key() } }).then(r => r.json());
}

// Helper: riset keyword → bangun URL search Shopee/TikTok Shop lalu scrape.
// Catatan: hasil tergantung kolektor dataset lo; normalisasi defensif.
async function searchViaBrightData(platform, keyword, limit = 20) {
  const ds = platform === 'shopee' ? process.env.BRIGHTDATA_SHOPEE_DATASET : process.env.BRIGHTDATA_TIKTOK_DATASET;
  const base = platform === 'shopee'
    ? `https://shopee.co.id/search?keyword=${encodeURIComponent(keyword)}`
    : `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`;
  const raw = limit <= 20
    ? await scrapeSync(ds, [base])
    : await scrapeAsync(ds, [base]);
  const arr = Array.isArray(raw) ? raw : [];
  return { snapshot: true, data: arr.slice(0, limit).map((x, i) => ({
    title: x.title || x.product_name || x.name || (keyword + ' #' + (i + 1)),
    price: +(x.final_price ?? x.price ?? 0),
    sold: +(x.sold_count ?? x.sold ?? 0),
    shop: x.seller_name || x.shop_name || 'BrightData',
    rating: +(x.rating || 0), url: x.url || base, raw: x
  }))};
}

module.exports = { hasKey, scrapeSync, scrapeAsync, searchViaBrightData };
