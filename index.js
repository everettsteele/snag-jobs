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
const APPLICATIONS_PATH = path.join(DATA_DIR, 'applications.json');
const JOB_BOARD_PATH = path.join(DATA_DIR, 'job_board_leads.json');

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

function loadApplications() {
  try {
    if (fs.existsSync(APPLICATIONS_PATH)) return JSON.parse(fs.readFileSync(APPLICATIONS_PATH, 'utf8'));
  } catch(e) { console.error('[ERROR]', e.message); }
  return [];
}

function saveApplications(apps) {
  try { fs.writeFileSync(APPLICATIONS_PATH, JSON.stringify(apps, null, 2)); } catch(e) { console.error('[ERROR]', e.message); }
}

function loadJobBoardLeads() {
  try {
    if (fs.existsSync(JOB_BOARD_PATH)) return JSON.parse(fs.readFileSync(JOB_BOARD_PATH, 'utf8'));
  } catch(e) { console.error('[ERROR]', e.message); }
  return [];
}

function saveJobBoardLeads(leads) {
  try { fs.writeFileSync(JOB_BOARD_PATH, JSON.stringify(leads, null, 2)); } catch(e) { console.error('[ERROR]', e.message); }
}

const SENT_STATUSES = new Set(['contacted', 'in conversation', 'bounced', 'passed', 'linkedin']);
const VALID_APP_STATUSES = ['queued','applied','confirmation_received','interviewing','offer','rejected','no_response','withdrawn'];

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

// Google Apps Script POST — manually follows redirect to preserve POST method
async function postToAppsScript(url, body) {
  const payload = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  const init = await fetch(url, {
    method: 'POST', headers, body: payload,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000)
  });
  console.log('[appsscript] initial status:', init.status);
  if (init.status >= 300 && init.status < 400) {
    const location = init.headers.get('location');
    if (!location) throw new Error('Redirect with no Location header');
    console.log('[appsscript] following redirect to:', location.slice(0, 80));
    const final = await fetch(location, {
      method: 'POST', headers, body: payload,
      signal: AbortSignal.timeout(30000)
    });
    return final;
  }
  return init;
}

const DAILY_TARGET = 15;
const SLA_TARGET   = 10;
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

