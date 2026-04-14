# State of Snag

**Last updated:** 2026-04-14
**Current version:** v3.0 (see `client/src/components/ChangelogModal.jsx`)
**Branch:** `main` (direct-to-main deploy via Railway)
**Repo:** https://github.com/everettsteele/snag-jobs

This is the single entry point for picking up where we left off. If you're a fresh session: read this, then `CLAUDE.md`, then whatever's in `docs/superpowers/specs/` and `docs/superpowers/plans/` for the most recent work. Every major feature below has a spec doc at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and an implementation plan at `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.

---

## Table of Contents

1. [One-line Pitch](#one-line-pitch)
2. [Tech Stack & Deployment](#tech-stack--deployment)
3. [Architecture](#architecture)
4. [Data Model](#data-model)
5. [API Surface](#api-surface)
6. [Services](#services)
7. [Frontend](#frontend)
8. [Event Logging (F1)](#event-logging-f1)
9. [Gating Model](#gating-model)
10. [Environment Variables](#environment-variables)
11. [Shipped Features](#shipped-features)
12. [Roadmap Status](#roadmap-status)
13. [Known Issues / Follow-ups](#known-issues--follow-ups)
14. [Local Development](#local-development)
15. [Deployment](#deployment)

---

## One-line Pitch

**Snag Jobs is an AI-native job application CRM with per-application Claude copilots for the resume, the cover letter, the company research, the fit verdict, the interview prep, practice mode, and the post-interview debrief — with a job board crawler, Chrome extension, and outreach drafting layered in.**

The positioning: Teal/Huntr-class tracker UX with interview coaching nobody else has, tied to a per-user resume-variant model that keeps one LinkedIn file clean while shipping angled variants.

---

## Tech Stack & Deployment

**Backend:** Node 18+, Express 4, PostgreSQL via `pg` driver, Anthropic SDK (`claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`), Stripe for billing, `multer` + `pdf-parse@2.4.5` for PDF uploads, `pg` connection pool in `src/db/pool.js`, `express-rate-limit` for abuse control.

**Frontend:** React 19, @tanstack/react-query 5, Tailwind 4 (via @tailwindcss/postcss), Vite 6, React Router 7. Single bundle served from `dist/`.

**Deployment:** Railway. Every push to `main` auto-deploys. Migrations in `src/db/migrations/` run on boot via `npm run db:migrate`. Persistent volume for PDF uploads at `data/resumes/`. Postgres is Railway-managed.

**Entrypoint:** `server.js` at repo root. (There was a stale `src/server.js` — deleted.)

**Model IDs in use:**
- `claude-opus-4-6[1m]` — interactive sessions (not currently called from the app)
- `claude-sonnet-4-6` — interview chat, prep brief, debrief, dossier, resume variants, cover letters
- `claude-haiku-4-5-20251001` — URL parse meta extraction, should-I-apply verdict, resume variant selection

---

## Architecture

```
┌─ Chrome Extension ─┐       ┌─ React SPA (Vite) ─┐
│ extension/         │ HTTP  │ client/src/        │ HTTP
│ snag-from-LinkedIn │──────▶│ Applications page  │─────┐
└────────────────────┘       │ Settings page      │     │
                             │ etc.               │     │
                             └────────────────────┘     ▼
                                              ┌─ Express / Node ─┐
                                              │ server.js        │
                                              │ /api/*           │
                                              │                  │
                                              │ routes/*.js      │──┐
                                              │ services/*.js    │  │
                                              │ middleware/*.js  │  │
                                              │ db/store.js      │  │
                                              └──────────────────┘  │
                                                                    ▼
                                                         ┌─ PostgreSQL (Railway) ─┐
                                                         │ tenants/users/profiles  │
                                                         │ applications + chat... │
                                                         │ resume_variants        │
                                                         │ product_events (F1)    │
                                                         │ company_dossiers       │
                                                         │ application_prep_briefs│
                                                         │ application_debriefs   │
                                                         └────────────────────────┘

                                         ┌────────────▶ Anthropic API (Claude)
                                         │
                                         ▼
                              ┌─ services/anthropic.js ─┐
                              │ services/dossier.js     │
                              │ services/prepBrief.js   │
                              │ services/debrief.js     │
                              │ services/verdict.js     │
                              │ services/crawler.js     │ (job board scrapes)
                              └─────────────────────────┘
```

Request lifecycle:
1. Client sends an auth-token or API key (Chrome extension) → `requireAuth` middleware hydrates `req.user` with profile.
2. Route modules handle endpoints (grouped by domain — applications, applications-contacts, applications-chat, prepBrief, debrief, dossier, verdict, resumes, billing, etc.).
3. Services own external calls (Anthropic, crawler scrapes, Google OAuth).
4. `db/store.js` is the single accessor layer to Postgres. All writes go through named accessors — no ad-hoc queries in route handlers.
5. `logEvent` is fired-and-forgotten across many routes to populate `product_events` (analytics).

---

## Data Model

**Migrations live in `src/db/migrations/001_*.sql` through `011_*.sql`.** Each is wrapped in `BEGIN/COMMIT` and idempotent (uses `IF NOT EXISTS`). Railway applies in order on boot.

### Core tables (from migration 001)

- `tenants` — id, name, plan (`free` | `pro`), stripe_customer_id, stripe_subscription_id
- `users` — id, tenant_id, email, role, api_key, password_hash
- `user_profiles` — id, user_id, full_name, phone, linkedin_url, location, background_text, target_roles (TEXT[]), target_geography (TEXT[]), signature_style, signature_closing, signature_image_url, `analytics_opt_out` (added later), `dossier_generations_per_week` quota tracked in `usage_log`
- `platform_firms` — curated recruiter firm list
- `user_outreach` — user's outreach pipeline (recruiter/CEO/VC drafts + cadence)
- `resume_variants` — per-user (id, user_id, slug, label, file_url, filename, parsed_text, is_default)
- `networking_events` — id, tenant_id, user_id, source ('manual' | 'google_calendar'), external_id, title, start_date, start_time, end_time, location, contacts (JSONB), next_steps (JSONB), hidden
- `applications` — the flagship table (see below)
- `job_board_leads` — crawler output + snag state
- `usage_log` — AI action accounting (used by `checkAiLimit` quota middleware)

### `applications` (final shape after all migrations)

- Basic: `id, tenant_id, user_id, company, role, source_url, notion_url, applied_date, status, follow_up_date, notes, cover_letter_text, resume_variant, drive_url, drive_folder_id, activity (JSONB), last_activity`
- Added in migration 006: `gmail_thread_id` (for future email sync)
- Added in migration 008: `snoozed_until DATE`, `closed_reason TEXT`, `jd_text TEXT` (cached JD for subsequent AI calls)

**5-status model** (after migration 008 backfill):
- `identified` — default on creation
- `ready_to_apply` — auto-advance when cover_letter_text AND resume_variant are both set
- `applied` — user clicked Apply
- `interviewing` — unlocks Interview Co-pilot tab features
- `closed` — with `closed_reason` sub-label (offer | rejected | withdrawn | no_response | other)

### Tables added in this session's work

**Migration 008 (`application_contacts`, `application_chats`):** per-application people list and interview chat messages.

**Migration 009 (`product_events`):** anonymized F1 event logging.

**Migration 010 (`company_dossiers`):** tenant-independent shared company summaries. UNIQUE by `company_key` (normalized slug).

**Migration 011 (`application_prep_briefs`, `application_debriefs`, `application_chats.mode` column):** Interview Co-pilot tables. `prep_briefs` is one-per-app (UNIQUE `application_id`), `debriefs` is many-per-app, `mode` column distinguishes Coach from Practice chat streams.

### Full migration list

| # | File | What |
|---|------|------|
| 001 | `001_multi_tenant_schema.sql` | Initial schema |
| 002 | `002_*.sql` | (pre-session; check file) |
| 003 | `003_resume_upload.sql` | Add `parsed_text`, `filename` to resume_variants |
| 004 | `004_billing.sql` | Stripe fields on tenants |
| 005 | `005_*.sql` | (pre-session) |
| 006 | `006_*.sql` | Gmail thread id + pipeline fields |
| 007 | `007_user_api_keys.sql` | Per-user API keys for extension |
| 008 | `008_applications_crm.sql` | snooze + jd_text + closed_reason + contacts + chats |
| 009 | `009_product_events.sql` | F1 analytics + analytics_opt_out |
| 010 | `010_company_dossiers.sql` | Company dossier cache |
| 011 | `011_interview_copilot.sql` | Prep briefs + debriefs + chats.mode |

---

## API Surface

All routes mounted under `/api`. Most require `requireAuth`. Rate limiting via `globalLimiter` (all) + `expensiveLimiter` (AI-calling endpoints).

### Auth & profile (`src/routes/auth.js`)
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/auth/me` → `{ user, profile, resumeVariants }`
- `PATCH /api/auth/profile` — updates `user_profiles`. Includes `analytics_opt_out`.

### Applications (`src/routes/applications.js`)
- `GET /api/applications`
- `POST /api/applications` — defaults status=`identified`, fires `autoSelectResumeInBackground` + `autoBuildDossierInBackground`
- `PATCH /api/applications/:id` — includes `maybeAutoAdvance` wiring
- `DELETE /api/applications/:id`
- `POST /api/applications/bulk` — `{ ids, action: 'set_status'|'delete'|'snooze'|'generate_letter', value }`. `generate_letter` gated by `expensiveLimiter` + `checkAiLimit` via conditional middleware.
- `PATCH /api/applications/:id/snooze` — `{ until: YYYY-MM-DD | null }`
- `POST /api/applications/parse-url` — Haiku meta extraction from pasted URL
- `POST /api/applications/:id/generate-letter` — single cover letter
- `POST /api/applications/batch-generate-letters` — all identified apps missing letters (SSE progress)
- `POST /api/applications/batch-packages` — queued apps get Drive folders
- `POST /api/applications/:id/snag` — extension entry point (via `src/routes/jobboard.js` actually)

### Applications Contacts (`src/routes/applications-contacts.js`)
- `GET /api/applications/:id/contacts`
- `POST /api/applications/:id/contacts`
- `PATCH /api/applications/contacts/:contactId`
- `DELETE /api/applications/contacts/:contactId`
Both PATCH + DELETE verify ownership via the parent app's `user_id`.

### Applications Chat (`src/routes/applications-chat.js`) — Pro + interviewing gated
- `GET /api/applications/:id/chat?mode=coach|practice` (default coach)
- `POST /api/applications/:id/chat` body `{ message, mode }`, 80-turn cap per mode, per-mode history, persists user message before model call (survives model failures)
- `DELETE /api/applications/:id/chat` — clears BOTH modes

### Prep Brief (`src/routes/prepBrief.js`) — Pro + interviewing gated
- `GET /api/applications/:id/prep-brief`
- `POST /api/applications/:id/prep-brief/build` body `{ refresh?: bool }`

### Debrief (`src/routes/debrief.js`) — Pro + interviewing gated
- `GET /api/applications/:id/debriefs`
- `POST /api/applications/:id/debriefs` body `{ transcript: 500-20000 chars }`. Side effect: appends `debrief_logged` to application activity timeline.
- `DELETE /api/applications/:id/debriefs/:debriefId`

### Verdict (`src/routes/verdict.js`)
- `POST /api/applications/verdict` — Haiku fit score for a pasted URL. Ungated (Haiku cost negligible). `expensiveLimiter` only.

### Dossier (`src/routes/dossier.js`) — Pro-gated for build, read is free
- `GET /api/applications/:id/dossier` — always readable
- `POST /api/applications/:id/dossier/build` body `{ refresh?: bool }`. Inline quota check (3 generations/week for Free; cached fresh reads skip the quota charge).

### Job Board (`src/routes/jobboard.js`)
- `GET /api/job-board`, `PATCH /api/job-board/:id`, `POST /api/job-board/batch-update`
- `POST /api/job-board/snag` — Chrome extension entry (creates Application + fires resume auto-select + dossier auto-build)
- `POST /api/job-board/crawl` — user-triggered crawl; runs in background, emits `job_board.crawled` per-source events
- `GET /api/job-board/sources`
- `GET /api/job-board/config`, `PATCH /api/job-board/config` — source selection + location filters (Free plan limited to 3 sources)

### Resumes (`src/routes/resumes.js`)
- `GET /api/resumes` — list variants
- `POST /api/resumes/base/upload` — upload base PDF (uses pdf-parse v2 `PDFParse` class)
- `POST /api/resumes/generate-variants` body `{ angles: [{ name, source }] }` — Pro 4/Free 1
- `POST /api/resumes/:slug/upload` — legacy per-slug upload
- `DELETE /api/resumes/:slug/file`, `DELETE /api/resumes/:slug`
- `GET /api/resumes/:slug/text`
- `POST /api/resumes/generate` — legacy operator/partner/builder/innovator angles
- `PATCH /api/resumes/:slug/default`

### Other routes
- `src/routes/firms.js` — curated firm directory + segments/stats
- `src/routes/networking.js` — events + Google Calendar sync + next-steps
- `src/routes/google.js` — OAuth (Drive, Gmail, Calendar)
- `src/routes/sse.js` — SSE channel for batch progress
- `src/routes/export.js` — CSV exports
- `src/routes/billing.js` — Stripe checkout + portal
- `src/routes/morning-sync.js` — aggregated morning routine
- `src/routes/admin.js` — admin-only dashboards
- `src/routes/snag-metrics.js` — personal weekly targets
- `src/routes/signature.js` — email signature uploads
- `src/routes/diagnostics.js` — `/api/health`

---

## Services

Files in `src/services/`:

- **`anthropic.js`** — core Anthropic helpers:
  - `generateCoverLetter(app, jd, userCtx)`
  - `selectResumeVariant(app, jd, userCtx)` — AI variant picker
  - `generateResumeVariant({ baseText, angleName, targetRole })` — angled variant rewrite
  - `generateEmailDraft({...})` — outreach email generation
  - `extractJobPostingMeta(jd, url)` — Haiku meta pull
  - `extractCompanyFromUrl(url)` — 10-ATS pattern matcher (Greenhouse, Lever, Workable, Ashby, Rippling, Workday, SmartRecruiters, BambooHR, JazzHR, careers/jobs subdomains)
  - `fetchJobDescription(url)` — scrape + sanitize
  - `cleanCoverLetterText(raw)` — strip LLM preamble/markdown
  - `buildCoverLetterSystemPrompt(profile)` — cover-letter system prompt
  - `buildInterviewChatSystemPrompt(ctx)` — Coach or Practice prompt (mode-aware)

- **`crawler.js`** — job board scrapes. `JOB_SOURCES` list + `crawlJobBoards(tenantId, userId)`. Respects user config (source selection, location filters, min_score). Pro-unlimited; Free capped to 3 sources.

- **`dossier.js`** — Company intelligence. `buildDossier(...)`, `companyKey(company, url)`, `isFresh(d)`, `ageDays(d)`, `getCachedDossier(key)`, `TTL_DAYS = 30`.

- **`prepBrief.js`** — Interview prep brief generation. One Sonnet call, dossier-enriched prompt, upserts to `application_prep_briefs`.

- **`debrief.js`** — Post-interview structured summary + thank-you draft. One Sonnet call. Writes to `application_debriefs`.

- **`verdict.js`** — Should-I-Apply Haiku fit score. Returns `{ verdict, score, reasoning, green_flags, red_flags }`. Neutral fallback when JD < 200 chars.

- **`events.js`** — F1 analytics. `logEvent(tenantId, userId, type, opts)` (fire-and-forget, never throws), `lengthBucket`, `urlHost`, `hashSlug`.

- **`google/calendar.js`, `google/oauth.js`, etc.** — Google integration.

---

## Frontend

**Pages** (`client/src/pages/`):
- `Login.jsx`, `Register.jsx`
- `Dashboard.jsx` — KPI row (Email Outreach, Applications, Networking card with real calendar data) + Daily Activity chart + Morning Sync modal + Snag Metrics
- `Applications.jsx` — the flagship page. Stable-sort table, bulk bar, quick-add URL paste with parallel verdict call, 5-status dropdown, row checkboxes
- `JobBoard.jsx` — crawler lead triage
- `Outreach.jsx` — firm/CEO/VC pipeline
- `Events.jsx` — week + upcoming calendar view
- `Settings.jsx` — profile, signature, preferences, Google OAuth, calendar picker, API key, billing, resumes (base + angled variants), **privacy (F1 opt-out)**, job search config

**Components** (`client/src/components/`):
- `Layout.jsx` — sidebar + topbar, version badge opens ChangelogModal
- `ChangelogModal.jsx` — user-visible changelog (v1.0 → v3.0)
- `Toast.jsx`, `ResumeViewer.jsx`, etc.
- `applications/ApplicationRow.jsx` — row + expanded 5-tab detail (Timeline, Company, Notes, People, Materials; Interview Prep when status=interviewing)
- `applications/InterviewChat.jsx` — Pro-gated chat with Coach/Practice toggle
- `applications/PrepBriefCard.jsx` — collapsible brief card
- `applications/DebriefList.jsx` + `applications/DebriefLogModal.jsx` — debriefs

**Important frontend behaviors:**
- **Stable sort** — Applications table doesn't reshuffle on status mutation. Filter changes drop the row from view (correct).
- **Click-row-to-expand** — anywhere on the row toggles the 5-tab panel.
- **Apply button** — opens `source_url` + `drive_url` in new tabs, PATCHes status=applied. Disabled if either URL missing.
- **Optimistic update** — status/resume changes apply instantly, server confirms via `onSettled` invalidation.
- **Mode-scoped query keys** — InterviewChat uses `['app-chat', appId, mode]` so Coach and Practice streams don't cross-contaminate the cache.

---

## Event Logging (F1)

**Table:** `product_events` (migration 009). Anonymized payloads only — enums, buckets, hostnames, hashes. Never raw text/names/URLs.

**Opt-out:** `user_profiles.analytics_opt_out` (defaults false). Privacy toggle in Settings.

**Event types emitted:**

| event_type | where | purpose |
|---|---|---|
| `application.created` | POST applications + snag | source attribution |
| `application.status_changed` | PATCH applications | funnel analysis |
| `application.auto_advanced` | `maybeAutoAdvance` | auto-transition rate |
| `application.closed` | PATCH with status=closed | outcome tracking |
| `application.apply_clicked` | PATCH with status=applied | CTR measurement |
| `application.snoozed` | PATCH snooze | engagement signal |
| `cover_letter.generated` | 3 endpoints (single/batch/bulk) | mode analysis |
| `resume_variant.selected` | 3 call sites | variant performance |
| `resume_variant.generated` | generate-variants | AI resume usage |
| `resume.uploaded` | base upload | onboarding funnel |
| `url.parsed` | parse-url | quick-add usage |
| `interview_chat.turn` | chat POST (coach) | coach chat volume |
| `practice_chat.turn` | chat POST (practice) | practice chat volume |
| `job_board.crawled` | crawl completion (per-source) | crawler yield |
| `job_board.lead_snagged` | snag | conversion rate |
| `company_dossier.built` | dossier build (user or auto) | dossier cost |
| `company_dossier.read` | dossier GET | dossier utility |
| `company_dossier.refresh_requested` | Pro refresh | refresh cadence |
| `verdict.generated` | verdict POST | verdict distribution |
| `prep_brief.built` | prep brief build | prep usage |
| `debrief.logged` | debrief POST | debrief cadence |

Ways to query:
```sql
-- Personal funnel (how do my cover letters convert?)
SELECT payload->>'mode' AS mode, COUNT(*)
FROM product_events WHERE user_id = $1 AND event_type = 'cover_letter.generated'
GROUP BY 1;

-- Aggregate: which job board source has highest snag→apply rate?
WITH snagged AS (...), applied AS (...)
SELECT ...
```

---

## Gating Model

Defined in `src/middleware/tier.js`:

```js
const LIMITS = {
  cover_letters_per_week: 3,       // free
  resumes: 1,                       // free (base only; Pro gets 4 variants)
  dossier_generation_per_week: 3,   // free; cached reads always free
};
```

**Pro unlocks:**
- Unlimited cover letters, resume variants (4 angles), job board sources
- Unlimited dossier generations + Refresh button
- Interview chat (Coach + Practice modes)
- Prep Brief generation
- Debrief generation

**Free keeps:**
- Unlimited applications + tracking
- 3 cover letters/week
- 1 resume variant (base only)
- 3 dossier generations/week (reads of cached dossiers: free forever — this is the PLG motion)
- Should-I-Apply verdict (Haiku — ungated)
- URL parse (Haiku — ungated)
- Applications table, contacts, notes, timeline
- Google Calendar / Gmail / Drive OAuth

**`PRO_FOREVER` env var** — comma-separated emails that always have Pro (default: `everett.steele@gmail.com`).

---

## Environment Variables

Set in Railway's **Variables** panel (NEVER in source):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (Railway auto-provides) |
| `ANTHROPIC_API_KEY` | Claude API access |
| `ADMIN_PASSWORD` | Legacy single-password auth (still accepted for CLI) |
| `API_KEY` | Legacy API key (replaced by per-user keys) |
| `PRO_FOREVER_EMAILS` | Comma-separated emails bypassing billing gate |
| `DRIVE_WEBHOOK_URL` | Apps Script endpoint for building Drive packages |
| `STRIPE_SECRET_KEY` | Stripe server key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `STRIPE_PRICE_ID` | Pro plan price id |
| `PUBLIC_URL` | Base URL for Stripe redirects + OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth |
| `GOOGLE_REDIRECT_URI` | OAuth callback |

`PORT` defaults to 3000 locally; Railway sets it automatically.

---

## Shipped Features

Chronological summary of what this session delivered (each has a spec + plan in `docs/superpowers/`):

### Applications CRM + Interview Prep Chat Revamp (shipped)
**Spec:** `2026-04-13-applications-crm-chat-revamp-design.md`
**Plan:** `2026-04-13-applications-crm-chat-revamp.md`

14 tasks. 5-status model with auto-advance, stable row sort, redesigned actions column, bulk select + bulk actions, expandable row with tabs (Timeline/Notes/People/Materials), smart snooze, quick-add via URL paste, first-class contacts per app, Pro-gated interview chat at status=interviewing with prompt caching.

### F1 Event Logging Foundation
**Spec:** `2026-04-13-event-logging-foundation-design.md`
**Plan:** `2026-04-13-event-logging-foundation.md`

10 tasks. `product_events` table, `logEvent` helper, ~16 instrumentation points, `analytics_opt_out` column on user_profiles, Settings privacy toggle.

### B: Company Intelligence Dossier
**Spec:** `2026-04-13-company-intelligence-dossier-design.md`
**Plan:** `2026-04-13-company-intelligence-dossier.md`

8 tasks. Tenant-independent `company_dossiers` cache keyed by normalized slug. Sonnet call generates summary + 3-6 facts + detected links from JD text. Auto-builds on app creation (background); explicit build via Company tab. 30-day TTL. Free 3/week generation cap; reads of cached entries always free (PLG).

### E: Should-I-Apply Verdict
**Spec:** `2026-04-13-should-i-apply-verdict-design.md`
**Plan:** `2026-04-13-should-i-apply-verdict.md`

5 tasks. Paste URL → parallel parse-url + verdict Haiku calls → color-coded card at top of AddApplicationModal showing 4-tier fit verdict + reasoning + green/red flags. Ungated.

### A: Interview Co-pilot Suite
**Spec:** `2026-04-13-interview-copilot-design.md`
**Plan:** `2026-04-13-interview-copilot.md`

14 tasks. Three features bundled on the Interview Prep tab (unlocks at status=interviewing, Pro-gated):

1. **Prep Brief** — one-shot structured doc (likely questions, company research, resume highlights, questions to ask). Dossier-aware prompt.
2. **Practice Mode** — mode toggle on existing chat. Claude plays skeptical hiring manager. Separate history stream per mode via `application_chats.mode` column.
3. **Debrief** — paste transcript → structured summary + thank-you email draft. Multiple per app (one per interview round). Appends to activity timeline.

### Other fixes shipped this session
- Rename repo + local folder from `meridian-recruiter-tracker` → `snag-jobs`
- Version rebase from `v10.0` → `v3.0` semver (all changelog content preserved)
- pdf-parse v2 API migration (was calling it as a function; v2.4.5 exposes `PDFParse` class)
- Resume UX rebuild: base + AI-angled variants driven by target_roles
- Resume column narrowing + dynamic variant dropdown
- Dashboard Networking card rebuilt with real calendar data (was filtering on `e.date` but table column is `start_date`)
- CoverLetterModal generate button rewired after page-shell rewrite dropped the mutation
- Default new apps to `'identified'` instead of legacy `'queued'`
- Company name extraction via URL pattern (10 ATS hosts) + model hint
- Contacts PATCH/DELETE ownership check
- Stale src/server.js deletion
- Bulk `generate_letter` quota gating
- Parse-URL rate limiting
- Chat user-message persistence before model call
- Dossier inline quota check (not middleware — cached reads no longer 429 for free users at cap)
- InterviewChat onSettled refresh so failed sends still reveal the persisted user turn

---

## Roadmap Status

### ✅ Shipped
- F1 event logging foundation
- B: Company Intelligence Dossier
- E: Should-I-Apply Verdict
- A: Interview Co-pilot Suite (Prep + Practice + Debrief)

### 🧩 Open (pick any when resuming)
1. **Insights surface** — use F1 data for personal + aggregate dashboards. "Your operator variant converts 3× vs builder." "Greenhouse jobs respond 2× faster than LinkedIn." Needs enough data first — come back to this after a few weeks of real usage.
2. **Calendar-triggered nudges** — 24h before an interview on Google Calendar, surface the prep brief as a push. Requires calendar↔application matching (company/title fuzzy match + contact-email overlap).
3. **Warm-intro finder** — LinkedIn connection import (OAuth or CSV). For each snagged job, surface mutual connections at the company + generate a personalized intro ask.
4. **Rejection pattern analytics** — once `closed_reason` data accrues, Claude analyzes patterns ("you're 3× more likely to make it past Stage 1 when the posting mentions 'startup'").
5. **Auto-apply to known ATS** — Greenhouse/Lever/Workday integrations. High effort, moonshot-grade differentiation.
6. **Standalone verdict preview** — paste URL, get fit read without creating an app. Drives top-of-funnel traffic.
7. **Compare two jobs side-by-side** — verdict matrix.
8. **Interview question banks by company** — crowdsource patterns from anonymized `prep_brief.built` + outcome data.

### 🧹 Small follow-ups / tech debt
- `prep_brief.viewed` event (debounced client-side via localStorage) — spec'd but not implemented.
- `outreach.drafted` event (instrumented when we touch that route next).
- `CHAT_TURN_CAP` constant lives in `applications-chat.js` only; could be centralized.
- Duplicate `getClient()` in `applications-chat.js` vs. `anthropic.js` — cosmetic.
- Dossier `generated_by_user_id` on deletion of the generating user becomes null (FK SET NULL); not a concern but worth noting.
- `activity` array is not indexed for search. If timeline search becomes a feature, consider moving to a dedicated table.
- Migration 011 has an index on `application_chats(application_id, mode, created_at)` — verify query plans pick it up if turn counts get noisy.

---

## Known Issues / Follow-ups

None actively broken. Minor items from reviews that didn't block ship:

- `application.auto_advanced` payload hardcodes `from:'identified', to:'ready_to_apply'`. `maybeAutoAdvance` only handles that transition today; if the helper ever grows, the event payload should be parameterized.
- `InterviewChat` does not currently distinguish Coach vs Practice turn counts in the displayed `N/80 turns` label — needs to pull `modes: { coach: {...}, practice: {...} }` from GET and render the active one. Plan mentioned this but simplified for V1.

---

## Local Development

```bash
git clone https://github.com/everettsteele/snag-jobs
cd snag-jobs
npm install

# Postgres (Railway CLI local proxy, or your own local Postgres)
# set DATABASE_URL in .env

# Required env vars at minimum: DATABASE_URL, ANTHROPIC_API_KEY
# Optional: STRIPE_*, GOOGLE_*, DRIVE_WEBHOOK_URL

# Run migrations
npm run db:migrate

# Backend
npm start                # runs server.js on PORT=3000

# Frontend (in another terminal)
npm run dev              # Vite on 5173, proxies /api to backend

# Production build
npm run build            # writes to dist/
```

---

## Deployment

Railway auto-deploys on any push to `main`. Build command: `npm install && npm run build`. Start command: `npm start`. Migrations run automatically on boot via `npm run db:migrate`.

**Post-deploy verification sequence (from this session):**

1. Check `/api/health` returns 200.
2. Log in → Settings → Privacy toggle visible.
3. Paste a Greenhouse/Lever URL into Applications quick-add. Modal opens, verdict card renders within ~5s.
4. Snag the app. Expanded row → Company tab auto-populates within ~10s (dossier).
5. Move app to Interviewing. Interview Prep tab shows three sections. Build prep brief → 4 sections populate.
6. Toggle Practice → empty chat. Click suggestion chip. Claude asks a question.
7. Send a reply. Get feedback + follow-up.
8. Log a debrief (>500 char transcript). Thank-you draft generated. Copy works.
9. Timeline tab has `auto_ready`, `applied`, `debrief_logged` activity entries.

DB smoke:
```sql
SELECT event_type, COUNT(*) FROM product_events
WHERE user_id = '<your-id>'
GROUP BY 1 ORDER BY 2 DESC;

SELECT status, COUNT(*) FROM applications
WHERE user_id = '<your-id>'
GROUP BY 1;
```

---

## How To Resume Work

1. Read this file + `CLAUDE.md` + `docs/superpowers/specs/*` + `docs/superpowers/plans/*`.
2. `git log --oneline -30` for the tail of what was done.
3. Pick from [Roadmap Status § Open](#open-pick-any-when-resuming) or whatever the user asks.
4. For any non-trivial feature, use the brainstorming → writing-plans → subagent-driven-development flow (proven workflow — all four major features this session used it).
5. **Meridian global rules** (from `CLAUDE.md`):
   - After every completed task: `git add . && git commit -m "..." && git push`.
   - Never commit `.env`, `.db` files, `node_modules`.
   - Production env vars go in Railway Variables, never source.
   - Architecture: simple and surgical.

---

## Contact

Owner: Everett Steele <everett.steele@gmail.com> (also `PRO_FOREVER` default).
Parent company: **neverstill.llc** (Meridian projects).
