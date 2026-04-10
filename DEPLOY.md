# Health Experts Commission Tracker
## Complete Deployment Guide — tools.healthexps.com

---

## What you have

- **Frontend** (React app) → deploys to Netlify → tools.healthexps.com
- **Backend** (Node.js API) → deploys to Railway → auto-generated URL
- **Database** (SQLite) → lives inside Railway, persists your data

**Total monthly cost: $0** (both free tiers cover your usage)
**AI parsing cost: ~$0.01–0.05 per file uploaded**

---

## STEP 1 — Get your Anthropic API key

1. Go to https://console.anthropic.com
2. Sign up / log in
3. Click "API Keys" → "Create Key"
4. Copy the key — it starts with `sk-ant-...`
5. Save it somewhere safe (you'll need it in Step 3)

---

## STEP 2 — Put the code on GitHub

You need a free GitHub account to deploy.

1. Go to https://github.com and create a free account
2. Click the "+" button → "New repository"
3. Name it: `healthexperts-commission-tracker`
4. Set to **Private**, click "Create repository"
5. Follow GitHub's instructions to upload this folder
   (or use GitHub Desktop app if you're not comfortable with command line)

**If using GitHub Desktop (easiest):**
- Download from https://desktop.github.com
- File → Add Local Repository → select this folder
- Publish to GitHub (private)

---

## STEP 3 — Deploy the backend to Railway

1. Go to https://railway.app and sign up with your GitHub account
2. Click "New Project" → "Deploy from GitHub repo"
3. Select `healthexperts-commission-tracker`
4. Railway will detect the backend — click "Deploy"
5. Once deployed, click "Variables" and add these:

```
ANTHROPIC_API_KEY   = sk-ant-your-key-from-step-1
JWT_SECRET          = any-long-random-string-like-HealthExperts2024SecretKey!
NODE_ENV            = production
FRONTEND_URL        = https://tools.healthexps.com
```

6. Railway gives you a URL like: `https://healthexperts-commission-tracker-production.up.railway.app`
7. **Copy this URL** — you need it in Step 4

**Important:** In Railway settings, set the Root Directory to `/backend`

---

## STEP 4 — Deploy the frontend to Netlify

1. Go to https://netlify.com and sign up with your GitHub account
2. Click "Add new site" → "Import an existing project" → GitHub
3. Select `healthexperts-commission-tracker`
4. Set these build settings:
   - Base directory: `frontend`
   - Build command: `npm run build`
   - Publish directory: `frontend/build`
5. Click "Add environment variables" and add:

```
REACT_APP_API_URL = https://your-railway-url-from-step-3
```

6. Click "Deploy site"
7. Netlify gives you a URL like `amazing-name-123.netlify.app`

---

## STEP 5 — Connect your custom domain (tools.healthexps.com)

**In Netlify:**
1. Go to your site → "Domain management" → "Add custom domain"
2. Type: `tools.healthexps.com`
3. Netlify shows you a CNAME value like: `amazing-name-123.netlify.app`

**In your domain registrar (wherever healthexps.com is registered):**
1. Go to DNS settings
2. Add a new record:
   - Type: `CNAME`
   - Name: `tools`
   - Value: `amazing-name-123.netlify.app`
3. Save — DNS changes take 5–30 minutes to propagate

**Enable HTTPS** (free): Back in Netlify → Domain management → Enable SSL

---

## STEP 6 — First login & change passwords

1. Go to https://tools.healthexps.com
2. Log in with:
   - Email: `yahoska@healthexps.com`
   - Password: `HealthExperts2024!`
3. **⚠️ Important:** Go to Agents → change all passwords immediately

**Default agent logins:**
- jill@healthexps.com / Agent2024!
- katy@healthexps.com / Agent2024!
- gina@healthexps.com / Agent2024!
- osmary@healthexps.com / Agent2024!
- sabri@healthexps.com / Agent2024!

---

## How to use it

### Uploading a carrier statement
1. Click "Upload" in the sidebar
2. Drag and drop any carrier Excel file (.xlsx or .csv)
3. The AI reads the column headers and figures out which column is "client name", which is "commission amount", etc. — automatically, for any carrier format
4. Records are saved to your database instantly

### Checking missing renewals
1. Click "Missing Renewals"
2. Select "Last month" and "This month" from the dropdowns
3. Click "Compare →"
4. Any client who appeared last month but not this month is flagged with a risk level

### What agents see vs what you see
- **You (admin):** See all agents' data, can upload files, manage agents
- **Agents:** Log in and see only their own commission records

---

## Troubleshooting

**"Cannot connect to server"**
- Check that your Railway backend is running (Railway dashboard → Deployments)
- Verify `REACT_APP_API_URL` in Netlify matches your Railway URL exactly

**"AI column mapping failed"**
- Check that `ANTHROPIC_API_KEY` is set correctly in Railway
- The system falls back to smart guessing even without AI

**Adding a new agent**
- Log in as admin → Agents → "Add agent"
- They get their own login and see only their records

**Upgrading Railway if you hit the free limit**
- Railway free tier gives you $5/month of compute
- A small Node.js server like this uses about $0.50–1/month
- Upgrade to Hobby ($5/month) if needed

---

## File structure reference

```
commission-tracker/
├── backend/
│   ├── server.js          ← main API server
│   ├── db/database.js     ← SQLite setup + user seeding
│   ├── routes/
│   │   ├── auth.js        ← login, user management
│   │   ├── files.js       ← upload + AI parsing
│   │   └── records.js     ← data queries + missing renewals
│   ├── .env.example       ← copy to .env and fill in
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.js         ← main app + navigation
│   │   ├── App.css        ← all styles
│   │   ├── api.js         ← API helper
│   │   └── pages/
│   │       ├── Login.js
│   │       ├── Dashboard.js
│   │       ├── Upload.js
│   │       ├── AllData.js
│   │       ├── MissingRenewals.js
│   │       └── Agents.js
│   └── package.json
├── netlify.toml           ← Netlify build config
└── DEPLOY.md              ← this file
```

---

## Need help?

All the code is yours — you own it completely. Share the GitHub repo link with any developer if you need help, and they can understand and extend it immediately.

Future features you can add:
- Payroll calculator (agent splits)
- Deposit reconciliation
- Export to Excel
- Email alerts for missing renewals
- Mobile app
