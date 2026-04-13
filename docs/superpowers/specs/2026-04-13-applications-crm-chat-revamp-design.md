# Applications CRM + Interview Prep Chat Revamp — Design

**Date:** 2026-04-13
**Status:** Approved
**Scope:** Applications page and surrounding API. Adds CRM-lite features and a Pro-gated interview prep chat.

## Goal

Turn the Applications page from a log into a focused workflow. Fewer statuses that auto-advance, row-level UX that stops fighting the user, bulk operations, an expandable row with context in-place, and a Pro-gated Claude chat per application for interview prep.

## In Scope

1. 5-status model with auto-transition from `identified` to `ready_to_apply` once a cover letter and resume variant are attached.
2. Stable row sort — status changes don't shuffle rows in the default view.
3. Actions column redesign — fixed 3-icon group, no wrap.
4. Bulk select + bulk actions (change status, generate letters, snooze, delete).
5. Expandable row with tabbed detail (Timeline / Notes / People / Materials, plus Interview Prep when applicable).
6. Smart snooze — hide a row from the default view until a target date.
7. Quick-add from pasted URL — auto-extract company and role via Claude Haiku.
8. People per application — first-class contacts CRUD.
9. Interview Prep Chat — Pro-only Claude chat per application, unlocked at `interviewing`.

## Out of Scope

- Kanban board view
- Email thread linking (Gmail ↔ application)
- Interview prep resources pane (external links, question banks)
- Company research auto-pull (Crunchbase / LinkedIn)
- Chat streaming (v1 is non-streaming; can be added later)

## Data Model

### Migration `008_applications_crm.sql`

```sql
ALTER TABLE applications ADD COLUMN snoozed_until DATE;
ALTER TABLE applications ADD COLUMN closed_reason TEXT;
ALTER TABLE applications ADD COLUMN jd_text TEXT;

CREATE TABLE application_contacts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  title          TEXT,
  email          TEXT,
  linkedin_url   TEXT,
  kind           TEXT NOT NULL DEFAULT 'other',
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_application_contacts_app ON application_contacts(application_id);

CREATE TABLE application_chats (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content        TEXT NOT NULL,
  tokens_in      INT NOT NULL DEFAULT 0,
  tokens_out     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_application_chats_app ON application_chats(application_id, created_at);

-- Status collapse backfill
UPDATE applications SET status = 'identified'
  WHERE status IN ('queued', 'researching', 'materials_prep');

UPDATE applications SET status = 'applied'
  WHERE status = 'confirmation_received';

UPDATE applications SET closed_reason = status, status = 'closed'
  WHERE status IN ('offer', 'rejected', 'withdrawn', 'no_response');
```

### Status Model

Canonical statuses:

| slug            | label           |
|-----------------|-----------------|
| `identified`    | Identified      |
| `ready_to_apply`| Ready to Apply  |
| `applied`       | Applied         |
| `interviewing`  | Interviewing    |
| `closed`        | Closed          |

`closed_reason` values: `offer | rejected | withdrawn | no_response | other`. UI renders Closed rows with the reason as a sub-label (e.g. "Closed — Offer").

`VALID_APP_STATUSES` in `src/middleware/validate.js` reduced to the five above.

### Kind values for contacts

`hiring_manager | recruiter | interviewer | referrer | other`.

## Auto-Transition Logic

Helper `maybeAutoAdvance(app, updates)` in `src/routes/applications.js` returns a patch object when all of the following hold:

- Current or updated status is `identified`
- Updated app has non-empty `cover_letter_text`
- Updated app has non-null `resume_variant`
- `snoozed_until` is null or in the past

When it fires, the patch sets `status = 'ready_to_apply'` and appends an activity entry `{ date, type: 'auto_ready', note: 'Cover letter and resume attached' }`.

Invoked from `updateApplication` (after applying user updates), `POST /applications/:id/generate-letter` (after persisting letter + variant), and the `batch-generate-letters` background job (per-app).

## API Surface

### `src/routes/applications.js` (modified)

