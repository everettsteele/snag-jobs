#!/usr/bin/env node
// One-off: import JSON data into an existing user's workspace.
// Usage: DATABASE_URL=... node src/db/import-to-existing-user.js
// Or:    EMAIL=you@example.com node src/db/import-to-existing-user.js

const fs = require('fs');
const path = require('path');
const { query, closePool } = require('./pool');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SEEDS_DIR = path.join(__dirname, '..', '..', 'seeds');

function loadJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return null; }
}

async function run() {
  const email = process.env.EMAIL || 'everett.steele@gmail.com';

  console.log(`\n=== Importing JSON data for ${email} ===\n`);

  // Find existing user
  const { rows } = await query(
    `SELECT u.id as user_id, u.tenant_id FROM users u WHERE u.email = $1`,
    [email]
  );
  if (!rows.length) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }
  const { user_id: userId, tenant_id: tenantId } = rows[0];
  console.log(`  User:   ${userId}`);
  console.log(`  Tenant: ${tenantId}\n`);

  // Import platform firms from seeds
  for (const category of ['firms', 'ceos', 'vcs']) {
    const items = loadJSON(path.join(SEEDS_DIR, `seed_${category}.json`));
    if (!items || !items.length) { console.log(`  [skip] No seed data for ${category}`); continue; }
    console.log(`  Importing ${items.length} ${category} into platform_firms...`);
    for (const item of items) {
      await query(
        `INSERT INTO platform_firms (id, category, name, tier, why, sector, template_version, website, contacts, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [item.id, category, item.name || item.company || item.firm || '',
         item.tier || null, item.why || '', item.sector || null,
         item.template_version || null, item.website || '',
         JSON.stringify(item.contacts || []),
         JSON.stringify({ status: item.status, linkedin: item.linkedin })]
      );
    }
    console.log(`  [done] ${category}`);
  }

  // Import overrides → user_outreach
  const overrides = loadJSON(path.join(DATA_DIR, 'overrides.json'));
  if (overrides) {
    let outreachCount = 0;
    for (const category of ['firms', 'ceos', 'vcs']) {
      const ov = overrides[category] || {};
      for (const [firmId, fields] of Object.entries(ov)) {
        await query(
          `INSERT INTO user_outreach (tenant_id, user_id, platform_firm_id, status, notes, followup_date, last_contacted, is_job_search, gmail_thread_id, cadence_day)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT DO NOTHING`,
          [tenantId, userId, parseInt(firmId),
           fields.status || 'not contacted', fields.notes || '',
           fields.followup_date || null, fields.last_contacted || null,
           fields.is_job_search !== false, fields.gmail_thread_id || null,
           fields.cadence_day || 1]
        );
        outreachCount++;
      }
    }
    console.log(`  Imported ${outreachCount} outreach overrides`);
  }

  // Import applications
  const apps = loadJSON(path.join(DATA_DIR, 'applications.json'));
  if (apps && apps.length) {
    console.log(`  Importing ${apps.length} applications...`);
    let imported = 0;
    for (const app of apps) {
      try {
        await query(
          `INSERT INTO applications (id, tenant_id, user_id, company, role, applied_date, status, source_url, notion_url, drive_url, drive_folder_id, follow_up_date, last_activity, notes, cover_letter_text, resume_variant, activity)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [app.id, tenantId, userId, app.company, app.role,
           app.applied_date, app.status, app.source_url || '', app.notion_url || '',
           app.drive_url || '', app.drive_folder_id || '',
           app.follow_up_date || null, app.last_activity || app.applied_date,
           app.notes || '', app.cover_letter_text || null, app.resume_variant || null,
           JSON.stringify(app.activity || [])]
        );
        imported++;
      } catch (e) {
        console.error(`  [fail] ${app.company} - ${app.role}: ${e.message}`);
      }
    }
    console.log(`  [done] ${imported}/${apps.length} applications`);
  } else {
    console.log(`  [skip] no applications.json`);
  }

  // Import job board leads
  const leads = loadJSON(path.join(DATA_DIR, 'job_board_leads.json'));
  if (leads && leads.length) {
    console.log(`  Importing ${leads.length} job board leads...`);
    let imported = 0;
    for (const l of leads) {
      try {
        await query(
          `INSERT INTO job_board_leads (id, tenant_id, source, source_label, title, organization, location, url, fit_score, fit_reason, date_found, status, snoozed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (id, tenant_id) DO NOTHING`,
          [l.id, tenantId, l.source, l.source_label || '', l.title,
           l.organization || '', l.location || '', l.url,
           l.fit_score || 0, l.fit_reason || '', l.date_found,
           l.status || 'new', l.snoozed || false]
        );
        imported++;
      } catch (e) {
        console.error(`  [fail] lead ${l.id}: ${e.message}`);
      }
    }
    console.log(`  [done] ${imported}/${leads.length} leads`);
  } else {
    console.log(`  [skip] no job_board_leads.json`);
  }

  // Import networking events
  const events = loadJSON(path.join(DATA_DIR, 'networking.json'));
  if (events && events.length) {
    console.log(`  Importing ${events.length} networking events...`);
    let imported = 0;
    for (const e of events) {
      try {
        await query(
          `INSERT INTO networking_events (id, tenant_id, user_id, source, external_id, calendar_id, calendar_name, title, start_date, start_time, end_time, location, type, attendees, notes, contacts, next_steps, hidden, follow_up_sent)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16::jsonb, $17::jsonb, $18, $19)
           ON CONFLICT (id) DO NOTHING`,
          [e.id, tenantId, userId, e.source || 'manual', e.external_id || null,
           e.calendar_id || null, e.calendar_name || null,
           e.title, e.start_date, e.start_time || '', e.end_time || '',
           e.location || '', e.type || 'other',
           JSON.stringify(e.attendees || []), e.notes || '',
           JSON.stringify(e.contacts || []), JSON.stringify(e.next_steps || []),
           e.hidden || false, e.follow_up_sent || false]
        );
        imported++;
      } catch (err) {
        console.error(`  [fail] event ${e.id}: ${err.message}`);
      }
    }
    console.log(`  [done] ${imported}/${events.length} events`);
  } else {
    console.log(`  [skip] no networking.json`);
  }

  console.log('\n=== Import complete ===\n');
  await closePool();
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
