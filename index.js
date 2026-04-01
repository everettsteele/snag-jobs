const express = require('express');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.AUTH_PASSWORD || '';

// Seeds live in /seeds/ — outside Railway volume mount at /app/data.
// Overrides (runtime status changes) live in /app/data/overrides.json on the volume.
const SEEDS_DIR = path.join(__dirname, 'seeds');
const DATA_DIR  = path.join(__dirname, 'data');
const OVERRIDES_PATH = path.join(DATA_DIR, 'overrides.json');

const SEED_PATHS = {
  firms: path.join(SEEDS_DIR, 'seed_firms.json'),
  ceos:  path.join(SEEDS_DIR, 'seed_ceos.json'),
  vcs:   path.join(SEEDS_DIR, 'seed_vcs.json'),
};

try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e){}

function readSeed(key) {
  try { return JSON.parse(fs.readFileSync(SEED_PATHS[key], 'utf8')); } catch(e) {
    console.error('Failed to read seed:', key, e.message);
    return [];
  }
}

function loadOverrides() {
  try {
    if (fs.existsSync(OVERRIDES_PATH)) return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch(e) {}
  return { firms: {}, ceos: {}, vcs: {} };
}

function saveOverrides(o) {
  try { fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(o, null, 2)); } catch(e) {}
}

function getDB(key) {
  const seed = readSeed(key);
  const ov = (loadOverrides()[key]) || {};
  return seed.map(item => {
    const o = ov[String(item.id)];
    return o ? { ...item, ...o } : item;
  });
}

// ── DAILY CRON ─────────────────────────────────────────────────────
// Runs at 6:00 AM ET every day.
// Pulls up to 5 contacts per pillar (firms, ceos, vcs) from 'not contacted' status
// and marks them as 'draft' so they appear in the Queue tab.
// Skips any pillar with no uncontacted entries — redistributes quota to others.
// Goal: at least 15 drafts queued every morning.

const DAILY_TARGET = 15;
const PILLARS = ['firms', 'ceos', 'vcs'];

function runDailyCron() {
  const ov = loadOverrides();
  const perPillar = Math.ceil(DAILY_TARGET / PILLARS.length); // 5 each

  // First pass: collect how many uncontacted exist per pillar
  const pools = {};
  PILLARS.forEach(key => {
    const seed = readSeed(key);
    const existing = ov[key] || {};
    pools[key] = seed.filter(item => {
      const status = (existing[String(item.id)] || {}).status || item.status || 'not contacted';
      return status === 'not contacted';
    }).sort((a, b) => (a.tier || 99) - (b.tier || 99)); // tier 1 first
  });

  // Calculate how many to pull per pillar, redistribute leftovers
  let allocations = {};
  let surplus = 0;
  PILLARS.forEach(key => {
    const available = pools[key].length;
    const take = Math.min(perPillar, available);
    allocations[key] = take;
    surplus += (perPillar - take);
  });

  // Redistribute surplus to pillars that have more contacts
  if (surplus > 0) {
    PILLARS.forEach(key => {
      if (surplus <= 0) return;
      const canTakeMore = pools[key].length - allocations[key];
      if (canTakeMore > 0) {
        const extra = Math.min(surplus, canTakeMore);
        allocations[key] += extra;
        surplus -= extra;
      }
    });
  }

  let totalDrafted = 0;
  PILLARS.forEach(key => {
    if (!ov[key]) ov[key] = {};
    const toMark = pools[key].slice(0, allocations[key]);
    toMark.forEach(item => {
      ov[key][String(item.id)] = { ...(ov[key][String(item.id)] || {}), status: 'draft' };
      totalDrafted++;
    });
  });

  saveOverrides(ov);

  const summary = PILLARS.map(k => `${k}:${allocations[k]}`).join(', ');
  console.log(`[CRON] Daily queue run — ${totalDrafted} contacts drafted (${summary})`);
  return { totalDrafted, allocations };
}

// 6 AM ET daily (UTC-4 in summer, UTC-5 in winter; using 10:00 UTC to cover ET)
cron.schedule('0 10 * * *', () => {
  console.log('[CRON] Running daily outreach queue...');
  runDailyCron();
}, { timezone: 'America/New_York' });

console.log(`HopeSpot ready — seeds:${readSeed('firms').length}f/${readSeed('ceos').length}c/${readSeed('vcs').length}v — daily cron active (6 AM ET)`);

const sessions = new Set();
function requireAuth(req, res, next) {
  if (!PASSWORD) return next();
  const token = req.headers['x-auth-token'] || req.query.token;
  if (sessions.has(token)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.use(express.json());

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ ok: true, token: 'no-auth' });
  if (req.body.password === PASSWORD) {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessions.add(token); res.json({ ok: true, token });
  } else res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/auth-required', (req, res) => res.json({ required: !!PASSWORD }));
app.get('/api/firms', requireAuth, (req, res) => res.json(getDB('firms')));
app.get('/api/ceos',  requireAuth, (req, res) => res.json(getDB('ceos')));
app.get('/api/vcs',   requireAuth, (req, res) => res.json(getDB('vcs')));

// Manually trigger the daily cron (for testing or manual queue top-up)
app.post('/api/cron/run', requireAuth, (req, res) => {
  const result = runDailyCron();
  res.json({ ok: true, ...result });
});

