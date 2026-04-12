const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { checkAiLimit, logAiUsage } = require('../middleware/tier');
const db = require('../db/store');
const store = require('../data/store');
const { todayET, daysAgoStr } = require('../utils');

const router = Router();

// ────────────────────────────────────────────────────────────────
// GET /api/morning-sync/status — aggregate today's priorities
// ────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  const today = todayET();
  const tenantId = req.user.tenantId;
  const userId = req.user.id;

  const apps = await db.listApplications(tenantId, userId);
  const needsPackage = apps
    .filter(a => a.status === 'queued' && !a.drive_url)
    .map(a => ({ id: a.id, company: a.company, role: a.role, source_url: a.source_url, notes: a.notes }));
  const appFollowUps = apps
    .filter(a => a.follow_up_date && a.follow_up_date <= today && !['rejected', 'withdrawn', 'offer', 'closed'].includes(a.status))
    .map(a => ({ id: a.id, company: a.company, role: a.role, status: a.status, follow_up_date: a.follow_up_date }));
  const appsByStatus = apps.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});

  const leads = await db.listJobBoardLeads(tenantId, 'new');
  const topLeads = leads.slice(0, 3).map(l => ({
    id: l.id, title: l.title, organization: l.organization,
    fit_score: l.fit_score, source_label: l.source_label, url: l.url,
  }));

  const events = await db.listEvents(tenantId, userId, { includeHidden: false });
  const cutoff14 = daysAgoStr(14);
  const overdueNextSteps = events
    .flatMap(e => (e.next_steps || [])
      .filter(ns => !ns.done && ns.due_date && ns.due_date <= today)
      .map(ns => ({ eventId: e.id, eventTitle: e.title, step: ns.text, due: ns.due_date })));
  const eventsNoNotes = events
    .filter(e => e.start_date >= cutoff14 && e.start_date <= today && !(e.notes || '').trim())
    .map(e => ({ id: e.id, title: e.title, start_date: e.start_date }));

  let draftsQueued = 0, dueCount = 0;
  try {
    const { getDB, PILLARS } = require('./firms');
    for (const key of PILLARS) {
      const items = await getDB(key);
      items.forEach(item => {
        if (item.status === 'draft') draftsQueued++;
        if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) dueCount++;
      });
    }
  } catch (e) {}

  res.json({
    today,
    applications: {
      byStatus: appsByStatus,
      needsPackage: needsPackage.length,
      needsPackageItems: needsPackage.slice(0, 5),
      followUpsDue: appFollowUps.length,
      followUpItems: appFollowUps.slice(0, 5),
    },
    jobBoard: { newLeads: leads.length, topLeads },
    networking: {
      overdueSteps: overdueNextSteps.length,
      overdueItems: overdueNextSteps.slice(0, 5),
      eventsNoNotes: eventsNoNotes.length,
      eventsNoNotesItems: eventsNoNotes.slice(0, 5),
    },
    outreach: { draftsQueued, dueFollowUps: dueCount },
  });
});

// ────────────────────────────────────────────────────────────────
// POST /api/morning-sync/run — actually do the work
// ────────────────────────────────────────────────────────────────
router.post('/run', requireAuth, async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;
  const today = todayET();
  const summary = {
    drafted: { firms: 0, ceos: 0, vcs: 0 },
    emailsGenerated: 0,
    emailsFailed: 0,
    crawlStarted: false,
    errors: [],
  };

  try {
    // 1. Run daily cron to allocate new drafts
    const { runDailyCron, PILLARS, getDB, orgName } = require('./firms');
    const cronResult = await runDailyCron();
    summary.drafted = cronResult.allocations || {};
    summary.totalDrafted = cronResult.totalDrafted || 0;
  } catch (e) {
    console.error('[morning-sync] runDailyCron error:', e.message);
    summary.errors.push('Daily cron: ' + e.message);
  }

  // 2. Generate AI email drafts for each drafted item that doesn't have one yet
  try {
    const { generateEmailDraft } = require('../services/anthropic');
    const { getDB, PILLARS, orgName } = require('./firms');

    // Get sender context (profile background or default resume)
    const { query: dbQuery } = require('../db/pool');
    let senderContext = '';
    try {
      const { rows } = await dbQuery(
        `SELECT background_text FROM user_profiles WHERE user_id = $1`,
        [userId]
      );
      senderContext = rows[0]?.background_text || '';
    } catch (e) {}
    if (!senderContext) {
      try {
        const { rows } = await dbQuery(
          `SELECT parsed_text FROM resume_variants WHERE user_id = $1 AND is_default = true LIMIT 1`,
          [userId]
        );
        senderContext = rows[0]?.parsed_text || '';
      } catch (e) {}
    }

    const typeMap = { firms: 'recruiter', ceos: 'ceo', vcs: 'vc' };

    for (const key of PILLARS) {
      const items = await getDB(key);
      const toDraft = items.filter(i => i.status === 'draft' && !i.email_draft);
      const ov = await store.loadOverrides();
      if (!ov[key]) ov[key] = {};

      for (const item of toDraft.slice(0, 10)) { // cap at 10 per pillar per run
        const contact = (item.contacts || []).find(c => c.email) || {};
        if (!contact.name && !item.name) continue;
        const company = orgName(key, item);
        const recipientName = contact.name || item.name || company;
        try {
          const draft = await generateEmailDraft({
            recipientName,
            company,
            recipientRole: contact.title || '',
            type: typeMap[key],
            senderContext,
          });
          ov[key][String(item.id)] = {
            ...(ov[key][String(item.id)] || {}),
            email_draft: draft,
          };
          summary.emailsGenerated++;
          await logAiUsage(tenantId, userId, 'cover_letters', 300, { type: 'morning_sync_draft', key, id: item.id });
        } catch (e) {
          summary.emailsFailed++;
          console.error(`[morning-sync] draft fail for ${key} #${item.id}:`, e.message);
        }
      }
      await store.saveOverrides(ov);
    }
  } catch (e) {
    console.error('[morning-sync] email draft error:', e.message);
    summary.errors.push('Email drafts: ' + e.message);
  }

  // 3. Kick off job board crawl in background (non-blocking)
  try {
    const { crawlJobBoards } = require('../services/crawler');
    crawlJobBoards(tenantId, userId)
      .then(r => console.log(`[morning-sync] crawl done: ${r.leads.length} new leads`))
      .catch(e => console.error('[morning-sync] crawl error:', e.message));
    summary.crawlStarted = true;
  } catch (e) {
    summary.errors.push('Crawler: ' + e.message);
  }

  res.json({ ok: true, summary });
});

module.exports = router;
