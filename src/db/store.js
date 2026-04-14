// PostgreSQL-backed data store with tenant isolation.
// Every function requires tenantId and/or userId to enforce data boundaries.

const { query, withTransaction } = require('./pool');

// ================================================================
// APPLICATIONS
// ================================================================

async function listApplications(tenantId, userId) {
  const { rows } = await query(
    `SELECT * FROM applications WHERE tenant_id = $1 AND user_id = $2
     ORDER BY applied_date DESC`,
    [tenantId, userId]
  );
  return rows;
}

async function getApplication(tenantId, id) {
  const { rows } = await query(
    `SELECT * FROM applications WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function createApplication(tenantId, userId, data) {
  const { rows } = await query(
    `INSERT INTO applications (tenant_id, user_id, company, role, applied_date, status, source_url, notion_url, follow_up_date, notes, activity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [tenantId, userId, data.company, data.role, data.applied_date, data.status || 'queued',
     data.source_url || '', data.notion_url || '', data.follow_up_date,
     data.notes || '', JSON.stringify(data.activity || [])]
  );
  return rows[0];
}

async function updateApplication(tenantId, id, fields) {
  const app = await getApplication(tenantId, id);
  if (!app) return null;

  const allowed = [
    'company', 'role', 'status', 'source_url', 'notion_url', 'drive_url',
    'drive_folder_id', 'follow_up_date', 'last_activity', 'notes',
    'cover_letter_text', 'resume_variant', 'activity',
  ];

  const sets = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      if (key === 'activity') {
        sets.push(`${key} = $${idx}::jsonb`);
        values.push(JSON.stringify(value));
      } else {
        sets.push(`${key} = $${idx}`);
        values.push(value);
      }
      idx++;
    }
  }
  if (sets.length === 0) return app;

  sets.push(`updated_at = NOW()`);
  values.push(id, tenantId);

  const { rows } = await query(
    `UPDATE applications SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values
  );
  return rows[0];
}

async function deleteApplication(tenantId, id) {
  const { rowCount } = await query(
    `DELETE FROM applications WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rowCount > 0;
}

// ================================================================
// JOB BOARD LEADS
// ================================================================

