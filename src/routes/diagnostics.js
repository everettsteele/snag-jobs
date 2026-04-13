const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const store = require('../data/store');
const { todayET, getDiagLogs } = require('../utils');

const router = Router();

router.get('/debug', requireAuth, async (req, res) => {
  const today = todayET();
  const apps = await store.loadApplications();
  const jb = await store.loadJobBoardLeads();
  const net = await store.loadNetworking();
  const calCfg = await store.loadCalConfig();
  const overdueSteps = net.filter(e => !e.hidden).reduce((n, e) => n + (e.next_steps || []).filter(ns => !ns.done && ns.due_date && ns.due_date <= today).length, 0);
  res.json({
    version: '9.0',
    applicationCount: apps.length,
    applicationsByStatus: apps.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {}),
    applicationsWithCoverLetter: apps.filter(a => a.cover_letter_text).length,
    jobBoardLeads: jb.length,
    jobBoardNew: jb.filter(l => l.status === 'new').length,
    jobBoardReviewed: jb.filter(l => l.status === 'reviewed').length,
    jobBoardSnagged: jb.filter(l => l.status === 'snagged').length,
    driveConfigured: !!process.env.DRIVE_WEBHOOK_URL,
    anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
    overdueSteps,
    cronState: await store.loadCronState(),
    todayET: today,
  });
});

router.get('/diag/logs', requireAuth, (req, res) => {
  const logs = getDiagLogs();
  res.json({ count: logs.length, logs });
});

router.get('/diag/job-board-search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const leads = await store.loadJobBoardLeads();
  const matches = leads.filter(l => (l.title || '').toLowerCase().includes(q) || (l.organization || '').toLowerCase().includes(q));
  res.json({ query: q, matches: matches.map(l => ({ id: l.id, title: l.title, organization: l.organization, status: l.status, source: l.source, url: l.url })) });
});

router.get('/health', (req, res) => res.json({ ok: true, version: '3.0', todayET: todayET() }));

module.exports = router;