function bootSeedApplications() {
  const existing = loadApplications();
  if (existing.length > 0) {
    console.log(`[BOOT] ${existing.length} applications already in data store.`);
    return;
  }
  const today = todayET();
  const fd = new Date(today + 'T12:00:00Z');
  fd.setDate(fd.getDate() + 7);
  const followup = fd.toISOString().split('T')[0];
  const seed = [
    { id: 'app-001', company: 'Machinify', role: 'Chief of Staff to the CTO', applied_date: today, status: 'queued', source_url: 'https://job-boards.greenhouse.io/machinifyinc/jobs/4173382009', notion_url: 'https://www.notion.so/33c4cf9804bf813a9b05c2eb5115d096', follow_up_date: followup, last_activity: today, notes: '', activity: [{ date: today, type: 'queued', note: 'Package ready in Notion' }] },
    { id: 'app-002', company: 'BluZinc', role: 'Chief of Staff Strategic Operations Director', applied_date: today, status: 'queued', source_url: 'https://www.chiefofstaff.network/jobs/chief-of-staff-bluzinc-xs4', notion_url: 'https://www.notion.so/33c4cf9804bf810e83a8d7fb56da60af', follow_up_date: followup, last_activity: today, notes: '$170K-$250K', activity: [{ date: today, type: 'queued', note: 'Package ready in Notion' }] },
    { id: 'app-003', company: 'Array', role: 'Chief of Staff', applied_date: today, status: 'queued', source_url: 'https://www.linkedin.com/jobs/view/4398405485', notion_url: 'https://www.notion.so/33c4cf9804bf81f58c33e0b5b58614e1', follow_up_date: followup, last_activity: today, notes: 'General Catalyst-backed', activity: [{ date: today, type: 'queued', note: 'Package ready in Notion' }] },
    { id: 'app-004', company: 'Total AI Systems Inc.', role: 'Chief of Staff', applied_date: today, status: 'queued', source_url: 'https://www.linkedin.com/jobs/view/4384353199', notion_url: 'https://www.notion.so/33c4cf9804bf8139be1af2fe89e500ff', follow_up_date: followup, last_activity: today, notes: '', activity: [{ date: today, type: 'queued', note: 'Package ready in Notion' }] },
    { id: 'app-005', company: 'GameChanger', role: 'Director, Strategic Operations', applied_date: today, status: 'queued', source_url: 'https://www.linkedin.com/jobs/view/4398949728', notion_url: 'https://www.notion.so/33c4cf9804bf8121b1cfff300487e089', follow_up_date: followup, last_activity: today, notes: '', activity: [{ date: today, type: 'queued', note: 'Package ready in Notion' }] },
    { id: 'app-006', company: 'DSD Recruitment', role: 'Chief Operating Officer', applied_date: today, status: 'queued', source_url: 'https://www.linkedin.com/jobs/view/4394752593', notion_url: 'https://www.notion.so/33c4cf9804bf8170b8e3f381e354b553', follow_up_date: followup, last_activity: today, notes: 'Blind agency posting', activity: [{ date: today, type: 'queued', note: 'Package ready in Notion' }] },
    { id: 'app-007', company: '24 Seven Talent', role: 'Chief Operating Officer', applied_date: today, status: 'queued', source_url: 'https://www.linkedin.com/jobs/view/4395463335', notion_url: 'https://www.notion.so/33c4cf9804bf8189a2cefb99c8a5a6db', follow_up_date: followup, last_activity: today, notes: 'Blind agency posting', activity: [{ date: today, type: 'queued', note: 'Package ready in Notion' }] },
    { id: 'app-008', company: 'TalentRemedy', role: 'Vice President Operations', applied_date: today, status: 'queued', source_url: 'https://www.linkedin.com/jobs/view/4395463335', notion_url: 'https://www.notion.so/33c4cf9804bf81c4b0baf20c279a0a07', follow_up_date: followup, last_activity: today, notes: 'Blind agency posting', activity: [{ date: today, type: 'queued', note: 'Package ready in Notion' }] },
    { id: 'app-009', company: 'The Humane League', role: 'Vice President Operations', applied_date: today, status: 'queued', source_url: 'https://www.linkedin.com/jobs/view/4398598541', notion_url: 'https://www.notion.so/33c4cf9804bf81d6a047ff71e6d5d68e', follow_up_date: followup, last_activity: today, notes: 'Nonprofit', activity: [{ date: today, type: 'queued', note: 'Package ready in Notion' }] },
    { id: 'app-010', company: 'Operation Homefront', role: 'Chief Impact Officer', applied_date: today, status: 'queued', source_url: 'https://www.linkedin.com/jobs/view/4372722978', notion_url: 'https://www.notion.so/33c4cf9804bf81fa9956df7f74825583', follow_up_date: followup, last_activity: today, notes: 'Nonprofit; veteran angle', activity: [{ date: today, type: 'queued', note: 'Package ready in Notion' }] },
  ];
  saveApplications(seed);
  console.log('[BOOT] Seeded 10 applications to data store.');
}

// Job board source definitions
const JOB_SOURCES = [
  {
    name: 'jewishjobs',
    label: 'JewishJobs',
    searches: [
      'https://www.jewishjobs.com/search/operations/-/-/true',
      'https://www.jewishjobs.com/search/chief-operating-officer/-/-/true',
      'https://www.jewishjobs.com/search/director/-/-/true',
    ],
    linkPattern: /href="(https?:\/\/(?:www\.)?jewishjobs\.com\/job\/[^"#?]+)"/gi,
    maxPerSearch: 8,
  },
  {
    name: 'execthread',
    label: 'ExecThread',
    searches: [
      'https://execthread.com/search?q=chief+operating+officer',
      'https://execthread.com/search?q=vp+operations',
      'https://execthread.com/search?q=chief+of+staff',
    ],
    linkPattern: /href="(https?:\/\/execthread\.com\/jobs\/[^"#?]+)"/gi,
    maxPerSearch: 6,
  },
  {
    name: 'csnetwork',
    label: 'CoS Network',
    searches: [
      'https://www.chiefofstaff.network/jobs',
    ],
    linkPattern: /href="(\/jobs\/[^"#?]+)".*?(?:title|aria-label)/gi,
    baseUrl: 'https://www.chiefofstaff.network',
    maxPerSearch: 10,
  },
  {
    name: 'idealist',
    label: 'Idealist',
    searches: [
      'https://www.idealist.org/en/jobs?q=vice+president+operations&type=JOB',
      'https://www.idealist.org/en/jobs?q=chief+operating+officer&type=JOB',
    ],
    linkPattern: /href="(https?:\/\/(?:www\.)?idealist\.org\/en\/job\/[^"#?]+)"/gi,
    maxPerSearch: 6,
  },
  {
    name: 'builtinatlanta',
    label: 'Built In ATL',
    searches: [
      'https://builtinatlanta.com/jobs?title=operations&seniority=Senior%20Leadership',
      'https://builtinatlanta.com/jobs?title=chief+of+staff',
    ],
    linkPattern: /href="(https?:\/\/builtinatlanta\.com\/job\/[^"#?]+)"/gi,
    maxPerSearch: 6,
  },
];

