const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas, VALID_OUTREACH_STATUSES } = require('../middleware/validate');
const { cronLimiter } = require('../middleware/security');
const store = require('../data/store');
const { todayET, daysAgoStr, daysBetween, diagLog } = require('../utils');
const { randomUUID } = require('crypto');

const router = Router();

// ================================================================
// Constants
// ================================================================

const SENT_STATUSES = new Set(['contacted', 'in conversation', 'bounced', 'passed', 'linkedin']);
const PILLARS = ['firms', 'ceos', 'vcs'];
const EXTENDED_FIELDS = ['status', 'notes', 'followup_date', 'is_job_search', 'gmail_thread_id', 'cadence_day', 'last_contacted'];
const DAILY_TARGET = 15;
const SLA_TARGET = 10;

// ================================================================
// Helpers
// ================================================================

async function getDB(key) {
  const seed = store.readSeedSync(key);
  const ov = (await store.loadOverrides())[key] || {};
  return seed.map(item => {
    const o = ov[String(item.id)];
    if (!o) return item;
    if (o.status === 'draft' && SENT_STATUSES.has(item.status)) return { ...item, ...o, status: item.status };
    return { ...item, ...o };
  });
}

function orgName(track, item) {
  if (track === 'ceos') return item.company || item.name || '';
  if (track === 'vcs') return item.firm || item.name || '';
  return item.name || '';
}

// ================================================================
// Cron
// ================================================================

async function runDailyCron() {
  let currentDrafts = 0;
  for (const key of PILLARS) {
    const db = await getDB(key);
    currentDrafts += db.filter(x => x.status === 'draft').length;
  }
  if (currentDrafts >= DAILY_TARGET) return { totalDrafted: 0, allocations: {}, skipped: true };

  const ov = await store.loadOverrides();
  const perPillar = Math.ceil(DAILY_TARGET / PILLARS.length);
  const pools = {};
  PILLARS.forEach(key => {
    const seed = store.readSeedSync(key);
    const existing = ov[key] || {};
    pools[key] = seed.filter(item => {
      const status = (existing[String(item.id)] || {}).status || item.status || 'not contacted';
      return status === 'not contacted' && (item.contacts || []).some(c => c.email && c.email.trim());
    }).sort((a, b) => (a.tier || 99) - (b.tier || 99));
  });

  let allocations = {}, surplus = 0;
  PILLARS.forEach(key => {
    const t = Math.min(perPillar, pools[key].length);
    allocations[key] = t;
    surplus += perPillar - t;
  });
  if (surplus > 0) {
    PILLARS.forEach(key => {
      if (surplus <= 0) return;
      const extra = Math.min(surplus, pools[key].length - allocations[key]);
      if (extra > 0) { allocations[key] += extra; surplus -= extra; }
    });
  }

  let totalDrafted = 0;
  PILLARS.forEach(key => {
    if (!ov[key]) ov[key] = {};
    pools[key].slice(0, allocations[key]).forEach(item => {
      ov[key][String(item.id)] = { ...(ov[key][String(item.id)] || {}), status: 'draft' };
      totalDrafted++;
    });
  });

  await store.saveOverrides(ov);
  await store.saveCronState({ lastRunDate: todayET(), totalDrafted, allocations });
  return { totalDrafted, allocations };
}

// ================================================================
// Patch factory
// ================================================================

function makePatch(key) {
  return async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const item = store.readSeedSync(key).find(x => x.id === id);
      if (!item) return res.status(404).json({ error: 'Not found' });

      const ov = await store.loadOverrides();
      if (!ov[key]) ov[key] = {};
      const upd = { ...(ov[key][String(id)] || {}) };

      EXTENDED_FIELDS.forEach(k => {
        if (req.body[k] !== undefined) upd[k] = req.body[k];
      });

      if (req.body.status && !['not contacted', 'draft'].includes(req.body.status) && !req.body.last_contacted) {
        upd.last_contacted = todayET();
      }

      ov[key][String(id)] = upd;
      await store.saveOverrides(ov);
      res.json({ ...item, ...upd });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };
}

// ================================================================
// Routes
// ================================================================

router.get('/firms', requireAuth, async (req, res) => {
  res.json(await getDB('firms'));
});

router.get('/ceos', requireAuth, async (req, res) => {
  res.json(await getDB('ceos'));
});

router.get('/vcs', requireAuth, async (req, res) => {
  res.json(await getDB('vcs'));
});

