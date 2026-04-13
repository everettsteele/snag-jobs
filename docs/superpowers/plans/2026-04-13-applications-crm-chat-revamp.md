# Applications CRM + Interview Prep Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Applications page into a CRM-lite workflow with 5 statuses + auto-transition, stable row sort, redesigned actions, bulk operations, expandable row with tabbed detail, smart snooze, URL quick-add, first-class people per application, and a Pro-gated Claude chat per application for interview prep.

**Architecture:** Backend adds one migration, two new route modules (contacts, chat), and new endpoints on the existing applications router. Frontend splits `Applications.jsx` into a page shell plus two component files (`ApplicationRow`, `InterviewChat`) and rebuilds the table around stable sort and expandable rows. Auto-transition runs server-side as a helper invoked from every code path that can set `cover_letter_text` or `resume_variant`. No test harness exists in this repo — verification at each task is syntax check + build + manual smoke via curl/browser.

**Tech Stack:** Node/Express 4, PostgreSQL (pg driver), React 19, @tanstack/react-query, Anthropic SDK (`claude-sonnet-4-6` for chat, `claude-haiku-4-5-20251001` for URL extraction), Tailwind 4, Vite 6.

---

## File Map

**Created:**
- `src/db/migrations/008_applications_crm.sql`
- `src/routes/applications-contacts.js`
- `src/routes/applications-chat.js`
- `client/src/components/applications/ApplicationRow.jsx`
- `client/src/components/applications/InterviewChat.jsx`

**Modified:**
- `src/middleware/validate.js` — `VALID_APP_STATUSES` and new zod schemas
- `src/db/store.js` — new accessors for contacts, chat, snooze, bulk, and jd_text caching
- `src/routes/applications.js` — auto-transition helper, bulk, snooze, parse-url, wiring
- `src/services/anthropic.js` — `extractJobPostingMeta`, `buildInterviewChatSystemPrompt`
- `server.js` — mount contacts + chat routers
- `client/src/pages/Applications.jsx` — rewritten to use split components

---

## Task 1: Database migration — snooze, jd_text, closed_reason, contacts, chats

**Files:**
- Create: `src/db/migrations/008_applications_crm.sql`

- [ ] **Step 1: Write the migration SQL**

Create `src/db/migrations/008_applications_crm.sql`:

```sql
-- 008_applications_crm.sql
-- Adds snooze, cached JD text, closed-reason sub-label, contacts table, chat table.
-- Also collapses the legacy 13-status model to 5 canonical statuses.

BEGIN;

-- Columns on applications
ALTER TABLE applications ADD COLUMN IF NOT EXISTS snoozed_until DATE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS closed_reason TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS jd_text TEXT;

-- Contacts per application
CREATE TABLE IF NOT EXISTS application_contacts (
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
CREATE INDEX IF NOT EXISTS idx_application_contacts_app
  ON application_contacts(application_id);

-- Interview prep chat messages
CREATE TABLE IF NOT EXISTS application_chats (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content        TEXT NOT NULL,
  tokens_in      INT NOT NULL DEFAULT 0,
  tokens_out     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_application_chats_app
  ON application_chats(application_id, created_at);

-- Legacy status backfill (idempotent — each UPDATE's WHERE naturally
-- excludes already-migrated rows because the new values aren't in the
-- WHERE set).
UPDATE applications SET status = 'identified'
  WHERE status IN ('queued', 'researching', 'materials_prep');

UPDATE applications SET status = 'applied'
  WHERE status = 'confirmation_received';

UPDATE applications SET closed_reason = status, status = 'closed'
  WHERE status IN ('offer', 'rejected', 'withdrawn', 'no_response');

COMMIT;
```

- [ ] **Step 2: Run the migration and verify**

Run from `/Users/everettsteele/PROJECTS/snag-jobs`:
```bash
npm run db:migrate
```

Expected output: migration 008 runs without error. (The migration runner lives at `src/db/migrate.js` and applies any un-run migration in order.)

If running in local/dev without DATABASE_URL, skip this step — Railway will run it on deploy. Verify the SQL parses by running:
```bash
psql --dry-run < src/db/migrations/008_applications_crm.sql
```
If `psql` isn't available locally, skip; the Railway deploy will exercise it.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/008_applications_crm.sql
git commit -m "feat: migration 008 — snooze, jd_text, closed_reason, contacts, chats"
```

---

## Task 2: Update validation schemas

**Files:**
- Modify: `src/middleware/validate.js`

- [ ] **Step 1: Replace `VALID_APP_STATUSES` and add new schemas**

Open `src/middleware/validate.js`. Find the line starting `const VALID_APP_STATUSES = [...]` and replace it with the new 5-status list. Add the new schemas near the bottom next to existing ones (`applicationPatch`, etc.).

Replace the existing constant:

```js
const VALID_APP_STATUSES = [
  'identified', 'ready_to_apply', 'applied', 'interviewing', 'closed',
];

const VALID_CLOSED_REASONS = [
  'offer', 'rejected', 'withdrawn', 'no_response', 'other',
];

const VALID_CONTACT_KINDS = [
  'hiring_manager', 'recruiter', 'interviewer', 'referrer', 'other',
];
```

Add these new zod schemas (after the existing `leadPatch` block):

```js
const bulkApplicationAction = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(['set_status', 'delete', 'snooze', 'generate_letter']),
  value: z.any().optional(),
});

const snoozeRequest = z.object({
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

const parseUrlRequest = z.object({
  url: z.string().url().max(2000),
});

const applicationContactCreate = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  linkedin_url: z.string().url().max(500).optional().nullable(),
  kind: z.enum(VALID_CONTACT_KINDS).optional().default('other'),
  notes: z.string().max(5000).optional().nullable(),
});

const applicationContactPatch = applicationContactCreate.partial();

const chatMessageRequest = z.object({
  message: z.string().min(1).max(4000),
});
```

And add them to the `schemas` export block at the bottom:

```js
module.exports = {
  validate,
  schemas: {
    applicationCreate,
    applicationPatch,
    outreachPatch,
    leadPatch,
    leadBatchUpdate,
    snagRequest,
    eventCreate,
    loginRequest,
    bulkApplicationAction,
    snoozeRequest,
    parseUrlRequest,
    applicationContactCreate,
    applicationContactPatch,
    chatMessageRequest,
  },
  VALID_APP_STATUSES,
  VALID_CLOSED_REASONS,
  VALID_CONTACT_KINDS,
};
```

Also update the `applicationPatch` schema to include `snoozed_until` and `closed_reason`. Find it and add these two fields:

```js
const applicationPatch = z.object({
  // ...existing fields...
  status: z.enum(VALID_APP_STATUSES).optional(),
  snoozed_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  closed_reason: z.enum(VALID_CLOSED_REASONS).nullable().optional(),
}).strict();
```

(Leave every existing field in `applicationPatch` as-is; only change the `status` enum source and add the two new fields.)

- [ ] **Step 2: Syntax check**

Run:
```bash
node -c src/middleware/validate.js && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/middleware/validate.js
git commit -m "feat: validation schemas for 5-status model + bulk/snooze/parse/contacts/chat"
```

---

## Task 3: Database accessors for new tables + snooze + bulk + jd_text

**Files:**
- Modify: `src/db/store.js`

- [ ] **Step 1: Add the new accessors**

Open `src/db/store.js`. Find the existing block near line 409 that exports functions. Just above that `module.exports = {` line, add these new functions:

```js
// ================================================================
// APPLICATION — SNOOZE + JD CACHE + BULK
// ================================================================

async function snoozeApplication(tenantId, applicationId, until) {
  const { rows } = await query(
    `UPDATE applications
       SET snoozed_until = $3, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, applicationId, until]
  );
  return rows[0] || null;
}

async function setJdText(tenantId, applicationId, text) {
  await query(
    `UPDATE applications SET jd_text = $3 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, applicationId, text]
  );
}

// ================================================================
// APPLICATION — CONTACTS
// ================================================================

async function listApplicationContacts(tenantId, applicationId) {
  const { rows } = await query(
    `SELECT * FROM application_contacts
       WHERE tenant_id = $1 AND application_id = $2
       ORDER BY created_at`,
    [tenantId, applicationId]
  );
  return rows;
}

