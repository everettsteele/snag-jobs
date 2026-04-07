const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.AUTH_PASSWORD || '';
const API_KEY = process.env.API_KEY || '';

const SEEDS_DIR = path.join(__dirname, 'seeds');
const DATA_DIR  = path.join(__dirname, 'data');
const OVERRIDES_PATH = path.join(DATA_DIR, 'overrides.json');
const CRON_STATE_PATH = path.join(DATA_DIR, 'cron_state.json');
const DYNAMIC_CONTACTS_PATH = path.join(DATA_DIR, 'dynamic_contacts.json');

const SEED_PATHS = {
  firms: path.join(SEEDS_DIR, 'seed_firms.json'),
  ceos:  path.join(SEEDS_DIR, 'seed_ceos.json'),
  vcs:   path.join(SEEDS_DIR, 'seed_vcs.json'),
};

try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e){ console.error('[ERROR]', e.message); }

function readSeed(key) {
  try { return JSON.parse(fs.readFileSync(SEED_PATHS[key], 'utf8')); } catch(e) {
    console.error('Failed to read seed:', key, e.message);
    return [];
  }
}

function loadOverrides() {
  try {
    if (fs.existsSync(OVERRIDES_PATH)) return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch(e) { console.error('[ERROR]', e.message); }
  return { firms: {}, ceos: {}, vcs: {} };
}

function saveOverrides(o) {
  try { fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(o, null, 2)); } catch(e) { console.error('[ERROR]', e.message); }
}

function loadDynamic() {
  try {
    if (fs.existsSync(DYNAMIC_CONTACTS_PATH)) return JSON.parse(fs.readFileSync(DYNAMIC_CONTACTS_PATH, 'utf8'));
  } catch(e) { console.error('[ERROR]', e.message); }
  return [];
}

function saveDynamic(contacts) {
  try { fs.writeFileSync(DYNAMIC_CONTACTS_PATH, JSON.stringify(contacts, null, 2)); } catch(e) { console.error('[ERROR]', e.message); }
}

const SENT_STATUSES = new Set(['contacted', 'in conversation', 'bounced', 'passed', 'linkedin']);

function orgName(track, item) {
  if (track === 'ceos') return item.company || item.name || '';
  if (track === 'vcs')  return item.firm    || item.name || '';
  return item.name || '';
}

function getDB(key) {
  const seed = readSeed(key);
  const ov = (loadOverrides()[key]) || {};
  return seed.map(item => {
    const o = ov[String(item.id)];
    if (!o) return item;
    if (o.status === 'draft' && SENT_STATUSES.has(item.status)) {
      return { ...item, ...o, status: item.status };
    }
    return { ...item, ...o };
  });
}

function todayET() {
  try {
    const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const d = new Date(etStr);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  } catch(e) {
    console.warn('[WARN] todayET() fell back to UTC');
    return new Date().toISOString().split('T')[0];
  }
}

function daysBetween(dateStr) {
  try {
    const then = new Date(dateStr + 'T00:00:00-05:00');
    const now = new Date();
    return Math.floor((now - then) / (1000 * 60 * 60 * 24));
  } catch(e) { return null; }
}

function loadCronState() {
  try {
    if (fs.existsSync(CRON_STATE_PATH)) return JSON.parse(fs.readFileSync(CRON_STATE_PATH, 'utf8'));
  } catch(e) { console.error('[ERROR]', e.message); }
  return { lastRunDate: null };
}

function saveCronState(state) {
  try { fs.writeFileSync(CRON_STATE_PATH, JSON.stringify(state, null, 2)); } catch(e) { console.error('[ERROR]', e.message); }
}

const DAILY_TARGET = 20;
const PILLARS = ['firms', 'ceos', 'vcs'];