router.get('/due', requireAuth, async (req, res) => {
  const today = todayET();
  const due = [];

  for (const track of PILLARS) {
    const db = await getDB(track);
    db.forEach(item => {
      if (item.status !== 'contacted') return;
      if (!item.followup_date || item.followup_date > today) return;
      if (item.is_job_search === false || item.is_job_search === 'false') return;
      const c = (item.contacts || []).filter(c => c.email)[0] || {};
      due.push({
        track,
        org_id: item.id,
        org_name: orgName(track, item),
        contact_name: c.name || '',
        contact_email: c.email || '',
        followup_date: item.followup_date,
        last_contacted: item.last_contacted || null,
        days_since_contact: item.last_contacted ? daysBetween(item.last_contacted) : null,
        gmail_thread_id: item.gmail_thread_id || null,
        cadence_day: item.cadence_day || 1,
        notes: item.notes || '',
        status: item.status,
      });
    });
  }

  const dynamic = await store.loadDynamic();
  dynamic.forEach(item => {
    if (item.status !== 'contacted') return;
    if (!item.followup_date || item.followup_date > today) return;
    if (item.is_job_search === false || item.is_job_search === 'false') return;
    due.push({
      track: item.track || 'ceos',
      org_id: item.id,
      org_name: item.org_name || '',
      contact_name: item.contact_name || '',
      contact_email: item.contact_email || '',
      followup_date: item.followup_date,
      last_contacted: item.last_contacted || null,
      days_since_contact: item.last_contacted ? daysBetween(item.last_contacted) : null,
      gmail_thread_id: item.gmail_thread_id || null,
      cadence_day: item.cadence_day || 1,
      notes: item.notes || '',
      status: item.status,
      dynamic: true,
    });
  });

  due.sort((a, b) => (a.followup_date || '').localeCompare(b.followup_date || ''));
  res.json(due);
});

router.get('/contacts', requireAuth, async (req, res) => {
  const c = await store.loadDynamic();
  const { track } = req.query;
  res.json(track ? c.filter(x => x.track === track) : c);
});

router.post('/contacts/import', requireAuth, async (req, res) => {
  const entries = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Expected array' });
  const contacts = await store.loadDynamic();
  let inserted = 0, updated = 0;
  entries.forEach(entry => {
    if (!entry.contact_email) return;
    const idx = contacts.findIndex(c => c.contact_email && c.contact_email.toLowerCase() === entry.contact_email.toLowerCase());
    if (idx >= 0) {
      contacts[idx] = { ...contacts[idx], ...entry, id: contacts[idx].id };
      updated++;
    } else {
      contacts.push({ id: randomUUID(), ...entry });
      inserted++;
    }
  });
  await store.saveDynamic(contacts);
  res.json({ ok: true, inserted, updated, total: contacts.length });
});

router.patch('/contacts/:id', requireAuth, async (req, res) => {
  const contacts = await store.loadDynamic();
  const idx = contacts.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  contacts[idx] = { ...contacts[idx], ...req.body, id: contacts[idx].id };
  await store.saveDynamic(contacts);
  res.json(contacts[idx]);
});

router.patch('/firms/:id', requireAuth, validate(schemas.outreachPatch), makePatch('firms'));
router.patch('/ceos/:id', requireAuth, validate(schemas.outreachPatch), makePatch('ceos'));
router.patch('/vcs/:id', requireAuth, validate(schemas.outreachPatch), makePatch('vcs'));

router.post('/reseed', requireAuth, async (req, res) => {
  await store.saveOverrides({ firms: {}, ceos: {}, vcs: {} });
  res.json({ ok: true });
});

router.post('/sync', requireAuth, async (req, res) => {
  const updates = req.body.updates || [];
  if (!updates.length) return res.json({ ok: true, changed: 0 });
  let changed = 0;
  const ov = await store.loadOverrides();

  PILLARS.forEach(key => {
    store.readSeedSync(key).forEach(item => {
      (item.contacts || []).forEach(c => {
        const match = updates.find(u => u.email && c.email && u.email.toLowerCase() === c.email.toLowerCase());
        if (!match) return;
        if (!ov[key]) ov[key] = {};
        const upd = { ...(ov[key][String(item.id)] || {}) };
        if (match.status) upd.status = match.status;
        if (match.note) {
          const ts = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          upd.notes = upd.notes ? upd.notes + '\n[' + ts + '] ' + match.note : '[' + ts + '] ' + match.note;
        }
        ['gmail_thread_id', 'followup_date', 'cadence_day', 'is_job_search'].forEach(f => {
          if (match[f] !== undefined) upd[f] = match[f];
        });
        upd.last_contacted = match.last_contacted || todayET();
        ov[key][String(item.id)] = upd;
        changed++;
      });
    });
  });

  const dynamic = await store.loadDynamic();
  let dc = false;
  dynamic.forEach((item, idx) => {
    const match = updates.find(u => u.email && item.contact_email && u.email.toLowerCase() === item.contact_email.toLowerCase());
    if (!match) return;
    if (match.status) dynamic[idx].status = match.status;
    if (match.note) {
      const ts = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dynamic[idx].notes = dynamic[idx].notes ? dynamic[idx].notes + '\n[' + ts + '] ' + match.note : '[' + ts + '] ' + match.note;
    }
    ['gmail_thread_id', 'followup_date', 'cadence_day', 'is_job_search'].forEach(f => {
      if (match[f] !== undefined) dynamic[idx][f] = match[f];
    });
    dynamic[idx].last_contacted = match.last_contacted || todayET();
    changed++;
    dc = true;
  });

  if (dc) await store.saveDynamic(dynamic);
  await store.saveOverrides(ov);
  res.json({ ok: true, changed });
});