async function createApplicationContact(tenantId, applicationId, data) {
  const { rows } = await query(
    `INSERT INTO application_contacts
       (tenant_id, application_id, name, title, email, linkedin_url, kind, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      tenantId, applicationId,
      data.name, data.title || null, data.email || null,
      data.linkedin_url || null, data.kind || 'other', data.notes || null,
    ]
  );
  return rows[0];
}

async function updateApplicationContact(tenantId, contactId, data) {
  const allowed = ['name', 'title', 'email', 'linkedin_url', 'kind', 'notes'];
  const sets = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(data)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = $${idx}`);
      values.push(val);
      idx++;
    }
  }
  if (!sets.length) return null;
  values.push(tenantId, contactId);
  const { rows } = await query(
    `UPDATE application_contacts SET ${sets.join(', ')}
       WHERE tenant_id = $${idx} AND id = $${idx + 1}
       RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function deleteApplicationContact(tenantId, contactId) {
  const { rowCount } = await query(
    `DELETE FROM application_contacts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, contactId]
  );
  return rowCount > 0;
}

// ================================================================
// APPLICATION — CHAT
// ================================================================

async function listChatMessages(tenantId, applicationId) {
  const { rows } = await query(
    `SELECT id, role, content, tokens_in, tokens_out, created_at
       FROM application_chats
      WHERE tenant_id = $1 AND application_id = $2
      ORDER BY created_at ASC`,
    [tenantId, applicationId]
  );
  return rows;
}

async function appendChatMessage(tenantId, applicationId, role, content, tokensIn, tokensOut) {
  const { rows } = await query(
    `INSERT INTO application_chats
       (tenant_id, application_id, role, content, tokens_in, tokens_out)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, applicationId, role, content, tokensIn || 0, tokensOut || 0]
  );
  return rows[0];
}

async function clearChatMessages(tenantId, applicationId) {
  await query(
    `DELETE FROM application_chats WHERE tenant_id = $1 AND application_id = $2`,
    [tenantId, applicationId]
  );
}

async function countChatTurns(tenantId, applicationId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM application_chats
      WHERE tenant_id = $1 AND application_id = $2 AND role = 'user'`,
    [tenantId, applicationId]
  );
  return rows[0]?.n || 0;
}
```

Then extend the `module.exports` at the bottom to include each new function:

```js
module.exports = {
  // ...existing exports...
  snoozeApplication,
  setJdText,
  listApplicationContacts,
  createApplicationContact,
  updateApplicationContact,
  deleteApplicationContact,
  listChatMessages,
  appendChatMessage,
  clearChatMessages,
  countChatTurns,
};
```

- [ ] **Step 2: Syntax + require smoke test**

Run:
```bash
node -c src/db/store.js && node -e "const s = require('./src/db/store'); console.log('ok, new fns:', typeof s.snoozeApplication, typeof s.listChatMessages, typeof s.createApplicationContact);"
```

Expected: prints `ok, new fns: function function function`.

- [ ] **Step 3: Commit**

```bash
git add src/db/store.js
git commit -m "feat: store accessors for snooze, jd_text, contacts, chat"
```

---

## Task 4: Auto-transition helper + wire into update/letter paths

**Files:**
- Modify: `src/routes/applications.js`

- [ ] **Step 1: Add `maybeAutoAdvance` helper**

Open `src/routes/applications.js`. Just below the `sendSSE` helper (around line 36), add:

```js
// If an application has both a cover letter and a resume variant attached,
// and it's still in 'identified', auto-advance to 'ready_to_apply'. Returns
// a patch object (may be empty). Appends a row to the activity timeline when
// it fires. Call this AFTER persisting the caller's own updates — pass the
// already-updated record.
function maybeAutoAdvance(app) {
  if (!app) return {};
  if (app.status !== 'identified') return {};
  if (!app.cover_letter_text || !app.resume_variant) return {};
  const today = todayET();
  const activity = Array.isArray(app.activity) ? [...app.activity] : [];
  activity.push({ date: today, type: 'auto_ready', note: 'Cover letter and resume attached' });
  return {
    status: 'ready_to_apply',
    last_activity: today,
    activity,
  };
}
```

- [ ] **Step 2: Wire into `PATCH /applications/:id`**

Find the `PATCH /applications/:id` handler (around line 62). Replace the final return sequence so it calls the helper after the initial update and applies a second update if the helper returns a patch:

```js
router.patch('/applications/:id', requireAuth, validate(schemas.applicationPatch), async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const today = todayET();
  const updates = { ...req.body, last_activity: today };

  if (req.body.status && req.body.status !== app.status) {
    const activity = Array.isArray(app.activity) ? [...app.activity] : [];
    activity.push({ date: today, type: req.body.status, note: req.body.activity_note || '' });
    updates.activity = activity;
  }
  delete updates.activity_note;

  let updated = await db.updateApplication(req.user.tenantId, req.params.id, updates);
  const advance = maybeAutoAdvance(updated);
  if (Object.keys(advance).length) {
    updated = await db.updateApplication(req.user.tenantId, req.params.id, advance);
  }
  res.json(updated);
});
```

- [ ] **Step 3: Wire into `/applications/:id/generate-letter`**

Find the single-letter endpoint (look for `router.post('/applications/:id/generate-letter'`). After the existing `db.updateApplication(... , patch)` call that persists the letter, add the auto-advance:

```js
    // (existing) const updated = await db.updateApplication(req.user.tenantId, app.id, patch);
    let updated = await db.updateApplication(req.user.tenantId, app.id, patch);
    const advance = maybeAutoAdvance(updated);
    if (Object.keys(advance).length) {
      updated = await db.updateApplication(req.user.tenantId, app.id, advance);
    }
    await db.logUsage(req.user.tenantId, req.user.id, 'cover_letters', 700, { company: app.company, single: true });

    res.json({ ok: true, application: updated });
```

(Replace `const updated = ...` with `let updated = ...` so we can reassign.)

- [ ] **Step 4: Wire into `batch-generate-letters`**

In the `setImmediate` background loop of `POST /applications/batch-generate-letters`, after the per-app `await db.updateApplication(tenantId, appRec.id, patch);` call, add:

```js
        const after = await db.getApplication(tenantId, appRec.id);
        const advance = maybeAutoAdvance(after);
        if (Object.keys(advance).length) {
          await db.updateApplication(tenantId, appRec.id, advance);
        }
```

- [ ] **Step 5: Syntax check**

```bash
node -c src/routes/applications.js && echo OK
```

Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/applications.js
git commit -m "feat: auto-advance identified → ready_to_apply when letter+resume attached"
```

---

## Task 5: Bulk applications endpoint

**Files:**
- Modify: `src/routes/applications.js`

- [ ] **Step 1: Add the bulk endpoint**

Open `src/routes/applications.js`. Just after the `DELETE /applications/:id` handler (around line 85), add:

```js
// POST /applications/bulk — apply an action to many application ids at once.
// Fast actions (set_status, delete, snooze) run inline. generate_letter
// spawns a background job that the client polls for updates.
router.post('/applications/bulk', requireAuth, validate(schemas.bulkApplicationAction), async (req, res) => {
  const { ids, action, value } = req.body;
  const tenantId = req.user.tenantId;

  // Verify every id belongs to this user's tenant before doing anything.
  const verifiable = await Promise.all(ids.map((id) => db.getApplication(tenantId, id)));
  const valid = verifiable.filter((a) => a && a.user_id === req.user.id).map((a) => a.id);
  if (!valid.length) return res.status(404).json({ error: 'No matching applications' });

  if (action === 'delete') {
    let deleted = 0;
    for (const id of valid) {
      const ok = await db.deleteApplication(tenantId, id);
      if (ok) deleted++;
    }
    return res.json({ ok: true, updated: deleted, failed: valid.length - deleted });
  }

  if (action === 'set_status') {
    if (!VALID_APP_STATUSES.includes(value)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const today = todayET();
    let updated = 0;
    for (const id of valid) {
      const app = await db.getApplication(tenantId, id);
      if (!app || app.status === value) continue;
      const activity = Array.isArray(app.activity) ? [...app.activity] : [];
      activity.push({ date: today, type: value, note: 'bulk update' });
      await db.updateApplication(tenantId, id, { status: value, last_activity: today, activity });
      updated++;
    }
    return res.json({ ok: true, updated, failed: valid.length - updated });
  }

  if (action === 'snooze') {
    if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    let updated = 0;
    for (const id of valid) {
      const r = await db.snoozeApplication(tenantId, id, value);
      if (r) updated++;
    }
    return res.json({ ok: true, updated, failed: valid.length - updated });
  }

  if (action === 'generate_letter') {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }
    const targets = verifiable
      .filter((a) => a && a.user_id === req.user.id && !a.cover_letter_text);
    res.json({ ok: true, queued: targets.length, message: `Generating ${targets.length} cover letters.` });

    const userId = req.user.id;
    const userProfile = req.user.profile || {};
    setImmediate(async () => {
      const userVariants = await getResumeVariants(userId);
      for (let i = 0; i < targets.length; i++) {
        const appRec = targets[i];
        try {
          let jdText = '';
          if (appRec.source_url) jdText = await fetchJobDescription(appRec.source_url);
          if (!jdText || jdText.length < 50) {
            jdText = `Position: ${appRec.role} at ${appRec.company}. ${appRec.notes || ''}`.trim();
          }
          const letter = await generateCoverLetter(appRec, jdText, {
            fullName: req.user.fullName,
            backgroundText: userProfile.backgroundText,
          });
          if (!letter || letter.length < 50) continue;
          const patch = { cover_letter_text: letter, last_activity: todayET() };
          if (!appRec.resume_variant) {
            try {
              const variant = await selectResumeVariant(appRec, jdText, {
                fullName: req.user.fullName,
                variants: userVariants,
              });
              if (variant) patch.resume_variant = variant;
            } catch (e) { diagLog('BULK letter auto-select failed: ' + e.message); }
          }
          await db.updateApplication(tenantId, appRec.id, patch);
          const after = await db.getApplication(tenantId, appRec.id);
          const advance = maybeAutoAdvance(after);
          if (Object.keys(advance).length) await db.updateApplication(tenantId, appRec.id, advance);
          await db.logUsage(tenantId, userId, 'cover_letter', 700, { company: appRec.company, bulk: true });
          await new Promise((r) => setTimeout(r, 1500));
        } catch (e) { diagLog('BULK letter EXCEPTION: ' + e.message); }
      }
    });
    return;
  }

  res.status(400).json({ error: 'Unknown action' });
});
```

You'll need `VALID_APP_STATUSES` imported at the top of the file. Find the existing line:
```js
const { validate, schemas, VALID_APP_STATUSES } = require('../middleware/validate');
```
If it's missing `VALID_APP_STATUSES`, add it. (It's already imported per current code.)