- `POST /applications/bulk` — `{ ids: string[], action: 'set_status'|'delete'|'snooze'|'generate_letter', value?: any }`. Verifies each id belongs to `req.user`. For `set_status`, `delete`, and `snooze` (fast operations), the handler applies them inline in a loop and returns `{ updated, failed }`. For `generate_letter` (slow — one Claude call per id), the handler spawns a background job using the existing `batch-generate-letters` pattern (setImmediate, SSE progress), and returns `{ queued: N, message }` immediately. The frontend polls `/applications` after dispatch to pick up new `cover_letter_text` values.
- `PATCH /applications/:id/snooze` — `{ until: 'YYYY-MM-DD' | null }`. Null clears. Appends activity.
- `POST /applications/parse-url` — `{ url }`. Uses `fetchJobDescription` to pull text, then calls Claude Haiku with a short extraction prompt. Returns `{ company, role, location?, source_url }`. Available to all plans (Haiku is cheap). Logged as `url_parse` action.
- Existing routes keep their paths. Auto-transition helper hooked into update + letter flows.

### `src/routes/applications-contacts.js` (new, mounted under `/api`)

- `GET /applications/:id/contacts` → array of contacts for that application
- `POST /applications/:id/contacts` → create. Body `{ name, title?, email?, linkedin_url?, kind?, notes? }`
- `PATCH /applications/contacts/:contactId` → partial update
- `DELETE /applications/contacts/:contactId` → remove

All scoped by tenant via a join to `applications`.

### `src/routes/applications-chat.js` (new)

- `GET /applications/:id/chat` → `{ messages: [{id, role, content, created_at}], turn_count }`
- `POST /applications/:id/chat` — `{ message: string }`. Gate: Pro OR `PRO_FOREVER` email, AND `status = 'interviewing'`. Non-Pro returns 403 with `{ error, upgrade: true }`. Wrong-status returns 400.
  - Loads application + jd_text + resume variant + cover letter + profile + contacts + recent activity.
  - If `jd_text` is null and `source_url` present, fetches and persists it before building the system prompt.
  - Builds system prompt with `cache_control: { type: 'ephemeral' }`.
  - Appends user message to DB, then all prior chat messages as the conversation, then the new user message to the Anthropic call.
  - Model: `claude-sonnet-4-6`, `max_tokens: 1500`.
  - Persists assistant reply + token counts. Increments turn count.
  - Returns `{ reply, tokens_in, tokens_out, turn_count }`.
  - Enforces 80-turn-per-application ceiling; returns 429 when hit with `{ error: 'Chat history full — clear to continue', cap: 80 }`.
- `DELETE /applications/:id/chat` → truncate history for that application.

Chat usage logged via `logAiUsage` with action `interview_chat` so admin dashboard can track cost.

## Backend File Map

- `src/db/migrations/008_applications_crm.sql` — new
- `src/middleware/validate.js` — `VALID_APP_STATUSES` updated; schemas for contacts, chat, bulk, snooze
- `src/routes/applications.js` — bulk, snooze, parse-url, auto-transition helper wired into update + letter paths
- `src/routes/applications-contacts.js` — new
- `src/routes/applications-chat.js` — new
- `src/services/anthropic.js` — add `extractJobPostingMeta(html)` (Haiku, ~200 tokens) for parse-url; `buildInterviewChatSystemPrompt(ctx)` for chat
- `src/db/store.js` — new accessors: `listApplicationContacts`, `createApplicationContact`, `updateApplicationContact`, `deleteApplicationContact`, `listChatMessages`, `appendChatMessage`, `clearChatMessages`, `countChatTurns`, `snoozeApplication`, `bulkUpdateApplications`
- `server.js` — mount new route files

## Frontend

### File Split

- `client/src/pages/Applications.jsx` — page shell, queries, filter/bulk bar, table
- `client/src/components/applications/ApplicationRow.jsx` — single row + expand state + tabbed detail panel
- `client/src/components/applications/InterviewChat.jsx` — Pro-gated chat panel

### Page Shell

