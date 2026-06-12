// Vercel Serverless Function — /api/groq
// Proxies Groq API calls server-side so GROQ_KEY never touches the browser

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const GROQ_KEY = process.env.GROQ_KEY;
  if (!GROQ_KEY) {
    return res.status(500).json({ error: 'GROQ_KEY not configured in Vercel environment variables' });
  }

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + GROQ_KEY,
      },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  3500,
        temperature: 0.1,
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message || 'Groq API error' });
    }

    // Return just the text content app.js needs
    const content = data.choices?.[0]?.message?.content || '';
    return res.status(200).json({ content });

  } catch (err) {
    return res.status(502).json({ error: 'Groq request failed: ' + err.message });
  }
}