- [ ] **Step 2: Syntax check**

```bash
node -c src/routes/applications.js && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/applications.js
git commit -m "feat: POST /applications/bulk for set_status/delete/snooze/generate_letter"
```

---

## Task 6: Snooze endpoint

**Files:**
- Modify: `src/routes/applications.js`

- [ ] **Step 1: Add `PATCH /applications/:id/snooze`**

Add just below the bulk endpoint:

```js
router.patch('/applications/:id/snooze', requireAuth, validate(schemas.snoozeRequest), async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const today = todayET();
  const activity = Array.isArray(app.activity) ? [...app.activity] : [];
  activity.push({
    date: today,
    type: req.body.until ? 'snoozed' : 'unsnoozed',
    note: req.body.until ? `Snoozed until ${req.body.until}` : 'Unsnoozed',
  });
  await db.updateApplication(req.user.tenantId, req.params.id, {
    activity, last_activity: today,
  });
  const updated = await db.snoozeApplication(req.user.tenantId, req.params.id, req.body.until);
  res.json(updated);
});
```

- [ ] **Step 2: Syntax check**

```bash
node -c src/routes/applications.js && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/applications.js
git commit -m "feat: PATCH /applications/:id/snooze"
```

---

## Task 7: Parse-URL endpoint + anthropic helper

**Files:**
- Modify: `src/services/anthropic.js`
- Modify: `src/routes/applications.js`

- [ ] **Step 1: Add `extractJobPostingMeta` to anthropic.js**

Open `src/services/anthropic.js`. Just above the existing `module.exports = {` block at the bottom, add:

```js
// ================================================================
// extractJobPostingMeta — pull {company, role, location} from a page
// ================================================================

async function extractJobPostingMeta(jdText, sourceUrl) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { company: '', role: '', location: '' };
  }
  const client = getClient();
  const prompt = `Extract the job posting's company, role title, and location from the text below. Respond with ONLY a JSON object like {"company":"Acme Corp","role":"Chief of Staff","location":"Remote"}. If a field is unknown use an empty string. No explanation.

URL: ${sourceUrl || '(unknown)'}

PAGE TEXT:
${(jdText || '').slice(0, 3500)}`;

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (resp.content?.[0]?.text || '').trim();
    // Trim code-fence noise if the model wraps it.
    const jsonStr = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(jsonStr);
    return {
      company: String(parsed.company || '').slice(0, 200),
      role: String(parsed.role || '').slice(0, 200),
      location: String(parsed.location || '').slice(0, 200),
    };
  } catch (e) {
    console.error('[extractJobPostingMeta]', e.message);
    return { company: '', role: '', location: '' };
  }
}
```

Add `extractJobPostingMeta` to the `module.exports`:

```js
module.exports = {
  // ...existing exports...
  extractJobPostingMeta,
};
```

- [ ] **Step 2: Add parse-url endpoint in applications.js**

Open `src/routes/applications.js`. Near the top, update the destructured import from anthropic to include the new helper:

```js
const {
  generateCoverLetter, selectResumeVariant, fetchJobDescription,
  cleanCoverLetterText, extractJobPostingMeta,
} = require('../services/anthropic');
```

Then add the endpoint below the snooze handler:

```js
router.post('/applications/parse-url', requireAuth, validate(schemas.parseUrlRequest), async (req, res) => {
  const { url } = req.body;
  let jdText = '';
  try { jdText = await fetchJobDescription(url); } catch (_) {}
  const meta = await extractJobPostingMeta(jdText, url);
  // Fallbacks if the model returned nothing.
  if (!meta.company) {
    try { meta.company = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
  }
  res.json({ ok: true, company: meta.company, role: meta.role, location: meta.location, source_url: url });
});
```

- [ ] **Step 3: Syntax check**

```bash
node -c src/services/anthropic.js && node -c src/routes/applications.js && echo OK
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/services/anthropic.js src/routes/applications.js
git commit -m "feat: POST /applications/parse-url + extractJobPostingMeta (Haiku)"
```

---

## Task 8: Contacts route file + mount

**Files:**
- Create: `src/routes/applications-contacts.js`
- Modify: `server.js`

- [ ] **Step 1: Create the contacts route file**

Create `src/routes/applications-contacts.js`:

```js
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const db = require('../db/store');

const router = Router();

// GET /applications/:id/contacts
router.get('/applications/:id/contacts', requireAuth, async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const contacts = await db.listApplicationContacts(req.user.tenantId, req.params.id);
  res.json(contacts);
});

// POST /applications/:id/contacts
router.post('/applications/:id/contacts', requireAuth, validate(schemas.applicationContactCreate), async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const created = await db.createApplicationContact(req.user.tenantId, req.params.id, req.body);
  res.json(created);
});

// PATCH /applications/contacts/:contactId
router.patch('/applications/contacts/:contactId', requireAuth, validate(schemas.applicationContactPatch), async (req, res) => {
  const updated = await db.updateApplicationContact(req.user.tenantId, req.params.contactId, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// DELETE /applications/contacts/:contactId
router.delete('/applications/contacts/:contactId', requireAuth, async (req, res) => {
  const ok = await db.deleteApplicationContact(req.user.tenantId, req.params.contactId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 2: Mount in server.js**

Open `server.js`. Find the block that mounts `applicationRoutes` (around line 46). Below it, add:

```js
const applicationContactsRoutes = require('./src/routes/applications-contacts');
app.use('/api', applicationContactsRoutes);
```

Also add the top-of-file require near the other route requires (around line 7-21) for readability:

```js
const applicationContactsRoutes = require('./src/routes/applications-contacts');
```

And change the inline `app.use` to reference the top-level require (avoid double-require). Only one `require` for this file total.

- [ ] **Step 3: Syntax + require smoke test**

```bash
node -c src/routes/applications-contacts.js && \
  node -c server.js && \
  node -e "const r = require('./src/routes/applications-contacts'); console.log('contacts router:', typeof r);" && \
  echo OK