function scoreTitle(title) {
  const tl = title.toLowerCase();
  let score = 0;
  if (/chief operating|\bcoo\b/.test(tl)) score += 4;
  else if (/vp oper|vice president oper|managing director|director of oper|director of strategic/.test(tl)) score += 3;
  else if (/\bdirector\b/.test(tl)) score += 2;
  else if (/\bvp\b|vice president/.test(tl)) score += 2;
  if (/executive director/.test(tl)) score += 2;
  if (/chief of staff/.test(tl)) score += 3;
  if (/rabbi|cantor|teacher|social work|therapist|counsel|development officer|philanthrop|chaplain|educator|bookkeeper|accountant|financial/.test(tl)) score -= 4;
  const reasons = [];
  if (/chief operating|\bcoo\b/.test(tl)) reasons.push('COO');
  if (/chief of staff/.test(tl)) reasons.push('CoS');
  if (/director/.test(tl)) reasons.push('Director');
  if (/vp|vice president/.test(tl)) reasons.push('VP');
  if (/executive director/.test(tl)) reasons.push('ED');
  if (/oper/.test(tl)) reasons.push('Ops');
  return { score: Math.min(score, 10), reasons };
}

async function crawlJobBoards() {
  const existing = loadJobBoardLeads();
  const existingUrls = new Set(existing.map(l => l.url));
  const allNewLeads = [];

  for (const source of JOB_SOURCES) {
    const sourceLeads = [];
    for (const searchUrl of source.searches) {
      try {
        const resp = await fetch(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hopespot/1.0)', 'Accept': 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(12000)
        });
        if (!resp.ok) { console.log(`[${source.name}] HTTP ${resp.status} for ${searchUrl}`); continue; }
        const html = await resp.text();

        const urls = [];
        let m;
        const regex = new RegExp(source.linkPattern.source, source.linkPattern.flags);
        while ((m = regex.exec(html)) !== null) {
          let u = m[1];
          if (source.baseUrl && u.startsWith('/')) u = source.baseUrl + u;
          if (!u.startsWith('http')) continue;
          if (!urls.includes(u) && !existingUrls.has(u)) urls.push(u);
        }
        console.log(`[${source.name}] Found ${urls.length} candidate URLs from ${searchUrl}`);

        for (const jobUrl of urls.slice(0, source.maxPerSearch || 8)) {
          try {
            const jr = await fetch(jobUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hopespot/1.0)', 'Accept': 'text/html' },
              signal: AbortSignal.timeout(10000)
            });
            if (!jr.ok) continue;
            const jhtml = await jr.text();

            const titleM = jhtml.match(/<h1[^>]*>([^<]+)<\/h1>/) || jhtml.match(/<title>([^|<\-\u2014]+)/);
            const title = titleM ? titleM[1].replace(/&amp;/g,'&').replace(/&#039;/g,"'").replace(/&ndash;/g,'-').replace(/&mdash;/g,'-').trim() : 'Unknown Role';

            const orgM = jhtml.match(/(?:class="[^"]*(?:employer|organization|company|org)[^"]*"[^>]*>)[^<]{1,5}<\/[^>]+>([^<]{3,80})/) ||
                          jhtml.match(/(?:Employer|Organization|Company):\s*([^<\n]{3,80})/);
            const organization = orgM ? orgM[1].replace(/<[^>]+>/g,'').trim() : '';

            const locM = jhtml.match(/(?:class="[^"]*location[^"]*"[^>]*>|Location:\s*)[^<]{0,10}<[^>]*>([^<]{3,60})/) ||
                          jhtml.match(/([A-Z][a-z]+,\s*[A-Z]{2}(?:,\s*(?:United States|Remote))?)/);
            const location = locM ? locM[1].replace(/<[^>]+>/g,'').trim() : '';

            const { score, reasons } = scoreTitle(title);
            if (score < 3) { await new Promise(r => setTimeout(r, 300)); continue; }

            const lead = {
              id: source.name.slice(0,2) + '-' + Buffer.from(jobUrl).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(0,14),
              source: source.name,
              source_label: source.label,
              title: title.slice(0, 200),
              organization: organization.slice(0, 200),
              location: location.slice(0, 100),
              url: jobUrl,
              fit_score: score,
              fit_reason: reasons.join(', ') || 'Senior role',
              date_found: todayET(),
              status: 'new',
              snoozed: false
            };
            sourceLeads.push(lead);
            existingUrls.add(jobUrl);
            await new Promise(r => setTimeout(r, 500));
          } catch(e) { continue; }
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch(e) { console.error(`[${source.name}] search error:`, e.message); continue; }
    }
    console.log(`[${source.name}] ${sourceLeads.length} new leads`);
    allNewLeads.push(...sourceLeads);
  }

  if (allNewLeads.length > 0) {
    const all = loadJobBoardLeads();
    all.push(...allNewLeads);
    saveJobBoardLeads(all);
    console.log(`[crawl] Total new leads: ${allNewLeads.length}`);
  }
  return allNewLeads;
}