async function listJobBoardLeads(tenantId, status) {
  if (status) {
    const { rows } = await query(
      `SELECT * FROM job_board_leads WHERE tenant_id = $1 AND status = $2
       ORDER BY fit_score DESC, date_found DESC`,
      [tenantId, status]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT * FROM job_board_leads WHERE tenant_id = $1 AND status = 'new'
     ORDER BY fit_score DESC, date_found DESC`,
    [tenantId]
  );
  return rows;
}

async function getJobBoardLead(tenantId, id) {
  const { rows } = await query(
    `SELECT * FROM job_board_leads WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function upsertJobBoardLeads(tenantId, leads) {
  if (!leads.length) return 0;
  let inserted = 0;
  for (const l of leads) {
    const { rowCount } = await query(
      `INSERT INTO job_board_leads (id, tenant_id, source, source_label, title, organization, location, url, fit_score, fit_reason, date_found, status, snoozed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id, tenant_id) DO NOTHING`,
      [l.id, tenantId, l.source, l.source_label || '', l.title, l.organization || '',
       l.location || '', l.url, l.fit_score, l.fit_reason || '', l.date_found,
       l.status || 'new', l.snoozed || false]
    );
    inserted += rowCount;
  }
  return inserted;
}

async function updateJobBoardLead(tenantId, id, fields) {
  const allowed = ['status', 'snoozed', 'snagged_app_id'];
  const sets = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }
  if (sets.length === 0) return null;
  values.push(id, tenantId);
  const { rows } = await query(
    `UPDATE job_board_leads SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function batchUpdateJobBoardLeads(tenantId, updates) {
  let updated = 0;
  for (const { id, ...fields } of updates) {
    const result = await updateJobBoardLead(tenantId, id, fields);
    if (result) updated++;
  }
  return updated;
}

async function jobBoardLeadCounts(tenantId) {
  const { rows } = await query(
    `SELECT status, COUNT(*)::int as count FROM job_board_leads
     WHERE tenant_id = $1 GROUP BY status`,
    [tenantId]
  );
  return rows.reduce((acc, r) => { acc[r.status] = r.count; return acc; }, {});
}

// ================================================================
// NETWORKING EVENTS
// ================================================================

async function listEvents(tenantId, userId, { includeHidden, days } = {}) {
  let sql = `SELECT * FROM networking_events WHERE tenant_id = $1 AND user_id = $2`;
  const params = [tenantId, userId];

  if (!includeHidden) {
    sql += ` AND hidden = false`;
  }
  if (days) {
    sql += ` AND start_date >= CURRENT_DATE - $${params.length + 1}::int`;
    params.push(days);
  }
  sql += ` ORDER BY start_date DESC`;

  const { rows } = await query(sql, params);
  return rows;
}

async function getEvent(tenantId, id) {
  const { rows } = await query(
    `SELECT * FROM networking_events WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function createEvent(tenantId, userId, data) {
  const { rows } = await query(
    `INSERT INTO networking_events (tenant_id, user_id, source, external_id, calendar_id, calendar_name, title, start_date, start_time, end_time, location, type, attendees, notes, contacts, next_steps)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15::jsonb, $16::jsonb)
     RETURNING *`,
    [tenantId, userId, data.source || 'manual', data.external_id || null,
     data.calendar_id || null, data.calendar_name || null,
     data.title, data.start_date, data.start_time || '', data.end_time || '',
     data.location || '', data.type || 'other',
     JSON.stringify(data.attendees || []), data.notes || '',
     JSON.stringify(data.contacts || []), JSON.stringify(data.next_steps || [])]
  );
  return rows[0];
}

async function updateEvent(tenantId, id, fields) {
  const allowed = [
    'title', 'start_date', 'start_time', 'end_time', 'location', 'type',
    'attendees', 'notes', 'contacts', 'next_steps', 'hidden', 'follow_up_sent',
  ];
  const jsonFields = new Set(['attendees', 'contacts', 'next_steps']);

  const sets = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      if (jsonFields.has(key)) {
        sets.push(`${key} = $${idx}::jsonb`);
        values.push(JSON.stringify(value));
      } else {
        sets.push(`${key} = $${idx}`);
        values.push(value);
      }
      idx++;
    }
  }
  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  values.push(id, tenantId);

  const { rows } = await query(
    `UPDATE networking_events SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function deleteEvent(tenantId, id) {
  const { rowCount } = await query(
    `DELETE FROM networking_events WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rowCount > 0;
}

// ================================================================
// PLATFORM FIRMS (shared, read-only for users)
// ================================================================

async function listPlatformFirms(category) {
  const { rows } = await query(
    `SELECT * FROM platform_firms WHERE category = $1 ORDER BY tier, name`,
    [category]
  );
  return rows;
}

// ================================================================
// USER OUTREACH — per-user interaction state on firms
// ================================================================

async function getUserOutreach(tenantId, userId, category) {
  const { rows } = await query(
    `SELECT uo.*, pf.name as firm_name, pf.tier, pf.why, pf.sector,
            pf.template_version, pf.website, pf.contacts as firm_contacts, pf.metadata
     FROM user_outreach uo
     LEFT JOIN platform_firms pf ON pf.id = uo.platform_firm_id
     WHERE uo.tenant_id = $1 AND uo.user_id = $2
       AND (pf.category = $3 OR uo.custom_category = $3)
     ORDER BY COALESCE(pf.tier, 99), COALESCE(pf.name, uo.custom_name)`,
    [tenantId, userId, category]
  );
  return rows;
}

async function upsertUserOutreach(tenantId, userId, platformFirmId, fields) {
  const { rows } = await query(
    `INSERT INTO user_outreach (tenant_id, user_id, platform_firm_id, status, notes, followup_date, last_contacted, is_job_search, gmail_thread_id, cadence_day)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (user_id, platform_firm_id) WHERE platform_firm_id IS NOT NULL
     DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, followup_date = EXCLUDED.followup_date,
                   last_contacted = EXCLUDED.last_contacted, is_job_search = EXCLUDED.is_job_search,
                   gmail_thread_id = EXCLUDED.gmail_thread_id, cadence_day = EXCLUDED.cadence_day,
                   updated_at = NOW()
     RETURNING *`,
    [tenantId, userId, platformFirmId,
     fields.status || 'not contacted', fields.notes || '', fields.followup_date || null,
     fields.last_contacted || null, fields.is_job_search !== false,
     fields.gmail_thread_id || null, fields.cadence_day || 1]
  );
  return rows[0];
}

async function updateUserOutreachById(tenantId, id, fields) {
  const allowed = ['status', 'notes', 'followup_date', 'last_contacted', 'is_job_search', 'gmail_thread_id', 'cadence_day'];
  const sets = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }
  if (sets.length === 0) return null;
  sets.push(`updated_at = NOW()`);
  values.push(id, tenantId);
  const { rows } = await query(
    `UPDATE user_outreach SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values
  );
  return rows[0] || null;
}

// ================================================================
// CRON STATE
// ================================================================

async function getCronState(userId) {
  const { rows } = await query(`SELECT * FROM cron_state WHERE user_id = $1`, [userId]);
  return rows[0] || { user_id: userId, last_run_date: null, total_drafted: 0, allocations: {} };
}

async function saveCronState(userId, data) {
  await query(
    `INSERT INTO cron_state (user_id, last_run_date, total_drafted, allocations)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET last_run_date = $2, total_drafted = $3, allocations = $4::jsonb, updated_at = NOW()`,
    [userId, data.last_run_date, data.total_drafted || 0, JSON.stringify(data.allocations || {})]
  );
}

// ================================================================
// CALENDAR CONFIG
// ================================================================

async function getCalConfig(userId) {
  const { rows } = await query(`SELECT * FROM calendar_config WHERE user_id = $1`, [userId]);
  return rows[0] || { user_id: userId, setup_complete: false, whitelisted_calendar_ids: [], whitelisted_calendar_names: {} };
}

async function saveCalConfig(userId, data) {
  await query(
    `INSERT INTO calendar_config (user_id, setup_complete, whitelisted_calendar_ids, whitelisted_calendar_names)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET setup_complete = $2, whitelisted_calendar_ids = $3, whitelisted_calendar_names = $4::jsonb, updated_at = NOW()`,
    [userId, data.setup_complete || false, data.whitelisted_calendar_ids || [], JSON.stringify(data.whitelisted_calendar_names || {})]
  );
}

// ================================================================
// JOB SEARCH CONFIG
// ================================================================

async function getJobSearchConfig(userId) {
  const { rows } = await query(`SELECT * FROM job_search_config WHERE user_id = $1`, [userId]);
  return rows[0] || null;
}

async function saveJobSearchConfig(userId, data) {
  // Ensure row exists first
  await query(
    `INSERT INTO job_search_config (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const allowed = ['enabled_sources', 'search_keywords', 'location_allow', 'location_deny', 'min_score'];
  const sets = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(data)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = NOW()`);
  values.push(userId);
  await query(
    `UPDATE job_search_config SET ${sets.join(', ')} WHERE user_id = $${idx}`,
    values
  );
}

// ================================================================
// USAGE LOG
// ================================================================

async function logUsage(tenantId, userId, action, tokensUsed, metadata) {
  await query(
    `INSERT INTO usage_log (tenant_id, user_id, action, tokens_used, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [tenantId, userId, action, tokensUsed || 0, JSON.stringify(metadata || {})]
  );
}

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

async function getApplicationContact(tenantId, contactId) {
  const { rows } = await query(
    `SELECT * FROM application_contacts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, contactId]
  );
  return rows[0] || null;
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

// ================================================================
// PRODUCT EVENTS (analytics)
// ================================================================

async function createProductEvent(tenantId, userId, eventType, entityType, entityId, payload) {
  await query(
    `INSERT INTO product_events (tenant_id, user_id, event_type, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [tenantId, userId, eventType, entityType || null, entityId || null, JSON.stringify(payload || {})]
  );
}

async function isAnalyticsOptOut(userId) {
  const { rows } = await query(
    `SELECT analytics_opt_out FROM user_profiles WHERE user_id = $1`,
    [userId]
  );
  return !!rows[0]?.analytics_opt_out;
}

module.exports = {
  // Applications
  listApplications, getApplication, createApplication, updateApplication, deleteApplication,
  // Application — Snooze + JD Cache
  snoozeApplication, setJdText,
  // Application — Contacts
  listApplicationContacts, getApplicationContact, createApplicationContact, updateApplicationContact, deleteApplicationContact,
  // Application — Chat
  listChatMessages, appendChatMessage, clearChatMessages, countChatTurns,
  // Job Board
  listJobBoardLeads, getJobBoardLead, upsertJobBoardLeads, updateJobBoardLead, batchUpdateJobBoardLeads, jobBoardLeadCounts,
  // Networking
  listEvents, getEvent, createEvent, updateEvent, deleteEvent,
  // Platform Firms
  listPlatformFirms,
  // User Outreach
  getUserOutreach, upsertUserOutreach, updateUserOutreachById,
  // Config
  getCronState, saveCronState, getCalConfig, saveCalConfig,
  getJobSearchConfig, saveJobSearchConfig,
  // Usage
  logUsage,
  // Product Events (analytics)
  createProductEvent,
  isAnalyticsOptOut,
};
