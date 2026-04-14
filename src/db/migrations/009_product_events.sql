-- 009_product_events.sql
-- Anonymized product event logging. Foundation for personal + aggregate
-- insights. Payload is JSONB for flexibility as new events land without
-- schema migrations.

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