setInterval(() => {
  try {
    const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const et = new Date(etStr);
    const h = et.getHours(), m = et.getMinutes();
    if (h === 6 && m < 5) {
      const state = loadCronState();
      if (state.lastRunDate !== todayET()) {
        console.log('[CRON] 6 AM ET — running daily queue + job board crawl...');
        runDailyCron();
        crawlJobBoards().catch(e => console.error('[crawl cron]', e.message));
      }
    }
  } catch(e) { console.error('[CRON interval error]', e.message); }
}, 5 * 60 * 1000);

setTimeout(bootCheck, 3000);
setTimeout(bootSeedApplications, 4000);

console.log(`HopeSpot v6.0 — seeds:${readSeed('firms').length}f/${readSeed('ceos').length}c/${readSeed('vcs').length}v`);

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
        track, org_id: item.id, org_name: orgName(track, item),
        contact_name: primaryContact.name || '', contact_email: primaryContact.email || '',
        followup_date: followup, last_contacted: item.last_contacted || null,
        days_since_contact: item.last_contacted ? daysBetween(item.last_contacted) : null,
        gmail_thread_id: item.gmail_thread_id || null, cadence_day: item.cadence_day || 1,
        notes: item.notes || '', status,
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
      track: item.track || 'ceos', org_id: item.id, org_name: item.org_name || '',
      contact_name: item.contact_name || '', contact_email: item.contact_email || '',
      followup_date: followup, last_contacted: item.last_contacted || null,
      days_since_contact: item.last_contacted ? daysBetween(item.last_contacted) : null,
      gmail_thread_id: item.gmail_thread_id || null, cadence_day: item.cadence_day || 1,
      notes: item.notes || '', status, dynamic: true,
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
    if (existing >= 0) { contacts[existing] = { ...contacts[existing], ...entry, id: contacts[existing].id }; updated++; }
    else { contacts.push({ id: randomUUID(), ...entry }); inserted++; }
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

// --- APPLICATION TRACKING ---

app.get('/api/applications', requireAuth, (req, res) => {
  res.json(loadApplications().sort((a,b) => (b.applied_date||'').localeCompare(a.applied_date||'')));
});

app.post('/api/applications', requireAuth, (req, res) => {
  const { company, role, source_url, notion_url, notes, applied_date, status } = req.body;
  if (!company || !role) return res.status(400).json({ error: 'company and role required' });
  const today = applied_date || todayET();
  const fd = new Date(today + 'T12:00:00Z');
  fd.setDate(fd.getDate() + 7);
  const rec = {
    id: randomUUID(), company, role,
    applied_date: today, status: status || 'queued',
    source_url: source_url || '', notion_url: notion_url || '',
    follow_up_date: fd.toISOString().split('T')[0],
    last_activity: today, notes: notes || '',
    activity: [{ date: today, type: status || 'queued', note: 'Added to queue' }]
  };
  const apps = loadApplications();
  apps.push(rec);
  saveApplications(apps);
  res.json(rec);
});