Top bar: filter dropdown (All / Identified / Ready to Apply / Applied / Interviewing / Closed), quick-add input (paste URL or type), "+ Log Application" button, "Generate All" (when identified-without-letters exist).

Bulk action bar appears above the table when any row is selected. Shows `N selected`, buttons: Change Status, Generate Letters, Snooze until, Delete, Clear.

Table columns: `[☐] Company / Role / Added / Status / Follow-up / Resume / Actions`. The first is a header checkbox that selects all visible rows.

### Stable Sort

Rows are sorted by `created_at desc` on the client, computed once per cache update in `useMemo`. Status mutations update the cached row in-place and don't retrigger the sort. In the default ("All") view, a row whose status changed stays in its current position.

In a filtered view, the client filters the sorted list; a row that no longer matches the filter falls out of the rendered list on the next render. This gives the exact UX requested: changing status in "All" doesn't shuffle; changing status in "Identified" removes the row.

### Actions Column (3 icons, fixed width)

| icon     | purpose |
|----------|---------|
| Apply (filled orange) | Opens `source_url` and `drive_url` in new tabs. PATCH `status=applied`. Disabled if either URL missing. Tooltip explains. Shows an orange dot if no cover letter yet. |
| Cover letter (ghost)  | Opens the existing cover letter modal. |
| ⋯ (ghost)             | Dropdown: Snooze until..., Reset chat (Pro + interviewing only), Delete |

No wrap. Fixed width keeps alignment stable.

### Expandable Row

Click anywhere on the row (outside checkbox, status dropdown, or action icons) to toggle expand. When expanded, the row grows to show a tabbed panel.

Tabs: **Timeline · Notes · People · Materials**, plus **Interview Prep** when `status = 'interviewing'`.

- **Timeline** — vertical list of `activity[]` entries, newest first. Each entry: type pill, note, date.
- **Notes** — textarea, debounced autosave on blur or 1.5s idle.
- **People** — list of contacts with icon per kind, inline "+ Add person" form (name, title, email, LinkedIn, kind, notes), edit/delete per row.
- **Materials** — side-by-side panels showing cover letter text and resume variant `parsed_text`, each with Copy button.
- **Interview Prep** — `InterviewChat` component (see below).

### Quick-Add via URL Paste

The top-bar input accepts any text. On submit:

- URL-like input (`/^https?:\/\//`) → `POST /applications/parse-url` → modal pre-filled with `{company, role, source_url}` → Save.
- Free-text input → open the manual add modal with the text in the company field.

### Snooze UX

In the row's "⋯" menu: "Snooze until..." opens a tiny date picker with quick-picks (`+3d`, `+1w`, `+2w`, `custom`). Snoozed rows get a `💤` icon next to the status pill and are hidden from the default "All" view. They remain visible in any explicit status filter. Unsnooze via the same menu.

### Bulk Actions

All bulk actions post to `/applications/bulk` with the selected ids. Toast shows `{updated, failed}` from the response. The cache is invalidated on success so the table re-renders.

### Interview Chat Panel (`InterviewChat.jsx`)

- Mounted only when the expanded row's status is `interviewing`.
- Free (non-Pro) user: shows a locked state with upgrade CTA linking to `/settings#billing`. No history is fetched.
- Pro user: queries `/applications/:id/chat` on mount.
- Message list: markdown-rendered. User right-aligned, assistant left-aligned.
- Input row: textarea + Send (cmd/ctrl+enter). Optimistic user message; loading indicator for assistant; replaces on response.
- Above input: turn counter `N/80`, Clear chat (confirm), Copy last reply.
- Empty-state suggestion chips:
  - "Generate 10 likely questions for this role"
  - "Help me rehearse behavioral answers from my resume"
  - "Research {first_interviewer_name} and suggest what to ask them" — only shown if a contact with `kind='interviewer'` exists.
- Errors: 403 (not Pro) → lock state; 429 (cap hit) → disable input with "Clear to continue"; 5xx/network → inline error below input, message text preserved.

### Frontend File Map

