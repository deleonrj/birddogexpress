# BirdDog Express ⚾

AI-powered MLB rumor tracker. Real-time validation across beat reporters, national sources, and team markets.

## How It Works

1. Enter an MLB rumor
2. The app runs two AI passes:
   - **Pass 1 (Search):** Forces web searches across origin market, destination market, and national sources
   - **Pass 2 (Analysis):** Analyzes only the live findings — no training data used
3. Returns a verdict with Credibility, Fit, and Overall Likelihood scores
4. Live team standings pulled directly from MLB Stats API
5. Post to BlueSky with one click

## Verdicts

| Verdict | Meaning |
|---|---|
| ✅ Corroborated | 1+ credible outlet in each market OR multiple independent Tier-1s |
| 🟡 Plausible but Unconfirmed | One market or national mentions; logic consistent |
| ⚠️ Weak / Speculative | Aggregators or low-threshold social only |
| ❌ Refuted / Debunked | Credible denial or contradiction found |
| 🔍 Unverified | Cannot determine from available sources |

---

## Deploy to Vercel

### Step 1 — Get an Anthropic API Key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Go to **API Keys** → **Create Key**
4. Copy the key — you won't see it again

### Step 2 — Push this repo to GitHub
If you haven't already:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/birddogexpress.git
git push -u origin main
```

### Step 3 — Deploy on Vercel
1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New Project**
3. Select your `birddogexpress` repo
4. Click **Deploy** (default settings are fine)

### Step 4 — Add Your API Key (CRITICAL)
1. In Vercel, go to your project → **Settings** → **Environment Variables**
2. Add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your key from Step 1
   - **Environment:** Production, Preview, Development (check all three)
3. Click **Save**
4. Go to **Deployments** → click the three dots on your latest deploy → **Redeploy**

Your app is live. Vercel gives you a URL like `birddogexpress.vercel.app`.

---

## Local Development

```bash
npm install
```

Create a `.env.local` file (never commit this):
```
ANTHROPIC_API_KEY=your_key_here
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Security Notes

- Your Anthropic API key lives **only** in Vercel's environment variables — never in the code
- The `.gitignore` excludes `.env.local` automatically
- The public GitHub repo contains zero sensitive information
- BlueSky credentials are used only in-browser for posting and are never sent to your server

---

## Tech Stack

- **Frontend:** Next.js + React
- **Backend:** Vercel Serverless Functions
- **AI:** Anthropic Claude (two-pass: search + analysis)
- **Standings:** MLB Stats API (statsapi.mlb.com)
- **Posting:** BlueSky AT Protocol API
