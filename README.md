# Snag

> *If you want to get a job from scratch, you must first build a CRM.*

A personal executive recruiter CRM built in one day by a 3x-exit operator running a serious COO job search. Deployed to Railway. Used daily.

**Live:** [meridian-recruiter-tracker-production.up.railway.app](https://meridian-recruiter-tracker-production.up.railway.app)

---

## What It Does

Snag is a HubSpot-style CRM designed for one specific workflow: contacting every relevant executive recruiter in the country systematically, tracking responses, and running 10+ outreach emails per morning without losing track of anything.

It is not a general-purpose CRM. It is purpose-built for a senior executive job search.

**Core features:**
- 40+ pre-loaded executive search firms with named contacts, emails, and "why you fit" notes
- Firm status tracking: Not contacted / Contacted / In conversation / Passed
- Contact-level tracking with individual status per person
- Follow-up date scheduling with overdue alerts
- 7-day follow-up cadence surfaced automatically
- Search across firm names, notes, and why-fit text
- Sidebar navigation: Firms / Contacts / Follow-ups / Pipeline
- Flat Contacts view showing every person across all firms
- CSV export and import
- Optional password auth via `AUTH_PASSWORD` env var
- Orange accent, HubSpot-adjacent layout, intentionally self-aware branding

---

## Daily Workflow

The target rhythm is **10+ emails per morning**:

1. Open Snag and check the Follow-ups nav (overdue badge)
2. Send any queued Gmail drafts — attach resume to each before sending
3. Mark sent firms as `contacted` in the app
4. Handle any responses — update status to `in conversation`
5. Pick one `research needed` firm from Tier 3 and find a named contact
6. Create a new draft for that contact
7. Set follow-up dates 7 days out on anything just sent

**The math:** 40 firms × 1 follow-up each = 40 touch-points before any firm recycles. At 10/day that is a full week of pipeline with no repeats.

---

## Firm Tiers

| Tier | Description | Count |
|------|-------------|-------|
| 1 | Priority — direct functional, industry, and stage match | 12 |
| 2 | Secondary — strong match, slightly less direct | 8 |
| 3 | Opportunistic — worth contacting, lower hit rate | 15 |
| 4 | Health Tech Specialists — vertical-specific | 5 |

Tier 1 and 2 firms have confirmed named contacts and email addresses. Tier 3 includes several `research needed` entries where a named contact still needs to be found before outreach.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js / Express |
| Data | JSON file (`data/tracker.json`) |
| Frontend | Vanilla JS, no framework |
| Styling | Custom CSS, HubSpot-inspired |
| Deployment | Railway (free tier) |
| Auth | Simple token session, `AUTH_PASSWORD` env var |

### Data persistence note

On Railway's free tier, `tracker.json` does **not** persist across redeploys unless you attach a Volume at `/app/data`. Without a Volume, the app reseeds from `SEED_FIRMS` in `index.js` on every deploy.

**To preserve live data across deploys:**
1. Go to your Railway service
2. Add a Volume mounted at `/app/data`
3. Your tracker.json will survive redeploys

Until then: export your CSV before any deploy that changes `index.js`, then re-import after.

---

## Run Locally

```bash
npm install
npm start
```

App runs at `http://localhost:3000`.

To enable password protection locally:
```bash
AUTH_PASSWORD=yourpassword npm start
```

---

## Deploy to Railway

1. Push this repo to GitHub
2. Connect the repo in [Railway](https://railway.app)
3. Set `AUTH_PASSWORD` in Railway environment variables (optional)
4. Deploy — Railway auto-detects Node and runs `npm start`
5. Add a Volume at `/app/data` for data persistence (optional but recommended)

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_PASSWORD` | No | If set, enables login screen. Leave blank for no auth. |
| `PORT` | No | Port to run on. Railway sets this automatically. |

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/firms` | All firms |
| POST | `/api/firms` | Add a firm |
| PATCH | `/api/firms/:id` | Update firm status, notes, followup_date |
| POST | `/api/firms/:id/contacts` | Add a contact to a firm |
| PATCH | `/api/firms/:id/contacts/:cid` | Update a contact |
| DELETE | `/api/firms/:id/contacts/:cid` | Remove a contact |
| GET | `/api/export.csv` | Export all firms as CSV |
| POST | `/api/import` | Bulk import firms from CSV rows |
| POST | `/api/login` | Authenticate (if `AUTH_PASSWORD` is set) |
| GET | `/api/auth-required` | Check if auth is enabled |

---

## Firm Data Structure

```js
{
  id: number,
  tier: 1 | 2 | 3 | 4,
  name: string,
  why: string,              // Why this firm is relevant to the candidate
  status: 'not contacted' | 'contacted' | 'in conversation' | 'passed',
  last_contacted: string,   // ISO date string or null
  followup_date: string,    // ISO date string or null
  notes: string,
  website: string,
  linkedin: string,
  contacts: Contact[]
}
```

```js
{
  id: number,
  name: string,
  title: string,
  email: string,
  linkedin: string,
  last_contacted: string,
  status: 'not contacted' | 'emailed' | 'linkedin sent' | 'responded' | 'in conversation' | 'dead end',
  notes: string
}
```

---

## Project Files

```
/
├── index.js              # Server + SEED_FIRMS data + all API routes
├── public/
│   └── index.html        # Full frontend (single file, vanilla JS)
├── data/
│   ├── tracker.json      # Live data (created on first run, gitignored)
│   └── activity.json     # Job search effort metrics
├── docs/
│   └── PRODUCT_SPEC.md   # Full PRD for Snag as a multi-user SaaS (tabled)
├── package.json
└── railway.json
```

---

## Adding Firms

**Via the UI:** Click `+ Add Firm` in the top-right. Fill in name, tier, and why-fit. Add contacts manually in the expanded firm view.

**Via seed data:** Add entries directly to `SEED_FIRMS` in `index.js`. This is the right approach for bulk additions with full contact data. Push to GitHub and redeploy (export CSV first if you have live data you want to keep).

**Via CSV import:** Use the Import CSV button. Required column: `name`. Optional: `tier`, `why`, `website`, `linkedin`, `notes`, `status`, `followup_date`. Existing firms matched by name will be updated, not duplicated.

---

## Branding

- **Name:** Snag
- **Tagline:** *If you want to get a job from scratch, you must first build a CRM.*
- **Login error:** *Incorrect password. The irony of being locked out of your own job search tool is noted.*
- **Sidebar footer:** *Built instead of applying.*
- **Header tooltip:** *Could've used HubSpot*
- **Primary accent:** `#F97316` (orange)
- **Background:** `#F5F7FA`
- **Borders:** `#E5E7EB`

---

## Activity Tracking

`data/activity.json` tracks effort metrics for a future retrospective post:

- Sessions, hours, git commits, code lines written
- Firms researched, emails drafted, emails sent
- LinkedIn profiles verified
- Responses received, response rate
- Bounces resolved

Update this file manually at the end of each session.

---

## Future: Snag as a SaaS

See [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) for a full product requirements document covering:

- Multi-user onboarding (resume upload + geography + role targeting)
- AI-generated personalized outreach per recruiter
- Curated recruiter database as the core IP
- Gmail API integration for one-click draft creation
- B2C subscription and B2B outplacement firm licensing

**Status: Tabled.** Candidate is in an active search. Revisit when the search concludes.

---

*Built March 2026. Version 3.0.*
