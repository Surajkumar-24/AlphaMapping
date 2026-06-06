// Vercel Serverless Function — /api/serp
// Proxies SerpAPI calls server-side so SERP_KEY never touches the browser

export default async function handler(req, res) {

  // CORS headers — allow your frontend to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SERP_KEY = process.env.SERP_KEY;
  if (!SERP_KEY) {
    return res.status(500).json({ error: 'SERP_KEY not configured in Vercel environment variables' });
  }

  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Missing query' });
  }

  try {
    const params = new URLSearchParams({
      api_key: SERP_KEY,
      engine:  'google',
      q:       query,
      num:     10,
      hl:      'en',
      gl:      'in',
    });

    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    const data     = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(502).json({ error: 'SerpAPI request failed: ' + err.message });
  }
}
