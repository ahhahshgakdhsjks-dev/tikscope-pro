// TikScope Pro — node test-all.js [--live]
// Cek 4 provider sekaligus + estimasi biaya per 1000 produk.
//   node test-all.js          → dry-run (cek config .env, tanpa spending)
//   node test-all.js --live   → test live murah (limit 2-3 item per provider yang ready)
// Biaya di bawah dari halaman Store resmi Okt 2026, bisa berubah — cek ulang sebelum bulk.
require('dotenv').config();

const COST = [
  { provider: 'Apify TikTok ID (kulqiz, khusus Indonesia)', per1k: 0.99, free: '$5 credit baru (~5000 produk!)', note: 'Sweep kategori shop-id.tokopedia.com + filter lokal. Test 100 produk ≈ $0.10' },
  { provider: 'Apify TikTok ID (silentflow, 10 negara)', per1k: 5.50, free: '$5 credit baru', note: 'Kategori/URL region id (keyword search-nya US-only). 40+ fields' },
  { provider: 'Apify TikTok (sian.agency)', per1k: 5.00, free: '$5 credit baru (~500-1000 produk)', note: 'Region ID/UK dihapus 26-08-2026 → dipakai sbg fallback MY proxy' },
  { provider: 'Apify TikTok trending (apivault_labs)', per1k: 3.00, free: '$5 credit baru', note: 'Mode trending:true, best-seller global' },
  { provider: 'Apify Shopee (zen-studio)', per1k: 4.00, free: '$5 credit baru (~1000 produk)', note: 'Estimasi, pay-per-result; tercepat ~1000/2mnt' },
  { provider: 'Bright Data Scraper API', per1k: 7.50, free: '5.000 credits/bln (~$7.50) tanpa kartu', note: 'Pay per successful record; max 20 URL sync' },
  { provider: 'TikTok Partner resmi', per1k: 0, free: 'Gratis (butuh toko sendiri)', note: 'Hanya produk toko sendiri, bukan riset pasar' },
  { provider: 'Shopee Open/AMS resmi', per1k: 0, free: 'Gratis (butuh toko sendiri)', note: 'Hanya item/kampanye sendiri' },
];

function status() {
  const apify = (process.env.APIFY_API_TOKEN || '').startsWith('apify_api_') && process.env.APIFY_API_TOKEN.length > 20;
  const bd = (process.env.BRIGHTDATA_API_KEY || '').length >= 16;
  const bdDs = (process.env.BRIGHTDATA_SHOPEE_DATASET || '').startsWith('gd_');
  const tik = !!(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET && process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_SHOP_CIPHER);
  const shp = !!(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY && process.env.SHOPEE_ACCESS_TOKEN && process.env.SHOPEE_SHOP_ID);
  return { apify, bd, bdDs, tik, shp };
}

async function main() {
  const live = process.argv.includes('--live');
  const s = status();
  console.log('=== TikScope test-all ===');
  console.log('apify:      ' + (s.apify ? 'READY (token terisi)' : 'KOSONG (isi APIFY_API_TOKEN di .env)'));
  console.log('brightdata: ' + (s.bd ? (s.bdDs ? 'READY (key+dataset terisi)' : 'SETENGAH (key ada, dataset gd_... belum)') : 'KOSONG (isi BRIGHTDATA_API_KEY di .env)'));
  console.log('tiktok-off: ' + (s.tik ? 'READY' : 'KOSONG (butuh APP_KEY/SECRET/TOKEN/CIPHER)'));
  console.log('shopee-off: ' + (s.shp ? 'READY' : 'KOSONG (butuh PARTNER_ID/KEY/TOKEN/SHOP_ID)'));
  console.log('');
  console.log('--- Estimasi biaya per 1000 produk ---');
  let total = 0;
  for (const c of COST) {
    console.log(`- ${c.provider}: $${c.per1k.toFixed(2)}/1k | free: ${c.free} | ${c.note}`);
    total += c.per1k;
  }
  console.log('');
  // Simulasi kebutuhan user: 10 keyword x 100 produk = 1000 produk/bln per marketplace
  const need = 1000;
  const apifyCost = 5.00 * need / 1000, bdCost = 7.50 * need / 1000;
  console.log(`Simulasi lo (1000 produk/bln): Apify ~$${apifyCost.toFixed(2)} | Bright Data ~$${bdCost.toFixed(2)} | Official $0 (toko sendiri)`);
  console.log('');

  if (!live) {
    console.log('Dry-run selesai (tanpa spending). Untuk test live murah: node test-all.js --live');
    return;
  }
  console.log('--- LIVE TEST (murah: 2-3 item/provider) ---');
  const base = 'http://127.0.0.1:3000';
  // 1) pastikan server jalan, kalau tidak, test langsung ke modul
  async function get(path) {
    const r = await fetch(base + path);
    return r.json();
  }
  let viaServer = true;
  try { await get('/api/health'); console.log('[server] jalan di :3000'); }
  catch (e) { viaServer = false; console.log('[server] TIDAK jalan — test modul langsung (tanpa server). Jalankan `node server.js` di terminal lain untuk test via HTTP.'); }

  if (viaServer) {
    for (const p of ['/api/providers', '/api/test-apify', '/api/test-brightdata', '/api/own-shop?which=tiktok', '/api/own-shop?which=shopee']) {
      try { const j = await get(p); console.log(`GET ${p} →`, JSON.stringify(j).slice(0, 220)); }
      catch (e) { console.log(`GET ${p} → FAIL: ${e.message}`); }
    }
  } else {
    if (s.apify) {
      try {
        const a = require('./apify');
        const t = await a.searchShopee('serum', 'id', 2);
        console.log('[apify Shopee] OK:', t.data.length, 'item, runId', t.runId);
      } catch (e) { console.log('[apify Shopee] FAIL:', String(e.message).slice(0, 200)); }
    } else console.log('[apify] skip (token kosong)');
    if (s.bd && s.bdDs) {
      try {
        const b = require('./brightdata');
        const r = await b.scrapeSync(process.env.BRIGHTDATA_SHOPEE_DATASET, ['https://shopee.co.id/search?keyword=serum']);
        console.log('[brightdata] OK:', r.length, 'record');
      } catch (e) { console.log('[brightdata] FAIL:', String(e.message).slice(0, 200)); }
    } else console.log('[brightdata] skip (key/dataset belum lengkap)');
    console.log('[official] hanya cek config (tidak panggil API tanpa creds lengkap).');
  }
  console.log('LIVE TEST selesai.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
