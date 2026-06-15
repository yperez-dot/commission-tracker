# OliComm 

Commission tracking system for **The Health Experts Insurance** + the broader THEI/BSI hierarchy.

Built by Yahoska Perez with Claude. Maintained + extended by Igor (AI agent).

The name? Olivia + commissions. Yahoska's daughter. The tool funding her future.

---

## What it does

- Tracks every commission dollar flowing into THE Health Experts Insurance — personal production, agency overrides, and 1099 pass-throughs.
- Parses carrier statements with AI-powered column mapping (Anthropic Claude).
- Handles the THEI ↔ BSI 50/50 split logic for Medicare commissions.
- Treats ACA correctly: THEI keeps 100% override (or passes through to producer for agency-only carriers).
- Generates 1099-ready totals at year-end.
- Built for AEP volume (Oct 15 – Dec 7) without breaking.

## Stack

- **Frontend:** React 18 (deployed on Netlify)
- **Backend:** Node.js / Express (deployed on Railway)
- **Database:** PostgreSQL (on Railway)
- **AI parsing:** Anthropic Claude (`@anthropic-ai/sdk`)
- **Auth:** JWT + bcrypt

## Quick links

- 📘 **Full deployment guide:** [`DEPLOY.md`](./DEPLOY.md)
- 📋 **Business rules + build plan:** see workspace `projects/olicomm/` (in Igor's workspace)

## Required environment variables (Railway)

```
DATABASE_URL          = auto-provided by Railway Postgres
ANTHROPIC_API_KEY     = sk-ant-... (for AI column mapping)
JWT_SECRET            = long random string
NODE_ENV              = production
FRONTEND_URL          = https://your-netlify-url.netlify.app
SEED_PASSWORD_YAHOSKA = (initial password for Yahoska's admin account)
SEED_PASSWORD_KATY    = (initial password for Katy's admin account)
```

## Local development

```bash
# install deps
npm install

# create a .env file with the env vars above
cp .env.example .env
# edit .env

# run server
node server.js

# run frontend (in another tab)
cd src && npm start
```

## Users + access

Currently seeded:
- **Yahoska** (admin) — `yahoska@healthexps.com`
- **Katy** (admin) — `katy@healthexps.com`

Other users (agents, ACA pass-through producers, partner agency principals) can be added via the **User Accounts** page once they're invited.

## License

Internal tool. All rights reserved by The Health Experts Insurance.
