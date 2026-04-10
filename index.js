const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID, createHash } = require('crypto');

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
const NETWORKING_PATH = path.join(DATA_DIR, 'networking.json');
const CAL_CONFIG_PATH = path.join(DATA_DIR, 'cal_config.json');

const SEED_PATHS = {
  firms: path.join(SEEDS_DIR, 'seed_firms.json'),
  ceos:  path.join(SEEDS_DIR, 'seed_ceos.json'),
  vcs:   path.join(SEEDS_DIR, 'seed_vcs.json'),
};

try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e){ console.error('[ERROR]', e.message); }

function readSeed(key) {
  try { return JSON.parse(fs.readFileSync(SEED_PATHS[key], 'utf8')); } catch(e) { return []; }
}
function loadOverrides() {
  try { if (fs.existsSync(OVERRIDES_PATH)) return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')); } catch(e) {}
  return { firms: {}, ceos: {}, vcs: {} };
}
function saveOverrides(o) { try { fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(o, null, 2)); } catch(e) {} }
function loadDynamic() {
  try { if (fs.existsSync(DYNAMIC_CONTACTS_PATH)) return JSON.parse(fs.readFileSync(DYNAMIC_CONTACTS_PATH, 'utf8')); } catch(e) {}  
  return [];
}
function saveDynamic(c) { try { fs.writeFileSync(DYNAMIC_CONTACTS_PATH, JSON.stringify(c, null, 2)); } catch(e) {} }
function loadApplications() {
  try { if (fs.existsSync(APPLICATIONS_PATH)) return JSON.parse(fs.readFileSync(APPLICATIONS_PATH, 'utf8')); } catch(e) {}  
  return [];
}
function saveApplications(a) {
  try { fs.writeFileSync(APPLICATIONS_PATH, JSON.stringify(a, null, 2)); return true; } catch(e) { console.error('[saveApplications]', e.message); return false; }
}
function loadJobBoardLeads() {
  try {
    if (fs.existsSync(JOB_BOARD_PATH)) {
      const data = JSON.parse(fs.readFileSync(JOB_BOARD_PATH, 'utf8'));
      return data;
    }
  } catch(e) { console.error('[loadJobBoardLeads] ERROR:', e.message); }
  console.warn('[loadJobBoardLeads] returning empty array — file missing or unreadable');
  return [];
}
function saveJobBoardLeads(l) {
  try {
    fs.writeFileSync(JOB_BOARD_PATH, JSON.stringify(l, null, 2));
    // Verify write by reading back
    const verify = JSON.parse(fs.readFileSync(JOB_BOARD_PATH, 'utf8'));
    if (verify.length !== l.length) {
      console.error('[saveJobBoardLeads] VERIFY FAILED: wrote', l.length, 'but read back', verify.length);
      return false;
    }
    return true;
  } catch(e) { console.error('[saveJobBoardLeads] ERROR:', e.message); return false; }
}
function loadNetworking() {
  try { if (fs.existsSync(NETWORKING_PATH)) return JSON.parse(fs.readFileSync(NETWORKING_PATH, 'utf8')); } catch(e) {}  
  return [];
}
function saveNetworking(e) { try { fs.writeFileSync(NETWORKING_PATH, JSON.stringify(e, null, 2)); } catch(e) {} }
function loadCalConfig() {
  try { if (fs.existsSync(CAL_CONFIG_PATH)) return JSON.parse(fs.readFileSync(CAL_CONFIG_PATH, 'utf8')); } catch(e) {}  
  return { setup_complete: false, whitelisted_calendar_ids: [], whitelisted_calendar_names: {} };
}
function saveCalConfig(c) { try { fs.writeFileSync(CAL_CONFIG_PATH, JSON.stringify(c, null, 2)); } catch(e) {} }

// ================================================================
// DIAGNOSTIC LOG RING BUFFER — last 50 entries, retrievable via /api/diag/logs
// ================================================================
const _diagLogs = [];
function diagLog(msg) {
  const entry = '[' + new Date().toISOString() + '] ' + msg;
  console.log(entry);
  _diagLogs.push(entry);
  if (_diagLogs.length > 50) _diagLogs.shift();
}

// ================================================================
// JOB BOARD WRITE LOCK
// Concurrent skip PATCHes each read the same stale file, then write
// with only their own change — last write wins and all others are lost.
// This lock serializes all job board mutations so reads always see
// the latest committed state.
// ================================================================
let _jobBoardLock = Promise.resolve();
let _lockSeq = 0;
function withJobBoardLock(fn) {
  const seq = ++_lockSeq;
  diagLog('LOCK queued seq=' + seq);
  _jobBoardLock = _jobBoardLock.then(() => {
    diagLog('LOCK executing seq=' + seq);
    return fn();
  }).catch(e => {
    diagLog('LOCK ERROR seq=' + seq + ': ' + (e && e.message || e));
  });
  return _jobBoardLock;
}

const SENT_STATUSES = new Set(['contacted', 'in conversation', 'bounced', 'passed', 'linkedin']);
const VALID_APP_STATUSES = ['queued','applied','confirmation_received','interviewing','offer','rejected','no_response','withdrawn'];

function orgName(track, item) {
  if (track === 'ceos') return item.company || item.name || '';
  if (track === 'vcs')  return item.firm    || item.name || '';
  return item.name || '';
}
function getDB(key) {
  const seed = readSeed(key), ov = (loadOverrides()[key]) || {};
  return seed.map(item => {
    const o = ov[String(item.id)];
    if (!o) return item;
    if (o.status === 'draft' && SENT_STATUSES.has(item.status)) return { ...item, ...o, status: item.status };
    return { ...item, ...o };
  });
}
function todayET() {
  try {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  } catch(e) { return new Date().toISOString().split('T')[0]; }
}
function daysAgoStr(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0];
}
function daysBetween(dateStr) {
  try { return Math.floor((new Date() - new Date(dateStr + 'T00:00:00-05:00')) / 864e5); } catch(e) { return null; }
}
function loadCronState() {
  try { if (fs.existsSync(CRON_STATE_PATH)) return JSON.parse(fs.readFileSync(CRON_STATE_PATH, 'utf8')); } catch(e) {}  
  return { lastRunDate: null };
}
function saveCronState(s) { try { fs.writeFileSync(CRON_STATE_PATH, JSON.stringify(s, null, 2)); } catch(e) {} }

