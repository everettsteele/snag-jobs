const { createHash } = require('crypto');
const { diagLog, todayET } = require('../utils');
const db = require('../db/store');

// Helper for URL-encoded search queries built from user keywords
function buildSearches(urlTemplate, defaultKeywords) {
  return defaultKeywords.map(kw => urlTemplate.replace('{q}', encodeURIComponent(kw)));
}

const DEFAULT_KEYWORDS = [
  'chief operating officer',
  'vp operations',
  'chief of staff',
  'director of operations',
  'head of operations',
];

const JOB_SOURCES = [
  // ── General boards ───────────────────────────────────────────
  {
    name: 'indeed', label: 'Indeed', category: 'General',
    searches: buildSearches('https://www.indeed.com/jobs?q={q}&l=Atlanta%2C+GA', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/(?:viewjob|rc\/clk)[^"#?\s]+)"/gi,
    baseUrl: 'https://www.indeed.com', maxPerSearch: 8,
  },
  {
    name: 'glassdoor', label: 'Glassdoor', category: 'General',
    searches: buildSearches('https://www.glassdoor.com/Job/jobs.htm?sc.keyword={q}&locT=C&locId=1155583', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/job-listing\/[^"#?\s]+)"/gi,
    baseUrl: 'https://www.glassdoor.com', maxPerSearch: 6,
  },
  {
    name: 'ziprecruiter', label: 'ZipRecruiter', category: 'General',
    searches: buildSearches('https://www.ziprecruiter.com/jobs-search?search={q}&location=Atlanta%2C+GA', DEFAULT_KEYWORDS),
    linkPattern: /href="(https?:\/\/(?:www\.)?ziprecruiter\.com\/jobs\/[^"#?\s]+)"/gi,
    baseUrl: '', maxPerSearch: 6,
  },
  {
    name: 'simplyhired', label: 'SimplyHired', category: 'General',
    searches: buildSearches('https://www.simplyhired.com/search?q={q}&l=Atlanta%2C+GA', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/job\/[^"#?\s]+)"/gi,
    baseUrl: 'https://www.simplyhired.com', maxPerSearch: 6,
  },
  {
    name: 'monster', label: 'Monster', category: 'General',
    searches: buildSearches('https://www.monster.com/jobs/search?q={q}&where=Atlanta%2C+GA', DEFAULT_KEYWORDS),
    linkPattern: /href="(https?:\/\/www\.monster\.com\/job-openings\/[^"#?\s]+)"/gi,
    baseUrl: '', maxPerSearch: 6,
  },
  {
    name: 'careerbuilder', label: 'CareerBuilder', category: 'General',
    searches: buildSearches('https://www.careerbuilder.com/jobs?keywords={q}&location=Atlanta%2C+GA', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/job\/[^"#?\s]+)"/gi,
    baseUrl: 'https://www.careerbuilder.com', maxPerSearch: 6,
  },
  {
    name: 'linkup', label: 'LinkUp', category: 'General',
    searches: buildSearches('https://www.linkup.com/search/?q={q}&location=Atlanta%2C+GA', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/details\/[^"#?\s]+)"/gi,
    baseUrl: 'https://www.linkup.com', maxPerSearch: 6,
  },

  // ── Tech & Startup ────────────────────────────────────────────
  {
    name: 'wellfound', label: 'Wellfound (AngelList)', category: 'Tech/Startup',
    searches: ['https://wellfound.com/role/chief-of-staff', 'https://wellfound.com/role/head-of-operations', 'https://wellfound.com/role/coo'],
    linkPattern: /href="(\/jobs\/\d+[^"#?\s]*)"/gi,
    baseUrl: 'https://wellfound.com', maxPerSearch: 8,
  },
  {
    name: 'ycjobs', label: 'Y Combinator Jobs', category: 'Tech/Startup',
    searches: ['https://www.ycombinator.com/jobs/role/operations-manager', 'https://www.ycombinator.com/jobs/role/chief-of-staff'],
    linkPattern: /href="(\/companies\/[^"#?\s]+\/jobs\/[^"#?\s]+)"/gi,
    baseUrl: 'https://www.ycombinator.com', maxPerSearch: 10,
  },
  {
    name: 'hiringcafe', label: 'Hiring Cafe', category: 'Tech/Startup',
    searches: buildSearches('https://hiring.cafe/?q={q}', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/jobs?\/[^"#?\s]+)"/gi,
    baseUrl: 'https://hiring.cafe', maxPerSearch: 6,
  },
  {
    name: 'builtin', label: 'Built In (national)', category: 'Tech/Startup',
    searches: buildSearches('https://builtin.com/jobs?search={q}&seniority=Senior%20Leadership', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/job\/[^"#?\s]+)"/gi,
    baseUrl: 'https://builtin.com', maxPerSearch: 6,
  },
  {
    name: 'builtinatlanta', label: 'Built In ATL', category: 'Tech/Startup',
    searches: buildSearches('https://builtinatlanta.com/jobs?search={q}&seniority=Senior%20Leadership', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/job\/[^"#?\s]+)"/gi,
    baseUrl: 'https://builtinatlanta.com', maxPerSearch: 8,
  },
  {
    name: 'remoteok', label: 'Remote OK', category: 'Tech/Startup',
    searches: buildSearches('https://remoteok.com/remote-{q}-jobs', ['ops', 'operations', 'chief-of-staff']),
    linkPattern: /href="(\/remote-jobs\/[^"#?\s]+)"/gi,
    baseUrl: 'https://remoteok.com', maxPerSearch: 8,
  },
  {
    name: 'weworkremotely', label: 'We Work Remotely', category: 'Tech/Startup',
    searches: ['https://weworkremotely.com/categories/remote-management-and-finance-jobs'],
    linkPattern: /href="(\/remote-jobs\/[^"#?\s]+)"/gi,
    baseUrl: 'https://weworkremotely.com', maxPerSearch: 10,
  },
  {
    name: 'pallet', label: 'Pallet', category: 'Tech/Startup',
    searches: ['https://pallet.com/jobs?q=operations'],
    linkPattern: /href="(\/jobs?\/[^"#?\s]+)"/gi,
    baseUrl: 'https://pallet.com', maxPerSearch: 6,
  },

  // ── Executive & Leadership ────────────────────────────────────
  {
    name: 'csnetwork', label: 'CoS Network', category: 'Executive',
    searches: ['https://www.chiefofstaff.network/jobs'],
    linkPattern: /href="(\/jobs\/[^"#?\s]{3,}?)"/gi,
    baseUrl: 'https://www.chiefofstaff.network', maxPerSearch: 12,
  },
  {
    name: 'execthread', label: 'ExecThread', category: 'Executive',
    searches: buildSearches('https://execthread.com/search?q={q}', DEFAULT_KEYWORDS),
    linkPattern: /href="((?:https?:\/\/execthread\.com)?\/jobs\/[^"#?\s]{3,}?)"/gi,
    baseUrl: 'https://execthread.com', maxPerSearch: 6,
  },
  {
    name: 'theladders', label: 'The Ladders', category: 'Executive',
    searches: buildSearches('https://www.theladders.com/jobs/search?k={q}&l=Atlanta%2C+GA', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/job\/[^"#?\s]+)"/gi,
    baseUrl: 'https://www.theladders.com', maxPerSearch: 6,
  },
  {
    name: 'chiefexecutive', label: 'Chief Executive Group', category: 'Executive',
    searches: ['https://chiefexecutive.net/jobs/'],
    linkPattern: /href="(https?:\/\/chiefexecutive\.net\/job\/[^"#?\s]+)"/gi,
    baseUrl: '', maxPerSearch: 10,
  },
  {
    name: 'boardsi', label: 'Boardsi', category: 'Executive',
    searches: ['https://boardsi.com/board-positions/'],
    linkPattern: /href="(\/board-positions?\/[^"#?\s]+)"/gi,
    baseUrl: 'https://boardsi.com', maxPerSearch: 8,
  },

  // ── Nonprofit & Mission-Driven ────────────────────────────────
  {
    name: 'idealist', label: 'Idealist', category: 'Nonprofit',
    searches: buildSearches('https://www.idealist.org/en/jobs?q={q}&type=JOB', DEFAULT_KEYWORDS),
    linkPattern: /href="((?:https?:\/\/(?:www\.)?idealist\.org)?\/en\/jobs?\/[^"#?\s]{3,}?)"/gi,
    baseUrl: 'https://www.idealist.org', maxPerSearch: 6,
  },
  {
    name: 'workforgood', label: 'Work for Good', category: 'Nonprofit',
    searches: buildSearches('https://www.workforgood.org/jobs?q={q}', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/jobs?\/[^"#?\s]+)"/gi,
    baseUrl: 'https://www.workforgood.org', maxPerSearch: 6,
  },
  {
    name: 'nonprofitjobs', label: 'Nonprofit Jobs', category: 'Nonprofit',
    searches: buildSearches('https://www.nonprofitjobs.org/search?q={q}', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/jobs?\/[^"#?\s]+)"/gi,
    baseUrl: 'https://www.nonprofitjobs.org', maxPerSearch: 6,
  },
  {
    name: 'dogoodjobs', label: 'Do Good Jobs', category: 'Nonprofit',
    searches: ['https://dogoodjobs.com/jobs/'],
    linkPattern: /href="(\/jobs?\/[^"#?\s]+)"/gi,
    baseUrl: 'https://dogoodjobs.com', maxPerSearch: 6,
  },
  {
    name: 'philanthropynews', label: 'Philanthropy News Digest', category: 'Nonprofit',
    searches: ['https://philanthropynewsdigest.org/jobs'],
    linkPattern: /href="(\/jobs\/[^"#?\s]+)"/gi,
    baseUrl: 'https://philanthropynewsdigest.org', maxPerSearch: 6,
  },

  // ── Government & Civic ────────────────────────────────────────
  {
    name: 'usajobs', label: 'USAJOBS', category: 'Government',
    searches: buildSearches('https://www.usajobs.gov/search/results/?k={q}&l=Atlanta', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/job\/\d+[^"#?\s]*)"/gi,
    baseUrl: 'https://www.usajobs.gov', maxPerSearch: 5,
  },
  {
    name: 'atlantaga', label: 'City of Atlanta', category: 'Government',
    searches: ['https://www.atlantaga.gov/government/career-opportunities'],
    linkPattern: /href="(\/government\/career-opportunities[^"#?\s]*)"/gi,
    baseUrl: 'https://www.atlantaga.gov', maxPerSearch: 5,
  },
  {
    name: 'georgiagov', label: 'State of Georgia', category: 'Government',
    searches: ['https://careers.georgia.gov/jobs'],
    linkPattern: /href="(\/jobs\/[^"#?\s]+)"/gi,
    baseUrl: 'https://careers.georgia.gov', maxPerSearch: 5,
  },

  // ── Niche & Community ─────────────────────────────────────────
  {
    name: 'jewishjobs', label: 'JewishJobs', category: 'Niche',
    searches: ['https://www.jewishjobs.com/search/operations/-/-/true', 'https://www.jewishjobs.com/search/chief-operating-officer/-/-/true', 'https://www.jewishjobs.com/search/director-of-operations/-/-/true'],
    linkPattern: /href="((?:https?:\/\/(?:www\.)?jewishjobs\.com)?\/(?:job|listing|jobs|position)s?(?:-openings?)?(?:\/|$)[^"#?\s]{3,}?)"/gi,
    baseUrl: 'https://www.jewishjobs.com', maxPerSearch: 10,
  },
  {
    name: 'diversityjobs', label: 'Diversity Jobs', category: 'Niche',
    searches: buildSearches('https://www.diversityjobs.com/search?q={q}&l=Atlanta%2C+GA', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/jobs?\/[^"#?\s]+)"/gi,
    baseUrl: 'https://www.diversityjobs.com', maxPerSearch: 6,
  },
  {
    name: 'vetjobs', label: 'VetJobs', category: 'Niche',
    searches: buildSearches('https://vetjobs.com/job-search/?keywords={q}', DEFAULT_KEYWORDS),
    linkPattern: /href="(\/job\/[^"#?\s]+)"/gi,
    baseUrl: 'https://vetjobs.com', maxPerSearch: 6,
  },
  {
    name: 'hireheroes', label: 'HireHeroes USA', category: 'Niche',
    searches: ['https://www.hireheroesusa.org/job-seekers/search-jobs/'],
    linkPattern: /href="(\/job[s]?\/[^"#?\s]+)"/gi,
    baseUrl: 'https://www.hireheroesusa.org', maxPerSearch: 5,
  },
];

const LOCATION_ALLOW = /\batlanta\b|\bgeorgia\b|,\s*GA\b|\bremote\b|\bhybrid\b|distributed|nationwide|flexible|anywhere|work\s*from\s*home|\bwfh\b|u\.?s\.?\s*only|us\s*only/i;
const LOCATION_DENY_STATES = /\bflorida\b|\btexas\b|\bcalifornia\b|\bnew\s*york\b|\billinois\b|\bpennsylvania\b|\bmaryland\b|\bvirginia\b|\bcolorado\b|\bwashington\b|\boregon\b|\bnevada\b|\barizona\b|\butah\b|\bminnesota\b|\bwisconsin\b|\bmissouri\b|\bmichigan\b|\bindiana\b|\bohio\b|\bkentucky\b|\btennessee\b|\bcarolina\b|\bconnecticut\b|\bmassachusetts\b|\bnew\s*jersey\b|\bnew\s*hampshire\b|\brhode\s*island\b|\bvermont\b|\bmaine\b/i;
const LOCATION_DENY_ABBR = /,\s*(?:FL|TX|CA|NY|IL|PA|MD|VA|CO|WA|OR|NV|AZ|UT|MN|WI|MO|MI|IN|OH|KY|TN|NC|SC|CT|MA|NJ|NH|RI|VT|ME|AL|AR|AK|HI|ID|IA|KS|LA|MS|MT|NE|ND|NM|OK|SD|WV|WY|DC)\b/i;
const LOCATION_DENY_CITIES = /\bphiladelphia\b|\bphilly\b|\bnew\s*york\b|\bnyc\b|\bbrooklyn\b|\bmanhattan\b|\bnew\s*jersey\b|\bchicago\b|\bboston\b|\bsan\s*francisco\b|\bseattle\b|\bdenver\b|\bmiami\b|\blos\s*angeles\b|\bportland\b|\bminneapolis\b|\bphoenix\b|\bdallas\b|\bhouston\b|\bnashville\b|\bcharlotte\b|\braleigh\b|washington[\s,]+d\.?c|\bbaltimore\b|\bpittsburgh\b|\bcleveland\b|\bdetroit\b|\bindianapolis\b|kansas\s*city|st\.?\s*louis|\bcolumbus,\s*oh\b|\bcincinnati\b|\bmemphis\b|\bomaha\b|\blas\s*vegas\b|\bsan\s*diego\b|\bsan\s*antonio\b|\bsan\s*jose\b|\btampa\b|\bjacksonville,\s*fl\b|\bmilwaukee\b|\bsacramento\b|salt\s*lake|\blouisville\b|\btucson\b|\baustin,\s*tx\b|\bfresno\b|\borlando\b|\bfort\s*lauderdale\b|\bjacksonville\b|\bboca\s*raton\b|\bst\.?\s*pete\b|\btallahassee\b/i;

// Default location filter (used when no user config)
function passesLocationFilter(location, userConfig) {
  if (!location || location.trim().length < 2) return true;

  // If user has custom allow/deny lists, use those
  if (userConfig?.location_allow?.length) {
    const allowRx = new RegExp(userConfig.location_allow.map(l => `\\b${l}\\b`).join('|'), 'i');
    if (allowRx.test(location)) return true;
  } else {
    // Fallback: always allow remote + default allow list
    if (LOCATION_ALLOW.test(location)) return true;
  }

  if (userConfig?.location_deny?.length) {
    const denyRx = new RegExp(userConfig.location_deny.map(l => `\\b${l}\\b`).join('|'), 'i');
    if (denyRx.test(location)) return false;
  } else {
    if (LOCATION_DENY_CITIES.test(location)) return false;
    if (LOCATION_DENY_ABBR.test(location)) return false;
    if (LOCATION_DENY_STATES.test(location)) return false;
  }
  return true;
}

function extractLocation(html) {
  const jldM = html.match(/"jobLocation"\s*:\s*\{[^}]*"addressLocality"\s*:\s*"([^"]{2,60})"/i);
  if (jldM) { if (/"remote"\s*:\s*true/i.test(html.slice(0, 5000))) return 'Remote'; return jldM[1].trim(); }
  const remoteM = html.match(/<[^>]+(?:class|id)="[^"]*(?:location|workplace|job-location)[^"]*"[^>]*>\s*([^<]{0,60}remote[^<]{0,30})<\/[^>]+>/i) || html.match(/>\s*((?:Fully\s+)?Remote(?:[^<]{0,20})?)<\//i);
  if (remoteM) return remoteM[1].replace(/<[^>]+>/g, '').trim().slice(0, 60);
  if (/hybrid/i.test(html.slice(0, 8000))) { const hybM = html.match(/>([^<]{0,20}hybrid[^<]{0,20})<\//i); if (hybM) return hybM[1].trim().slice(0, 60); }
  const cityM = html.match(/([A-Z][a-zA-Z\s]{1,20},\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC))/);
  if (cityM) return cityM[1].trim();
  const locCtxM = html.match(/(?:location|located|based)[^<]{0,20}>[^<]{0,10}([A-Z][^<]{2,50}(?:,\s*[A-Z]{2}|remote|hybrid))/i);
  if (locCtxM) return locCtxM[1].trim().slice(0, 80);
  return '';
}

// Score based on how closely a job title matches user's target roles.
// Exact phrase match = highest score. Token overlap = partial.
// Seniority signals (chief/vp/head/director) add weight.
function scoreTitle(title, targetRoles) {
  const tl = (title || '').toLowerCase();
  if (!tl) return { score: 0, reasons: [] };

  let score = 0;
  const reasons = [];

  const roles = (targetRoles && targetRoles.length) ? targetRoles : ['chief operating officer', 'vp operations', 'chief of staff', 'director of operations', 'head of operations'];

  // Exact phrase match against any target role = up to 6 points
  for (const r of roles) {
    const rl = r.toLowerCase().trim();
    if (!rl) continue;
    if (tl.includes(rl)) {
      score += 6;
      reasons.push(r);
      break;  // don't double-count for multiple overlapping targets
    }
  }

  // Token-level partial matches: 1 point per shared meaningful token (max 3 pts)
  if (score === 0) {
    const titleTokens = new Set(tl.split(/[^a-z]+/).filter(t => t.length > 2));
    const stop = new Set(['the', 'and', 'for', 'with', 'senior', 'junior', 'level', 'remote', 'hybrid']);
    let tokenHits = 0;
    for (const r of roles) {
      const roleTokens = r.toLowerCase().split(/[^a-z]+/).filter(t => t.length > 2 && !stop.has(t));
      for (const rt of roleTokens) {
        if (titleTokens.has(rt)) tokenHits++;
      }
    }
    if (tokenHits > 0) {
      score += Math.min(3, tokenHits);
      reasons.push('partial match');
    }
  }

  // Seniority boost
  if (/\b(chief|coo|cto|cfo|cpo|ceo|president|svp|vp|vice\s*president|head|director|executive)\b/.test(tl)) {
    score += 2;
    if (!reasons.some(r => /senior/i.test(r))) reasons.push('senior');
  }

  // Penalize clearly-off-target roles
  if (/\b(intern|assistant|coordinator|clerk|receptionist|cashier|driver|nurse|pharmac)/i.test(tl)) {
    score -= 4;
  }

  return { score: Math.max(0, Math.min(score, 10)), reasons };
}

// Crawl a single source with circuit breaker
async function crawlSource(source, existingUrls, userConfig, targetRoles) {
  const srcLeads = [];
  let urlsFound = 0, urlsAttempted = 0, filteredByLocation = 0, filteredByScore = 0;
  let consecutiveFailures = 0;

  for (const searchUrl of source.searches) {
    if (consecutiveFailures >= 3) { diagLog(`CRAWL ${source.name}: circuit breaker tripped after 3 failures`); break; }
    try {
      const resp = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; snag/1.0)', Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(12000),
      });
      if (!resp.ok) { consecutiveFailures++; continue; }
      consecutiveFailures = 0;
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
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; snag/1.0)', Accept: 'text/html' },
            signal: AbortSignal.timeout(10000),
          });
          if (!jr.ok) continue;
          const jhtml = await jr.text();
          const titleM = jhtml.match(/<h1[^>]*>([^<]+)<\/h1>/) || jhtml.match(/<title>([^|<\-\u2014]+)/);
          const title = titleM ? titleM[1].replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&ndash;/g, '-').trim() : 'Unknown Role';
          const orgM = jhtml.match(/(?:Employer|Organization|Company|Posted by):\s*([^<\n]{3,80})/) || jhtml.match(/class="[^"]*(?:company|employer|org)[^"]*"[^>]*>([^<]{3,60})/i);
          const organization = orgM ? orgM[1].replace(/<[^>]+>/g, '').trim() : '';
          const location = extractLocation(jhtml);
          const { score, reasons } = scoreTitle(title, targetRoles);
          const minScore = userConfig?.min_score || 3;
          if (score < minScore) { filteredByScore++; await new Promise(r => setTimeout(r, 300)); continue; }
          if (!passesLocationFilter(location, userConfig)) { filteredByLocation++; await new Promise(r => setTimeout(r, 300)); continue; }
          srcLeads.push({
            id: source.name.slice(0, 2) + '-' + createHash('sha256').update(jobUrl).digest('hex').slice(0, 16),
            source: source.name, source_label: source.label,
            title: title.slice(0, 200), organization: organization.slice(0, 200), location: location.slice(0, 100),
            url: jobUrl, fit_score: score, fit_reason: reasons.join(', ') || 'Senior role',
            date_found: todayET(), status: 'new', snoozed: false,
          });
          existingUrls.add(jobUrl);
          await new Promise(r => setTimeout(r, 500));
        } catch (e) { continue; }
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) { consecutiveFailures++; console.error(`[${source.name}] search error: ${e.message}`); }
  }

  return { name: source.name, leads: srcLeads, stats: { urlsFound, urlsAttempted, added: srcLeads.length, filteredByLocation, filteredByScore } };
}

// Main crawl: run all sources in parallel, scoped to a tenant
// tenantId and userId are required for multi-tenant isolation
async function crawlJobBoards(tenantId, userId) {
  diagLog(`CRAWL starting for tenant=${tenantId} user=${userId}`);

  // Load user's job search config (if available)
  let userConfig = null;
  try {
    userConfig = await db.getJobSearchConfig(userId);
  } catch (e) { /* no config — use defaults */ }

  // Load target roles + fall back to target_geography from profile if no explicit allowlist
  let targetRoles = [];
  try {
    const { query } = require('../db/pool');
    const { rows } = await query(`SELECT target_roles, target_geography FROM user_profiles WHERE user_id = $1`, [userId]);
    if (rows[0]) {
      targetRoles = rows[0].target_roles || [];
      if (userConfig && !userConfig.location_allow?.length && rows[0].target_geography?.length) {
        userConfig = { ...userConfig, location_allow: rows[0].target_geography };
      }
    }
  } catch (e) {}

  // Filter sources by user's enabled list
  const enabledSources = userConfig?.enabled_sources?.length
    ? JOB_SOURCES.filter(s => userConfig.enabled_sources.includes(s.name))
    : JOB_SOURCES;

  // Get existing lead URLs for dedup
  const allStatuses = await db.listJobBoardLeads(tenantId, null);
  const existingUrls = new Set(allStatuses.map(l => l.url));
  diagLog('CRAWL existing leads=' + allStatuses.length + ' unique URLs=' + existingUrls.size);

  // Run all enabled sources in parallel
  // Note: source URLs have default keywords baked in, but scoring uses user's target roles
  const results = await Promise.allSettled(
    enabledSources.map(source => crawlSource(source, existingUrls, userConfig, targetRoles))
  );

  const allNew = [];
  const sourceStats = {};
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { name, leads, stats } = result.value;
      sourceStats[name] = stats;
      allNew.push(...leads);
      diagLog(`CRAWL ${name}: found=${stats.urlsFound} attempted=${stats.urlsAttempted} added=${stats.added} locFiltered=${stats.filteredByLocation} scoreFiltered=${stats.filteredByScore}`);
    } else {
      diagLog(`CRAWL source failed: ${result.reason?.message || result.reason}`);
    }
  }

  // Insert new leads into database, scoped to tenant
  if (allNew.length > 0) {
    const inserted = await db.upsertJobBoardLeads(tenantId, allNew);
    diagLog(`CRAWL inserted ${inserted} new leads into DB`);
  }

  // Log usage
  try { await db.logUsage(tenantId, userId, 'crawl', 0, { sources: enabledSources.length, newLeads: allNew.length }); } catch (e) {}

  diagLog('CRAWL complete. Total new leads: ' + allNew.length);
  return { leads: allNew, sourceStats };
}

module.exports = { crawlJobBoards, JOB_SOURCES };