function runDailyCron() {
  const currentDrafts = PILLARS.reduce((sum, key) =>
    sum + getDB(key).filter(x => x.status === 'draft').length, 0);
  if (currentDrafts >= DAILY_TARGET) {
    console.log(`[CRON] ${currentDrafts} drafts already queued. Skipping.`);
    return { totalDrafted: 0, allocations: {}, skipped: true };
  }

  const ov = loadOverrides();
  const perPillar = Math.ceil(DAILY_TARGET / PILLARS.length);

  const pools = {};
  PILLARS.forEach(key => {
    const seed = readSeed(key);
    const existing = ov[key] || {};
    pools[key] = seed.filter(item => {
      const status = (existing[String(item.id)] || {}).status || item.status || 'not contacted';
      const hasContact = (item.contacts || []).some(c => c.email && c.email.trim().length > 0);
      return status === 'not contacted' && hasContact;
    }).sort((a, b) => (a.tier || 99) - (b.tier || 99));
  });

  let allocations = {};
  let surplus = 0;
  PILLARS.forEach(key => {
    const available = pools[key].length;
    const take = Math.min(perPillar, available);
    allocations[key] = take;
    surplus += (perPillar - take);
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

  saveOverrides(ov);
  saveCronState({ lastRunDate: todayET(), totalDrafted, allocations });
  console.log(`[CRON] Drafted ${totalDrafted} contacts (${PILLARS.map(k=>`${k}:${allocations[k]}`).join(', ')})`);
  return { totalDrafted, allocations };
}

function bootCheck() {
  const state = loadCronState();
  const today = todayET();
  if (state.lastRunDate === today) {
    console.log(`[BOOT] Queue already ran today (${today}). Skipping.`);
    return;
  }
  console.log(`[BOOT] Running queue for ${today}...`);
  runDailyCron();
}

setInterval(() => {
  try {
    const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const et = new Date(etStr);
    const h = et.getHours(), m = et.getMinutes();
    if (h === 6 && m < 5) {
      const state = loadCronState();
      if (state.lastRunDate !== todayET()) {
        console.log('[CRON] 6 AM ET window hit — running daily queue...');
        runDailyCron();
      }
    }
  } catch(e) { console.error('[CRON interval error]', e.message); }
}, 5 * 60 * 1000);

setTimeout(bootCheck, 3000);

console.log(`HopeSpot ready — seeds:${readSeed('firms').length}f/${readSeed('ceos').length}c/${readSeed('vcs').length}v`);

const sessions = new Set();
function requireAuth(req, res, next) {
  if (!PASSWORD) return next();
  if (API_KEY) {
    const headerKey = req.headers['x-api-key'] || (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (headerKey && headerKey === API_KEY) return next();
  }
  const token = req.headers['x-auth-token'] || req.query.token;
  if (sessions.has(token)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.use(express.json());

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ ok: true, token: 'no-auth' });
  if (req.body.password === PASSWORD) {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessions.add(token);
    res.json({ ok: true, token });
  } else res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/auth-required', (req, res) => res.json({ required: !!PASSWORD }));
app.get('/api/firms', requireAuth, (req, res) => res.json(getDB('firms')));
app.get('/api/ceos',  requireAuth, (req, res) => res.json(getDB('ceos')));
app.get('/api/vcs',   requireAuth, (req, res) => res.json(getDB('vcs')));

app.get('/api/due', requireAuth, (req, res) => {
  const today = todayET();
  const due = [];

  PILLARS.forEach(track => {
    getDB(track).forEach(item => {
      const status = item.status || 'not contacted';
      const followup = item.followup_date;
      const isJobSearch = item.is_job_search !== false && item.is_job_search !== 'false';
      if (status !== 'contacted') return;
      if (!followup || followup > today) return;
      if (!isJobSearch) return;
      const contacts = (item.contacts || []).filter(c => c.email && c.email.trim());
      const primaryContact = contacts[0] || {};
      due.push({
        track,
        org_id: item.id,
        org_name: orgName(track, item),
        contact_name: primaryContact.name || '',
        contact_email: primaryContact.email || '',
        followup_date: followup,
        last_contacted: item.last_contacted || null,
        days_since_contact: item.last_contacted ? daysBetween(item.last_contacted) : null,
        gmail_thread_id: item.gmail_thread_id || null,
        cadence_day: item.cadence_day || 1,
        notes: item.notes || '',
        status,
      });
    });
  });

  loadDynamic().forEach(item => {
    const status = item.status || 'contacted';
    const followup = item.followup_date;
    const isJobSearch = item.is_job_search !== false && item.is_job_search !== 'false';
    if (status !== 'contacted') return;
    if (!followup || followup > today) return;
    if (!isJobSearch) return;
    due.push({
      track: item.track || 'ceos',
      org_id: item.id,
      org_name: item.org_name || '',
      contact_name: item.contact_name || '',
      contact_email: item.contact_email || '',
      followup_date: followup,
      last_contacted: item.last_contacted || null,
      days_since_contact: item.last_contacted ? daysBetween(item.last_contacted) : null,
      gmail_thread_id: item.gmail_thread_id || null,
      cadence_day: item.cadence_day || 1,
      notes: item.notes || '',
      status,
      dynamic: true,
    });
  });

  due.sort((a, b) => (a.followup_date || '').localeCompare(b.followup_date || ''));
  res.json(due);
});

app.get('/api/contacts', requireAuth, (req, res) => {
  const contacts = loadDynamic();
  const { track } = req.query;
  res.json(track ? contacts.filter(c => c.track === track) : contacts);
});

app.post('/api/contacts/import', requireAuth, (req, res) => {
  const entries = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Expected array' });
  const contacts = loadDynamic();
  let inserted = 0, updated = 0;
  entries.forEach(entry => {
    if (!entry.contact_email) return;
    const existing = contacts.findIndex(c => c.contact_email && c.contact_email.toLowerCase() === entry.contact_email.toLowerCase());
    if (existing >= 0) {
      contacts[existing] = { ...contacts[existing], ...entry, id: contacts[existing].id };
      updated++;
    } else {
      contacts.push({ id: randomUUID(), ...entry });
      inserted++;
    }
  });
  saveDynamic(contacts);
  res.json({ ok: true, inserted, updated, total: contacts.length });
});

app.patch('/api/contacts/:id', requireAuth, (req, res) => {
  const contacts = loadDynamic();
  const idx = contacts.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  contacts[idx] = { ...contacts[idx], ...req.body, id: contacts[idx].id };
  saveDynamic(contacts);
  res.json(contacts[idx]);
});

let lastCronRunCall = 0;
app.post('/api/cron/run', requireAuth, (req, res) => {
  if (Date.now() - lastCronRunCall < 60000)
    return res.status(429).json({ error: 'Rate limited. Wait 60 seconds.' });
  lastCronRunCall = Date.now();
  res.json({ ok: true, ...runDailyCron() });
});

app.get('/api/debug', (req, res) => {
  const ov = loadOverrides();
  const today = todayET();
  let dueCount = 0;
  PILLARS.forEach(track => {
    getDB(track).forEach(item => {
      if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) dueCount++;
    });
  });
  loadDynamic().forEach(item => {
    if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) dueCount++;
  });
  res.json({
    version: '3.5',
    seedCounts: { firms: readSeed('firms').length, ceos: readSeed('ceos').length, vcs: readSeed('vcs').length },
    dynamicCount: loadDynamic().length,
    overrideCounts: { firms: Object.keys(ov.firms||{}).length, ceos: Object.keys(ov.ceos||{}).length, vcs: Object.keys(ov.vcs||{}).length },
    contactedCounts: {
      firms: getDB('firms').filter(x => SENT_STATUSES.has(x.status)).length,
      ceos:  getDB('ceos').filter(x => SENT_STATUSES.has(x.status)).length,
      vcs:   getDB('vcs').filter(x => SENT_STATUSES.has(x.status)).length,
    },
    draftCounts: {
      firms: getDB('firms').filter(x => x.status === 'draft').length,
      ceos:  getDB('ceos').filter(x => x.status === 'draft').length,
      vcs:   getDB('vcs').filter(x => x.status === 'draft').length,
    },
    notContactedCounts: {
      firms: getDB('firms').filter(x => x.status === 'not contacted').length,
      ceos:  getDB('ceos').filter(x => x.status === 'not contacted').length,
      vcs:   getDB('vcs').filter(x => x.status === 'not contacted').length,
    },
    dueCount,
    cronState: loadCronState(),
    todayET: today,
  });
});

// Sectors excluded from the outreach performance table (warm network, not cold outreach)
const SECTOR_EXCLUDE_FROM_TABLE = new Set(['network']);

app.get('/api/stats', requireAuth, (req, res) => {
  const firms = getDB('firms');
  const ceos  = getDB('ceos');
  const vcs   = getDB('vcs');

  function seg(arr, label) {
    const contacted = arr.filter(x => ['contacted','in conversation'].includes(x.status)).length;
    const conv      = arr.filter(x => x.status === 'in conversation').length;
    const drafts    = arr.filter(x => x.status === 'draft').length;
    const bounced   = arr.filter(x => x.status === 'bounced' || (x.contacts||[]).some(c => c.status === 'bounced')).length;
    return { label, total: arr.length, contacted, drafts, conv, bounced,
      responseRate: contacted > 0 ? Math.round((conv/contacted)*100) : 0 };
  }

  const allItems = [
    ...firms.map(x => ({...x, _key:'firms'})),
    ...ceos.map(x  => ({...x, _key:'ceos'})),
    ...vcs.map(x   => ({...x, _key:'vcs'})),
  ];

  const byDate = {};
  allItems.forEach(item => {
    if (!item.last_contacted) return;
    const d = item.last_contacted;
    if (!byDate[d]) byDate[d] = { recruiters:0, ceos:0, vcs:0, total:0 };
    if (['contacted','in conversation'].includes(item.status)) {
      if (item._key === 'firms') byDate[d].recruiters++;
      if (item._key === 'ceos')  byDate[d].ceos++;
      if (item._key === 'vcs')   byDate[d].vcs++;
      byDate[d].total++;
    }
  });

  // Sector stats (CEO only, excludes warm network sectors)
  const SECTOR_MAP = {
    healthtech:'Healthtech', revenue_gtm:'Revenue/GTM', analytics:'Analytics',
    fintech:'FinTech', vertical_saas:'Vertical SaaS', general:'General SaaS', network:'Network'
  };
  const sectorBuckets = {};
  ceos.forEach(item => {
    const s = item.sector || 'general';
    if (!sectorBuckets[s]) sectorBuckets[s] = [];
    sectorBuckets[s].push(item);
  });
  const sectorStats = Object.entries(sectorBuckets)
    .filter(([sector]) => !SECTOR_EXCLUDE_FROM_TABLE.has(sector))
    .map(([sector, items]) => {
      const sent    = items.filter(x => ['contacted','in conversation','bounced'].includes(x.status)).length;
      const replies = items.filter(x => x.status === 'in conversation').length;
      const bounced = items.filter(x => x.status === 'bounced' || (x.contacts||[]).some(c=>c.status==='bounced')).length;
      return { sector, label: SECTOR_MAP[sector]||sector, sent, replies, bounced,
        replyRate: sent > 0 ? Math.round((replies/sent)*100) : 0 };
    }).sort((a,b) => b.sent - a.sent);

  // Template version stats (CEO only)
  const tmplBuckets = {};
  ceos.forEach(item => {
    const v = item.template_version || 'v1';
    if (!tmplBuckets[v]) tmplBuckets[v] = [];
    tmplBuckets[v].push(item);
  });
  const templateStats = Object.entries(tmplBuckets).map(([version, items]) => {
    const sent    = items.filter(x => ['contacted','in conversation','bounced'].includes(x.status)).length;
    const replies = items.filter(x => x.status === 'in conversation').length;
    const bounced = items.filter(x => x.status === 'bounced' || (x.contacts||[]).some(c=>c.status==='bounced')).length;
    return { version, sent, replies, bounced, replyRate: sent > 0 ? Math.round((replies/sent)*100) : 0 };
  }).sort((a,b) => a.version.localeCompare(b.version));

  // SLA stats — 7-day rolling average vs 20/day target
  const todayStr = todayET();
  const cutoffDate = new Date(todayStr + 'T12:00:00-05:00');
  cutoffDate.setDate(cutoffDate.getDate() - 6);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];
  let totalRecent = 0;
  Object.entries(byDate).forEach(([d, v]) => { if (d >= cutoffStr) totalRecent += v.total; });
  const dailyAvg7 = Math.round(totalRecent / 7);
  const slaStats = { target: 20, dailyAvg7, onTrack: dailyAvg7 >= 20 };

  res.json({
    segments: [seg(firms,'Recruiters'), seg(ceos,'Direct CEO'), seg(vcs,'VC Firms')],
    daily: Object.entries(byDate).sort(([a],[b])=>a>b?1:-1).map(([date,counts])=>({date,...counts})),
    totals: {
      contacted: allItems.filter(x => ['contacted','in conversation'].includes(x.status)).length,
      inConversation: allItems.filter(x => x.status === 'in conversation').length,
      drafts: allItems.filter(x => x.status === 'draft').length,
      bounced: allItems.filter(x => x.status === 'bounced').length,
      total: allItems.length,
    },
    sectorStats,
    templateStats,
    slaStats,
  });
});