app.get('/api/debug', requireAuth, (req, res) => {
  const ov = loadOverrides();
  res.json({
    seedsDir: SEEDS_DIR,
    dataDir: DATA_DIR,
    seedCounts: { firms: readSeed('firms').length, ceos: readSeed('ceos').length, vcs: readSeed('vcs').length },
    overrideCounts: { firms: Object.keys(ov.firms||{}).length, ceos: Object.keys(ov.ceos||{}).length, vcs: Object.keys(ov.vcs||{}).length },
    notContactedCounts: {
      firms: getDB('firms').filter(x=>x.status==='not contacted').length,
      ceos:  getDB('ceos').filter(x=>x.status==='not contacted').length,
      vcs:   getDB('vcs').filter(x=>x.status==='not contacted').length,
    }
  });
});

app.get('/api/stats', requireAuth, (req, res) => {
  const firms = getDB('firms');
  const ceos  = getDB('ceos');
  const vcs   = getDB('vcs');

  function seg(arr, label) {
    const contacted = arr.filter(x => ['contacted','in conversation'].includes(x.status)).length;
    const drafts    = arr.filter(x => x.status === 'draft').length;
    const conv      = arr.filter(x => x.status === 'in conversation').length;
    const bounced   = arr.filter(x => x.status === 'bounced' || (x.contacts||[]).some(c => c.status === 'bounced')).length;
    return { label, total: arr.length, contacted, drafts, conv, bounced, responseRate: contacted > 0 ? Math.round((conv/contacted)*100) : 0 };
  }

  const allItems = [
    ...firms.map(x => ({ ...x, _key: 'firms' })),
    ...ceos.map(x  => ({ ...x, _key: 'ceos' })),
    ...vcs.map(x   => ({ ...x, _key: 'vcs' })),
  ];

  const byDate = {};
  allItems.forEach(item => {
    if (!item.last_contacted) return;
    const d = item.last_contacted;
    if (!byDate[d]) byDate[d] = { recruiters: 0, ceos: 0, vcs: 0, total: 0 };
    if (['contacted','in conversation'].includes(item.status)) {
      if (item._key === 'firms') byDate[d].recruiters++;
      if (item._key === 'ceos')  byDate[d].ceos++;
      if (item._key === 'vcs')   byDate[d].vcs++;
      byDate[d].total++;
    }
  });

  const daily = Object.entries(byDate)
    .sort(([a],[b]) => a > b ? 1 : -1)
    .map(([date, counts]) => ({ date, ...counts }));

  res.json({
    segments: [seg(firms,'Recruiters'), seg(ceos,'Direct CEO'), seg(vcs,'VC Firms')],
    daily,
    totals: {
      contacted: allItems.filter(x => ['contacted','in conversation'].includes(x.status)).length,
      inConversation: allItems.filter(x => x.status === 'in conversation').length,
      drafts: allItems.filter(x => x.status === 'draft').length,
      bounced: allItems.filter(x => x.status === 'bounced').length,
      total: allItems.length,
    }
  });
});

function makePatch(key) {
  return (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const seed = readSeed(key);
      const item = seed.find(x => x.id === id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      const ov = loadOverrides();
      if (!ov[key]) ov[key] = {};
      const cur = ov[key][String(id)] || {};
      const upd = { ...cur };
      ['status','notes','followup_date'].forEach(k => { if (req.body[k] !== undefined) upd[k] = req.body[k]; });
      if (req.body.status && !['not contacted','draft'].includes(req.body.status))
        upd.last_contacted = new Date().toISOString().split('T')[0];
      ov[key][String(id)] = upd;
      saveOverrides(ov);
      res.json({ ...item, ...upd });
    } catch(e) { res.status(500).json({ error: e.message }); }
  };
}

app.patch('/api/firms/:id', requireAuth, makePatch('firms'));
app.patch('/api/ceos/:id',  requireAuth, makePatch('ceos'));
app.patch('/api/vcs/:id',   requireAuth, makePatch('vcs'));

app.post('/api/reseed', requireAuth, (req, res) => {
  saveOverrides({ firms: {}, ceos: {}, vcs: {} });
  res.json({ ok: true, message: 'Overrides cleared.' });
});

app.post('/api/sync', requireAuth, (req, res) => {
  const updates = req.body.updates || [];
  if (!updates.length) return res.json({ ok: true, changed: 0 });
  let changed = 0;
  const ov = loadOverrides();
  ['firms','ceos','vcs'].forEach(key => {
    const seed = readSeed(key);
    seed.forEach(item => {
      (item.contacts||[]).forEach(c => {
        const match = updates.find(u => u.email && c.email && u.email.toLowerCase() === c.email.toLowerCase());
        if (!match) return;
        if (!ov[key]) ov[key] = {};
        const cur = ov[key][String(item.id)] || {};
        const upd = { ...cur };
        if (match.status) upd.status = match.status;
        if (match.note) {
          const ts = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});
          upd.notes = upd.notes ? upd.notes+'\n['+ts+'] '+match.note : '['+ts+'] '+match.note;
        }
        upd.last_contacted = new Date().toISOString().split('T')[0];
        ov[key][String(item.id)] = upd;
        changed++;
      });
    });
  });
  saveOverrides(ov);
  res.json({ ok: true, changed });
});

app.get('/health', (req, res) => res.json({ ok: true, port: PORT }));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, '0.0.0.0', () => console.log('Listening on port '+PORT));