```

Expected: `contacts router: function` then `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/applications-contacts.js server.js
git commit -m "feat: applications-contacts route + mount"
```

---

## Task 9: Chat route file + system prompt builder + mount

**Files:**
- Modify: `src/services/anthropic.js`
- Create: `src/routes/applications-chat.js`
- Modify: `server.js`

- [ ] **Step 1: Add `buildInterviewChatSystemPrompt` to anthropic.js**

Add to `src/services/anthropic.js` below `extractJobPostingMeta`:

```js
// ================================================================
// buildInterviewChatSystemPrompt — context injection for interview chat
// ================================================================

function buildInterviewChatSystemPrompt(ctx) {
  const {
    app, jdText, resumeText, coverLetter, profile, contacts, notes, activity,
  } = ctx;
  const fullName = profile?.full_name || profile?.fullName || 'the candidate';
  const background = profile?.background_text || profile?.backgroundText || '';
  const targetRoles = Array.isArray(profile?.target_roles) ? profile.target_roles.join(', ') : '';

  const contactsBlock = (contacts || []).length
    ? (contacts || []).map((c) =>
        `- ${c.name}${c.title ? ` (${c.title})` : ''} — ${c.kind}${c.linkedin_url ? ` · ${c.linkedin_url}` : ''}${c.notes ? `\n   Notes: ${c.notes}` : ''}`
      ).join('\n')
    : '(none recorded)';

  const activityBlock = (activity || []).slice(-30).map((a) =>
    `- ${a.date || ''} ${a.type || ''}${a.note ? `: ${a.note}` : ''}`
  ).join('\n') || '(none)';

  return `You are a focused interview prep coach for ${fullName}. They are interviewing for the ${app.role} role at ${app.company}. Use the context below to help them prepare specific answers, anticipate questions, and research the people interviewing them. Ground every answer in the resume and cover letter facts — never invent experience. When they ask to practice, act as the interviewer.

ROLE: ${app.role}
COMPANY: ${app.company}

JOB DESCRIPTION:
${(jdText || '(not available)').slice(0, 4000)}

CANDIDATE:
Name: ${fullName}
Background: ${background}
Target roles: ${targetRoles}

RESUME (variant they submitted for this app):
${(resumeText || '(no resume attached)').slice(0, 4000)}

COVER LETTER:
${(coverLetter || '(none)').slice(0, 2000)}

PEOPLE ON THIS APPLICATION:
${contactsBlock}

RECENT NOTES:
${notes || '(none)'}

RECENT ACTIVITY:
${activityBlock}`;
}
```

Add to exports:

```js
module.exports = {
  // ...
  buildInterviewChatSystemPrompt,
};
```

- [ ] **Step 2: Create `src/routes/applications-chat.js`**

```js
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { expensiveLimiter } = require('../middleware/security');
const { isPro, logAiUsage } = require('../middleware/tier');
const { getResumeVariants } = require('../db/users');
const {
  fetchJobDescription,
  buildInterviewChatSystemPrompt,
} = require('../services/anthropic');
const db = require('../db/store');

const CHAT_TURN_CAP = 80;
const MODEL = 'claude-sonnet-4-6';

const router = Router();

let _client = null;
function getClient() {
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

function requireInterviewing(app) {
  return app && app.status === 'interviewing';
}

// GET /applications/:id/chat → history + turn count
router.get('/applications/:id/chat', requireAuth, async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const messages = await db.listChatMessages(req.user.tenantId, req.params.id);
  const turnCount = messages.filter((m) => m.role === 'user').length;
  res.json({ messages, turn_count: turnCount, cap: CHAT_TURN_CAP });
});

// POST /applications/:id/chat → send a message, get a reply
router.post('/applications/:id/chat', requireAuth, expensiveLimiter,
  validate(schemas.chatMessageRequest), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }
  if (!isPro(req.user)) {
    return res.status(403).json({ error: 'Interview prep chat is a Pro feature', upgrade: true });
  }

  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (!requireInterviewing(app)) {
    return res.status(400).json({ error: 'Interview prep unlocks at Interviewing status' });
  }

  const turnCount = await db.countChatTurns(req.user.tenantId, req.params.id);
  if (turnCount >= CHAT_TURN_CAP) {
    return res.status(429).json({ error: 'Chat history full — clear to continue', cap: CHAT_TURN_CAP });
  }

  // Ensure JD text is cached.
  let jdText = app.jd_text || '';
  if (!jdText && app.source_url) {
    try {
      jdText = await fetchJobDescription(app.source_url);
      if (jdText && jdText.length > 50) {
        await db.setJdText(req.user.tenantId, app.id, jdText);
      }
    } catch (_) {}
  }

  // Pull resume variant text.
  let resumeText = '';
  if (app.resume_variant) {
    const variants = await getResumeVariants(req.user.id);
    const v = variants.find((x) => x.slug === app.resume_variant);
    resumeText = v?.parsed_text || '';
  }

  const contacts = await db.listApplicationContacts(req.user.tenantId, app.id);

  const systemPrompt = buildInterviewChatSystemPrompt({
    app,
    jdText,
    resumeText,
    coverLetter: app.cover_letter_text || '',
    profile: req.user.profile || {},
    contacts,
    notes: app.notes || '',
    activity: Array.isArray(app.activity) ? app.activity : [],
  });

  const history = await db.listChatMessages(req.user.tenantId, app.id);
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: req.body.message });

  let reply = '';
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const client = getClient();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages,
    });
    reply = (resp.content?.[0]?.text || '').trim();
    tokensIn = resp.usage?.input_tokens || 0;
    tokensOut = resp.usage?.output_tokens || 0;
  } catch (e) {
    console.error('[chat]', e.message);
    return res.status(500).json({ error: e.message || 'Chat failed' });
  }

  if (!reply) return res.status(500).json({ error: 'Empty reply from model' });

  await db.appendChatMessage(req.user.tenantId, app.id, 'user', req.body.message, 0, 0);
  const stored = await db.appendChatMessage(req.user.tenantId, app.id, 'assistant', reply, tokensIn, tokensOut);
  await logAiUsage(req.user.tenantId, req.user.id, 'interview_chat', tokensIn + tokensOut, {
    company: app.company, role: app.role,
  });

  const newTurnCount = await db.countChatTurns(req.user.tenantId, app.id);
  res.json({
    id: stored.id,
    reply,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    turn_count: newTurnCount,
    cap: CHAT_TURN_CAP,
  });
});