const VALID_STATUSES = ['not contacted','draft','linkedin','contacted','in conversation','bounced','passed'];
const EXTENDED_FIELDS = ['status','notes','followup_date','is_job_search','gmail_thread_id','cadence_day','last_contacted'];

function makePatch(key) {
  return (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
        return res.status(400).json({ error: 'Invalid request body' });
      if (req.body.status !== undefined && !VALID_STATUSES.includes(req.body.status))
        return res.status(400).json({ error: 'Invalid status value' });
      const id = parseInt(req.params.id);
      const item = readSeed(key).find(x => x.id === id);
      if (!item) return res.status(404).json({ error: 'Not found' });  
      const ov = loadOverrides();
      if (!ov[key]) ov[key] = {};
      const upd = { ...(ov[key][String(id)] || {}) };
      EXTENDED_FIELDS.forEach(k => { if (req.body[k] !== undefined) upd[k] = req.body[k]; });
      if (req.body.status && !['not contacted','draft'].includes(req.body.status) && !req.body.last_contacted)
        upd.last_contacted = todayET();
      ov[key][String(id)] = upd;
      saveOverrides(ov);
      res.json({ ...item, ...upd });
    } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: e.message }); }
  };
}

app.patch('/api/firms/:id', requireAuth, makePatch('firms'));
app.patch('/api/ceos/:id',  requireAuth, makePatch('ceos'));
app.patch('/api/vcs/:id',   requireAuth, makePatch('vcs'));

