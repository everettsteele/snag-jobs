# Event Logging Foundation — Design

**Date:** 2026-04-13
**Status:** Approved
**Scope:** Anonymized product event logging across Snag Jobs. Foundation for personal and aggregate insights.

## Goal

Capture structured events from every meaningful user action so Snag can:
1. Give each user personal insights (e.g., "your operator variant converts 3× vs builder").
2. Compute opt-in aggregate insights across users (e.g., "Greenhouse jobs get 2× responses vs LinkedIn").
3. Retain a non-destructive history even after rows get deleted (apps closed, variants removed, etc.).

Collect data now so future features have signal from day one. Zero UI in this spec — everything is instrumentation plus a single privacy toggle.

## Non-Goals

- Insights UI (separate future spec, reads from this table).
- Aggregation jobs / materialized views (future spec).
- Replacing the existing `usage_log` table, which stays dedicated to AI token accounting and quota enforcement.
- Event streaming to a third-party analytics platform.

## Data Model

### Why a new table instead of extending `usage_log`

`usage_log` is hot-path for billing and quota enforcement (`checkAiLimit` queries it). It captures AI actions with token counts. Mixing analytics events (status changes, snoozes, apply-clicks) into it would:
- Pollute quota queries with irrelevant rows.
- Block future compliance/billing work that assumes `usage_log` == AI usage.
- Reduce index effectiveness.

New table is cleaner separation, cheaper writes (no tokens column to update), and independent retention policy later.

### Migration `009_product_events.sql`

```sql
BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS analytics_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS product_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_events_user_time
  ON product_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_type_time
  ON product_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_entity
  ON product_events(entity_type, entity_id);

COMMIT;
```