router.post('/gmail-sync', requireAuth, async (req, res) => {
  const emails = req.body.emails || [];
  if (!emails.length) return res.json({ ok: true, changed: 0 });
  const updates = emails.map(({ email, sent_date }) => {
    const base = sent_date || todayET();
    const d = new Date(base + 'T12:00:00Z');
    d.setDate(d.getDate() + 7);
    return { email: email.toLowerCase().trim(), status: 'contacted', last_contacted: base, followup_date: d.toISOString().split('T')[0] };
  });
  let changed = 0;
  const ov = await store.loadOverrides();
  PILLARS.forEach(key => {
    store.readSeedSync(key).forEach(item => {
      (item.contacts || []).forEach(c => {
        const match = updates.find(u => u.email === (c.email || '').toLowerCase().trim());
        if (!match) return;
        if (!ov[key]) ov[key] = {};
        const upd = { ...(ov[key][String(item.id)] || {}) };
        upd.status = match.status;
        upd.last_contacted = match.last_contacted;
        upd.followup_date = match.followup_date;
        ov[key][String(item.id)] = upd;
        changed++;
      });
    });
  });
  await store.saveOverrides(ov);
  res.json({ ok: true, changed });
});

router.post('/mark-drafts-sent', requireAuth, async (req, res) => {
  const today = todayET();
  const fd = new Date(today + 'T12:00:00Z');
  fd.setDate(fd.getDate() + 7);
  const followupDate = fd.toISOString().split('T')[0];
  let marked = 0;
  const ov = await store.loadOverrides();

  for (const key of PILLARS) {
    if (!ov[key]) ov[key] = {};
    const db = await getDB(key);
    db.forEach(item => {
      if (item.status !== 'draft') return;
      ov[key][String(item.id)] = {
        ...(ov[key][String(item.id)] || {}),
        status: 'contacted',
        last_contacted: today,
        followup_date: followupDate,
      };
      marked++;
    });
  }

  await store.saveOverrides(ov);
  res.json({ ok: true, marked });
});

const SECTOR_EXCLUDE_FROM_TABLE = new Set(['network']);
const SECTOR_MAP = {
  healthtech: 'Healthtech',
  revenue_gtm: 'Revenue/GTM',
  analytics: 'Analytics',
  fintech: 'FinTech',
  vertical_saas: 'Vertical SaaS',
  general: 'General SaaS',
  network: 'Network',
};