app.post('/api/reseed', requireAuth, (req, res) => {
  saveOverrides({ firms:{}, ceos:{}, vcs:{} });
  res.json({ ok: true });
});

app.post('/api/sync', requireAuth, (req, res) => {
  const updates = req.body.updates || [];
  if (!updates.length) return res.json({ ok: true, changed: 0 });
  let changed = 0;
  const ov = loadOverrides();
  ['firms','ceos','vcs'].forEach(key => {
    readSeed(key).forEach(item => {
      (item.contacts||[]).forEach(c => {
        const match = updates.find(u => u.email && c.email &&
          u.email.toLowerCase() === c.email.toLowerCase());
        if (!match) return;
        if (!ov[key]) ov[key] = {};
        const upd = { ...(ov[key][String(item.id)] || {}) };
        if (match.status) upd.status = match.status;
        if (match.note) {
          const ts = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});
          upd.notes = upd.notes ? upd.notes+'\n['+ts+'] '+match.note : '['+ts+'] '+match.note;
        }
        ['gmail_thread_id','followup_date','cadence_day','is_job_search'].forEach(f => {
          if (match[f] !== undefined) upd[f] = match[f];
        });
        upd.last_contacted = match.last_contacted || todayET();
        ov[key][String(item.id)] = upd;
        changed++;
      });
    });
  });
  const dynamic = loadDynamic();
  let dynChanged = false;
  dynamic.forEach((item, idx) => {
    const match = updates.find(u => u.email && item.contact_email &&
      u.email.toLowerCase() === item.contact_email.toLowerCase());
    if (!match) return;
    if (match.status) dynamic[idx].status = match.status;
    if (match.note) {
      const ts = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});
      dynamic[idx].notes = dynamic[idx].notes ? dynamic[idx].notes+'\n['+ts+'] '+match.note : '['+ts+'] '+match.note;
    }
    ['gmail_thread_id','followup_date','cadence_day','is_job_search'].forEach(f => {
      if (match[f] !== undefined) dynamic[idx][f] = match[f];
    });
    dynamic[idx].last_contacted = match.last_contacted || todayET();
    changed++;
    dynChanged = true;
  });
  if (dynChanged) saveDynamic(dynamic);
  saveOverrides(ov);
  res.json({ ok: true, changed });
});

app.get('/health', (req, res) => res.json({ ok: true, port: PORT, cronState: loadCronState(), todayET: todayET() }));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, '0.0.0.0', () => console.log('Listening on port ' + PORT));
