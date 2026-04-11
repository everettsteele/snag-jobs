#!/usr/bin/env node
// Migrate existing JSON data into PostgreSQL for an initial user.
// Usage: DATABASE_URL=postgres://... node src/db/seed-from-json.js
//
// This creates a tenant + user from existing data and imports:
// - seed_firms, seed_ceos, seed_vcs → platform_firms
// - applications.json → applications
// - job_board_leads.json → job_board_leads
// - networking.json → networking_events
// - overrides.json → user_outreach

const fs = require('fs');
const path = require('path');
const { query, withTransaction, closePool } = require('./pool');
const { createTenantWithOwner } = require('./users');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SEEDS_DIR = path.join(__dirname, '..', '..', 'seeds');

function loadJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return null; }
}

async function seedFromJSON() {
  console.log('=== Seeding PostgreSQL from existing JSON data ===\n');

  // Step 1: Create the initial tenant and user
  const email = process.env.SEED_EMAIL || 'everett.steele@gmail.com';
  const password = process.env.SEED_PASSWORD || process.env.AUTH_PASSWORD || 'changeme123';
  const fullName = process.env.SEED_NAME || 'Everett Steele';

  console.log(`Creating tenant + user: ${email}`);
  const { tenant, user } = await createTenantWithOwner({
    tenantName: `${fullName}'s Search`,
    email,
    password,
    fullName,
  });
  console.log(`  Tenant: ${tenant.id}`);
  console.log(`  User:   ${user.id}\n`);

  // Step 2: Import platform firms from seeds
  for (const category of ['firms', 'ceos', 'vcs']) {
    const seedFile = path.join(SEEDS_DIR, `seed_${category}.json`);
    const items = loadJSON(seedFile);
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

  // Step 3: Import overrides → user_outreach
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
          [tenant.id, user.id, parseInt(firmId),
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

  // Step 4: Import applications
  const apps = loadJSON(path.join(DATA_DIR, 'applications.json'));
  if (apps && apps.length) {
    console.log(`  Importing ${apps.length} applications...`);
    for (const app of apps) {
      await query(
        `INSERT INTO applications (id, tenant_id, user_id, company, role, applied_date, status, source_url, notion_url, drive_url, drive_folder_id, follow_up_date, last_activity, notes, cover_letter_text, resume_variant, activity)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [app.id, tenant.id, user.id, app.company, app.role,
         app.applied_date, app.status, app.source_url || '', app.notion_url || '',
         app.drive_url || '', app.drive_folder_id || '',
         app.follow_up_date || null, app.last_activity || app.applied_date,
         app.notes || '', app.cover_letter_text || null, app.resume_variant || null,
         JSON.stringify(app.activity || [])]
      );
    }
    console.log(`  [done] ${apps.length} applications`);
  }

  // Step 5: Import job board leads
  const leads = loadJSON(path.join(DATA_DIR, 'job_board_leads.json'));
  if (leads && leads.length) {
    console.log(`  Importing ${leads.length} job board leads...`);
    for (const l of leads) {
      await query(
        `INSERT INTO job_board_leads (id, tenant_id, source, source_label, title, organization, location, url, fit_score, fit_reason, date_found, status, snoozed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id, tenant_id) DO NOTHING`,
        [l.id, tenant.id, l.source, l.source_label || '', l.title,
         l.organization || '', l.location || '', l.url,
         l.fit_score || 0, l.fit_reason || '', l.date_found,
         l.status || 'new', l.snoozed || false]
      );
    }
    console.log(`  [done] ${leads.length} leads`);
  }

  // Step 6: Import networking events
  const events = loadJSON(path.join(DATA_DIR, 'networking.json'));
  if (events && events.length) {
    console.log(`  Importing ${events.length} networking events...`);
    for (const e of events) {
      await query(
        `INSERT INTO networking_events (id, tenant_id, user_id, source, external_id, calendar_id, calendar_name, title, start_date, start_time, end_time, location, type, attendees, notes, contacts, next_steps, hidden, follow_up_sent)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16::jsonb, $17::jsonb, $18, $19)
         ON CONFLICT (id) DO NOTHING`,
        [e.id, tenant.id, user.id, e.source || 'manual', e.external_id || null,
         e.calendar_id || null, e.calendar_name || null,
         e.title, e.start_date, e.start_time || '', e.end_time || '',
         e.location || '', e.type || 'other',
         JSON.stringify(e.attendees || []), e.notes || '',
         JSON.stringify(e.contacts || []), JSON.stringify(e.next_steps || []),
         e.hidden || false, e.follow_up_sent || false]
      );
    }
    console.log(`  [done] ${events.length} events`);
  }

  // Step 7: Update user profile with Everett's background
  await query(
    `UPDATE user_profiles SET
       phone = $2, email_display = $3, linkedin_url = $4, location = $5,
       background_text = $6, target_roles = $7, target_geography = $8
     WHERE user_id = $1`,
    [user.id, '678.899.3971', 'everett.steele@gmail.com',
     'linkedin.com/in/everettsteeleATL', 'Atlanta, GA',
     'Veteran (US Army, Infantry Recon Platoon Leader, Baghdad). 3 successful exits as founder/CEO. SVP Operations at ChartRequest: scaled from $2M to $16M ARR, 40 to 180+ employees across 4 countries in under 3 years. Built full operating infrastructure: EOS, scorecards, OKRs, cross-functional accountability systems. Chief of Staff to Atlanta City Council/Mayor Andre Dickens. UX/Product Director at UpTogether (1.25M members). Forbes Disruptor in Logistics. ABC 40 Under 40. LEAD Atlanta Fellow. Currently building Meridian, an AI-native venture studio.',
     '{COO,"Chief of Staff","VP Operations","SVP Operations","Director of Operations"}',
     '{Atlanta,Georgia,Remote}']
  );

  console.log('\n=== Seed complete ===');
  console.log(`Login with: ${email} / ${password}`);
  await closePool();
}

if (require.main === module) {
  seedFromJSON().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { seedFromJSON };
