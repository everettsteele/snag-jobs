-- Migration 001: Multi-tenant foundation schema
-- Creates all tables needed for a multi-user commercial deployment.

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";  -- case-insensitive text for emails

-- ================================================================
-- TENANTS & USERS
-- ================================================================

CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free',  -- free, pro, enterprise
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',  -- owner, admin, member
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);

-- ================================================================
-- USER PROFILES — stores resume, background, and preferences
-- ================================================================

CREATE TABLE user_profiles (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name        TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  email_display    TEXT NOT NULL DEFAULT '',  -- display email (may differ from login)
  linkedin_url     TEXT NOT NULL DEFAULT '',
  location         TEXT NOT NULL DEFAULT '',
  background_text  TEXT NOT NULL DEFAULT '',  -- full biography for AI prompts
  target_roles     TEXT[] NOT NULL DEFAULT '{}',
  target_geography TEXT[] NOT NULL DEFAULT '{}',
  target_industries TEXT[] NOT NULL DEFAULT '{}',
  daily_outreach_target INT NOT NULL DEFAULT 15,
  sla_target       INT NOT NULL DEFAULT 10,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- RESUME VARIANTS — user-defined resume versions
-- ================================================================

CREATE TABLE resume_variants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,        -- 'operator', 'partner', etc.
  label       TEXT NOT NULL,        -- human-readable description
  file_url    TEXT NOT NULL DEFAULT '',  -- S3/GCS URL to the PDF
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, slug)
);

CREATE INDEX idx_resume_variants_user ON resume_variants(user_id);

-- ================================================================
-- PLATFORM FIRMS — shared recruiter database (the "moat")
-- Read-only for users. Maintained by platform.
-- ================================================================

CREATE TABLE platform_firms (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL,  -- 'firms', 'ceos', 'vcs'
  name        TEXT NOT NULL,
  tier        INT,
  why         TEXT NOT NULL DEFAULT '',
  sector      TEXT,
  template_version TEXT,
  website     TEXT NOT NULL DEFAULT '',
  contacts    JSONB NOT NULL DEFAULT '[]',  -- [{name, title, email}]
  metadata    JSONB NOT NULL DEFAULT '{}',  -- flexible extra fields
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_firms_category ON platform_firms(category);

-- ================================================================
-- USER OUTREACH — per-user status/notes on platform firms
-- ================================================================

CREATE TABLE user_outreach (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform_firm_id INT REFERENCES platform_firms(id) ON DELETE SET NULL,
  -- Fields for custom contacts (not in platform_firms)
  custom_name     TEXT,
  custom_category TEXT,  -- 'firms', 'ceos', 'vcs'
  custom_contacts JSONB,
  -- Outreach state
  status          TEXT NOT NULL DEFAULT 'not contacted',
  notes           TEXT NOT NULL DEFAULT '',
  followup_date   DATE,
  last_contacted  DATE,
  is_job_search   BOOLEAN NOT NULL DEFAULT TRUE,
  gmail_thread_id TEXT,
  cadence_day     INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_outreach_user ON user_outreach(user_id);
CREATE INDEX idx_user_outreach_tenant ON user_outreach(tenant_id);
CREATE INDEX idx_user_outreach_status ON user_outreach(status);
CREATE INDEX idx_user_outreach_followup ON user_outreach(followup_date) WHERE followup_date IS NOT NULL;

-- ================================================================
-- APPLICATIONS
-- ================================================================

CREATE TABLE applications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company         TEXT NOT NULL,
  role            TEXT NOT NULL,
  applied_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'queued',
  source_url      TEXT NOT NULL DEFAULT '',
  notion_url      TEXT NOT NULL DEFAULT '',
  drive_url       TEXT NOT NULL DEFAULT '',
  drive_folder_id TEXT NOT NULL DEFAULT '',
  follow_up_date  DATE,
  last_activity   DATE NOT NULL DEFAULT CURRENT_DATE,
  notes           TEXT NOT NULL DEFAULT '',
  cover_letter_text TEXT,
  resume_variant  TEXT,
  activity        JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_applications_tenant ON applications(tenant_id);
CREATE INDEX idx_applications_user ON applications(user_id);
CREATE INDEX idx_applications_status ON applications(status);

-- ================================================================
-- JOB BOARD LEADS
-- ================================================================

CREATE TABLE job_board_leads (
  id              TEXT NOT NULL,  -- source prefix + hash
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  source_label    TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL,
  organization    TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  url             TEXT NOT NULL,
  fit_score       INT NOT NULL DEFAULT 0,
  fit_reason      TEXT NOT NULL DEFAULT '',
  date_found      DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'new',
  snoozed         BOOLEAN NOT NULL DEFAULT FALSE,
  snagged_app_id  UUID REFERENCES applications(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, tenant_id)
);

CREATE INDEX idx_job_board_leads_tenant ON job_board_leads(tenant_id);
CREATE INDEX idx_job_board_leads_status ON job_board_leads(tenant_id, status);

-- ================================================================
-- NETWORKING EVENTS
-- ================================================================

CREATE TABLE networking_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source          TEXT NOT NULL DEFAULT 'manual',
  external_id     TEXT,
  calendar_id     TEXT,
  calendar_name   TEXT,
  title           TEXT NOT NULL,
  start_date      DATE NOT NULL,
  start_time      TEXT NOT NULL DEFAULT '',
  end_time        TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  type            TEXT NOT NULL DEFAULT 'other',
  attendees       JSONB NOT NULL DEFAULT '[]',
  notes           TEXT NOT NULL DEFAULT '',
  contacts        JSONB NOT NULL DEFAULT '[]',
  next_steps      JSONB NOT NULL DEFAULT '[]',
  hidden          BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_networking_events_tenant ON networking_events(tenant_id);
CREATE INDEX idx_networking_events_user ON networking_events(user_id);
CREATE INDEX idx_networking_events_date ON networking_events(start_date);

-- ================================================================
-- CRON STATE — per-user daily queue state
-- ================================================================

CREATE TABLE cron_state (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_run_date   DATE,
  total_drafted   INT NOT NULL DEFAULT 0,
  allocations     JSONB NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- USAGE LOG — for billing and rate limiting
-- ================================================================

CREATE TABLE usage_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,  -- 'cover_letter', 'variant_select', 'crawl', etc.
  tokens_used INT NOT NULL DEFAULT 0,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_log_tenant ON usage_log(tenant_id);
CREATE INDEX idx_usage_log_created ON usage_log(created_at);

-- ================================================================
-- JOB SEARCH CONFIG — per-user crawler preferences
-- ================================================================

CREATE TABLE job_search_config (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled_sources     TEXT[] NOT NULL DEFAULT '{jewishjobs,execthread,csnetwork,idealist,builtinatlanta}',
  search_keywords     TEXT[] NOT NULL DEFAULT '{chief operating officer,vp operations,chief of staff,director of operations}',
  location_allow      TEXT[] NOT NULL DEFAULT '{Atlanta,Georgia,Remote}',
  location_deny       TEXT[] NOT NULL DEFAULT '{}',
  min_score           INT NOT NULL DEFAULT 3,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- CALENDAR CONFIG — per-user Google Calendar sync settings
-- ================================================================

CREATE TABLE calendar_config (
  user_id                    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  setup_complete             BOOLEAN NOT NULL DEFAULT FALSE,
  whitelisted_calendar_ids   TEXT[] NOT NULL DEFAULT '{}',
  whitelisted_calendar_names JSONB NOT NULL DEFAULT '{}',
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- REFRESH TOKENS — persistent sessions
-- ================================================================

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);
