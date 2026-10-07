export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ ok: true, apify: process.env.APIFY_API_TOKEN ? 'token-terisi' : 'token-kosong', time: Date.now() });
}
