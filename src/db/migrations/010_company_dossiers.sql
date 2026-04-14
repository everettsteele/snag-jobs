-- 010_company_dossiers.sql
-- Shared (tenant-independent) company info cache. Populated on demand by
-- the dossier service. Reads are always free; generations are quota-gated.

BEGIN;

CREATE TABLE IF NOT EXISTS company_dossiers (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_key           TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  source_domain         TEXT,
  summary               TEXT,
  facts                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  links                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  tokens_in             INT NOT NULL DEFAULT 0,
  tokens_out            INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_dossiers_key
  ON company_dossiers(company_key);

COMMIT;
