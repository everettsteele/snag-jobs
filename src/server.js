const express = require('express');
const path = require('path');
const { createHash } = require('crypto');
const fs = require('fs');

const { helmetMiddleware, corsMiddleware, globalLimiter } = require('./middleware/security');
const store = require('./data/store');
const { todayET, diagLog } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;

// Global middleware
app.use(helmetMiddleware);
app.use(express.json({ limit: '1mb' }));
app.use('/api', corsMiddleware);
app.use('/api', globalLimiter);

// Pre-auth logging for job-board debugging
const { sessions, PASSWORD, API_KEY } = require('./middleware/auth');
app.use('/api/job-board', (req, res, next) => {
  const authToken = req.headers['x-auth-token'] || '';
  const apiKey = req.headers['x-api-key'] || '';
  diagLog('PRE-AUTH ' + req.method + ' ' + req.originalUrl + ' auth_token=' + (authToken ? authToken.slice(0, 8) + '...' : 'EMPTY') + ' api_key=' + (apiKey ? apiKey.slice(0, 8) + '...' : 'EMPTY') + ' session_valid=' + sessions.has(authToken) + ' apikey_valid=' + (API_KEY && apiKey === API_KEY) + ' PASSWORD_SET=' + !!PASSWORD + ' sessions_count=' + sessions.size);
  next();
});

// Routes
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/firms'));
app.use('/api', require('./routes/applications'));
app.use('/api', require('./routes/jobboard'));
app.use('/api/networking', require('./routes/networking'));
app.use('/api', require('./routes/diagnostics'));
app.use('/api/sse', require('./routes/sse'));
app.use('/api/export', require('./routes/export'));

// Morning sync endpoint — aggregates data from multiple domains
const { requireAuth } = require('./middleware/auth');
const { getDB, PILLARS } = require('./routes/firms');
const { daysAgoStr } = require('./utils');

app.get('/api/morning-sync/status', requireAuth, async (req, res) => {
  const today = todayET();
  const apps = await store.loadApplications();
  const needsPackage = apps.filter(a => a.status === 'queued' && !a.drive_url).map(a => ({ id: a.id, company: a.company, role: a.role, source_url: a.source_url, notion_url: a.notion_url, notes: a.notes }));
  const appFollowUps = apps.filter(a => a.follow_up_date && a.follow_up_date <= today && !['rejected', 'withdrawn', 'offer'].includes(a.status)).map(a => ({ id: a.id, company: a.company, role: a.role, status: a.status, follow_up_date: a.follow_up_date }));
  const leads = await store.loadJobBoardLeads();
  const newLeads = leads.filter(l => l.status === 'new');
  const events = await store.loadNetworking();
  const cutoff14 = daysAgoStr(14);
  const overdueNextSteps = events.filter(e => !e.hidden).flatMap(e => (e.next_steps || []).filter(ns => !ns.done && ns.due_date && ns.due_date <= today).map(ns => ({ eventId: e.id, eventTitle: e.title, step: ns.text, due: ns.due_date })));
  const eventsNoNotes = events.filter(e => !e.hidden && e.start_date >= cutoff14 && e.start_date <= today && !(e.notes || '').trim()).map(e => ({ id: e.id, title: e.title, start_date: e.start_date }));
  const allItems = (await Promise.all(PILLARS.map(k => getDB(k)))).flat();
  const draftsQueued = allItems.filter(x => x.status === 'draft').length;
  let dueCount = 0;
  for (const track of PILLARS) {
    const items = await getDB(track);
    items.forEach(item => { if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) dueCount++; });
  }
  const dynamic = await store.loadDynamic();
  dynamic.forEach(item => { if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) dueCount++; });
  const calConfig = await store.loadCalConfig();
  res.json({ today, needsPackage, appFollowUps, newJobLeads: newLeads.length, topLeads: newLeads.slice(0, 3).map(l => ({ id: l.id, title: l.title, organization: l.organization, fit_score: l.fit_score, source_label: l.source_label, url: l.url })), networking: { overdueNextSteps: overdueNextSteps.length, overdueItems: overdueNextSteps.slice(0, 5), eventsNoNotes }, outreach: { draftsQueued, dueFollowUps: dueCount }, calendarConfig: { setup_complete: calConfig.setup_complete, whitelisted_count: calConfig.whitelisted_calendar_ids.length, whitelisted_names: calConfig.whitelisted_calendar_names }, cronState: await store.loadCronState() });
});

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback — serve index.html for non-API, non-file routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Startup
const { runDailyCron } = require('./routes/firms');
const { crawlJobBoards } = require('./services/crawler');

function bootCheck() {
  store.loadCronState().then(state => {
    const today = todayET();
    if (state.lastRunDate === today) return;
    runDailyCron();
  });
}