app.patch('/api/applications/:id', requireAuth, (req, res) => {
  const apps = loadApplications();
  const idx = apps.findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  if (req.body.status && !VALID_APP_STATUSES.includes(req.body.status))
    return res.status(400).json({ error: 'Invalid status' });
  const today = todayET();
  if (req.body.status && req.body.status !== apps[idx].status) {
    const activity = apps[idx].activity || [];
    activity.push({ date: today, type: req.body.status, note: req.body.activity_note || '' });
    apps[idx].activity = activity;
  }
  apps[idx] = { ...apps[idx], ...req.body, id: apps[idx].id, last_activity: today };
  delete apps[idx].activity_note;
  saveApplications(apps);
  res.json(apps[idx]);
});

app.delete('/api/applications/:id', requireAuth, (req, res) => {
  const apps = loadApplications();
  const idx = apps.findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  apps.splice(idx, 1);
  saveApplications(apps);
  res.json({ ok: true });
});

app.post('/api/applications/email-sync', requireAuth, (req, res) => {
  const matches = req.body.matches || [];
  if (!matches.length) return res.json({ ok: true, changed: 0 });
  const apps = loadApplications();
  let changed = 0;
  matches.forEach(({ id, status, note, date }) => {
    const idx = apps.findIndex(a => a.id === id);
    if (idx < 0) return;
    const actDate = date || todayET();
    if (status && VALID_APP_STATUSES.includes(status) && status !== apps[idx].status) apps[idx].status = status;
    const activity = apps[idx].activity || [];
    activity.push({ date: actDate, type: status || 'note', note: note || '' });
    apps[idx].activity = activity;
    apps[idx].last_activity = actDate;
    changed++;
  });
  saveApplications(apps);
  res.json({ ok: true, changed });
});

