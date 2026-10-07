// TikScope Pro — konektor RESMI: TikTok Shop Partner API + Shopee Open Platform / AMS
// BATASAN JUJUR (biar nggak zonk):
// - TikTok Partner Search Products (POST /product/202502/products/search) hanya mengembalikan
//   produk TOKO MILIK LO SENDIRI (butuh seller access_token + shop_cipher), BUKAN riset pasar global.
//   Untuk riset kompetitor/market-wide tetap pakai Apify/Bright Data. Official cocok untuk sinkron
//   katalog toko sendiri + stok + harga.
// - Shopee Open Platform (get_item_list / AMS) juga hanya data toko sendiri + manajemen kampanye
//   affiliate, bukan search publik. Search publik Shopee hanya via scraper (Apify/Bright Data).
const crypto = require('crypto');

// ---- TikTok Shop Partner: sign HMAC-SHA256 sesuai docs partner.tiktokshop.com ----
function tiktokSign({ appSecret, path, params }) {
  const keys = Object.keys(params).filter(k => k !== 'sign' && k !== 'access_token').sort();
  const str = keys.map(k => k + params[k]).join('');
  const base = appSecret + path + str + appSecret;
  return crypto.createHmac('sha256', appSecret).update(base).digest('hex');
}
function hasTikTokCred(){
  return !!(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET && process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_SHOP_CIPHER);
}
// Search produk toko sendiri. Docs: POST /product/202502/products/search?page_size=&shop_cipher= + header x-tts-access-token
async function tiktokSearchOwnShop(pageSize = 20) {
  if (!hasTikTokCred()) throw new Error('TIKTOK_APP_KEY/SECRET/ACCESS_TOKEN/SHOP_CIPHER belum diisi di .env (daftar di partner.tiktokshop.com, buat app, otorisasi seller, ambil shop_cipher via GET /authorization/202309/shops)');
  const path = '/product/202502/products/search';
  const ts = Math.floor(Date.now() / 1000);
  const params = { app_key: process.env.TIKTOK_APP_KEY, timestamp: String(ts), page_size: String(pageSize), shop_cipher: process.env.TIKTOK_SHOP_CIPHER };
  params.sign = tiktokSign({ appSecret: process.env.TIKTOK_APP_SECRET, path, params });
  const qs = new URLSearchParams(params).toString();
  const base = (process.env.TIKTOK_API_BASE || 'https://open-api.tikwm.com').replace(/\/$/, '');
  const r = await fetch(`${base}${path}?${qs}`, {
    method: 'POST', headers: { 'x-tts-access-token': process.env.TIKTOK_ACCESS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const j = await r.json();
  if (j.code !== 0 && j.code !== undefined && j.message) throw new Error('TikTok API: ' + JSON.stringify(j).slice(0, 300));
  const list = j?.data?.products || j?.data?.product_list || [];
  return { source: 'tiktok-official', note: 'Hanya produk toko sendiri (bukan market-wide).', data: list.map(p => ({ title: p.title || p.product_name, price: 0, sold: 0, shop: 'Toko Saya', raw: p })) };
}

// ---- Shopee Open Platform: sign HMAC-SHA256(partner_key + path + timestamp + token + shop) ----
function shopeeSign({ partnerKey, path, timestamp, accessToken, shopId }) {
  const base = `${partnerKey}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex');
}
function hasShopeeCred(){
  return !!(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY && process.env.SHOPEE_ACCESS_TOKEN && process.env.SHOPEE_SHOP_ID);
}
// Ambil daftar item toko sendiri (GET /api/v2/product/get_item_list). Bukan search publik.
async function shopeeGetOwnItems(offset = 0, limit = 20) {
  if (!hasShopeeCred()) throw new Error('SHOPEE_PARTNER_ID/KEY/ACCESS_TOKEN/SHOP_ID belum diisi di .env (daftar di open.shopee.com → buat app → otorisasi toko. Untuk affiliate publik: daftar program affiliate, pakai link afiliasi + AMS Open API untuk kelola kampanye, bukan untuk search market-wide)');
  const path = '/api/v2/product/get_item_list';
  const ts = Math.floor(Date.now() / 1000);
  const sign = shopeeSign({ partnerKey: process.env.SHOPEE_PARTNER_KEY, path, timestamp: ts, accessToken: process.env.SHOPEE_ACCESS_TOKEN, shopId: process.env.SHOPEE_SHOP_ID });
  const host = process.env.SHOPEE_API_HOST || 'https://partner.shopeemobile.com';
  const url = `${host}${path}?partner_id=${process.env.SHOPEE_PARTNER_ID}&timestamp=${ts}&access_token=${process.env.SHOPEE_ACCESS_TOKEN}&shop_id=${process.env.SHOPEE_SHOP_ID}&sign=${sign}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) throw new Error('Shopee API: ' + JSON.stringify(j).slice(0, 300));
  return { source: 'shopee-official', note: 'Hanya item toko sendiri. Search publik pakai Apify/Bright Data.', data: (j?.response?.item || []).map(x => ({ title: 'item_id ' + (x.item_id || x), price: 0, sold: 0, shop: 'Toko Saya', raw: x })) };
}

module.exports = { hasTikTokCred, tiktokSearchOwnShop, hasShopeeCred, shopeeGetOwnItems, tiktokSign, shopeeSign };