function bootSeedApplications() {
  store.loadApplications().then(existing => {
    if (existing.length > 0) return;
    const today = todayET(), fd = new Date(today + 'T12:00:00Z');
    fd.setDate(fd.getDate() + 7);
    const followup = fd.toISOString().split('T')[0];
    const mkApp = (id, company, role, src, notion, notes) => ({ id, company, role, applied_date: today, status: 'queued', source_url: src, notion_url: notion, drive_url: '', follow_up_date: followup, last_activity: today, notes: notes || '', activity: [{ date: today, type: 'queued', note: 'Snagged' }] });
    store.saveApplications([
      mkApp('app-001', 'Machinify', 'Chief of Staff to the CTO', 'https://job-boards.greenhouse.io/machinifyinc/jobs/4173382009', 'https://www.notion.so/33c4cf9804bf813a9b05c2eb5115d096', ''),
      mkApp('app-002', 'BluZinc', 'Chief of Staff Strategic Operations Director', 'https://www.chiefofstaff.network/jobs/chief-of-staff-bluzinc-xs4', 'https://www.notion.so/33c4cf9804bf810e83a8d7fb56da60af', '$170K-$250K'),
      mkApp('app-003', 'Array', 'Chief of Staff', 'https://www.linkedin.com/jobs/view/4398405485', 'https://www.notion.so/33c4cf9804bf81f58c33e0b5b58614e1', 'General Catalyst-backed'),
      mkApp('app-004', 'Total AI Systems Inc.', 'Chief of Staff', 'https://www.linkedin.com/jobs/view/4384353199', 'https://www.notion.so/33c4cf9804bf8139be1af2fe89e500ff', ''),
      mkApp('app-005', 'GameChanger', 'Director, Strategic Operations', 'https://www.linkedin.com/jobs/view/4398949728', 'https://www.notion.so/33c4cf9804bf8121b1cfff300487e089', ''),
      mkApp('app-006', 'DSD Recruitment', 'Chief Operating Officer', 'https://www.linkedin.com/jobs/view/4394752593', 'https://www.notion.so/33c4cf9804bf8170b8e3f381e354b553', 'Blind agency'),
      mkApp('app-007', '24 Seven Talent', 'Chief Operating Officer', 'https://www.linkedin.com/jobs/view/4395463335', 'https://www.notion.so/33c4cf9804bf8189a2cefb99c8a5a6db', 'Blind agency'),
      mkApp('app-008', 'TalentRemedy', 'Vice President Operations', 'https://www.linkedin.com/jobs/view/4395463335', 'https://www.notion.so/33c4cf9804bf81c4b0baf20c279a0a07', 'Blind agency'),
      mkApp('app-009', 'The Humane League', 'Vice President Operations', 'https://www.linkedin.com/jobs/view/4398598541', 'https://www.notion.so/33c4cf9804bf81d6a047ff71e6d5d68e', 'Nonprofit'),
      mkApp('app-010', 'Operation Homefront', 'Chief Impact Officer', 'https://www.linkedin.com/jobs/view/4372722978', 'https://www.notion.so/33c4cf9804bf81fa9956df7f74825583', 'Nonprofit; veteran angle'),
    ]);
  });
}

function migrateLeadIds() {
  store.loadJobBoardLeads().then(leads => {
    if (!leads.length) return;
    const seen = new Set();
    let dupes = 0;
    leads.forEach(l => { if (seen.has(l.id)) dupes++; seen.add(l.id); });
    if (dupes === 0) return;
    console.log('[MIGRATE] Found ' + dupes + ' duplicate IDs. Regenerating.');
    leads.forEach(l => {
      if (l.url) {
        const src = (l.source || '').slice(0, 2) || 'xx';
        l.id = src + '-' + createHash('sha256').update(l.url).digest('hex').slice(0, 16);
      }
    });
    store.saveJobBoardLeads(leads);
  });
}

// 6 AM ET cron
setInterval(() => {
  try {
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    store.loadCronState().then(state => {
      if (et.getHours() === 6 && et.getMinutes() < 5 && state.lastRunDate !== todayET()) {
        runDailyCron();
        crawlJobBoards().catch(e => console.error('[crawl cron]', e.message));
      }
    });
  } catch (e) {}
}, 5 * 60 * 1000);

setTimeout(bootCheck, 3000);
setTimeout(bootSeedApplications, 4000);
setTimeout(migrateLeadIds, 2000);

const seedCounts = `${store.readSeedSync('firms').length}f/${store.readSeedSync('ceos').length}c/${store.readSeedSync('vcs').length}v`;
console.log(`Snag v9.0 — seeds:${seedCounts}`);

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
