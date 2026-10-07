// TikScope Pro — Backend multi-provider (Apify + Bright Data + Official + mock)
// .env: copy .env.example → .env, isi token yang dipakai. Provider dipilih via ?provider=
//   provider=apify (default, riset pasar) | brightdata (riset pasar) | tiktok-official (toko sendiri)
//   | shopee-official (toko sendiri) | mock
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const apify = require('./apify');
const bd = require('./brightdata');
const off = require('./official');
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;
const TTL = (+process.env.CACHE_TTL_SEC || 3600) * 1000;
const cache = new Map();
const ck = (...a) => a.join('|');
function getCache(k){ const v = cache.get(k); if(v && v.exp > Date.now()) return v.payload; cache.delete(k); return null; }
function setCache(k, payload){ cache.set(k, { exp: Date.now()+TTL, payload }); }

function mockProducts(platform, q, limit=30){
  const names = ['Serum Niacinamide Viral','Sunscreen Tone Up SPF50','Kemeja Linen Oversize','TWS Bluetooth 5.3','Vacuum Mini Portable','Basreng Daun Jeruk','Parfum Pheromone','Stroller Lipat Cabin'];
  return Array.from({length: limit}, (_,i)=>({ title:(q?q+' ':'')+names[i%names.length]+' #'+(i+1), price:20000+Math.floor(Math.random()*200000), sold:500+Math.floor(Math.random()*50000), shop:'Shop-'+(i+1), category:'Beauty' }));
}

// GET /api/products?platform=tiktok|shopee&q=serum&region=ID&market=id&limit=30&mode=search|trending&provider=apify|brightdata|mock
app.get('/api/products', async (req,res)=>{
  const platform = (req.query.platform||'tiktok').toLowerCase();
  const q = (req.query.q||req.query.keyword||'serum').toString().slice(0,80);
  const limit = Math.min(+req.query.limit||30, +process.env.MAX_LIMIT||50);
  const region = (req.query.region||req.query.country||'ID').toString();
  const market = (req.query.market||'id').toString();
  const mode = (req.query.mode||'search').toString();
  const provider = (req.query.provider||'apify').toString();
  const key = ck(provider, platform, q.toLowerCase(), region+market+mode, limit);
  const hit = getCache(key);
  if(hit) return res.json({ ...hit, cached:true });
  try{
    let payload;
    if(provider === 'mock'){ payload = { source:'mock', platform, data: mockProducts(platform,q,limit) }; }
    else if(provider === 'brightdata'){ const out = await bd.searchViaBrightData(platform, q, Math.min(limit,20)); payload = { source:'brightdata-live', platform, query:q, ...out }; }
    else { // apify default
      if(!apify.hasToken()) return res.json({ source:'mock-no-token', hint:'Isi APIFY_API_TOKEN di backend/.env untuk data live.', platform, data: mockProducts(platform,q,limit) });
      let out;
      if(platform === 'shopee') out = await apify.searchShopee(q, market, limit);
      else if(mode === 'trending') out = await apify.trendingTikTok(limit);
      else out = await apify.searchTikTok(q, region, limit);
      payload = { source:'apify-live', platform, query:q, ...out };
    }
    setCache(key, payload);
    res.json(payload);
  }catch(e){
    console.error(provider, 'error:', e.message);
    res.status(200).json({ source:'mock-fallback-error', provider, error:String(e.message).slice(0,300), platform, data:mockProducts(platform,q,limit) });
  }
});

// GET /api/own-shop?which=tiktok|shopee — data toko sendiri via API resmi
app.get('/api/own-shop', async (req,res)=>{
  const which = (req.query.which||'tiktok').toLowerCase();
  try{
    if(which === 'shopee') return res.json(await off.shopeeGetOwnItems(0, 20));
    return res.json(await off.tiktokSearchOwnShop(20));
  }catch(e){ res.status(200).json({ ok:false, error:String(e.message).slice(0,400) }); }
});

// GET /api/providers — status semua provider (dipakai frontend Settings)
app.get('/api/providers', (req,res)=> res.json({
  apify: apify.hasToken() ? 'ready' : 'butuh APIFY_API_TOKEN (apify_api_...)',
  brightdata: bd.hasKey() ? 'ready' : 'butuh BRIGHTDATA_API_KEY + dataset gd_...',
  tiktokOfficial: off.hasTikTokCred() ? 'ready' : 'butuh TIKTOK_APP_KEY/SECRET/ACCESS_TOKEN/SHOP_CIPHER (hanya toko sendiri)',
  shopeeOfficial: off.hasShopeeCred() ? 'ready' : 'butuh SHOPEE_PARTNER_ID/KEY/ACCESS_TOKEN/SHOP_ID (hanya toko sendiri)'
}));

// GET /api/test-apify — cek token + 1 run kecil (limit 3)
app.get('/api/test-apify', async (req,res)=>{
  if(!apify.hasToken()) return res.json({ ok:false, msg:'APIFY_API_TOKEN belum diisi / salah format (harus apify_api_...). Cek backend/.env' });
  try{ const t = await apify.searchShopee('serum', 'id', 3); res.json({ ok:true, msg:'Token OK, Shopee live dapat '+t.data.length+' item.', sample:t.data[0]||null, runId:t.runId }); }
  catch(e){ res.json({ ok:false, msg:'Token terisi tapi run gagal: '+String(e.message).slice(0,300) }); }
});

// GET /api/test-brightdata — 1 scrape sync murah ke 1 URL
app.get('/api/test-brightdata', async (req,res)=>{
  if(!bd.hasKey()) return res.json({ ok:false, msg:'BRIGHTDATA_API_KEY belum diisi di .env' });
  const ds = process.env.BRIGHTDATA_SHOPEE_DATASET || '';
  if(!ds.startsWith('gd_')) return res.json({ ok:false, msg:'BRIGHTDATA_SHOPEE_DATASET belum diset (format gd_...). Buat kolektor dulu.' });
  try{
    const r = await bd.scrapeSync(ds, ['https://shopee.co.id/search?keyword=serum']);
    res.json({ ok:true, msg:'Bright Data OK, dapat '+r.length+' record.', sample:JSON.stringify(r[0]||{}).slice(0,300) });
  }catch(e){ res.json({ ok:false, msg:'Gagal: '+String(e.message).slice(0,300) }); }
});

app.get('/api/shops', (req,res)=> res.json({ source:'mock', data:[{name:'Glamora Official',sold:120000}] }));
app.get('/api/creators', (req,res)=> res.json({ source:'mock', data:[{handle:'@racunshopee',followers:1200000}] }));
app.get('/api/trending', async (req,res)=>{
  if(!apify.hasToken()) return res.json({ source:'mock', data:mockProducts('tiktok','viral',10) });
  try{ const t = await apify.trendingTikTok(10); res.json({ source:'apify-live', ...t }); }
  catch(e){ res.json({ source:'mock-fallback-error', error:String(e.message).slice(0,200), data:mockProducts('tiktok','viral',10) }); }
});
app.get('/api/health', (req,res)=> res.json({ ok:true, apify:apify.hasToken()?'token-terisi':'token-kosong', brightdata:bd.hasKey()?'key-terisi':'key-kosong', tiktok:off.hasTikTokCred()?'creds-terisi':'creds-kosong', shopee:off.hasShopeeCred()?'creds-terisi':'creds-kosong', time:Date.now() }));

app.listen(PORT, ()=> console.log('TikScope API :'+PORT+' apify='+(apify.hasToken()?'LIVE':'MOCK')+' bd='+(bd.hasKey()?'LIVE':'MOCK')));
