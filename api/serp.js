// Vercel Serverless Function — /api/serp
// Proxies Serper.dev calls server-side so SERP_KEY never touches the browser

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const SERP_KEY = process.env.SERP_KEY;
  if (!SERP_KEY) {
    return res.status(500).json({ error: 'SERP_KEY not configured in Vercel environment variables' });
  }

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });

  try {
    // Serper.dev API — https://serper.dev
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY':    SERP_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q:   query,
        num: 10,
        gl:  'in',   // geolocation — India
        hl:  'en',   // language
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Serper API error' });
    }

    // Normalise Serper response to match what app.js expects:
    // app.js reads data.organic_results[].link / .title / .snippet
    // Serper returns data.organic[].link / .title / .snippet — just remap
    const normalised = {
      organic_results: (data.organic || []).map(r => ({
        link:    r.link,
        title:   r.title,
        snippet: r.snippet,
      })),
    };

    return res.status(200).json(normalised);

  } catch (err) {
    return res.status(502).json({ error: 'Serper request failed: ' + err.message });
  }
}
