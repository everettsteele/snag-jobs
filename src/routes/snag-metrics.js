const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { query } = require('../db/pool');
const db = require('../db/store');
const { todayET, daysAgoStr } = require('../utils');

const router = Router();

// GET /api/snag-metrics — progress against user's weekly targets
router.get('/', requireAuth, async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;

  // Fetch user targets
  const { rows: profileRows } = await query(
    `SELECT weekly_outreach_target, weekly_apps_target, weekly_events_target, weekly_followups_target
     FROM user_profiles WHERE user_id = $1`,
    [userId]
  );
  const targets = profileRows[0] || {};
  const weeklyOutreachTarget = targets.weekly_outreach_target || 50;
  const weeklyAppsTarget = targets.weekly_apps_target || 10;
  const weeklyEventsTarget = targets.weekly_events_target || 2;
  const weeklyFollowupsTarget = targets.weekly_followups_target || 10;

  // Compute counts for current 7-day window
  const cutoff = daysAgoStr(7);
  const today = todayET();

  // Applications submitted in last 7 days
  const apps = await db.listApplications(tenantId, userId);
  const appsThisWeek = apps.filter(a => {
    const dt = a.applied_date instanceof Date ? a.applied_date.toISOString().split('T')[0] : String(a.applied_date || '').slice(0, 10);
    return dt >= cutoff && ['applied', 'interviewing', 'offer'].includes(a.status);
  }).length;

  // Events in last 7 days
  const events = await db.listEvents(tenantId, userId, { includeHidden: false });
  const eventsThisWeek = events.filter(e => {
    const dt = e.start_date instanceof Date ? e.start_date.toISOString().split('T')[0] : String(e.start_date || '').slice(0, 10);
    return dt >= cutoff && dt <= today;
  }).length;

  // Outreach emails sent in last 7 days (from JSON store)
  let outreachThisWeek = 0;
  let followupsThisWeek = 0;
  try {
    const { getDB, PILLARS } = require('./firms');
    for (const key of PILLARS) {
      const items = await getDB(key);
      items.forEach(item => {
        if (item.last_contacted && item.last_contacted >= cutoff) {
          if (['contacted', 'in conversation'].includes(item.status)) outreachThisWeek++;
        }
      });
    }
  } catch (e) {}

  // Overdue follow-ups (items that need a follow-up today or earlier)
  try {
    const { getDB, PILLARS } = require('./firms');
    for (const key of PILLARS) {
      const items = await getDB(key);
      items.forEach(item => {
        if (item.followup_date && item.followup_date <= today && item.status === 'contacted' && item.is_job_search !== false) {
          followupsThisWeek++;
        }
      });
    }
  } catch (e) {}

  res.json({
    outreach: {
      count: outreachThisWeek,
      target: weeklyOutreachTarget,
      label: 'Emails sent this week',
    },
    applications: {
      count: appsThisWeek,
      target: weeklyAppsTarget,
      label: 'Applications submitted this week',
    },
    events: {
      count: eventsThisWeek,
      target: weeklyEventsTarget,
      label: 'Networking events this week',
    },
    followups: {
      count: followupsThisWeek,
      target: weeklyFollowupsTarget,
      label: 'Follow-ups pending',
      inverted: true, // lower is better
    },
  });
});

module.exports = router;