router.get('/stats', requireAuth, async (req, res) => {
  const firms = await getDB('firms');
  const ceos = await getDB('ceos');
  const vcs = await getDB('vcs');

  function seg(arr, label) {
    return {
      label,
      total: arr.length,
      contacted: arr.filter(x => ['contacted', 'in conversation'].includes(x.status)).length,
      drafts: arr.filter(x => x.status === 'draft').length,
      conv: arr.filter(x => x.status === 'in conversation').length,
      bounced: arr.filter(x => x.status === 'bounced' || (x.contacts || []).some(c => c.status === 'bounced')).length,
      responseRate: 0,
    };
  }

  const allItems = [
    ...firms.map(x => ({ ...x, _key: 'firms' })),
    ...ceos.map(x => ({ ...x, _key: 'ceos' })),
    ...vcs.map(x => ({ ...x, _key: 'vcs' })),
  ];

  const segs = [seg(firms, 'Recruiters'), seg(ceos, 'Direct CEO'), seg(vcs, 'VC Firms')];
  segs.forEach(s => {
    s.responseRate = s.contacted > 0 ? Math.round((s.conv / s.contacted) * 100) : 0;
  });

  // Daily activity
  const byDate = {};
  allItems.forEach(item => {
    if (!item.last_contacted) return;
    const d = item.last_contacted;
    if (!byDate[d]) byDate[d] = { recruiters: 0, ceos: 0, vcs: 0, total: 0 };
    if (['contacted', 'in conversation'].includes(item.status)) {
      if (item._key === 'firms') byDate[d].recruiters++;
      if (item._key === 'ceos') byDate[d].ceos++;
      if (item._key === 'vcs') byDate[d].vcs++;
      byDate[d].total++;
    }
  });

  // Sector stats (CEOs only)
  const sBuckets = {};
  ceos.forEach(item => {
    const s = item.sector || 'general';
    if (!sBuckets[s]) sBuckets[s] = [];
    sBuckets[s].push(item);
  });
  const sectorStats = Object.entries(sBuckets)
    .filter(([s]) => !SECTOR_EXCLUDE_FROM_TABLE.has(s))
    .map(([sector, items]) => {
      const sent = items.filter(x => ['contacted', 'in conversation', 'bounced'].includes(x.status)).length;
      const replies = items.filter(x => x.status === 'in conversation').length;
      const bounced = items.filter(x => x.status === 'bounced' || (x.contacts || []).some(c => c.status === 'bounced')).length;
      return { sector, label: SECTOR_MAP[sector] || sector, sent, replies, bounced, replyRate: sent > 0 ? Math.round((replies / sent) * 100) : 0 };
    })
    .sort((a, b) => b.sent - a.sent);

  // Template A/B stats
  const tBuckets = {};
  ceos.forEach(item => {
    const v = item.template_version || 'v1';
    if (!tBuckets[v]) tBuckets[v] = [];
    tBuckets[v].push(item);
  });
  const templateStats = Object.entries(tBuckets)
    .map(([version, items]) => {
      const sent = items.filter(x => ['contacted', 'in conversation', 'bounced'].includes(x.status)).length;
      const replies = items.filter(x => x.status === 'in conversation').length;
      const bounced = items.filter(x => x.status === 'bounced' || (x.contacts || []).some(c => c.status === 'bounced')).length;
      return { version, sent, replies, bounced, replyRate: sent > 0 ? Math.round((replies / sent) * 100) : 0 };
    })
    .sort((a, b) => a.version.localeCompare(b.version));

  // SLA compliance (7-day rolling avg)
  const todayStr = todayET();
  const cutoffDate = new Date(todayStr + 'T12:00:00-05:00');
  cutoffDate.setDate(cutoffDate.getDate() - 6);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];
  let totalRecent = 0;
  Object.entries(byDate).forEach(([d, v]) => {
    if (d >= cutoffStr) totalRecent += v.total;
  });
  const dailyAvg7 = Math.round(totalRecent / 7);

  res.json({
    segments: segs,
    daily: Object.entries(byDate).sort(([a], [b]) => (a > b ? 1 : -1)).map(([date, counts]) => ({ date, ...counts })),
    totals: {
      contacted: allItems.filter(x => ['contacted', 'in conversation'].includes(x.status)).length,
      inConversation: allItems.filter(x => x.status === 'in conversation').length,
      drafts: allItems.filter(x => x.status === 'draft').length,
      bounced: allItems.filter(x => x.status === 'bounced').length,
      total: allItems.length,
    },
    sectorStats,
    templateStats,
    slaStats: { target: SLA_TARGET, dailyAvg7, onTrack: dailyAvg7 >= SLA_TARGET },
  });
});

router.post('/cron/run', requireAuth, cronLimiter, async (req, res) => {
  res.json({ ok: true, ...(await runDailyCron()) });
});

// ================================================================
// Email draft generation for outreach contacts
// ================================================================
router.post('/draft-email', requireAuth, async (req, res) => {
  const { recipientName, company, recipientRole, type } = req.body;
  if (!recipientName || !company) return res.status(400).json({ error: 'recipientName and company required' });

  try {
    const { generateEmailDraft } = require('../services/anthropic');
    const { query: dbQuery } = require('../db/pool');

    // Get user's background for sender context
    let senderContext = '';
    try {
      const { rows } = await dbQuery(
        `SELECT background_text FROM user_profiles WHERE user_id = $1`,
        [req.user.id]
      );
      senderContext = rows[0]?.background_text || '';
    } catch (e) {}

    // If no background, try to get parsed resume text
    if (!senderContext) {
      try {
        const { rows } = await dbQuery(
          `SELECT parsed_text FROM resume_variants WHERE user_id = $1 AND is_default = true LIMIT 1`,
          [req.user.id]
        );
        senderContext = rows[0]?.parsed_text || '';
      } catch (e) {}
    }

    const draft = await generateEmailDraft({
      recipientName,
      company,
      recipientRole: recipientRole || '',
      type: type || 'recruiter',
      senderContext,
    });

    res.json({ draft });
  } catch (e) {
    console.error('[draft-email]', e.message);
    if (e.message.includes('ANTHROPIC_API_KEY')) return res.status(503).json({ error: 'AI not configured' });
    res.status(500).json({ error: 'Failed to generate email draft' });
  }
});

module.exports = router;
module.exports.getDB = getDB;
module.exports.orgName = orgName;
module.exports.PILLARS = PILLARS;
module.exports.SENT_STATUSES = SENT_STATUSES;
module.exports.runDailyCron = runDailyCron;