// POST /api/create-drive-package
app.post('/api/create-drive-package', requireAuth, async (req, res) => {
  const { app_id, variant, cover_letter_text, company, role } = req.body;
  if (!app_id || !variant || !cover_letter_text)
    return res.status(400).json({ error: 'app_id, variant, and cover_letter_text required' });
  const webhookUrl = process.env.DRIVE_WEBHOOK_URL;
  if (!webhookUrl)
    return res.status(503).json({ error: 'DRIVE_WEBHOOK_URL not configured.' });
  const apps = loadApplications();
  const idx = apps.findIndex(a => a.id === app_id);
  if (idx < 0) return res.status(404).json({ error: 'Application not found' });
  const appRecord = apps[idx];
  const folderName = (company || appRecord.company) + ' - ' + (role || appRecord.role);
  try {
    const response = await postToAppsScript(webhookUrl, {
      folderName, variant,
      coverLetterText: cover_letter_text,
      company: company || appRecord.company,
      role: role || appRecord.role
    });
    const text = await response.text();
    console.log('[create-drive-package] raw response:', text.slice(0, 200));
    let result;
    try { result = JSON.parse(text); } catch(e) {
      return res.status(500).json({ error: 'Apps Script returned non-JSON: ' + text.slice(0, 120) });
    }
    if (!result.ok) return res.status(500).json({ error: result.error || 'Drive webhook failed' });
    const today = todayET();
    apps[idx].drive_url = result.folderUrl;
    apps[idx].drive_folder_id = result.folderId;
    apps[idx].last_activity = today;
    const activity = apps[idx].activity || [];
    activity.push({ date: today, type: 'package_created', note: 'Drive package created: ' + result.folderUrl });
    apps[idx].activity = activity;
    saveApplications(apps);
    res.json({ ok: true, folderUrl: result.folderUrl, folderId: result.folderId });
  } catch(err) {
    console.error('[create-drive-package]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- JOB BOARD ---

app.get('/api/job-board', requireAuth, (req, res) => {
  const leads = loadJobBoardLeads();
  const { status } = req.query;
  const filtered = status ? leads.filter(l => l.status === status) : leads.filter(l => l.status !== 'snogged');
  res.json(filtered.sort((a,b) => (b.fit_score - a.fit_score) || b.date_found.localeCompare(a.date_found)));
});

app.patch('/api/job-board/:id', requireAuth, (req, res) => {
  const leads = loadJobBoardLeads();
  const idx = leads.findIndex(l => l.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  leads[idx] = { ...leads[idx], ...req.body, id: leads[idx].id };
  saveJobBoardLeads(leads);
  res.json(leads[idx]);
});

// Snag a job board lead — moves it into the Applications queue as 'queued'
app.post('/api/job-board/snag', requireAuth, (req, res) => {
  const { lead_id } = req.body;
  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });
  const leads = loadJobBoardLeads();
  const leadIdx = leads.findIndex(l => l.id === lead_id);
  if (leadIdx < 0) return res.status(404).json({ error: 'Lead not found' });
  const lead = leads[leadIdx];
  const today = todayET();
  const fd = new Date(today + 'T12:00:00Z');
  fd.setDate(fd.getDate() + 7);
  const newApp = {
    id: randomUUID(),
    company: lead.organization || 'Unknown',
    role: lead.title,
    applied_date: today,
    status: 'queued',
    source_url: lead.url,
    notion_url: '',
    drive_url: '',
    follow_up_date: fd.toISOString().split('T')[0],
    last_activity: today,
    notes: 'Snagged from ' + (lead.source_label || lead.source) + (lead.location ? ' \u00b7 ' + lead.location : ''),
    activity: [{ date: today, type: 'queued', note: 'Snagged from ' + (lead.source_label || lead.source) }]
  };
  const apps = loadApplications();
  apps.push(newApp);
  saveApplications(apps);
  leads[leadIdx].status = 'snagged';
  leads[leadIdx].snagged_app_id = newApp.id;
  saveJobBoardLeads(leads);
  res.json({ ok: true, application: newApp });
});

app.post('/api/job-board/crawl', requireAuth, async (req, res) => {
  try {
    const newLeads = await crawlJobBoards();
    res.json({ ok: true, newLeads: newLeads.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- END JOB BOARD ---

let lastCronRunCall = 0;
app.post('/api/cron/run', requireAuth, (req, res) => {
  if (Date.now() - lastCronRunCall < 60000)
    return res.status(429).json({ error: 'Rate limited. Wait 60 seconds.' });
  lastCronRunCall = Date.now();
  res.json({ ok: true, ...runDailyCron() });
});

app.post('/api/mark-drafts-sent', requireAuth, (req, res) => {
  const today = todayET();
  const followupDate = (() => { const d = new Date(today + 'T12:00:00Z'); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0]; })();
  let marked = 0;
  const ov = loadOverrides();
  PILLARS.forEach(key => {
    if (!ov[key]) ov[key] = {};
    getDB(key).forEach(item => {
      if (item.status !== 'draft') return;
      ov[key][String(item.id)] = { ...(ov[key][String(item.id)] || {}), status: 'contacted', last_contacted: today, followup_date: followupDate };
      marked++;
    });
  });
  saveOverrides(ov);
  res.json({ ok: true, marked });
});

app.post('/api/gmail-sync', requireAuth, (req, res) => {
  const emails = req.body.emails || [];
  if (!emails.length) return res.json({ ok: true, changed: 0 });
  const updates = emails.map(({ email, sent_date }) => {
    const base = sent_date || todayET();
    const d = new Date(base + 'T12:00:00Z'); d.setDate(d.getDate() + 7);
    return { email: email.toLowerCase().trim(), status: 'contacted', last_contacted: base, followup_date: d.toISOString().split('T')[0] };
  });
  let changed = 0;
  const ov = loadOverrides();
  PILLARS.forEach(key => {
    readSeed(key).forEach(item => {
      (item.contacts || []).forEach(c => {
        const match = updates.find(u => u.email === (c.email || '').toLowerCase().trim());
        if (!match) return;
        if (!ov[key]) ov[key] = {};
        const upd = { ...(ov[key][String(item.id)] || {}) };
        upd.status = match.status; upd.last_contacted = match.last_contacted; upd.followup_date = match.followup_date;
        ov[key][String(item.id)] = upd; changed++;
      });
    });
  });
  saveOverrides(ov);
  res.json({ ok: true, changed });
});

app.get('/api/debug', (req, res) => {
  const ov = loadOverrides();
  const today = todayET();
  let dueCount = 0;
  PILLARS.forEach(track => { getDB(track).forEach(item => { if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) dueCount++; }); });
  loadDynamic().forEach(item => { if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) dueCount++; });
  const appsByStatus = loadApplications().reduce((acc,a)=>{ acc[a.status]=(acc[a.status]||0)+1; return acc; }, {});
  const jbLeads = loadJobBoardLeads();
  res.json({
    version: '6.0',
    seedCounts: { firms: readSeed('firms').length, ceos: readSeed('ceos').length, vcs: readSeed('vcs').length },
    dynamicCount: loadDynamic().length,
    applicationCount: loadApplications().length,
    applicationsByStatus: appsByStatus,
    applicationsWithDrive: loadApplications().filter(a => a.drive_url).length,
    jobBoardLeads: jbLeads.length,
    jobBoardNew: jbLeads.filter(l => l.status === 'new').length,
    jobBoardSnagged: jbLeads.filter(l => l.status === 'snagged').length,
    driveConfigured: !!process.env.DRIVE_WEBHOOK_URL,
    overrideCounts: { firms: Object.keys(ov.firms||{}).length, ceos: Object.keys(ov.ceos||{}).length, vcs: Object.keys(ov.vcs||{}).length },
    contactedCounts: { firms: getDB('firms').filter(x => SENT_STATUSES.has(x.status)).length, ceos: getDB('ceos').filter(x => SENT_STATUSES.has(x.status)).length, vcs: getDB('vcs').filter(x => SENT_STATUSES.has(x.status)).length },
    draftCounts: { firms: getDB('firms').filter(x => x.status === 'draft').length, ceos: getDB('ceos').filter(x => x.status === 'draft').length, vcs: getDB('vcs').filter(x => x.status === 'draft').length },
    jobSources: JOB_SOURCES.map(s => s.name),
    dueCount, cronState: loadCronState(), todayET: today,
  });
});

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
    return { label, total: arr.length, contacted, drafts, conv, bounced, responseRate: contacted > 0 ? Math.round((conv/contacted)*100) : 0 };
  }
  const allItems = [...firms.map(x=>({...x,_key:'firms'})),...ceos.map(x=>({...x,_key:'ceos'})),...vcs.map(x=>({...x,_key:'vcs'}))];
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
  const SECTOR_MAP = { healthtech:'Healthtech', revenue_gtm:'Revenue/GTM', analytics:'Analytics', fintech:'FinTech', vertical_saas:'Vertical SaaS', general:'General SaaS', network:'Network' };
  const sectorBuckets = {};
  ceos.forEach(item => { const s = item.sector || 'general'; if (!sectorBuckets[s]) sectorBuckets[s] = []; sectorBuckets[s].push(item); });
  const sectorStats = Object.entries(sectorBuckets).filter(([sector]) => !SECTOR_EXCLUDE_FROM_TABLE.has(sector)).map(([sector, items]) => {
    const sent = items.filter(x => ['contacted','in conversation','bounced'].includes(x.status)).length;
    const replies = items.filter(x => x.status === 'in conversation').length;
    const bounced = items.filter(x => x.status === 'bounced' || (x.contacts||[]).some(c=>c.status==='bounced')).length;
    return { sector, label: SECTOR_MAP[sector]||sector, sent, replies, bounced, replyRate: sent > 0 ? Math.round((replies/sent)*100) : 0 };
  }).sort((a,b) => b.sent - a.sent);
  const tmplBuckets = {};
  ceos.forEach(item => { const v = item.template_version || 'v1'; if (!tmplBuckets[v]) tmplBuckets[v] = []; tmplBuckets[v].push(item); });
  const templateStats = Object.entries(tmplBuckets).map(([version, items]) => {
    const sent = items.filter(x => ['contacted','in conversation','bounced'].includes(x.status)).length;
    const replies = items.filter(x => x.status === 'in conversation').length;
    const bounced = items.filter(x => x.status === 'bounced' || (x.contacts||[]).some(c=>c.status==='bounced')).length;
    return { version, sent, replies, bounced, replyRate: sent > 0 ? Math.round((replies/sent)*100) : 0 };
  }).sort((a,b) => a.version.localeCompare(b.version));
  const todayStr = todayET();
  const cutoffDate = new Date(todayStr + 'T12:00:00-05:00'); cutoffDate.setDate(cutoffDate.getDate() - 6);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];
  let totalRecent = 0;
  Object.entries(byDate).forEach(([d, v]) => { if (d >= cutoffStr) totalRecent += v.total; });
  const dailyAvg7 = Math.round(totalRecent / 7);
  const slaStats = { target: SLA_TARGET, dailyAvg7, onTrack: dailyAvg7 >= SLA_TARGET };
  res.json({
    segments: [seg(firms,'Recruiters'), seg(ceos,'Direct CEO'), seg(vcs,'VC Firms')],
    daily: Object.entries(byDate).sort(([a],[b])=>a>b?1:-1).map(([date,counts])=>({date,...counts})),
    totals: { contacted: allItems.filter(x => ['contacted','in conversation'].includes(x.status)).length, inConversation: allItems.filter(x => x.status === 'in conversation').length, drafts: allItems.filter(x => x.status === 'draft').length, bounced: allItems.filter(x => x.status === 'bounced').length, total: allItems.length },
    sectorStats, templateStats, slaStats,
  });
});

const VALID_STATUSES = ['not contacted','draft','linkedin','contacted','in conversation','bounced','passed'];
const EXTENDED_FIELDS = ['status','notes','followup_date','is_job_search','gmail_thread_id','cadence_day','last_contacted'];

function makePatch(key) {
  return (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Invalid request body' });
      if (req.body.status !== undefined && !VALID_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status value' });
      const id = parseInt(req.params.id);
      const item = readSeed(key).find(x => x.id === id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      const ov = loadOverrides();
      if (!ov[key]) ov[key] = {};
      const upd = { ...(ov[key][String(id)] || {}) };
      EXTENDED_FIELDS.forEach(k => { if (req.body[k] !== undefined) upd[k] = req.body[k]; });
      if (req.body.status && !['not contacted','draft'].includes(req.body.status) && !req.body.last_contacted) upd.last_contacted = todayET();
      ov[key][String(id)] = upd;
      saveOverrides(ov);
      res.json({ ...item, ...upd });
    } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: e.message }); }
  };
}