async function postToAppsScript(url, body) {
  const payload = JSON.stringify(body), headers = { 'Content-Type': 'application/json' };
  // Google Apps Script Web Apps: POST executes doPost(), then 302 redirects
  // to a result URL. The redirect must be followed with GET (not POST).
  // We may need to follow multiple redirects (Google account routing).
  let resp = await fetch(url, { method: 'POST', headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  let hops = 0;
  while (resp.status >= 300 && resp.status < 400 && hops < 5) {
    const loc = resp.headers.get('location');
    if (!loc) throw new Error('Redirect with no Location');
    diagLog('WEBHOOK redirect ' + resp.status + ' -> ' + loc.slice(0, 120));
    resp = await fetch(loc, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    hops++;
  }
  return resp;
}

const DAILY_TARGET = 15, SLA_TARGET = 10, PILLARS = ['firms', 'ceos', 'vcs'];

function runDailyCron() {
  const currentDrafts = PILLARS.reduce((sum, key) => sum + getDB(key).filter(x => x.status === 'draft').length, 0);
  if (currentDrafts >= DAILY_TARGET) return { totalDrafted: 0, allocations: {}, skipped: true };
  const ov = loadOverrides(), perPillar = Math.ceil(DAILY_TARGET / PILLARS.length);
  const pools = {};
  PILLARS.forEach(key => {
    const seed = readSeed(key), existing = ov[key] || {};
    pools[key] = seed.filter(item => {
      const status = (existing[String(item.id)] || {}).status || item.status || 'not contacted';
      return status === 'not contacted' && (item.contacts || []).some(c => c.email && c.email.trim());
    }).sort((a, b) => (a.tier || 99) - (b.tier || 99));
  });
  let allocations = {}, surplus = 0;
  PILLARS.forEach(key => { const t = Math.min(perPillar, pools[key].length); allocations[key] = t; surplus += perPillar - t; });
  if (surplus > 0) PILLARS.forEach(key => {
    if (surplus <= 0) return;
    const extra = Math.min(surplus, pools[key].length - allocations[key]);
    if (extra > 0) { allocations[key] += extra; surplus -= extra; }
  });
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
  return { totalDrafted, allocations };
}

function bootCheck() {
  const state = loadCronState(), today = todayET();
  if (state.lastRunDate === today) return;
  runDailyCron();
}

function bootSeedApplications() {
  const existing = loadApplications();
  if (existing.length > 0) return;
  const today = todayET(), fd = new Date(today + 'T12:00:00Z');
  fd.setDate(fd.getDate() + 7);
  const followup = fd.toISOString().split('T')[0];
  const mkApp = (id, company, role, src, notion, notes) => ({ id, company, role, applied_date: today, status: 'queued', source_url: src, notion_url: notion, drive_url: '', follow_up_date: followup, last_activity: today, notes: notes || '', activity: [{ date: today, type: 'queued', note: 'Snagged' }] });
  saveApplications([
    mkApp('app-001','Machinify','Chief of Staff to the CTO','https://job-boards.greenhouse.io/machinifyinc/jobs/4173382009','https://www.notion.so/33c4cf9804bf813a9b05c2eb5115d096',''),
    mkApp('app-002','BluZinc','Chief of Staff Strategic Operations Director','https://www.chiefofstaff.network/jobs/chief-of-staff-bluzinc-xs4','https://www.notion.so/33c4cf9804bf810e83a8d7fb56da60af','$170K-$250K'),
    mkApp('app-003','Array','Chief of Staff','https://www.linkedin.com/jobs/view/4398405485','https://www.notion.so/33c4cf9804bf81f58c33e0b5b58614e1','General Catalyst-backed'),
    mkApp('app-004','Total AI Systems Inc.','Chief of Staff','https://www.linkedin.com/jobs/view/4384353199','https://www.notion.so/33c4cf9804bf8139be1af2fe89e500ff',''),
    mkApp('app-005','GameChanger','Director, Strategic Operations','https://www.linkedin.com/jobs/view/4398949728','https://www.notion.so/33c4cf9804bf8121b1cfff300487e089',''),
    mkApp('app-006','DSD Recruitment','Chief Operating Officer','https://www.linkedin.com/jobs/view/4394752593','https://www.notion.so/33c4cf9804bf8170b8e3f381e354b553','Blind agency'),
    mkApp('app-007','24 Seven Talent','Chief Operating Officer','https://www.linkedin.com/jobs/view/4395463335','https://www.notion.so/33c4cf9804bf8189a2cefb99c8a5a6db','Blind agency'),
    mkApp('app-008','TalentRemedy','Vice President Operations','https://www.linkedin.com/jobs/view/4395463335','https://www.notion.so/33c4cf9804bf81c4b0baf20c279a0a07','Blind agency'),
    mkApp('app-009','The Humane League','Vice President Operations','https://www.linkedin.com/jobs/view/4398598541','https://www.notion.so/33c4cf9804bf81d6a047ff71e6d5d68e','Nonprofit'),
    mkApp('app-010','Operation Homefront','Chief Impact Officer','https://www.linkedin.com/jobs/view/4372722978','https://www.notion.so/33c4cf9804bf81fa9956df7f74825583','Nonprofit; veteran angle'),
  ]);
}

// ================================================================
// COVER LETTER GENERATION
// ================================================================

function cleanCoverLetterText(raw) {
  if (!raw) return '';
  let text = raw.trim();
  const sepIdx = text.indexOf('---');
  if (sepIdx > -1) {
    const afterSep = text.slice(sepIdx + 3).trim();
    if (afterSep.length > 100) text = afterSep;
  }
  const metaPatterns = [
    /^the job description/i,
    /^i(?:'m| am) working with/i,
    /^i(?:'ll| will) write/i,
    /^since the (job|jd|description)/i,
    /^note:/i,
    /^based on the/i,
    /^working from/i,
  ];
  const lines = text.split('\n');
  let startIdx = 0;
  while (startIdx < lines.length && metaPatterns.some(p => p.test(lines[startIdx].trim()))) startIdx++;
  text = lines.slice(startIdx).join('\n').trim();
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  return text;
}

const COVER_LETTER_SYSTEM = `You are writing a cover letter for Everett Steele, a senior executive and veteran.

CRITICAL OUTPUT RULES:
- Begin your response with the FIRST SENTENCE OF THE LETTER. Nothing else before it.
- Do NOT include any preamble, disclaimers, notes, meta-commentary, or explanations of what you are doing.
- Do NOT write things like "The job description didn't load" or "I'll write based on" or "Note:" or any separator like "---".
- Do NOT use markdown bold (**text**) or any other markdown formatting. Plain text only.
- If the job description is incomplete, write the best letter you can from the available context. Do not mention the gap.

VOICE AND STYLE:
- First person. Direct and declarative. No filler phrases. No "I am excited to" openings.
- Start with a strong statement tied specifically to the role.

EVERETT'S BACKGROUND:
Veteran (US Army, Infantry Recon Platoon Leader, Baghdad). 3 successful exits as founder/CEO. SVP Operations at ChartRequest: scaled from $2M to $16M ARR, 40 to 180+ employees across 4 countries in under 3 years. Built full operating infrastructure: EOS, scorecards, OKRs, cross-functional accountability systems. Chief of Staff to Atlanta City Council/Mayor Andre Dickens. UX/Product Director at UpTogether (1.25M members). Forbes Disruptor in Logistics. ABC 40 Under 40. LEAD Atlanta Fellow. Currently building Meridian, an AI-native venture studio.

FORMAT:
3-4 paragraphs. Under 350 words. No sign-off needed. Output the letter text only.`;

const VARIANT_LABELS = {
  operator: 'Integrator/COO — EOS, scaling, building the operational machine',
  partner: 'Chief of Staff — right-hand to CEO, strategic ops, force multiplier',
  builder: 'VP/SVP Operations — multi-function ownership, revenue ops, GTM, cross-functional',
  innovator: 'AI/Special Projects — AI, automation, innovation, special initiatives'
};

async function selectResumeVariant(appRecord, jdText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'operator';
  try {
    const prompt = `Based on this job description, pick the single best resume variant for Everett Steele to use.

VARIANTS:
- operator: Integrator/COO role. JD uses EOS, Integrator, or scaling context. Operator brought in to build the machine.
- partner: Chief of Staff role. Right-hand-to-CEO, force multiplier, strategic ops, executive leverage.
- builder: VP/SVP Operations role. Owns multiple functions, revenue ops, CS, GTM alignment, cross-functional accountability.
- innovator: AI/Special Projects role. AI, automation, innovation, or explicit special initiatives scope.

RULES:
- If the JD uses "Integrator" language explicitly, always pick operator.
- If the title says "Chief of Staff", pick partner.
- For roles that fit two categories, default to the one matching the JD title.
- Respond with ONLY the single word: operator, partner, builder, or innovator. Nothing else.

ROLE: ${appRecord.role} at ${appRecord.company}
JOB DESCRIPTION:
${jdText.slice(0, 2000)}`;
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return 'operator';
    const data = await resp.json();
    const raw = (data.content?.[0]?.text || '').trim().toLowerCase();
    if (['operator','partner','builder','innovator'].includes(raw)) return raw;
    return 'operator';
  } catch(e) { console.error('[selectResumeVariant]', e.message); return 'operator'; }
}

async function generateCoverLetterForApp(appRecord, jdText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const prompt = `ROLE: ${appRecord.role} at ${appRecord.company}\n\nJOB DESCRIPTION:\n${jdText.slice(0, 3000)}\n\nNotes about this role: ${appRecord.notes || 'None'}\n\nWrite the cover letter now. Start immediately with the first sentence.`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 700, system: COVER_LETTER_SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(30000)
  });
  if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status}`);
  const data = await resp.json();
  const raw = data.content?.[0]?.text || '';
  return cleanCoverLetterText(raw);
}

async function fetchJobDescription(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hopespot/1.0)', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(12000)
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
               .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
               .replace(/<[^>]+>/g, ' ')
               .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;/g, "'")
               .replace(/\s{2,}/g, ' ').trim().slice(0, 4000);
  } catch(e) { return ''; }
}

// ================================================================
// JOB BOARD
// ================================================================

const JOB_SOURCES = [
  {
    name: 'jewishjobs',
    label: 'JewishJobs',
    searches: [
      'https://www.jewishjobs.com/search/operations/-/-/true',
      'https://www.jewishjobs.com/search/chief-operating-officer/-/-/true',
      'https://www.jewishjobs.com/search/director-of-operations/-/-/true',
    ],
    linkPattern: /href="((?:https?:\/\/(?:www\.)?jewishjobs\.com)?\/(?:job|listing|jobs|position)s?(?:-openings?)?(?:\/|$)[^"#?\s]{3,}?)"/gi,
    baseUrl: 'https://www.jewishjobs.com',
    maxPerSearch: 10,
  },
  {
    name: 'execthread',
    label: 'ExecThread',
    searches: [
      'https://execthread.com/search?q=chief+operating+officer',
      'https://execthread.com/search?q=vp+operations',
      'https://execthread.com/search?q=chief+of+staff',
    ],
    linkPattern: /href="((?:https?:\/\/execthread\.com)?\/jobs\/[^"#?\s]{3,}?)"/gi,
    baseUrl: 'https://execthread.com',
    maxPerSearch: 6,
  },
  {
    name: 'csnetwork',
    label: 'CoS Network',
    searches: ['https://www.chiefofstaff.network/jobs'],
    linkPattern: /href="(\/jobs\/[^"#?\s]{3,}?)"/gi,
    baseUrl: 'https://www.chiefofstaff.network',
    maxPerSearch: 12,
  },
  {
    name: 'idealist',
    label: 'Idealist',
    searches: [
      'https://www.idealist.org/en/jobs?q=vice+president+operations&type=JOB',
      'https://www.idealist.org/en/jobs?q=chief+operating+officer&type=JOB',
      'https://www.idealist.org/en/jobs?q=director+operations&type=JOB',
    ],
    linkPattern: /href="((?:https?:\/\/(?:www\.)?idealist\.org)?\/en\/jobs?\/[^"#?\s]{3,}?)"/gi,
    baseUrl: 'https://www.idealist.org',
    maxPerSearch: 6,
  },
  {
    name: 'builtinatlanta',
    label: 'Built In ATL',
    searches: [
      'https://builtinatlanta.com/jobs?title=operations&seniority=Senior%20Leadership',
      'https://builtinatlanta.com/jobs?title=chief+of+staff',
      'https://builtinatlanta.com/jobs?title=vice+president+operations',
    ],
    linkPattern: /href="((?:https?:\/\/builtinatlanta\.com)?\/jobs?\/[^"#?\s]{3,}?)"/gi,
    baseUrl: 'https://builtinatlanta.com',
    maxPerSearch: 8,
  },
];

const LOCATION_ALLOW = /\batlanta\b|\bgeorgia\b|,\s*GA\b|\bremote\b|\bhybrid\b|distributed|nationwide|flexible|anywhere|work\s*from\s*home|\bwfh\b|u\.?s\.?\s*only|us\s*only/i;
const LOCATION_DENY_STATES = /\bflorida\b|\btexas\b|\bcalifornia\b|\bnew\s*york\b|\billinois\b|\bpennsylvania\b|\bmaryland\b|\bvirginia\b|\bcolorado\b|\bwashington\b|\boregon\b|\bnevada\b|\barizona\b|\butah\b|\bminnesota\b|\bwisconsin\b|\bmissouri\b|\bmichigan\b|\bindiana\b|\bohio\b|\bkentucky\b|\btennessee\b|\bcarolina\b|\bconnecticut\b|\bmassachusetts\b|\bnew\s*jersey\b|\bnew\s*hampshire\b|\brhode\s*island\b|\bvermont\b|\bmaine\b/i;
const LOCATION_DENY_ABBR = /,\s*(?:FL|TX|CA|NY|IL|PA|MD|VA|CO|WA|OR|NV|AZ|UT|MN|WI|MO|MI|IN|OH|KY|TN|NC|SC|CT|MA|NJ|NH|RI|VT|ME|AL|AR|AK|HI|ID|IA|KS|LA|MS|MT|NE|ND|NM|OK|SD|WV|WY|DC)\b/i;
const LOCATION_DENY_CITIES = /\bphiladelphia\b|\bphilly\b|\bnew\s*york\b|\bnyc\b|\bbrooklyn\b|\bmanhattan\b|\bnew\s*jersey\b|\bchicago\b|\bboston\b|\bsan\s*francisco\b|\bseattle\b|\bdenver\b|\bmiami\b|\blos\s*angeles\b|\bportland\b|\bminneapolis\b|\bphoenix\b|\bdallas\b|\bhouston\b|\bnashville\b|\bcharlotte\b|\braleigh\b|washington[\s,]+d\.?c|\bbaltimore\b|\bpittsburgh\b|\bcleveland\b|\bdetroit\b|\bindianapolis\b|kansas\s*city|st\.?\s*louis|\bcolumbus,\s*oh\b|\bcincinnati\b|\bmemphis\b|\bomaha\b|\blas\s*vegas\b|\bsan\s*diego\b|\bsan\s*antonio\b|\bsan\s*jose\b|\btampa\b|\bjacksonville,\s*fl\b|\bmilwaukee\b|\bsacramento\b|salt\s*lake|\blouisville\b|\btucson\b|\baustin,\s*tx\b|\bfresno\b|\borlando\b|\bfort\s*lauderdale\b|\bjacksonville\b|\bboca\s*raton\b|\bst\.?\s*pete\b|\btallahassee\b/i;

function passesLocationFilter(location) {
  if (!location || location.trim().length < 2) return true;
  if (LOCATION_ALLOW.test(location)) return true;
  if (LOCATION_DENY_CITIES.test(location)) return false;
  if (LOCATION_DENY_ABBR.test(location)) return false;
  if (LOCATION_DENY_STATES.test(location)) return false;
  return true;
}

function extractLocation(html) {
  const jldM = html.match(/"jobLocation"\s*:\s*\{[^}]*"addressLocality"\s*:\s*"([^"]{2,60})"/i);
  if (jldM) {
    if (/"remote"\s*:\s*true/i.test(html.slice(0, 5000))) return 'Remote';
    return jldM[1].trim();
  }
  const remoteM = html.match(/<[^>]+(?:class|id)="[^"]*(?:location|workplace|job-location)[^"]*"[^>]*>\s*([^<]{0,60}remote[^<]{0,30})<\/[^>]+>/i)
                || html.match(/>\s*((?:Fully\s+)?Remote(?:[^<]{0,20})?)<\//i);
  if (remoteM) return remoteM[1].replace(/<[^>]+>/g,'').trim().slice(0, 60);
  if (/hybrid/i.test(html.slice(0, 8000))) {
    const hybM = html.match(/>([^<]{0,20}hybrid[^<]{0,20})<\//i);
    if (hybM) return hybM[1].trim().slice(0, 60);
  }
  const cityM = html.match(/([A-Z][a-zA-Z\s]{1,20},\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC))/);
  if (cityM) return cityM[1].trim();
  const locCtxM = html.match(/(?:location|located|based)[^<]{0,20}>[^<]{0,10}([A-Z][^<]{2,50}(?:,\s*[A-Z]{2}|remote|hybrid))/i);
  if (locCtxM) return locCtxM[1].trim().slice(0, 80);
  return '';
}

function scoreTitle(title) {
  const tl = title.toLowerCase();
  let score = 0;
  if (/chief operating|\bcoo\b/.test(tl)) score += 4;
  else if (/vp oper|vice president oper|managing director|director of oper|director of strategic/.test(tl)) score += 3;
  else if (/\bdirector\b/.test(tl)) score += 2;
  else if (/\bvp\b|vice president/.test(tl)) score += 2;
  if (/executive director/.test(tl)) score += 2;
  if (/chief of staff/.test(tl)) score += 3;
  if (/rabbi|cantor|teacher|social work|therapist|counsel|philanthrop|chaplain|educator|bookkeeper|accountant/.test(tl)) score -= 4;
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
  diagLog('CRAWL starting...');
  const existing = loadJobBoardLeads();
  const existingUrls = new Set(existing.map(l => l.url));
  diagLog('CRAWL existing leads=' + existing.length + ' unique URLs=' + existingUrls.size);
  const allNew = [];
  const sourceStats = {};

  for (const source of JOB_SOURCES) {
    const srcLeads = [];
    let urlsFound = 0, urlsAttempted = 0, filteredByLocation = 0, filteredByScore = 0;

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
        const rx = new RegExp(source.linkPattern.source, source.linkPattern.flags);
        while ((m = rx.exec(html)) !== null) {
          let u = m[1];
          if (source.baseUrl && (u.startsWith('/') || !u.startsWith('http'))) u = source.baseUrl + (u.startsWith('/') ? '' : '/') + u;
          if (!u.startsWith('http')) continue;
          if (!urls.includes(u) && !existingUrls.has(u)) urls.push(u);
        }
        urlsFound += urls.length;

        for (const jobUrl of urls.slice(0, source.maxPerSearch || 8)) {
          urlsAttempted++;
          try {
            const jr = await fetch(jobUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hopespot/1.0)', 'Accept': 'text/html' },
              signal: AbortSignal.timeout(10000)
            });
            if (!jr.ok) continue;
            const jhtml = await jr.text();

            const titleM = jhtml.match(/<h1[^>]*>([^<]+)<\/h1>/) || jhtml.match(/<title>([^|<\-\u2014]+)/);
            const title = titleM ? titleM[1].replace(/&amp;/g,'&').replace(/&#039;/g,"'").replace(/&ndash;/g,'-').trim() : 'Unknown Role';

            const orgM = jhtml.match(/(?:Employer|Organization|Company|Posted by):\s*([^<\n]{3,80})/)
                       || jhtml.match(/class="[^"]*(?:company|employer|org)[^"]*"[^>]*>([^<]{3,60})/i);
            const organization = orgM ? orgM[1].replace(/<[^>]+>/g,'').trim() : '';

            const location = extractLocation(jhtml);
            const { score, reasons } = scoreTitle(title);
            if (score < 3) { filteredByScore++; await new Promise(r => setTimeout(r, 300)); continue; }

            if (!passesLocationFilter(location)) {
              filteredByLocation++;
              await new Promise(r => setTimeout(r, 300));
              continue;
            }

            const lead = {
              id: source.name.slice(0,2) + '-' + createHash('sha256').update(jobUrl).digest('hex').slice(0,16),
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
              snoozed: false,
            };
            srcLeads.push(lead);
            existingUrls.add(jobUrl);
            await new Promise(r => setTimeout(r, 500));
          } catch(e) { continue; }
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch(e) { console.error(`[${source.name}] search error: ${e.message}`); continue; }
    }

    sourceStats[source.name] = { urlsFound, urlsAttempted, added: srcLeads.length, filteredByLocation, filteredByScore };
    diagLog('CRAWL ' + source.name + ': found=' + urlsFound + ' attempted=' + urlsAttempted + ' added=' + srcLeads.length + ' locFiltered=' + filteredByLocation + ' scoreFiltered=' + filteredByScore);
    allNew.push(...srcLeads);
  }

  if (allNew.length > 0) {
    await new Promise(resolve => {
      withJobBoardLock(() => {
        const all = loadJobBoardLeads();
        all.push(...allNew);
        saveJobBoardLeads(all);
        resolve();
      });
    });
  }
  diagLog('CRAWL complete. Total new leads: ' + allNew.length + ' | Stats: ' + JSON.stringify(sourceStats));
  return { leads: allNew, sourceStats };
}

setInterval(() => {
  try {
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    if (et.getHours() === 6 && et.getMinutes() < 5 && loadCronState().lastRunDate !== todayET()) {
      runDailyCron();
      crawlJobBoards().catch(e => console.error('[crawl cron]', e.message));
    }
  } catch(e) {}
}, 5 * 60 * 1000);

// Migrate existing leads: fix duplicate IDs caused by truncated base64
function migrateLeadIds() {
  const leads = loadJobBoardLeads();
  if (!leads.length) return;
  const seen = new Set();
  let dupes = 0;
  leads.forEach(l => {
    if (seen.has(l.id)) dupes++;
    seen.add(l.id);
  });
  if (dupes === 0) { console.log('[MIGRATE] No duplicate lead IDs found.'); return; }
  console.log('[MIGRATE] Found ' + dupes + ' duplicate IDs. Regenerating all IDs from URLs.');
  leads.forEach(l => {
    if (l.url) {
      const src = (l.source || '').slice(0, 2) || 'xx';
      l.id = src + '-' + createHash('sha256').update(l.url).digest('hex').slice(0, 16);
    }
  });
  saveJobBoardLeads(leads);
  console.log('[MIGRATE] Lead IDs regenerated. ' + leads.length + ' leads updated.');
}

setTimeout(bootCheck, 3000);
setTimeout(bootSeedApplications, 4000);
setTimeout(migrateLeadIds, 2000);
console.log(`HopeSpot v8.0 \u2014 seeds:${readSeed('firms').length}f/${readSeed('ceos').length}c/${readSeed('vcs').length}v`);

const sessions = new Set();
function requireAuth(req, res, next) {
  if (!PASSWORD) return next();
  if (API_KEY) {
    const hk = req.headers['x-api-key'] || (req.headers['authorization']||'').replace('Bearer ','').trim();
    if (hk && hk === API_KEY) return next();
  }
  if (sessions.has(req.headers['x-auth-token'] || req.query.token)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.use(express.json());
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Log ALL job-board requests BEFORE auth — to catch 401 rejections
app.use('/api/job-board', (req, res, next) => {
  const authToken = req.headers['x-auth-token'] || '';
  const apiKey = req.headers['x-api-key'] || '';
  const hasSession = sessions.has(authToken);
  const hasApiKey = API_KEY && apiKey === API_KEY;
  diagLog('PRE-AUTH ' + req.method + ' ' + req.originalUrl + ' auth_token=' + (authToken ? authToken.slice(0,8) + '...' : 'EMPTY') + ' api_key=' + (apiKey ? apiKey.slice(0,8) + '...' : 'EMPTY') + ' session_valid=' + hasSession + ' apikey_valid=' + hasApiKey + ' PASSWORD_SET=' + !!PASSWORD + ' sessions_count=' + sessions.size);
  next();
});

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
  const today = todayET(), due = [];
  PILLARS.forEach(track => {
    getDB(track).forEach(item => {
      if (item.status !== 'contacted') return;
      if (!item.followup_date || item.followup_date > today) return;
      if (item.is_job_search === false || item.is_job_search === 'false') return;
      const c = (item.contacts||[]).filter(c => c.email)[0] || {};
      due.push({ track, org_id: item.id, org_name: orgName(track,item), contact_name: c.name||'', contact_email: c.email||'', followup_date: item.followup_date, last_contacted: item.last_contacted||null, days_since_contact: item.last_contacted ? daysBetween(item.last_contacted) : null, gmail_thread_id: item.gmail_thread_id||null, cadence_day: item.cadence_day||1, notes: item.notes||'', status: item.status });
    });
  });
  loadDynamic().forEach(item => {
    if (item.status !== 'contacted') return;
    if (!item.followup_date || item.followup_date > today) return;
    if (item.is_job_search === false || item.is_job_search === 'false') return;
    due.push({ track: item.track||'ceos', org_id: item.id, org_name: item.org_name||'', contact_name: item.contact_name||'', contact_email: item.contact_email||'', followup_date: item.followup_date, last_contacted: item.last_contacted||null, days_since_contact: item.last_contacted ? daysBetween(item.last_contacted) : null, gmail_thread_id: item.gmail_thread_id||null, cadence_day: item.cadence_day||1, notes: item.notes||'', status: item.status, dynamic: true });
  });
  due.sort((a,b) => (a.followup_date||'').localeCompare(b.followup_date||''));
  res.json(due);
});

app.get('/api/contacts', requireAuth, (req, res) => { const c = loadDynamic(); const { track } = req.query; res.json(track ? c.filter(x => x.track === track) : c); });
app.post('/api/contacts/import', requireAuth, (req, res) => {
  const entries = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Expected array' });
  const contacts = loadDynamic();
  let inserted = 0, updated = 0;
  entries.forEach(entry => {
    if (!entry.contact_email) return;
    const idx = contacts.findIndex(c => c.contact_email && c.contact_email.toLowerCase() === entry.contact_email.toLowerCase());
    if (idx >= 0) { contacts[idx] = { ...contacts[idx], ...entry, id: contacts[idx].id }; updated++; }
    else { contacts.push({ id: randomUUID(), ...entry }); inserted++; }
  });
  saveDynamic(contacts);
  res.json({ ok: true, inserted, updated, total: contacts.length });
});
app.patch('/api/contacts/:id', requireAuth, (req, res) => {
  const contacts = loadDynamic(), idx = contacts.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  contacts[idx] = { ...contacts[idx], ...req.body, id: contacts[idx].id };
  saveDynamic(contacts);
  res.json(contacts[idx]);
});

// --- APPLICATIONS ---
app.get('/api/applications', requireAuth, (req, res) => res.json(loadApplications().sort((a,b) => (b.applied_date||'').localeCompare(a.applied_date||''))));
app.post('/api/applications', requireAuth, (req, res) => {
  const { company, role, source_url, notion_url, notes, applied_date, status } = req.body;
  if (!company || !role) return res.status(400).json({ error: 'company and role required' });
  const today = applied_date || todayET(), fd = new Date(today + 'T12:00:00Z');
  fd.setDate(fd.getDate() + 7);
  const rec = { id: randomUUID(), company, role, applied_date: today, status: status||'queued', source_url: source_url||'', notion_url: notion_url||'', drive_url: '', follow_up_date: fd.toISOString().split('T')[0], last_activity: today, notes: notes||'', activity: [{ date: today, type: status||'queued', note: 'Added to queue' }] };
  const apps = loadApplications(); apps.push(rec); saveApplications(apps);
  res.json(rec);
});
app.patch('/api/applications/:id', requireAuth, (req, res) => {
  const apps = loadApplications(), idx = apps.findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  if (req.body.status && !VALID_APP_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  const today = todayET();
  if (req.body.status && req.body.status !== apps[idx].status) {
    const activity = apps[idx].activity || [];
    activity.push({ date: today, type: req.body.status, note: req.body.activity_note||'' });
    apps[idx].activity = activity;
  }
  apps[idx] = { ...apps[idx], ...req.body, id: apps[idx].id, last_activity: today };
  delete apps[idx].activity_note;
  saveApplications(apps);
  res.json(apps[idx]);
});
app.delete('/api/applications/:id', requireAuth, (req, res) => {
  const apps = loadApplications(), idx = apps.findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  apps.splice(idx, 1); saveApplications(apps);
  res.json({ ok: true });
});
app.post('/api/applications/email-sync', requireAuth, (req, res) => {
  const matches = req.body.matches||[];
  if (!matches.length) return res.json({ ok: true, changed: 0 });
  const apps = loadApplications(); let changed = 0;
  matches.forEach(({ id, status, note, date }) => {
    const idx = apps.findIndex(a => a.id === id); if (idx < 0) return;
    const actDate = date || todayET();
    if (status && VALID_APP_STATUSES.includes(status) && status !== apps[idx].status) apps[idx].status = status;
    (apps[idx].activity = apps[idx].activity||[]).push({ date: actDate, type: status||'note', note: note||'' });
    apps[idx].last_activity = actDate; changed++;
  });
  saveApplications(apps); res.json({ ok: true, changed });
});

// --- COVER LETTER ---
app.get('/api/applications/:id/cover-letter', requireAuth, (req, res) => {
  const apps = loadApplications();
  const appRecord = apps.find(a => a.id === req.params.id);
  if (!appRecord) return res.status(404).send('Application not found.');
  if (!appRecord.cover_letter_text) return res.status(404).send('No cover letter generated yet.');
  const letterText = cleanCoverLetterText(appRecord.cover_letter_text);
  const paragraphs = letterText.split(/\n{2,}/).map(p => p.replace(/\n/g, ' ').trim()).filter(p => p.length > 0);
  const paragraphsHtml = paragraphs.map(p => `<p>${p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`).join('\n');
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const companyEsc = (appRecord.company||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${companyEsc} Cover Letter</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;font-size:12pt;color:#000;background:#fff}.page{max-width:8in;margin:0 auto;padding:1in}.header{text-align:center;margin-bottom:32pt}.header h1{font-size:14pt;font-weight:bold;letter-spacing:1px;margin-bottom:6pt}.header .contact{font-size:10pt;color:#333}.date{margin-bottom:10pt}.company{margin-bottom:24pt}p{margin-bottom:12pt;line-height:1.6;text-align:justify}.no-print{position:fixed;top:16px;right:16px;padding:10px 20px;background:#1f2d3d;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-family:sans-serif}@media print{.no-print{display:none}body{font-size:12pt}.page{padding:0;max-width:100%}@page{margin:1in;size:letter}}</style></head><body><button class="no-print" onclick="window.print()">Print / Save as PDF</button><div class="page"><div class="header"><h1>EVERETT STEELE</h1><div class="contact">everett.steele@gmail.com &nbsp;|&nbsp; 678.899.3971 &nbsp;|&nbsp; linkedin.com/in/everettsteeleATL &nbsp;|&nbsp; Atlanta, GA</div></div><div class="date">${dateStr}</div><div class="company">${companyEsc}</div>${paragraphsHtml}</div><script>window.addEventListener('load',function(){setTimeout(function(){window.print();},400);});<\/script></body></html>`;
  res.set('Content-Type','text/html; charset=utf-8').set('Cache-Control','no-store').send(html);
});

// --- BATCH PACKAGES ---
app.post('/api/applications/batch-packages', requireAuth, async (req, res) => {
  const webhookUrl = process.env.DRIVE_WEBHOOK_URL;
  if (!webhookUrl) return res.status(503).json({ error: 'DRIVE_WEBHOOK_URL not configured' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  const apps = loadApplications();
  const targets = apps.filter(a => a.status === 'queued' && (!a.cover_letter_text || !a.drive_url));
  if (!targets.length) return res.json({ ok: true, built: 0, message: 'All queued applications already have complete packages' });
  diagLog('BATCH-PKG starting for ' + targets.length + ' apps: ' + targets.map(a => a.company).join(', '));
  res.json({ ok: true, queued: targets.length, message: `Building packages for ${targets.length} applications in background. Check back in 2-3 minutes.` });
  setImmediate(async () => {
    let built = 0, failed = 0;
    for (const appRec of targets) {
      try {
        diagLog('BATCH-PKG processing: ' + appRec.company + ' (id=' + appRec.id + ')');
        const allApps = loadApplications();
        const idx = allApps.findIndex(a => a.id === appRec.id);
        if (idx < 0) { diagLog('BATCH-PKG app not found: ' + appRec.id); continue; }
        const today = todayET();
        let coverLetter = allApps[idx].cover_letter_text;
        let jdText = '';
        // Phase 1: Generate cover letter if missing
        if (!coverLetter) {
          diagLog('BATCH-PKG generating cover letter for ' + appRec.company);
          jdText = await fetchJobDescription(appRec.source_url);
          if (!jdText || jdText.length < 50) jdText = `Position: ${appRec.role} at ${appRec.company}. ${appRec.notes || ''}`.trim();
          coverLetter = await generateCoverLetterForApp(appRec, jdText);
          if (!coverLetter || coverLetter.length < 50) { diagLog('BATCH-PKG cover letter generation failed for ' + appRec.company); failed++; continue; }
          allApps[idx].cover_letter_text = coverLetter;
          allApps[idx].last_activity = today;
          diagLog('BATCH-PKG cover letter generated for ' + appRec.company + ' (' + coverLetter.length + ' chars)');
        } else {
          diagLog('BATCH-PKG cover letter exists for ' + appRec.company);
        }
        // Phase 2: Select resume variant + create Drive folder if missing
        if (!allApps[idx].drive_url) {
          if (!jdText) {
            jdText = await fetchJobDescription(appRec.source_url);
            if (!jdText || jdText.length < 50) jdText = `Position: ${appRec.role} at ${appRec.company}. ${appRec.notes || ''}`.trim();
          }
          diagLog('BATCH-PKG selecting variant for ' + appRec.company + ' (jd=' + jdText.length + ' chars)');
          const variant = await selectResumeVariant(appRec, jdText);
          allApps[idx].resume_variant = variant;
          diagLog('BATCH-PKG variant=' + variant + ' for ' + appRec.company + ', calling webhook...');
          if (!webhookUrl) { diagLog('BATCH-PKG NO WEBHOOK URL'); } else {
            try {
              const response = await postToAppsScript(webhookUrl, { folderName: `${appRec.company} - ${appRec.role}`, variant, coverLetterText: coverLetter, company: appRec.company, role: appRec.role });
              const text = await response.text();
              diagLog('BATCH-PKG webhook response for ' + appRec.company + ': ' + text.slice(0, 300));
              let result; try { result = JSON.parse(text); } catch(e) { result = null; }
              if (result && result.ok) {
                const folderUrl = result.folderUrl || result.driveUrl || result.url || result.folder_url || '';
                if (folderUrl) {
                  allApps[idx].drive_url = folderUrl;
                  allApps[idx].drive_folder_id = result.folderId || '';
                  (allApps[idx].activity = allApps[idx].activity||[]).push({ date: today, type: 'package_created', note: variant + ' package: ' + folderUrl });
                  diagLog('BATCH-PKG drive folder created for ' + appRec.company + ': ' + folderUrl);
                } else {
                  diagLog('BATCH-PKG webhook ok but no folderUrl in response for ' + appRec.company);
                }
              } else {
                diagLog('BATCH-PKG webhook failed for ' + appRec.company + ': ' + (result ? JSON.stringify(result) : 'non-JSON response'));
              }
            } catch(driveErr) { diagLog('BATCH-PKG webhook error for ' + appRec.company + ': ' + driveErr.message); }
          }
        } else {
          diagLog('BATCH-PKG drive_url exists for ' + appRec.company + ': ' + allApps[idx].drive_url);
        }
        saveApplications(allApps);
        built++;
        await new Promise(r => setTimeout(r, 2000));
      } catch(err) { diagLog('BATCH-PKG EXCEPTION for ' + appRec.company + ': ' + err.message); failed++; }
    }
    diagLog('BATCH-PKG complete. Built: ' + built + ', Failed: ' + failed);
  });
});

app.post('/api/create-drive-package', requireAuth, async (req, res) => {
  const { app_id, variant, cover_letter_text, company, role } = req.body;
  if (!app_id || !variant || !cover_letter_text) return res.status(400).json({ error: 'app_id, variant, and cover_letter_text required' });
  const webhookUrl = process.env.DRIVE_WEBHOOK_URL;
  if (!webhookUrl) return res.status(503).json({ error: 'DRIVE_WEBHOOK_URL not configured.' });
  const apps = loadApplications(), idx = apps.findIndex(a => a.id === app_id);
  if (idx < 0) return res.status(404).json({ error: 'Application not found' });
  const ar = apps[idx];
  try {
    const response = await postToAppsScript(webhookUrl, { folderName: (company||ar.company)+' - '+(role||ar.role), variant, coverLetterText: cover_letter_text, company: company||ar.company, role: role||ar.role });
    const text = await response.text();
    let result; try { result = JSON.parse(text); } catch(e) { return res.status(500).json({ error: 'Apps Script non-JSON: '+text.slice(0,100) }); }
    if (!result.ok) return res.status(500).json({ error: result.error||'Drive webhook failed' });
    const today = todayET();
    apps[idx].drive_url = result.folderUrl; apps[idx].drive_folder_id = result.folderId; apps[idx].last_activity = today;
    (apps[idx].activity = apps[idx].activity||[]).push({ date: today, type: 'package_created', note: 'Drive: '+result.folderUrl });
    saveApplications(apps);
    res.json({ ok: true, folderUrl: result.folderUrl, folderId: result.folderId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// --- JOB BOARD ---
// GET: only 'new' leads. Skipped/snagged never come back through re-render.
app.get('/api/job-board', requireAuth, (req, res) => {
  const leads = loadJobBoardLeads(), { status } = req.query;
  const statusCounts = {};
  leads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status]||0) + 1; });
  diagLog('GET /api/job-board query_status=' + (status||'(default=new)') + ' total=' + leads.length + ' counts=' + JSON.stringify(statusCounts));
  const filtered = status ? leads.filter(l => l.status === status) : leads.filter(l => l.status === 'new');
  res.json(filtered.sort((a,b) => (b.fit_score - a.fit_score) || b.date_found.localeCompare(a.date_found)));
});

// PATCH single lead — serialized through write lock.
app.patch('/api/job-board/:id', requireAuth, (req, res) => {
  diagLog('PATCH id=' + req.params.id + ' body=' + JSON.stringify(req.body));
  withJobBoardLock(() => {
    const leads = loadJobBoardLeads();
    diagLog('PATCH-LOCK loaded ' + leads.length + ' leads, searching for id=' + req.params.id);
    const idx = leads.findIndex(l => l.id === req.params.id);
    if (idx < 0) {
      diagLog('PATCH-LOCK NOT FOUND id=' + req.params.id + ' sample_ids=' + JSON.stringify(leads.slice(0,3).map(l => l.id)));
      res.status(404).json({ error: 'Not found' });
      return;
    }
    diagLog('PATCH-LOCK found idx=' + idx + ' cur_status=' + leads[idx].status + ' new_status=' + req.body.status);
    leads[idx] = { ...leads[idx], ...req.body, id: leads[idx].id };
    const saved = saveJobBoardLeads(leads);
    diagLog('PATCH-LOCK saved=' + saved);
    if (!saved) { res.status(500).json({ error: 'Save failed' }); return; }
    res.json(leads[idx]);
  });
});

// BATCH UPDATE — updates multiple leads in one atomic write.
app.post('/api/job-board/batch-update', requireAuth, (req, res) => {
  const updates = req.body.updates;
  diagLog('BATCH-UPDATE received ' + (Array.isArray(updates) ? updates.length : 0) + ' updates: ' + JSON.stringify(updates));
  if (!Array.isArray(updates) || !updates.length) return res.status(400).json({ error: 'updates array required' });
  withJobBoardLock(() => {
    const leads = loadJobBoardLeads();
    const results = [];
    updates.forEach(({ id, status, ...rest }) => {
      const idx = leads.findIndex(l => l.id === id);
      if (idx < 0) { diagLog('BATCH-UPDATE id=' + id + ' NOT FOUND'); return; }
      diagLog('BATCH-UPDATE idx=' + idx + ' id=' + id + ' from=' + leads[idx].status + ' to=' + status);
      leads[idx] = { ...leads[idx], ...rest, status, id: leads[idx].id };
      results.push(leads[idx]);
    });
    const saved = saveJobBoardLeads(leads);
    diagLog('BATCH-UPDATE saved=' + saved + ' updated=' + results.length);
    if (!saved) { res.status(500).json({ error: 'Save failed' }); return; }
    res.json({ ok: true, updated: results.length });
  });
});

// SNAG — serialized through write lock.
app.post('/api/job-board/snag', requireAuth, (req, res) => {
  const { lead_id } = req.body;
  diagLog('SNAG lead_id=' + lead_id);
  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });
  withJobBoardLock(() => {
    const leads = loadJobBoardLeads(), li = leads.findIndex(l => l.id === lead_id);
    diagLog('SNAG-LOCK loaded=' + leads.length + ' findIndex=' + li);
    if (li < 0) { diagLog('SNAG-LOCK NOT FOUND lead_id=' + lead_id); res.status(404).json({ error: 'Lead not found' }); return; }
    const lead = leads[li], today = todayET(), fd = new Date(today + 'T12:00:00Z');
    fd.setDate(fd.getDate() + 7);
    const newApp = { id: randomUUID(), company: lead.organization||lead.title, role: lead.title, applied_date: today, status: 'queued', source_url: lead.url, notion_url: '', drive_url: '', follow_up_date: fd.toISOString().split('T')[0], last_activity: today, notes: 'Snagged from '+(lead.source_label||lead.source)+(lead.location?' \u00b7 '+lead.location:''), activity: [{ date: today, type: 'queued', note: 'Snagged from '+(lead.source_label||lead.source) }] };
    const apps = loadApplications(); apps.push(newApp);
    const appSaved = saveApplications(apps);
    if (!appSaved) { res.status(500).json({ error: 'Failed to save application' }); return; }
    leads[li].status = 'snagged'; leads[li].snagged_app_id = newApp.id;
    const leadSaved = saveJobBoardLeads(leads);
    if (!leadSaved) { res.status(500).json({ error: 'Failed to update lead status' }); return; }
    res.json({ ok: true, application: newApp });
  });
});

// CRAWL — async, responds immediately.
app.post('/api/job-board/crawl', requireAuth, (req, res) => {
  res.json({ ok: true, message: 'Crawl running in background. Check back in 2-3 minutes.' });
  crawlJobBoards().then(r => console.log(`[crawl] Done. Added ${r.leads.length} new leads.`)).catch(e => console.error('[crawl error]', e.message));
});

// --- NETWORKING ---
app.get('/api/networking/events', requireAuth, (req, res) => {
  const events = loadNetworking();
  const { days, include_hidden } = req.query;
  const pool = include_hidden === 'true' ? events : events.filter(e => !e.hidden);
  if (days) { const cutoff = daysAgoStr(parseInt(days)); return res.json(pool.filter(e => e.start_date >= cutoff).sort((a,b) => b.start_date.localeCompare(a.start_date))); }
  res.json(pool.sort((a,b) => b.start_date.localeCompare(a.start_date)));
});
app.post('/api/networking/events', requireAuth, (req, res) => {
  const { title, start_date, start_time, end_time, location, type, notes, contacts, next_steps } = req.body;
  if (!title || !start_date) return res.status(400).json({ error: 'title and start_date required' });
  const event = { id: randomUUID(), source: 'manual', external_id: null, title, start_date, start_time: start_time||'', end_time: end_time||'', location: location||'', attendees: [], notes: notes||'', contacts: contacts||[], next_steps: next_steps||[], type: type||'other', hidden: false, follow_up_sent: false, created_at: todayET() };
  const events = loadNetworking(); events.push(event); saveNetworking(events);
  res.json(event);
});
app.patch('/api/networking/events/:id', requireAuth, (req, res) => {
  const events = loadNetworking(), idx = events.findIndex(e => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  events[idx] = { ...events[idx], ...req.body, id: events[idx].id }; saveNetworking(events);
  res.json(events[idx]);
});
app.delete('/api/networking/events/:id', requireAuth, (req, res) => {
  const events = loadNetworking(), idx = events.findIndex(e => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  events.splice(idx, 1); saveNetworking(events);
  res.json({ ok: true });
});
app.post('/api/networking/calendar-sync', requireAuth, (req, res) => {
  let incoming = req.body.events || [];
  if (!incoming.length) return res.json({ ok: true, added: 0, updated: 0, filtered: 0 });
  const calCfg = loadCalConfig();
  let filtered = 0;
  if (calCfg.setup_complete && calCfg.whitelisted_calendar_ids.length > 0) {
    const before = incoming.length;
    incoming = incoming.filter(ev => !ev.calendar_id || calCfg.whitelisted_calendar_ids.includes(ev.calendar_id));
    filtered = before - incoming.length;
  }
  const events = loadNetworking();
  const extIds = new Set(events.filter(e => e.external_id).map(e => e.external_id));
  let added = 0, updated = 0;
  incoming.forEach(ev => {
    if (!ev.title || !ev.start_date) return;
    if (ev.external_id && extIds.has(ev.external_id)) {
      const idx = events.findIndex(e => e.external_id === ev.external_id);
      if (idx >= 0) { events[idx] = { ...events[idx], title: ev.title, start_date: ev.start_date, start_time: ev.start_time||events[idx].start_time||'', end_time: ev.end_time||events[idx].end_time||'', location: ev.location||events[idx].location||'', attendees: ev.attendees||events[idx].attendees||[] }; updated++; }
    } else {
      events.push({ id: randomUUID(), source: 'google_calendar', external_id: ev.external_id||null, calendar_id: ev.calendar_id||null, calendar_name: ev.calendar_name||null, title: ev.title, start_date: ev.start_date, start_time: ev.start_time||'', end_time: ev.end_time||'', location: ev.location||'', attendees: ev.attendees||[], notes: '', contacts: [], next_steps: [], type: 'other', hidden: false, follow_up_sent: false, created_at: todayET() });
      if (ev.external_id) extIds.add(ev.external_id);
      added++;
    }
  });
  saveNetworking(events);
  res.json({ ok: true, added, updated, filtered });
});
app.get('/api/networking/calendar-config', requireAuth, (req, res) => res.json(loadCalConfig()));
app.post('/api/networking/calendar-config', requireAuth, (req, res) => {
  const config = loadCalConfig();
  const { whitelisted_calendar_ids, whitelisted_calendar_names, setup_complete } = req.body;
  if (whitelisted_calendar_ids !== undefined) config.whitelisted_calendar_ids = whitelisted_calendar_ids;
  if (whitelisted_calendar_names !== undefined) config.whitelisted_calendar_names = whitelisted_calendar_names;
  if (setup_complete !== undefined) config.setup_complete = setup_complete;
  saveCalConfig(config);
  res.json({ ok: true, config });
});

app.get('/api/morning-sync/status', requireAuth, (req, res) => {
  const today = todayET();
  const apps = loadApplications();
  const needsPackage = apps.filter(a => a.status === 'queued' && !a.drive_url).map(a => ({ id: a.id, company: a.company, role: a.role, source_url: a.source_url, notion_url: a.notion_url, notes: a.notes }));
  const appFollowUps = apps.filter(a => a.follow_up_date && a.follow_up_date <= today && !['rejected','withdrawn','offer'].includes(a.status)).map(a => ({ id: a.id, company: a.company, role: a.role, status: a.status, follow_up_date: a.follow_up_date }));
  const leads = loadJobBoardLeads();
  const newLeads = leads.filter(l => l.status === 'new');
  const events = loadNetworking();
  const cutoff14 = daysAgoStr(14);
  const overdueNextSteps = events.filter(e => !e.hidden).flatMap(e => (e.next_steps||[]).filter(ns => !ns.done && ns.due_date && ns.due_date <= today).map(ns => ({ eventId: e.id, eventTitle: e.title, step: ns.text, due: ns.due_date })));
  const eventsNoNotes = events.filter(e => !e.hidden && e.start_date >= cutoff14 && e.start_date <= today && !(e.notes||'').trim()).map(e => ({ id: e.id, title: e.title, start_date: e.start_date }));
  const allItems = PILLARS.flatMap(k => getDB(k));
  const draftsQueued = allItems.filter(x => x.status === 'draft').length;
  const dueCount = (() => { let n = 0; PILLARS.forEach(track => { getDB(track).forEach(item => { if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) n++; }); }); loadDynamic().forEach(item => { if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) n++; }); return n; })();
  const calConfig = loadCalConfig();
  res.json({ today, needsPackage, appFollowUps, newJobLeads: newLeads.length, topLeads: newLeads.slice(0,3).map(l => ({ id: l.id, title: l.title, organization: l.organization, fit_score: l.fit_score, source_label: l.source_label, url: l.url })), networking: { overdueNextSteps: overdueNextSteps.length, overdueItems: overdueNextSteps.slice(0,5), eventsNoNotes }, outreach: { draftsQueued, dueFollowUps: dueCount }, calendarConfig: { setup_complete: calConfig.setup_complete, whitelisted_count: calConfig.whitelisted_calendar_ids.length, whitelisted_names: calConfig.whitelisted_calendar_names }, cronState: loadCronState() });
});

let lastCronRunCall = 0;
app.post('/api/cron/run', requireAuth, (req, res) => {
  if (Date.now() - lastCronRunCall < 60000) return res.status(429).json({ error: 'Rate limited.' });
  lastCronRunCall = Date.now();
  res.json({ ok: true, ...runDailyCron() });
});
app.post('/api/mark-drafts-sent', requireAuth, (req, res) => {
  const today = todayET(), fd = new Date(today + 'T12:00:00Z');
  fd.setDate(fd.getDate() + 7);
  const followupDate = fd.toISOString().split('T')[0];
  let marked = 0;
  const ov = loadOverrides();
  PILLARS.forEach(key => {
    if (!ov[key]) ov[key] = {};
    getDB(key).forEach(item => {
      if (item.status !== 'draft') return;
      ov[key][String(item.id)] = { ...(ov[key][String(item.id)]||{}), status: 'contacted', last_contacted: today, followup_date: followupDate };
      marked++;
    });
  });
  saveOverrides(ov);
  res.json({ ok: true, marked });
});
app.post('/api/gmail-sync', requireAuth, (req, res) => {
  const emails = req.body.emails||[];
  if (!emails.length) return res.json({ ok: true, changed: 0 });
  const updates = emails.map(({ email, sent_date }) => { const base = sent_date || todayET(), d = new Date(base + 'T12:00:00Z'); d.setDate(d.getDate() + 7); return { email: email.toLowerCase().trim(), status: 'contacted', last_contacted: base, followup_date: d.toISOString().split('T')[0] }; });
  let changed = 0;
  const ov = loadOverrides();
  PILLARS.forEach(key => { readSeed(key).forEach(item => { (item.contacts||[]).forEach(c => { const match = updates.find(u => u.email === (c.email||'').toLowerCase().trim()); if (!match) return; if (!ov[key]) ov[key] = {}; const upd = { ...(ov[key][String(item.id)]||{}) }; upd.status = match.status; upd.last_contacted = match.last_contacted; upd.followup_date = match.followup_date; ov[key][String(item.id)] = upd; changed++; }); }); });
  saveOverrides(ov);
  res.json({ ok: true, changed });
});

app.get('/api/debug', (req, res) => {
  const ov = loadOverrides(), today = todayET();
  let dueCount = 0;
  PILLARS.forEach(track => { getDB(track).forEach(item => { if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) dueCount++; }); });
  loadDynamic().forEach(item => { if (item.status === 'contacted' && item.followup_date && item.followup_date <= today && item.is_job_search !== false) dueCount++; });
  let dataWritable = false;
  try { const t = path.join(DATA_DIR, '.write_test'); fs.writeFileSync(t, 'ok'); fs.unlinkSync(t); dataWritable = true; } catch(e) {}
  const apps = loadApplications(), jb = loadJobBoardLeads(), net = loadNetworking(), calCfg = loadCalConfig();
  const overdueSteps = net.filter(e=>!e.hidden).reduce((n, e) => n + (e.next_steps||[]).filter(ns => !ns.done && ns.due_date && ns.due_date <= today).length, 0);
  res.json({ version: '8.0', dataWritable, dataDir: DATA_DIR, applicationCount: apps.length, applicationsByStatus: apps.reduce((acc,a) => { acc[a.status]=(acc[a.status]||0)+1; return acc; }, {}), applicationsWithCoverLetter: apps.filter(a => a.cover_letter_text).length, jobBoardLeads: jb.length, jobBoardNew: jb.filter(l => l.status==='new').length, jobBoardReviewed: jb.filter(l => l.status==='reviewed').length, jobBoardSnagged: jb.filter(l => l.status==='snagged').length, driveConfigured: !!process.env.DRIVE_WEBHOOK_URL, anthropicConfigured: !!process.env.ANTHROPIC_API_KEY, dueCount, cronState: loadCronState(), todayET: today });
});

const SECTOR_EXCLUDE_FROM_TABLE = new Set(['network']);
app.get('/api/stats', requireAuth, (req, res) => {
  const firms = getDB('firms'), ceos = getDB('ceos'), vcs = getDB('vcs');
  function seg(arr, label) { return { label, total: arr.length, contacted: arr.filter(x => ['contacted','in conversation'].includes(x.status)).length, drafts: arr.filter(x => x.status==='draft').length, conv: arr.filter(x => x.status==='in conversation').length, bounced: arr.filter(x => x.status==='bounced'||(x.contacts||[]).some(c=>c.status==='bounced')).length, responseRate: 0 }; }
  const allItems = [...firms.map(x=>({...x,_key:'firms'})),...ceos.map(x=>({...x,_key:'ceos'})),...vcs.map(x=>({...x,_key:'vcs'}))];
  const segs = [seg(firms,'Recruiters'), seg(ceos,'Direct CEO'), seg(vcs,'VC Firms')];
  segs.forEach(s => { s.responseRate = s.contacted > 0 ? Math.round((s.conv/s.contacted)*100) : 0; });
  const byDate = {};
  allItems.forEach(item => { if (!item.last_contacted) return; const d = item.last_contacted; if (!byDate[d]) byDate[d] = { recruiters:0, ceos:0, vcs:0, total:0 }; if (['contacted','in conversation'].includes(item.status)) { if (item._key==='firms') byDate[d].recruiters++; if (item._key==='ceos') byDate[d].ceos++; if (item._key==='vcs') byDate[d].vcs++; byDate[d].total++; } });
  const SECTOR_MAP = { healthtech:'Healthtech', revenue_gtm:'Revenue/GTM', analytics:'Analytics', fintech:'FinTech', vertical_saas:'Vertical SaaS', general:'General SaaS', network:'Network' };
  const sBuckets = {};
  ceos.forEach(item => { const s = item.sector||'general'; if (!sBuckets[s]) sBuckets[s] = []; sBuckets[s].push(item); });
  const sectorStats = Object.entries(sBuckets).filter(([s]) => !SECTOR_EXCLUDE_FROM_TABLE.has(s)).map(([sector, items]) => { const sent = items.filter(x=>['contacted','in conversation','bounced'].includes(x.status)).length, replies = items.filter(x=>x.status==='in conversation').length, bounced = items.filter(x=>x.status==='bounced'||(x.contacts||[]).some(c=>c.status==='bounced')).length; return { sector, label: SECTOR_MAP[sector]||sector, sent, replies, bounced, replyRate: sent>0?Math.round((replies/sent)*100):0 }; }).sort((a,b) => b.sent-a.sent);
  const tBuckets = {};
  ceos.forEach(item => { const v = item.template_version||'v1'; if (!tBuckets[v]) tBuckets[v] = []; tBuckets[v].push(item); });
  const templateStats = Object.entries(tBuckets).map(([version, items]) => { const sent = items.filter(x=>['contacted','in conversation','bounced'].includes(x.status)).length, replies = items.filter(x=>x.status==='in conversation').length, bounced = items.filter(x=>x.status==='bounced'||(x.contacts||[]).some(c=>c.status==='bounced')).length; return { version, sent, replies, bounced, replyRate: sent>0?Math.round((replies/sent)*100):0 }; }).sort((a,b) => a.version.localeCompare(b.version));
  const todayStr = todayET(), cutoffDate = new Date(todayStr + 'T12:00:00-05:00');
  cutoffDate.setDate(cutoffDate.getDate() - 6);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];
  let totalRecent = 0;
  Object.entries(byDate).forEach(([d, v]) => { if (d >= cutoffStr) totalRecent += v.total; });
  const dailyAvg7 = Math.round(totalRecent / 7);
  res.json({ segments: segs, daily: Object.entries(byDate).sort(([a],[b])=>a>b?1:-1).map(([date,counts])=>({date,...counts})), totals: { contacted: allItems.filter(x=>['contacted','in conversation'].includes(x.status)).length, inConversation: allItems.filter(x=>x.status==='in conversation').length, drafts: allItems.filter(x=>x.status==='draft').length, bounced: allItems.filter(x=>x.status==='bounced').length, total: allItems.length }, sectorStats, templateStats, slaStats: { target: SLA_TARGET, dailyAvg7, onTrack: dailyAvg7 >= SLA_TARGET } });
});

const VALID_STATUSES = ['not contacted','draft','linkedin','contacted','in conversation','bounced','passed'];
const EXTENDED_FIELDS = ['status','notes','followup_date','is_job_search','gmail_thread_id','cadence_day','last_contacted'];
function makePatch(key) {
  return (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Invalid body' });
      if (req.body.status !== undefined && !VALID_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
      const id = parseInt(req.params.id), item = readSeed(key).find(x => x.id === id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      const ov = loadOverrides(); if (!ov[key]) ov[key] = {};
      const upd = { ...(ov[key][String(id)]||{}) };
      EXTENDED_FIELDS.forEach(k => { if (req.body[k] !== undefined) upd[k] = req.body[k]; });
      if (req.body.status && !['not contacted','draft'].includes(req.body.status) && !req.body.last_contacted) upd.last_contacted = todayET();
      ov[key][String(id)] = upd; saveOverrides(ov);
      res.json({ ...item, ...upd });
    } catch(e) { res.status(500).json({ error: e.message }); }
  };
}
app.patch('/api/firms/:id', requireAuth, makePatch('firms'));
app.patch('/api/ceos/:id',  requireAuth, makePatch('ceos'));
app.patch('/api/vcs/:id',   requireAuth, makePatch('vcs'));
app.post('/api/reseed', requireAuth, (req, res) => { saveOverrides({ firms:{}, ceos:{}, vcs:{} }); res.json({ ok: true }); });
app.post('/api/sync', requireAuth, (req, res) => {
  const updates = req.body.updates||[];
  if (!updates.length) return res.json({ ok: true, changed: 0 });
  let changed = 0;
  const ov = loadOverrides();
  ['firms','ceos','vcs'].forEach(key => { readSeed(key).forEach(item => { (item.contacts||[]).forEach(c => { const match = updates.find(u => u.email && c.email && u.email.toLowerCase() === c.email.toLowerCase()); if (!match) return; if (!ov[key]) ov[key] = {}; const upd = { ...(ov[key][String(item.id)]||{}) }; if (match.status) upd.status = match.status; if (match.note) { const ts = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'}); upd.notes = upd.notes ? upd.notes+'\n['+ts+'] '+match.note : '['+ts+'] '+match.note; } ['gmail_thread_id','followup_date','cadence_day','is_job_search'].forEach(f => { if (match[f] !== undefined) upd[f] = match[f]; }); upd.last_contacted = match.last_contacted || todayET(); ov[key][String(item.id)] = upd; changed++; }); }); });
  const dynamic = loadDynamic(); let dc = false;
  dynamic.forEach((item, idx) => { const match = updates.find(u => u.email && item.contact_email && u.email.toLowerCase() === item.contact_email.toLowerCase()); if (!match) return; if (match.status) dynamic[idx].status = match.status; if (match.note) { const ts = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'}); dynamic[idx].notes = dynamic[idx].notes ? dynamic[idx].notes+'\n['+ts+'] '+match.note : '['+ts+'] '+match.note; } ['gmail_thread_id','followup_date','cadence_day','is_job_search'].forEach(f => { if (match[f] !== undefined) dynamic[idx][f] = match[f]; }); dynamic[idx].last_contacted = match.last_contacted || todayET(); changed++; dc = true; });
  if (dc) saveDynamic(dynamic);
  saveOverrides(ov);
  res.json({ ok: true, changed });
});

// Diagnostic: retrieve log ring buffer
app.get('/api/diag/logs', (req, res) => {
  res.json({ count: _diagLogs.length, logs: _diagLogs });
});

// Diagnostic: search leads by title substring
app.get('/api/diag/job-board-search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const leads = loadJobBoardLeads();
  const matches = leads.filter(l => (l.title||'').toLowerCase().includes(q) || (l.organization||'').toLowerCase().includes(q));
  res.json({ query: q, matches: matches.map(l => ({ id: l.id, title: l.title, organization: l.organization, status: l.status, source: l.source, url: l.url })) });
});

// Diagnostic: test job board read-modify-write cycle
app.get('/api/diag/job-board-rwtest', (req, res) => {
  try {
    const leads = loadJobBoardLeads();
    const statusCounts = {};
    leads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status]||0) + 1; });
    const firstNew = leads.find(l => l.status === 'new');
    if (!firstNew) return res.json({ ok: false, error: 'No new leads to test with', total: leads.length, statusCounts, path: JOB_BOARD_PATH });
    // Test write: mark it reviewed
    const testId = firstNew.id;
    const idx = leads.findIndex(l => l.id === testId);
    leads[idx] = { ...leads[idx], status: 'reviewed', _diag_test: true };
    const writeOk = saveJobBoardLeads(leads);
    // Read back
    const readback = loadJobBoardLeads();
    const readbackLead = readback.find(l => l.id === testId);
    const readbackStatus = readbackLead ? readbackLead.status : 'LEAD_MISSING';
    // Revert
    const revertLeads = loadJobBoardLeads();
    const ri = revertLeads.findIndex(l => l.id === testId);
    if (ri >= 0) { delete revertLeads[ri]._diag_test; revertLeads[ri].status = 'new'; saveJobBoardLeads(revertLeads); }
    res.json({ ok: true, testId, writeOk, readbackStatus, persisted: readbackStatus === 'reviewed', total: leads.length, statusCounts, path: JOB_BOARD_PATH, fileExists: fs.existsSync(JOB_BOARD_PATH), fileSizeBytes: fs.existsSync(JOB_BOARD_PATH) ? fs.statSync(JOB_BOARD_PATH).size : 0 });
  } catch(e) { res.json({ ok: false, error: e.message, stack: e.stack }); }
});

app.get('/health', (req, res) => res.json({ ok: true, port: PORT, version: '8.0', todayET: todayET() }));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, '0.0.0.0', () => console.log('HopeSpot v7.8 listening on port ' + PORT));