- `client/src/pages/Applications.jsx` — rewritten
- `client/src/components/applications/ApplicationRow.jsx` — new
- `client/src/components/applications/InterviewChat.jsx` — new
- `client/src/lib/auth.jsx` — no change expected; `user.isPro` already exposed

## Interview Chat System Prompt

Constructed on each turn from:

- Company + role + application status + closed_reason (if closing)
- `jd_text` (fetched once, cached on application row)
- Assigned resume variant's `parsed_text`
- Cover letter text
- User's full_name, background_text, target_roles
- Contacts list, structured so the model can cite by name
- Last 30 activity entries
- Last 3 notes

Template (simplified):

```
You are a focused interview prep coach for {full_name}. They are interviewing
for the {role} role at {company}. Use the context below to help them prepare
specific answers, anticipate questions, and research the people interviewing
them. Ground everything in the resume and cover letter — never invent
experience they don't have. When they ask to practice, act as the interviewer.

ROLE: {role}
COMPANY: {company}
JOB DESCRIPTION:
{jd_text}

CANDIDATE (you are coaching this person):
Name: {full_name}
Background: {background_text}
Target roles: {target_roles}

RESUME (they submitted this variant):
{resume_variant_text}

COVER LETTER:
{cover_letter_text}

PEOPLE INVOLVED:
{contacts}

RECENT NOTES:
{recent_notes}

RECENT ACTIVITY:
{recent_activity}
```

Marked with `cache_control: { type: 'ephemeral' }` so identical prefixes hit the prompt cache across turns.

## Cost Envelope

System prompt ~4k tokens (cached after first turn). Per turn: ~5k input (mostly cached) + ~1k output. At Sonnet 4.6 pricing, roughly $0.015–0.02 per turn uncached, ~$0.006 cached. 80-turn ceiling caps each application at roughly $1.50 worst case.

## Error Handling

- Migration idempotent; backfill uses `UPDATE ... WHERE status IN (...)` which is naturally idempotent.
- Chat non-Pro → 403 with `{ upgrade: true }`.
- Chat wrong status → 400 with `{ error: 'Interview prep unlocks at Interviewing status' }`.
- Chat cap hit → 429 with `{ cap: 80 }`.
- `parse-url` failures → return a reasonable default (company = URL domain, role = empty) rather than hard-failing the user's add flow.
- Bulk endpoint collects per-id errors into the response; never aborts the whole batch.
- JD fetch for chat falls back to `"Position: {role} at {company}"` when the URL is missing or unreachable.

## Testing

Manual test plan (per phase during implementation):

1. **Migration** — seed a fresh DB, confirm 5 statuses + new tables. Run against a DB with legacy statuses, confirm backfill maps correctly.
2. **Auto-transition** — create app in `identified`, generate cover letter, confirm flip to `ready_to_apply` and activity entry.
3. **Row shuffle** — in "All" view, change status on a row that was at position 5; confirm it stays at position 5 in the render. In "Identified" filter, change to `applied`; confirm the row disappears.
4. **Bulk** — select 3 identified rows, Generate Letters, confirm 3 letters produced and rows auto-advanced.
5. **Snooze** — snooze a row +1w; confirm `💤` in row, row hidden in All view, visible in its status filter. Unsnooze, confirm back to normal.
6. **Quick-add URL** — paste a LinkedIn URL, confirm modal prefilled with company + role.
7. **People** — add hiring_manager, recruiter, two interviewers; edit one; delete one.
8. **Interview Chat** — move app to `interviewing`, send a message, confirm reply appears and persists. Reload page; confirm history returns. Free user (log out + log back in as free) sees lock. Clear chat; confirm empty state.
9. **Chat cap** — temporarily lower cap to 3, send 4 turns, confirm 429 and UI disables input.

## Non-Goals / Open Questions

- Streaming chat — deferred to v2. Non-streaming with loading dots is acceptable in v1.
- Multi-user chat context — not needed; chat is scoped to a single user per application.
- Export chat history — deferred; users can copy-paste.
- Rename "Snag" to something else — out of scope here.
