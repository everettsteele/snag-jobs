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