app.patch('/api/firms/:id', requireAuth, makePatch('firms'));
app.patch('/api/ceos/:id',  requireAuth, makePatch('ceos'));
app.patch('/api/vcs/:id',   requireAuth, makePatch('vcs'));

app.post('/api/reseed', requireAuth, (req, res) => { saveOverrides({ firms:{}, ceos:{}, vcs:{} }); res.json({ ok: true }); });

app.post('/api/sync', requireAuth, (req, res) => {
  const updates = req.body.updates || [];
  if (!updates.length) return res.json({ ok: true, changed: 0 });
  let changed = 0;
  const ov = loadOverrides();
  ['firms','ceos','vcs'].forEach(key => {
    readSeed(key).forEach(item => {
      (item.contacts||[]).forEach(c => {
        const match = updates.find(u => u.email && c.email && u.email.toLowerCase() === c.email.toLowerCase());
        if (!match) return;
        if (!ov[key]) ov[key] = {};
        const upd = { ...(ov[key][String(item.id)] || {}) };
        if (match.status) upd.status = match.status;
        if (match.note) { const ts = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'}); upd.notes = upd.notes ? upd.notes+'\n['+ts+'] '+match.note : '['+ts+'] '+match.note; }
        ['gmail_thread_id','followup_date','cadence_day','is_job_search'].forEach(f => { if (match[f] !== undefined) upd[f] = match[f]; });
        upd.last_contacted = match.last_contacted || todayET();
        ov[key][String(item.id)] = upd; changed++;
      });
    });
  });
  const dynamic = loadDynamic();
  let dynChanged = false;
  dynamic.forEach((item, idx) => {
    const match = updates.find(u => u.email && item.contact_email && u.email.toLowerCase() === item.contact_email.toLowerCase());
    if (!match) return;
    if (match.status) dynamic[idx].status = match.status;
    if (match.note) { const ts = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'}); dynamic[idx].notes = dynamic[idx].notes ? dynamic[idx].notes+'\n['+ts+'] '+match.note : '['+ts+'] '+match.note; }
    ['gmail_thread_id','followup_date','cadence_day','is_job_search'].forEach(f => { if (match[f] !== undefined) dynamic[idx][f] = match[f]; });
    dynamic[idx].last_contacted = match.last_contacted || todayET();
    changed++; dynChanged = true;
  });
  if (dynChanged) saveDynamic(dynamic);
  saveOverrides(ov);
  res.json({ ok: true, changed });
});

app.get('/health', (req, res) => res.json({ ok: true, port: PORT, version: '6.0', cronState: loadCronState(), todayET: todayET() }));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, '0.0.0.0', () => console.log('HopeSpot v6.0 listening on port ' + PORT));