Foreign keys cascade on tenant/user deletion. No FK on `entity_id` — events survive when the referenced row is deleted (that's the whole point).

## Event Taxonomy

Every logged event has: `event_type`, optional `entity_type` + `entity_id`, and a structured `payload`. Payload is **always anonymized** — no raw text, no company/role strings, no full URLs. Lengths, domains, slugs, enums only.

| event_type | entity_type | payload keys |
|---|---|---|
| `application.created` | `application` | `source` (`manual`\|`snag`\|`bulk`\|`quick_add`), `source_domain`, `has_url` |
| `application.status_changed` | `application` | `from`, `to`, `days_in_prev_status` |
| `application.auto_advanced` | `application` | `from`, `to` |
| `application.snoozed` | `application` | `until_days_out`, `unsnoozed` (bool) |
| `application.closed` | `application` | `closed_reason`, `days_since_created` |
| `application.apply_clicked` | `application` | `had_cover_letter`, `had_drive_url` |
| `cover_letter.generated` | `application` | `word_count`, `mode` (`single`\|`bulk`\|`batch`), `jd_length_bucket` (`none`\|`short`\|`medium`\|`long`) |
| `resume_variant.generated` | `resume_variant` | `base_word_count`, `output_word_count`, `angle_source` (`target_role`\|`custom`) |
| `resume_variant.selected` | `application` | `slug_hash`, `auto` (bool) |
| `resume.uploaded` | `resume_variant` | `text_length` |
| `interview_chat.turn` | `application` | `turn_number`, `tokens_in`, `tokens_out`, `contact_count` |
| `outreach.drafted` | `user_outreach` | `category` (`firms`\|`ceos`\|`vcs`), `cadence_day` |
| `job_board.crawled` | — | `source`, `urls_found`, `urls_kept`, `filtered_by_location`, `filtered_by_score` |
| `job_board.lead_snagged` | `job_board_lead` | `source`, `fit_score` |
| `url.parsed` | — | `host`, `company_came_from` (`url_pattern`\|`model`\|`fallback`) |

`slug_hash` for resume variants: a short deterministic hash per-user so aggregate queries can compare relative performance of variant slots without exposing user-chosen variant names (which can contain role titles).

`source_domain` always the URL's hostname — never path or query. LinkedIn URLs reduce to `linkedin.com`.

Future events can be added without schema change since `payload` is JSONB.

## Anonymization Rules

Enforced at the `logEvent` helper layer. No caller should ever put these into a payload:

- Raw cover letter, resume, JD, notes, or email body text.
- Full URLs. Use `new URL(url).hostname` only.
- Company names, role titles, contact names, contact emails.
- UUIDs other than `entity_id` (which lives in its own column).

Allowed: word counts, string lengths bucketed (`short`/`medium`/`long`), enum values (`from`/`to` status, `source`, `kind`), boolean flags, ISO date diffs (`days_in_prev_status`, `days_since_created`), numeric model IDs or slug hashes.

## Privacy: Opt-Out

`user_profiles.analytics_opt_out` defaults to `FALSE` (events are logged by default). When `TRUE`:
- `logEvent` becomes a no-op for that user.
- User can toggle via Settings → Privacy.
- No retroactive deletion in this spec; a later "forget me" feature can cascade delete by user_id.

Opt-out check happens in the `logEvent` helper, cached per-request on `req.user.analyticsOptOut` when available. For background jobs where `req` isn't present, the helper does a single SELECT per invocation, which is acceptable for non-critical-path writes.

## Helper API

New file: `src/services/events.js`

Public surface:

```js
// Fire-and-forget. Never throws, never blocks. Errors logged via diagLog.
logEvent(tenantId, userId, eventType, opts?) → Promise<void>
  // opts: { entityType?, entityId?, payload? }

// Bucket helper for string lengths in payloads.
lengthBucket(str) → 'none' | 'short' | 'medium' | 'long'

// Derive source_domain safely from any URL string.
urlHost(url) → string (hostname or '')

// Short deterministic hash for a variant slug scoped to the user.
hashSlug(userId, slug) → string (16-char hex)
```

Internally calls a new DB accessor `db.createProductEvent(...)`.

Never `await`ed by callers — fire-and-forget so analytics lag never blocks user responses. Helper catches its own errors.

## Instrumentation Points

Files touched with one `logEvent` call each:

- `src/routes/applications.js`
  - POST `/applications` → `application.created`
  - PATCH `/applications/:id` (when status changes) → `application.status_changed`; when status becomes `closed` → additionally `application.closed`
  - `maybeAutoAdvance` (when it fires) → `application.auto_advanced`
  - PATCH `/applications/:id/snooze` → `application.snoozed`
  - POST `/applications/:id/generate-letter` → `cover_letter.generated` with `mode='single'`
  - POST `/applications/batch-generate-letters` (per app) → `cover_letter.generated` with `mode='batch'`
  - POST `/applications/bulk` (generate_letter action, per app) → `cover_letter.generated` with `mode='bulk'`
  - POST `/applications/parse-url` → `url.parsed`

- `src/routes/jobboard.js`
  - POST `/job-board/snag` → `application.created` with `source='snag'` + `job_board.lead_snagged`
  - crawl completion (per source) → `job_board.crawled`

- `src/routes/applications-chat.js`
  - After successful model reply → `interview_chat.turn`

- `src/routes/resumes.js`
  - POST `/resumes/base/upload` → `resume.uploaded`
  - POST `/resumes/generate-variants` (per angle) → `resume_variant.generated`

- `src/routes/applications.js` (Apply button PATCH flow) or a new endpoint capturing the click — treat the PATCH that sets status=applied as the apply click event. → `application.apply_clicked`.

- `src/services/anthropic.js` or callers of `selectResumeVariant` → `resume_variant.selected`.

Each call is ≤ 2 lines at the call site. Payload construction is inline or via a small helper.

## Settings UI (minimal)

Add a single toggle to the existing PrivacySection (or create it if absent) in `client/src/pages/Settings.jsx`:

```
[ ] Help Snag get smarter
Your anonymized usage patterns (status changes, variant performance,
response rates) feed personal and aggregate insights. Never includes
any text from your resume, cover letters, job descriptions, or notes.
```

Checked = `analytics_opt_out = false` (default). Unchecked = opt-out.

New endpoint: `PATCH /auth/profile` already accepts a partial profile update. Add `analytics_opt_out` to the allowed fields list.

## Testing

Manual smoke after implementation:

1. Create an app manually → query `product_events WHERE event_type = 'application.created'` — verify row with correct payload shape and no PII.
2. Change status → verify `status_changed` event with `from`, `to`, `days_in_prev_status`.
3. Generate a cover letter → verify `cover_letter.generated` with word count but no letter text.
4. Toggle opt-out in Settings → repeat steps 1–3 → verify NO events are written for that user.
5. Toggle back on → events resume.

Query patterns this enables (for future insights):

```sql
-- Personal: cover letter conversion by variant
SELECT payload->>'slug_hash', count(*) FILTER (WHERE event_type = 'application.status_changed' AND payload->>'to' = 'interviewing') AS interviews
FROM product_events WHERE user_id = $1
GROUP BY 1;

-- Aggregate: source-board response rate
SELECT payload->>'source', avg((payload->>'fit_score')::int) FROM product_events
WHERE event_type = 'job_board.lead_snagged'
GROUP BY 1;
```

## Error Handling

- `logEvent` never throws. DB errors logged via existing `diagLog` and swallowed.
- If `analytics_opt_out` lookup fails, default to opt-in (event is logged). Safer fallback — losing an event is worse than losing a bit of opt-out honor for a transient DB glitch. Future hardening could invert this.
- Migration idempotent via `IF NOT EXISTS` on all DDL.

## Rollout

Single PR. Migration + helper + instrumentation + Settings toggle land together. No feature flag needed — events start flowing on deploy.

## Open Questions (addressed)

- **Reuse `usage_log`?** No — separation of billing vs. analytics concerns is worth one extra table.
- **Default opt-in vs opt-out?** Default opt-in. Privacy toggle visible in Settings. TOS update note: should mention anonymized analytics collection.
- **Retention?** Unlimited for now. Revisit in the F2 storage hygiene spec.

## File Map

Created:
- `src/db/migrations/009_product_events.sql`
- `src/services/events.js`

Modified:
- `src/db/store.js` — `createProductEvent(...)`
- `src/routes/applications.js` — 6 instrumentation points
- `src/routes/applications-chat.js` — 1 instrumentation point
- `src/routes/jobboard.js` — 2 instrumentation points
- `src/routes/resumes.js` — 2 instrumentation points
- `src/services/anthropic.js` — 1 instrumentation point (resume selection)
- `src/routes/auth.js` — allow `analytics_opt_out` in profile patch
- `src/middleware/validate.js` — allow `analytics_opt_out` in profile patch schema
- `client/src/pages/Settings.jsx` — privacy toggle (small additive)
