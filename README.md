# AlphaMapping — Vercel Deployment

## Folder structure
```
alphamapping/
├── index.html
├── style.css
├── app.js
├── vercel.json
├── api/
│   └── serp.js     ← serverless function (holds SERP_KEY)
└── README.md
```

## Step 1 — Add your Groq key

Open `app.js` line 7, replace:
```
const GROQ_KEY = 'YOUR_GROQ_API_KEY';
```
with your actual key from console.groq.com

## Step 2 — Deploy to Vercel

1. Go to vercel.com → New Project → Import Git Repository
   OR drag & drop this folder at vercel.com/new

2. After deploy, go to your project → Settings → Environment Variables
3. Add:  Name = SERP_KEY  |  Value = your SerpAPI key
4. Go to Deployments → click the 3 dots → Redeploy

Done. Your site is live with real data.
