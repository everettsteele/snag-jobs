const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { logAiUsage } = require('../middleware/tier');
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
// Returns detailed diagnostics so the user can see what happened.
// ────────────────────────────────────────────────────────────────
router.post('/run', requireAuth, async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;
  const summary = {
    outreach: {
      pool: { firms: 0, ceos: 0, vcs: 0 },           // eligible ("not contacted" w/ email)
      alreadyDrafted: { firms: 0, ceos: 0, vcs: 0 }, // already in draft status
      allContacted: { firms: 0, ceos: 0, vcs: 0 },   // already contacted (ineligible)
      newlyDrafted: { firms: 0, ceos: 0, vcs: 0 },   // moved to draft this run
      draftedNames: [],                               // names of newly drafted
    },
    emails: {
      generated: 0,
      failed: 0,
      items: [],  // { pillar, name, status: ok/failed, reason }
    },
    crawl: {
      started: false,
      finished: false,
      sourceStats: {},
      newLeads: 0,
      error: null,
    },
    errors: [],
  };

  // ────── Phase 1: Pre-count state of each pillar ──────
  const { getDB, runDailyCron, PILLARS, orgName } = require('./firms');
  try {
    for (const key of PILLARS) {
      const items = await getDB(key);
      items.forEach(item => {
        const status = item.status || 'not contacted';
        const hasEmail = (item.contacts || []).some(c => c.email && c.email.trim());
        if (status === 'draft') summary.outreach.alreadyDrafted[key]++;
        else if (['contacted', 'in conversation', 'bounced', 'passed'].includes(status)) summary.outreach.allContacted[key]++;
        else if (status === 'not contacted' && hasEmail) summary.outreach.pool[key]++;
      });
    }
  } catch (e) {
    summary.errors.push('Pre-count: ' + e.message);
  }

  // ────── Phase 2: Allocate new drafts ──────
  try {
    const cronResult = await runDailyCron();
    summary.outreach.newlyDrafted = cronResult.allocations || {};
    summary.outreach.totalDrafted = cronResult.totalDrafted || 0;
  } catch (e) {
    console.error('[morning-sync] runDailyCron error:', e.message);
    summary.errors.push('Daily cron: ' + e.message);
  }

  // ────── Phase 3: Generate AI email drafts ──────
  try {
    const { generateEmailDraft } = require('../services/anthropic');
    const { query: dbQuery } = require('../db/pool');

    let senderContext = '';
    try {
      const { rows } = await dbQuery(`SELECT background_text FROM user_profiles WHERE user_id = $1`, [userId]);
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

      for (const item of toDraft.slice(0, 10)) {
        const contact = (item.contacts || []).find(c => c.email) || {};
        const company = orgName(key, item);
        const recipientName = contact.name || item.name || company;
        if (!recipientName) {
          summary.emails.items.push({ pillar: key, name: `#${item.id}`, status: 'failed', reason: 'no name' });
          summary.emails.failed++;
          continue;
        }
        summary.outreach.draftedNames.push({ pillar: key, name: recipientName, company });
        try {
          const draft = await generateEmailDraft({
            recipientName, company,
            recipientRole: contact.title || '',
            type: typeMap[key],
            senderContext,
          });
          ov[key][String(item.id)] = { ...(ov[key][String(item.id)] || {}), email_draft: draft };
          summary.emails.generated++;
          summary.emails.items.push({ pillar: key, name: recipientName, status: 'ok' });
          await logAiUsage(tenantId, userId, 'cover_letters', 300, { type: 'morning_sync_draft', key, id: item.id });
        } catch (e) {
          summary.emails.failed++;
          summary.emails.items.push({ pillar: key, name: recipientName, status: 'failed', reason: e.message });
          console.error(`[morning-sync] draft fail for ${key} #${item.id}:`, e.message);
        }
      }
      await store.saveOverrides(ov);
    }
  } catch (e) {
    console.error('[morning-sync] email draft error:', e.message);
    summary.errors.push('Email drafts: ' + e.message);
  }

  // ────── Phase 4: Run job board crawl SYNCHRONOUSLY (bounded) ──────
  try {
    summary.crawl.started = true;
    const { crawlJobBoards } = require('../services/crawler');

    // Bound the crawl to 90s total so the request doesn't hang
    const crawlPromise = crawlJobBoards(tenantId, userId);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Crawl timeout (90s) — continuing in background')), 90000)
    );
    const result = await Promise.race([crawlPromise, timeout]);
    summary.crawl.finished = true;
    summary.crawl.sourceStats = result.sourceStats || {};
    summary.crawl.newLeads = (result.leads || []).length;
  } catch (e) {
    summary.crawl.error = e.message;
    console.error('[morning-sync] crawl error:', e.message);
  }

  res.json({ ok: true, summary });
});

module.exports = router;