// DELETE /applications/:id/chat → clear history
router.delete('/applications/:id/chat', requireAuth, async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  await db.clearChatMessages(req.user.tenantId, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 3: Mount in server.js**

Add at the top alongside other requires:

```js
const applicationChatRoutes = require('./src/routes/applications-chat');
```

And below the applicationContactsRoutes mount:

```js
app.use('/api', applicationChatRoutes);
```

- [ ] **Step 4: Syntax + require smoke test**

```bash
node -c src/services/anthropic.js && \
  node -c src/routes/applications-chat.js && \
  node -c server.js && \
  node -e "const r = require('./src/routes/applications-chat'); console.log('chat router:', typeof r);" && \
  echo OK
```

Expected: `chat router: function` then `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/services/anthropic.js src/routes/applications-chat.js server.js
git commit -m "feat: interview prep chat route (Pro-gated, interviewing status) + prompt cache"
```

---

## Task 10: Frontend — rewrite Applications.jsx page shell

**Files:**
- Modify: `client/src/pages/Applications.jsx`
- Create: `client/src/components/applications/ApplicationRow.jsx` (stub)

This task lays the new page structure. Tab detail will land in Task 11; for now `ApplicationRow` is a thin wrapper over the existing row layout so the build still works.

- [ ] **Step 1: Create the stub row component**

Create `client/src/components/applications/ApplicationRow.jsx`:

```jsx
import { useState } from 'react';

export default function ApplicationRow({
  app, variants = [], selected, onToggleSelect,
  onUpdate, onDelete, onShowCoverLetter,
}) {
  const [expanded, setExpanded] = useState(false);

  const statusInfo = STATUS_INFO[app.status] || STATUS_INFO.identified;
  const followUp = app.follow_up_date || app.followup_date;
  const sourceUrl = app.source_url || app.url;
  const hasCoverLetter = !!app.cover_letter_text;
  const snoozed = !!app.snoozed_until;

  return (
    <>
      <tr
        className={`border-b border-gray-50 hover:bg-gray-50/50 ${expanded ? 'bg-gray-50' : ''}`}
        onClick={(e) => {
          // Don't toggle when clicking interactive elements
          const tag = (e.target.tagName || '').toUpperCase();
          if (['INPUT', 'SELECT', 'BUTTON', 'A', 'OPTION', 'LABEL', 'TEXTAREA'].includes(tag)) return;
          if (e.target.closest('.row-action')) return;
          setExpanded((v) => !v);
        }}
      >
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="w-4 h-4 accent-[#F97316] cursor-pointer"
          />
        </td>
        <td className="px-4 py-3">
          <div className="font-medium text-[#1F2D3D] flex items-center gap-1.5">
            {app.company}
            {snoozed && <span title={`Snoozed until ${app.snoozed_until}`}>💤</span>}
          </div>
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
               className="text-xs text-[#F97316] hover:underline"
               onClick={(e) => e.stopPropagation()}>View posting</a>
          )}
        </td>
        <td className="px-4 py-3 text-gray-700">{app.role || '--'}</td>
        <td className="px-4 py-3 text-gray-500 text-xs">
          {app.applied_date ? new Date(app.applied_date + 'T12:00:00').toLocaleDateString()
            : app.created_at ? new Date(app.created_at).toLocaleDateString() : '--'}
        </td>
        <td className="px-4 py-3">
          <select
            value={app.status}
            onChange={(e) => onUpdate({ status: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${statusInfo.color}`}
          >
            {Object.entries(STATUS_INFO).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          {app.status === 'closed' && app.closed_reason && (
            <span className="ml-2 text-[10px] text-gray-500 uppercase tracking-wide">
              {app.closed_reason}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500">
          {followUp ? new Date(followUp + 'T12:00:00').toLocaleDateString() : '--'}
        </td>
        <td className="px-2 py-3 text-xs">
          <select
            value={app.resume_variant || ''}
            onChange={(e) => onUpdate({ resume_variant: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            title={variants.find((v) => v.slug === app.resume_variant)?.label || app.resume_variant || 'No resume selected'}
            className="text-xs border border-gray-200 rounded px-1 py-1 cursor-pointer hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[#F97316] w-[82px] truncate"
          >
            <option value="">—</option>
            {variants.map((v) => (
              <option key={v.slug} value={v.slug} title={v.label || v.slug}>{v.slug}</option>
            ))}
            {app.resume_variant && !variants.some((v) => v.slug === app.resume_variant) && (
              <option value={app.resume_variant}>{app.resume_variant}</option>
            )}
          </select>
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="row-action flex items-center gap-1">
            <button
              type="button"
              disabled={!sourceUrl || !hasCoverLetter}
              onClick={() => {
                if (sourceUrl) window.open(sourceUrl, '_blank', 'noopener');
                if (app.drive_url) window.open(app.drive_url, '_blank', 'noopener');
                if (app.status === 'ready_to_apply') onUpdate({ status: 'applied' });
              }}
              title={!sourceUrl ? 'No posting URL' : !hasCoverLetter ? 'Generate a cover letter first' : 'Open posting + Drive, mark applied'}
              className="text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-2 py-1 rounded disabled:opacity-40 cursor-pointer"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => onShowCoverLetter(app)}
              title="View cover letter"
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded cursor-pointer"
            >
              CL
            </button>
            <button
              type="button"
              onClick={onDelete}
              title="Delete"
              className="text-xs bg-gray-100 hover:bg-red-100 text-gray-600 hover:text-red-600 px-2 py-1 rounded cursor-pointer"
            >
              ×
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 border-b border-gray-100">
          <td colSpan={8} className="px-6 py-4">
            <div className="text-xs text-gray-400">Expanded details coming in the next task.</div>
          </td>
        </tr>
      )}
    </>
  );
}

export const STATUS_INFO = {
  identified: { label: 'Identified', color: 'bg-gray-100 text-gray-700' },
  ready_to_apply: { label: 'Ready to Apply', color: 'bg-purple-50 text-purple-700' },
  applied: { label: 'Applied', color: 'bg-[#F97316]/10 text-[#F97316]' },
  interviewing: { label: 'Interviewing', color: 'bg-amber-50 text-amber-700' },
  closed: { label: 'Closed', color: 'bg-gray-100 text-gray-500' },
};
```

- [ ] **Step 2: Rewrite `Applications.jsx` page shell**

Open `client/src/pages/Applications.jsx`. Replace the top of the file (imports + page component + `APP_STATUSES` const) with:

```jsx
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import ApplicationRow, { STATUS_INFO } from '../components/applications/ApplicationRow';

export default function ApplicationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [coverLetterApp, setCoverLetterApp] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [quickInput, setQuickInput] = useState('');
  const [prefill, setPrefill] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['applications'],
    queryFn: () => api.get('/applications'),
  });

  const { data: variants = [] } = useQuery({
    queryKey: ['resume-variants'],
    queryFn: () => api.get('/resumes'),
  });

  const addMutation = useMutation({
    mutationFn: (app) => api.post('/applications', app),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast('Application added');
      setShowModal(false);
      setPrefill(null);
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...fields }) => api.patch(`/applications/${id}`, fields),
    onMutate: async ({ id, ...fields }) => {
      await queryClient.cancelQueries({ queryKey: ['applications'] });
      const prev = queryClient.getQueryData(['applications']);
      queryClient.setQueryData(['applications'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((a) => (a.id === id ? { ...a, ...fields } : a));
      });
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      queryClient.setQueryData(['applications'], ctx?.prev);
      toast(err.message, 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.del(`/applications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast('Deleted');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const buildMutation = useMutation({
    mutationFn: () => api.post('/applications/batch-packages'),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast(d?.message || 'Package build started');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const generateAllMutation = useMutation({
    mutationFn: () => api.post('/applications/batch-generate-letters'),
    onSuccess: (d) => {
      toast(d?.message || 'Generating cover letters');
      const poll = setInterval(() => queryClient.invalidateQueries({ queryKey: ['applications'] }), 4000);
      setTimeout(() => clearInterval(poll), 120000);
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const bulkMutation = useMutation({
    mutationFn: ({ action, value }) => api.post('/applications/bulk', {
      ids: Array.from(selected), action, value,
    }),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast(d?.message || `Updated ${d?.updated || 0} · ${d?.failed || 0} failed`);
      setSelected(new Set());
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const parseUrlMutation = useMutation({
    mutationFn: (url) => api.post('/applications/parse-url', { url }),
    onSuccess: (d) => {
      setPrefill({ company: d.company, role: d.role, source_url: d.source_url });
      setShowModal(true);
      setQuickInput('');
    },
    onError: (err) => toast(err.message || 'Could not parse URL', 'error'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-600 mb-2">{error.message}</p>
        <button onClick={() => queryClient.invalidateQueries({ queryKey: ['applications'] })}
                className="text-sm text-[#F97316] hover:underline cursor-pointer">Retry</button>
      </div>
    );
  }

  const appList = Array.isArray(data) ? data : data?.applications || [];
  const todayStr = new Date().toISOString().slice(0, 10);

  // Stable sort: by created_at desc, tie-break on id.
  const sorted = useMemo(() => {
    return [...appList].sort((a, b) => {
      const ta = new Date(a.created_at || a.applied_date || 0).getTime();
      const tb = new Date(b.created_at || b.applied_date || 0).getTime();
      if (tb !== ta) return tb - ta;
      return String(a.id).localeCompare(String(b.id));
    });
  }, [appList]);

  // Filter + snooze rule: default view hides snoozed rows whose date is future.
  const filtered = sorted.filter((a) => {
    if (filter !== 'all' && a.status !== filter) return false;
    if (filter === 'all' && a.snoozed_until && a.snoozed_until > todayStr) return false;
    return true;
  });

  const needsPackages = appList.some((a) => a.status === 'ready_to_apply');
  const identifiedNeedingLetter = appList.filter((a) => a.status === 'identified' && !a.cover_letter_text);

  const toggleRow = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => {
    if (prev.size === filtered.length) return new Set();
    return new Set(filtered.map((a) => a.id));
  });

  const handleQuick = () => {
    const v = quickInput.trim();
    if (!v) return;
    if (/^https?:\/\//i.test(v)) {
      parseUrlMutation.mutate(v);
    } else {
      setPrefill({ company: v });
      setShowModal(true);
      setQuickInput('');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-[#1F2D3D]">
            {filtered.length} Application{filtered.length !== 1 ? 's' : ''}
          </h2>
          {needsPackages && (
            <button onClick={() => buildMutation.mutate()} disabled={buildMutation.isPending}
                    className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
              Build Packages
            </button>
          )}
          {identifiedNeedingLetter.length > 0 && (
            <button onClick={() => generateAllMutation.mutate()} disabled={generateAllMutation.isPending}
                    className="text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
              {generateAllMutation.isPending ? 'Starting...' : `Generate All (${identifiedNeedingLetter.length})`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleQuick()}
            placeholder="Paste URL or type company"
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#F97316] w-56"
          />
          <button onClick={handleQuick} disabled={parseUrlMutation.isPending}
                  className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
            {parseUrlMutation.isPending ? '...' : '+ Add'}
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#F97316]">
            <option value="all">All Statuses</option>
            {Object.entries(STATUS_INFO).map(([k, { label }]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          onStatus={(s) => bulkMutation.mutate({ action: 'set_status', value: s })}
          onDelete={() => {
            if (window.confirm(`Delete ${selected.size} application(s)?`))
              bulkMutation.mutate({ action: 'delete' });
          }}
          onGenerate={() => bulkMutation.mutate({ action: 'generate_letter' })}
          onSnooze={(d) => bulkMutation.mutate({ action: 'snooze', value: d })}
          onClear={() => setSelected(new Set())}
          busy={bulkMutation.isPending}
        />
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/50">
              <th className="px-3 py-3">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  className="w-4 h-4 accent-[#F97316] cursor-pointer"
                />
              </th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Added</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Follow-up</th>
              <th className="px-2 py-3 font-medium w-[90px]">Resume</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-gray-400 py-10">No applications found</td></tr>
            ) : (
              filtered.map((app) => (
                <ApplicationRow
                  key={app.id}
                  app={app}
                  variants={variants}
                  selected={selected.has(app.id)}
                  onToggleSelect={() => toggleRow(app.id)}
                  onUpdate={(fields) => updateMutation.mutate({ id: app.id, ...fields })}
                  onShowCoverLetter={(a) => setCoverLetterApp(a)}
                  onDelete={() => {
                    if (window.confirm('Delete this application?')) deleteMutation.mutate(app.id);
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {showModal && (
        <AddApplicationModal
          prefill={prefill}
          onClose={() => { setShowModal(false); setPrefill(null); }}
          onSave={(d) => addMutation.mutate(d)}
          saving={addMutation.isPending}
        />
      )}
      {coverLetterApp && (
        <CoverLetterModal
          app={coverLetterApp}
          onClose={() => setCoverLetterApp(null)}
        />
      )}
    </div>
  );
}

function BulkBar({ count, onStatus, onDelete, onGenerate, onSnooze, onClear, busy }) {
  const [snoozeDate, setSnoozeDate] = useState('');
  return (
    <div className="flex items-center gap-2 bg-[#F97316]/10 border border-[#F97316]/30 rounded-lg px-4 py-2 flex-wrap">
      <span className="text-sm font-medium text-[#1F2D3D] mr-2">{count} selected</span>
      <select
        defaultValue=""
        onChange={(e) => { if (e.target.value) { onStatus(e.target.value); e.target.value = ''; } }}
        disabled={busy}
        className="text-xs border border-gray-300 rounded px-2 py-1 cursor-pointer bg-white"
      >
        <option value="" disabled>Change status…</option>
        {Object.entries(STATUS_INFO).map(([k, { label }]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
      <button onClick={onGenerate} disabled={busy}
              className="text-xs bg-white hover:bg-gray-50 border border-gray-300 px-2 py-1 rounded cursor-pointer disabled:opacity-50">
        Generate Letters
      </button>
      <div className="flex items-center gap-1">
        <input type="date" value={snoozeDate} onChange={(e) => setSnoozeDate(e.target.value)}
               className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white" />
        <button onClick={() => { if (snoozeDate) { onSnooze(snoozeDate); setSnoozeDate(''); } }}
                disabled={!snoozeDate || busy}
                className="text-xs bg-white hover:bg-gray-50 border border-gray-300 px-2 py-1 rounded cursor-pointer disabled:opacity-50">
          Snooze
        </button>
      </div>
      <button onClick={onDelete} disabled={busy}
              className="text-xs bg-white hover:bg-red-50 border border-gray-300 text-red-600 px-2 py-1 rounded cursor-pointer disabled:opacity-50">
        Delete
      </button>
      <button onClick={onClear} className="text-xs text-gray-500 hover:text-gray-700 ml-auto cursor-pointer">
        Clear
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Keep `AddApplicationModal`, `CoverLetterModal`, `ResumeViewModal` as-is**

The existing `AddApplicationModal` and `CoverLetterModal` components at the bottom of `Applications.jsx` remain in the file but with one tweak: `AddApplicationModal` accepts a `prefill` prop and uses it to seed its form state on mount.

Find `function AddApplicationModal({ onClose, onSave, saving })` and replace its signature + first `useState` calls with:

```jsx
function AddApplicationModal({ prefill, onClose, onSave, saving }) {
  const [company, setCompany] = useState(prefill?.company || '');
  const [role, setRole] = useState(prefill?.role || '');
  const [sourceUrl, setSourceUrl] = useState(prefill?.source_url || '');
  // ...leave the rest unchanged
```

Leave everything else in the modal untouched.

Delete the old `ResumeViewModal` and `ResumeTextFetch` functions and the old `ApplicationRow` function body from `Applications.jsx` (they've moved / become obsolete; materials preview lives in the expanded row).

- [ ] **Step 4: Vite build**

Run:
```bash
npx vite build 2>&1 | tail -5
```

Expected: build succeeds, no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Applications.jsx client/src/components/applications/ApplicationRow.jsx
git commit -m "refactor: split Applications page, add stable sort + bulk bar + quick-add"
```

---

## Task 11: Frontend — ApplicationRow expanded detail (Timeline, Notes, Materials)

**Files:**
- Modify: `client/src/components/applications/ApplicationRow.jsx`

- [ ] **Step 1: Replace the placeholder expanded cell with tabbed detail**

In `ApplicationRow.jsx`, replace the `{expanded && (...)}` block at the bottom with:

```jsx
      {expanded && (
        <tr className="bg-gray-50 border-b border-gray-100">
          <td colSpan={8} className="px-6 py-4">
            <ExpandedDetail app={app} onUpdate={onUpdate} variants={variants} />
          </td>
        </tr>
      )}
```

Confirm the top of the file has these imports (add/merge what's missing):

```jsx
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
```

Then add the `ExpandedDetail` component below `ApplicationRow`'s default export:

```jsx
function ExpandedDetail({ app, onUpdate, variants }) {
  const [tab, setTab] = useState(app.status === 'interviewing' ? 'interview' : 'timeline');
  const activity = Array.isArray(app.activity) ? app.activity : [];
  const variantRow = variants.find((v) => v.slug === app.resume_variant);

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="flex items-center gap-1 border-b border-gray-100 px-3 pt-2">
        {[
          ['timeline', 'Timeline'],
          ['notes', 'Notes'],
          ['people', 'People'],
          ['materials', 'Materials'],
          ...(app.status === 'interviewing' ? [['interview', 'Interview Prep']] : []),
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`text-xs font-medium px-3 py-1.5 border-b-2 cursor-pointer ${
              tab === k ? 'border-[#F97316] text-[#F97316]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'timeline' && <TimelineTab activity={activity} />}
        {tab === 'notes' && <NotesTab app={app} onUpdate={onUpdate} />}
        {tab === 'people' && <PeopleTab app={app} />}
        {tab === 'materials' && <MaterialsTab app={app} variantRow={variantRow} />}
        {tab === 'interview' && <InterviewTabLazy app={app} />}
      </div>
    </div>
  );
}

function TimelineTab({ activity }) {
  if (!activity.length) return <div className="text-xs text-gray-400">No activity yet.</div>;
  const reversed = [...activity].reverse();
  return (
    <ul className="space-y-1.5 max-h-64 overflow-y-auto">
      {reversed.map((e, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          <span className="text-gray-400 whitespace-nowrap w-20">{e.date || ''}</span>
          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded font-medium uppercase tracking-wide text-[10px]">
            {e.type}
          </span>
          <span className="flex-1 text-gray-600">{e.note || ''}</span>
        </li>
      ))}
    </ul>
  );
}

function NotesTab({ app, onUpdate }) {
  const [text, setText] = useState(app.notes || '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setText(app.notes || ''); setDirty(false); }, [app.id]);

  const save = () => {
    if (!dirty) return;
    onUpdate({ notes: text });
    setDirty(false);
  };

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setDirty(true); }}
        onBlur={save}
        rows={6}
        placeholder="Notes about this application..."
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#F97316]"
      />
      <div className="mt-1 text-[10px] text-gray-400">
        {dirty ? 'Unsaved — click outside to save' : 'Saved'}
      </div>
    </div>
  );
}

function MaterialsTab({ app, variantRow }) {
  const [resumeText, setResumeText] = useState(null);
  useEffect(() => {
    let cancel = false;
    if (!app.resume_variant) { setResumeText(''); return; }
    api.get(`/resumes/${app.resume_variant}/text`)
      .then((d) => { if (!cancel) setResumeText(d?.parsed_text || ''); })
      .catch(() => { if (!cancel) setResumeText(''); });
    return () => { cancel = true; };
  }, [app.resume_variant]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-[#1F2D3D]">Cover Letter</span>
          {app.cover_letter_text && (
            <button
              onClick={() => navigator.clipboard.writeText(app.cover_letter_text)}
              className="text-[10px] text-[#F97316] hover:underline cursor-pointer"
            >Copy</button>
          )}
        </div>
        <pre className="text-xs bg-gray-50 rounded border border-gray-200 p-3 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">
          {app.cover_letter_text || '(not generated yet)'}
        </pre>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-[#1F2D3D]">
            Resume — {variantRow?.label || app.resume_variant || '(none)'}
          </span>
          {resumeText && (
            <button
              onClick={() => navigator.clipboard.writeText(resumeText)}
              className="text-[10px] text-[#F97316] hover:underline cursor-pointer"
            >Copy</button>
          )}
        </div>
        <pre className="text-xs bg-gray-50 rounded border border-gray-200 p-3 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">
          {resumeText === null ? 'Loading...' : (resumeText || '(no variant attached)')}
        </pre>
      </div>
    </div>
  );
}

function PeopleTab() { return <div className="text-xs text-gray-400">Coming up in Task 12.</div>; }

function InterviewTabLazy() { return <div className="text-xs text-gray-400">Coming up in Task 16.</div>; }
```

(No extra alias juggling — all hooks/helpers come from the standard top-of-file imports.)

- [ ] **Step 2: Build**

```bash
npx vite build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/applications/ApplicationRow.jsx
git commit -m "feat: expandable row — Timeline, Notes, Materials tabs"
```

---

## Task 12: Frontend — People tab with contacts CRUD

**Files:**
- Modify: `client/src/components/applications/ApplicationRow.jsx`

- [ ] **Step 1: Replace the `PeopleTab` stub**

Add these imports to the top of `ApplicationRow.jsx` (merge with the existing import block):

```jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
```

Then replace the `PeopleTab` stub with a full implementation:

```jsx

const CONTACT_KINDS = [
  { value: 'hiring_manager', label: 'Hiring Manager' },
  { value: 'recruiter',      label: 'Recruiter' },
  { value: 'interviewer',    label: 'Interviewer' },
  { value: 'referrer',       label: 'Referrer' },
  { value: 'other',          label: 'Other' },
];

function PeopleTab({ app }) {
  const qc = useQueryClient();
  const { data: contacts = [] } = useQuery({
    queryKey: ['app-contacts', app.id],
    queryFn: () => api.get(`/applications/${app.id}/contacts`),
  });

  const createMut = useMutation({
    mutationFn: (data) => api.post(`/applications/${app.id}/contacts`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-contacts', app.id] }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => api.patch(`/applications/contacts/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-contacts', app.id] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => api.del(`/applications/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-contacts', app.id] }),
  });

  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="space-y-2 mb-3">
        {contacts.length === 0 && !adding && (
          <div className="text-xs text-gray-400">No people yet.</div>
        )}
        {contacts.map((c) => (
          <ContactRow key={c.id} contact={c}
                      onUpdate={(data) => updateMut.mutate({ id: c.id, ...data })}
                      onDelete={() => deleteMut.mutate(c.id)} />
        ))}
      </div>
      {adding ? (
        <ContactForm onSave={(d) => { createMut.mutate(d); setAdding(false); }}
                     onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)}
                className="text-xs text-[#F97316] hover:text-[#EA580C] cursor-pointer">
          + Add person
        </button>
      )}
    </div>
  );
}

function ContactRow({ contact, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const kindLabel = CONTACT_KINDS.find((k) => k.value === contact.kind)?.label || contact.kind;
  if (editing) {
    return <ContactForm initial={contact} onSave={(d) => { onUpdate(d); setEditing(false); }}
                        onCancel={() => setEditing(false)} />;
  }
  return (
    <div className="flex items-start gap-3 border border-gray-200 rounded-lg bg-white px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#1F2D3D]">
          {contact.name}
          {contact.title && <span className="text-gray-500 font-normal"> — {contact.title}</span>}
        </div>
        <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap">
          <span className="uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded font-medium">{kindLabel}</span>
          {contact.email && <a href={`mailto:${contact.email}`} className="hover:text-[#F97316]">{contact.email}</a>}
          {contact.linkedin_url && <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer"
                                     className="hover:text-[#F97316]">LinkedIn</a>}
        </div>
        {contact.notes && <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{contact.notes}</div>}
      </div>
      <button onClick={() => setEditing(true)} className="text-[11px] text-gray-500 hover:text-[#F97316] cursor-pointer">Edit</button>
      <button onClick={onDelete} className="text-[11px] text-gray-400 hover:text-red-600 cursor-pointer">×</button>
    </div>
  );
}

function ContactForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    title: initial?.title || '',
    email: initial?.email || '',
    linkedin_url: initial?.linkedin_url || '',
    kind: initial?.kind || 'interviewer',
    notes: initial?.notes || '',
  });
  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
  const canSave = f.name.trim().length > 0;

  return (
    <div className="border border-[#F97316]/30 bg-[#F97316]/5 rounded-lg px-3 py-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input placeholder="Name *" value={f.name} onChange={(e) => set('name', e.target.value)}
               className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#F97316]" />
        <input placeholder="Title" value={f.title} onChange={(e) => set('title', e.target.value)}
               className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#F97316]" />
        <input placeholder="Email" value={f.email} onChange={(e) => set('email', e.target.value)}
               className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#F97316]" />
        <input placeholder="LinkedIn URL" value={f.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)}
               className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#F97316]" />
        <select value={f.kind} onChange={(e) => set('kind', e.target.value)}
                className="text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[#F97316]">
          {CONTACT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <textarea placeholder="Notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
                className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#F97316]" />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer">Cancel</button>
        <button onClick={() => canSave && onSave(f)} disabled={!canSave}
                className="text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-3 py-1 rounded cursor-pointer disabled:opacity-50">
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
npx vite build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/applications/ApplicationRow.jsx
git commit -m "feat: People tab — contacts CRUD per application"
```

---

## Task 13: Frontend — InterviewChat component + Interview Prep tab

**Files:**
- Create: `client/src/components/applications/InterviewChat.jsx`
- Modify: `client/src/components/applications/ApplicationRow.jsx`

- [ ] **Step 1: Create `InterviewChat.jsx`**

```jsx
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const SUGGESTION_BASE = [
  'Generate 10 likely questions for this role',
  'Help me rehearse behavioral answers from my resume',
];

export default function InterviewChat({ app }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  const { data: contacts = [] } = useQuery({
    queryKey: ['app-contacts', app.id],
    queryFn: () => api.get(`/applications/${app.id}/contacts`),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['app-chat', app.id],
    queryFn: () => api.get(`/applications/${app.id}/chat`),
    enabled: !!user?.isPro,
  });

  const sendMut = useMutation({
    mutationFn: (message) => api.post(`/applications/${app.id}/chat`, { message }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['app-chat', app.id] }); setDraft(''); },
  });

  const clearMut = useMutation({
    mutationFn: () => api.del(`/applications/${app.id}/chat`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-chat', app.id] }),
  });

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [data?.messages?.length, sendMut.isPending]);

  if (!user?.isPro) {
    return (
      <div className="text-center py-8">
        <div className="text-sm font-semibold text-[#1F2D3D] mb-1">Interview Prep Chat is Pro-only</div>
        <p className="text-xs text-gray-500 mb-3">
          Unlock a Claude-powered coach for this interview with full context on the role, your resume, and the people you're meeting.
        </p>
        <a href="/settings#billing" className="inline-block text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-4 py-2 rounded-lg">
          Upgrade to Pro
        </a>
      </div>
    );
  }

  if (error) {
    return <div className="text-xs text-red-600">{error.message}</div>;
  }

  const messages = data?.messages || [];
  const turnCount = data?.turn_count || 0;
  const cap = data?.cap || 80;
  const capped = turnCount >= cap;

  const firstInterviewer = contacts.find((c) => c.kind === 'interviewer');
  const suggestions = [
    ...SUGGESTION_BASE,
    ...(firstInterviewer ? [`Research ${firstInterviewer.name} and suggest what to ask them`] : []),
  ];

  const onSend = (text) => {
    const msg = (text ?? draft).trim();
    if (!msg || sendMut.isPending) return;
    sendMut.mutate(msg);
  };

  return (
    <div className="flex flex-col h-[420px]">
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
        {isLoading ? (
          <div className="text-xs text-gray-400 py-8 text-center">Loading history...</div>
        ) : messages.length === 0 ? (
          <div className="py-6">
            <p className="text-xs text-gray-500 mb-3">Ask anything. Claude has your resume, the JD, the people on this app, and your notes.</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-full cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-[#F97316] text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {m.content}
              </div>
            </div>
          ))
        )}
        {sendMut.isPending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-500 rounded-lg px-3 py-2 text-sm">...</div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-gray-500 mt-2 mb-1">
        <span>{turnCount}/{cap} turns</span>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button onClick={() => navigator.clipboard.writeText(messages[messages.length - 1]?.content || '')}
                    className="hover:text-[#F97316] cursor-pointer">Copy last reply</button>
          )}
          {messages.length > 0 && (
            <button onClick={() => { if (window.confirm('Clear chat history?')) clearMut.mutate(); }}
                    className="hover:text-red-600 cursor-pointer">Clear chat</button>
          )}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend(); }
          }}
          disabled={capped || sendMut.isPending}
          placeholder={capped ? 'Chat full — clear to continue' : 'Ask a question (⌘/Ctrl+Enter)'}
          rows={2}
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#F97316] disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button
          onClick={() => onSend()}
          disabled={!draft.trim() || capped || sendMut.isPending}
          className="text-sm bg-[#F97316] hover:bg-[#EA580C] text-white px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
        >
          {sendMut.isPending ? '...' : 'Send'}
        </button>
      </div>
      {sendMut.error && (
        <div className="text-[11px] text-red-600 mt-1">{sendMut.error.message}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace the `InterviewTabLazy` stub in `ApplicationRow.jsx`**

Add to the top of `ApplicationRow.jsx`:

```jsx
import InterviewChat from './InterviewChat';
```

Then replace:

```jsx
function InterviewTabLazy() { return <div className="text-xs text-gray-400">Coming up in Task 16.</div>; }
```

with:

```jsx
function InterviewTabLazy({ app }) { return <InterviewChat app={app} />; }
```

Also make sure the call site passes the app:

```jsx
{tab === 'interview' && <InterviewTabLazy app={app} />}
```

(Replace the existing `<InterviewTabLazy />` to include the prop.)

- [ ] **Step 3: Build**

```bash
npx vite build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/applications/InterviewChat.jsx client/src/components/applications/ApplicationRow.jsx
git commit -m "feat: Interview Prep chat panel — Pro-gated, unlocks at Interviewing"
```

---

## Task 14: Final wiring smoke test

- [ ] **Step 1: Full boot + build**

```bash
node -c server.js && npx vite build 2>&1 | tail -5 && echo OK
```

Expected: `OK`. Build output shows a single chunk under ~500KB gzip < 150KB.

- [ ] **Step 2: Require graph smoke**

```bash
node -e "
  require('./src/routes/applications');
  require('./src/routes/applications-contacts');
  require('./src/routes/applications-chat');
  console.log('all route files load');
"
```

Expected: `all route files load`.

- [ ] **Step 3: Commit (if anything changed) and push**

```bash
git status
# If anything's uncommitted from fixup, commit now.
git push
```

Expected: `main` now points to the final commit. Railway picks up the migration and routes automatically.

- [ ] **Step 4: Manual test plan after deploy**

Run through this sequence on the live site (post-deploy):

1. Open Applications — confirm 5 statuses in the filter dropdown.
2. Create a new app manually. Confirm it lands in Identified.
3. Click Generate → confirm cover letter + resume_variant get set, row auto-flips to Ready to Apply with an `auto_ready` activity entry in the Timeline tab.
4. Switch filter to "All Statuses." Change a row's status via its dropdown — confirm it does NOT move in the list.
5. Switch filter to "Identified" — change a row from Identified to Applied — confirm it drops out of the list on the next render.
6. Select 3 rows via checkboxes — bulk bar appears. Change status via bulk → confirm all 3 updated.
7. Paste a LinkedIn posting URL into the quick-add input → Add → confirm the modal prefills company+role.
8. Snooze a row +1w via the bulk bar → confirm the row hides in "All" view, appears in "Identified" view with `💤`.
9. Open a row's expand panel → tabs Timeline / Notes / People / Materials show correct content. Add a person, edit the name, delete.
10. Move an app to Interviewing. Open it → Interview Prep tab appears. Free user: locked state with upgrade CTA. Pro user: chat history empty + suggestion chips. Send a message → reply appears + persists on refresh. Clear chat → back to empty.

---

## Self-Review Checklist

- [x] Spec coverage: all 9 items from the spec have tasks: 5-status model (T1, T2), stable sort (T10), actions column (T10), bulk (T5, T10), expandable row (T11, T12, T13), snooze (T6, T10), quick-add (T7, T10), people (T8, T12), interview chat (T9, T13).
- [x] Placeholder scan: no TBD/TODO. Every code block is complete.
- [x] Type consistency: `STATUS_INFO` keys match `VALID_APP_STATUSES`. `maybeAutoAdvance` signature consistent across callers. `buildInterviewChatSystemPrompt` takes `{app, jdText, resumeText, coverLetter, profile, contacts, notes, activity}` — matches the chat route call site.
- [x] Auto-advance hook points: `PATCH /applications/:id`, `generate-letter`, `batch-generate-letters`, plus the new `POST /applications/bulk` with `generate_letter` action — all four covered.
- [x] Migration idempotency: uses `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and backfill UPDATEs scoped to legacy status values.

---

**End of plan.**
