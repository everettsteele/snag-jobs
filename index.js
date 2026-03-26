const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'tracker.json');
const PASSWORD = process.env.AUTH_PASSWORD || '';

if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

const sessions = new Set();

const SEED_FIRMS = [
  {
    id: 1, tier: 1, name: 'Bespoke Partners',
    why: 'Top PE-backed SaaS exec search. Places COO/President roles. Exact profile match.',
    status: 'contacted', notes: '', linkedin: 'https://www.linkedin.com/company/bespoke-partners/', website: 'https://bespokepartners.com',
    last_contacted: '2026-03-26', followup_date: '2026-04-02',
    contacts: [
      { id: 1, name: 'Katherine Baker', title: 'Partner, CEO & P&L Practice', email: 'katherine.baker@bespokepartners.com', linkedin: 'https://www.linkedin.com/in/katherinebaker14/', last_contacted: '2026-03-26', status: 'emailed', notes: 'Emailed 3/26. LinkedIn connection sent.' }
    ]
  },
  {
    id: 2, tier: 1, name: 'Talentfoot',
    why: 'SaaS-only exec search. PE-backed sweet spot. Atlanta reach. Strong COO/ops practice.',
    status: 'in conversation', notes: 'Camille responded same day. Connected Everett to colleagues. Flagged President role for March.', linkedin: 'https://www.linkedin.com/company/talentfoot/', website: 'https://talentfoot.com',
    last_contacted: '2026-03-26', followup_date: null,
    contacts: [
      { id: 1, name: 'Camille Fetter', title: 'Founder & CEO', email: 'cfetter@talentfoot.com', linkedin: 'https://www.linkedin.com/in/digitalmarketingrecruiter1/', last_contacted: '2026-03-26', status: 'in conversation', notes: 'Responded same day. Connected to colleagues. Flagged a President role in March. Replied highlighting marketing ownership at ChartRequest.' }
    ]
  },
  {
    id: 3, tier: 1, name: 'Cowen Partners',
    why: 'Forbes Top 100. PE-backed COO specialists. Deep ops practice. Fast time-to-fill.',
    status: 'contacted', notes: '', linkedin: 'https://www.linkedin.com/company/cowen-partners/', website: 'https://cowenpartners.com',
    last_contacted: '2026-03-26', followup_date: '2026-04-02',
    contacts: [
      { id: 1, name: 'Shawn Cole', title: 'President & Founding Partner', email: 'shawn@cowenpartners.com', linkedin: 'https://www.linkedin.com/in/coleshawn', last_contacted: '2026-03-26', status: 'emailed', notes: 'Emailed 3/26. LinkedIn connection sent.' }
    ]
  },
  {
    id: 4, tier: 1, name: 'BSG (Boston Search Group)',
    why: 'Mid-market PE. Builder-leader profile match. SaaS and healthcare tech verticals.',
    status: 'contacted', notes: '', linkedin: 'https://www.linkedin.com/company/bsg-team-ventures/', website: 'https://bostonsearchgroup.com',
    last_contacted: '2026-03-26', followup_date: '2026-04-02',
    contacts: [
      { id: 1, name: 'Clark Waterfall', title: 'Founder & Managing Director', email: 'cwaterfall@bostonsearchgroup.com', linkedin: 'https://www.linkedin.com/in/clarkwaterfall', last_contacted: '2026-03-26', status: 'emailed', notes: 'Emailed 3/26. LinkedIn connection sent.' }
    ]
  },
  {
    id: 5, tier: 1, name: 'Bloom Recruiting',
    why: 'Warm relationship. Callie has full context and is actively working the pipeline.',
    status: 'in conversation', notes: 'Callie connected Everett to colleagues. Flagged a President role for March.', linkedin: '', website: '',
    last_contacted: '2026-03-26', followup_date: null,
    contacts: [
      { id: 1, name: 'Callie Vandegrift', title: 'Recruiter', email: '', linkedin: '', last_contacted: '2026-03-26', status: 'in conversation', notes: 'Already connected. Put Everett on radar for President role in March. Has resume and full context.' }
    ]
  },
  {
    id: 6, tier: 2, name: 'True Search',
    why: 'PE/VC tech companies. Transparent process. Strong Series B/C COO practice.',
    status: 'contacted', notes: '', linkedin: 'https://www.linkedin.com/company/true-search/', website: 'https://trueplatform.com',
    last_contacted: '2026-03-26', followup_date: '2026-04-02',
    contacts: [
      { id: 1, name: 'Steve Tutelman', title: 'Managing Director, PE Practice', email: 'steve.tutelman@truesearch.com', linkedin: 'https://www.linkedin.com/in/stevetutelman/', last_contacted: '2026-03-26', status: 'emailed', notes: 'Emailed 3/26.' },
      { id: 2, name: 'Nora Sutherland', title: 'Partner, Technology Practice', email: 'nora.sutherland@trueplatform.com', linkedin: 'https://www.linkedin.com/in/nsutherlanddsg/', last_contacted: '2026-03-26', status: 'emailed', notes: 'Formerly at DSG. Emailed at new True Search address 3/26. Also emailed old DSG address earlier same day.' }
    ]
  },
  {
    id: 7, tier: 2, name: 'Heidrick and Struggles',
    why: 'National. COO practice. Good for high-profile PE-backed ops roles at scale.',
    status: 'contacted', notes: 'Emailed Doug Greenberg at Heidrick address but he is confirmed at Korn Ferry. This entry may be a dead end.', linkedin: 'https://www.linkedin.com/company/heidrick-struggles/', website: 'https://heidrick.com',
    last_contacted: '2026-03-26', followup_date: null,
    contacts: [
      { id: 1, name: 'Doug Greenberg', title: 'NOTE: Confirmed at Korn Ferry, not Heidrick', email: 'doug.greenberg@heidrick.com', linkedin: 'https://www.linkedin.com/in/doug-greenberg-6593a41/', last_contacted: '2026-03-26', status: 'dead end', notes: 'Emailed Heidrick address 3/26 but Doug is at Korn Ferry. See Korn Ferry entry.' }
    ]
  },
  {
    id: 8, tier: 2, name: 'Korn Ferry',
    why: 'Large national firm. COO/SVP Ops practice. Best for Series C/D and PE-owned companies.',
    status: 'contacted', notes: '', linkedin: 'https://www.linkedin.com/company/kornferry/', website: 'https://kornferry.com',
    last_contacted: '2026-03-26', followup_date: '2026-04-02',
    contacts: [
      { id: 1, name: 'Doug Greenberg', title: 'Senior Partner, Healthcare Technology', email: 'doug.greenberg@kornferry.com', linkedin: 'https://www.linkedin.com/in/doug-greenberg-6593a41/', last_contacted: '2026-03-26', status: 'emailed', notes: 'Emailed 3/26. LinkedIn connection pending (ran out of free connects this month).' }
    ]
  },
  {
    id: 9, tier: 2, name: 'TGC Search',
    why: 'Placed COOs for IPO-prep SaaS. Experience in scaling scenarios like ChartRequest.',
    status: 'contacted', notes: 'No named partner found. Sent to general info inbox.', linkedin: 'https://www.linkedin.com/company/tgc-search/', website: 'https://tgcsearch.com',
    last_contacted: '2026-03-26', followup_date: '2026-04-02',
    contacts: [
      { id: 1, name: 'General Inbox', title: '', email: 'info@tgcsearch.com', linkedin: '', last_contacted: '2026-03-26', status: 'emailed', notes: 'No named partner surfaced. Emailed general inbox 3/26. Follow up by finding a named contact.' }
    ]
  },
  {
    id: 10, tier: 2, name: 'Charles Aris',
    why: 'NC-based, national reach. Consistent COO placements in Southeast growth companies.',
    status: 'contacted', notes: '', linkedin: 'https://www.linkedin.com/company/charles-aris-inc-/', website: 'https://charlesaris.com',
    last_contacted: '2026-03-26', followup_date: '2026-04-02',
    contacts: [
      { id: 1, name: 'Kevin Stemke', title: 'Practice Leader', email: 'kevin.stemke@charlesaris.com', linkedin: 'https://www.linkedin.com/in/kevinstemke/', last_contacted: '2026-03-26', status: 'emailed', notes: 'Emailed 3/26. LinkedIn connection sent.' }
    ]
  },
  {
    id: 11, tier: 3, name: 'ReadySetExec',
    why: 'Founder-led boutique. Operations and SaaS focus. Relationship-first process.',
    status: 'contacted', notes: '', linkedin: '', website: 'https://readysetexec.com',
    last_contacted: '2026-03-26', followup_date: '2026-04-02',
    contacts: [
      { id: 1, name: 'Patrick Shea', title: 'Co-Founder & Managing Partner', email: 'patrick@readysetexec.com', linkedin: 'https://www.linkedin.com/in/patrick-jm-shea/', last_contacted: '2026-03-26', status: 'emailed', notes: 'Emailed 3/26. LinkedIn connection sent.' }
    ]
  },
  {
    id: 12, tier: 3, name: 'Klein Hersh',
    why: 'Healthcare tech and digital health SaaS. ChartRequest background is a specific credential here.',
    status: 'contacted', notes: '', linkedin: 'https://www.linkedin.com/company/klein-hersh/', website: 'https://kleinhersh.com',
    last_contacted: '2026-03-26', followup_date: '2026-04-02',
    contacts: [
      { id: 1, name: 'Jesse Klein', title: 'Managing Director & COO', email: 'jesse@kleinhersh.com', linkedin: 'https://www.linkedin.com/in/kleinjesse/', last_contacted: '2026-03-26', status: 'emailed', notes: 'Emailed 3/26. Healthcare tech angle highlighted given ChartRequest background.' }
    ]
  },
  {
    id: 13, tier: 3, name: 'Diversified Search Group',
    why: 'PE-backed tech practice. Primary contact Nora Sutherland has since moved to True Search.',
    status: 'passed', notes: 'Nora Sutherland confirmed moved to True Search. No replacement contact identified at DSG. Dead end for now.', linkedin: 'https://www.linkedin.com/company/diversifiedsearchgroup/', website: 'https://diversifiedsearchgroup.com',
    last_contacted: '2026-03-26', followup_date: null,
    contacts: [
      { id: 1, name: 'Nora Sutherland', title: 'MOVED TO TRUE SEARCH', email: 'nora.sutherland@divsearch.com', linkedin: 'https://www.linkedin.com/in/nsutherlanddsg/', last_contacted: '2026-03-26', status: 'dead end', notes: 'Emailed DSG address 3/26 but Nora has moved to True Search. See True Search entry.' }
    ]
  }
];

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(SEED_FIRMS, null, 2));
    return SEED_FIRMS;
  }
  const firms = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  return firms.map(f => ({
    last_contacted: null,
    followup_date: null,
    contacts: [],
    ...f
  }));
}

function saveDB(firms) {
  fs.writeFileSync(DB_PATH, JSON.stringify(firms, null, 2));
}

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
    sessions.add(token);
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.get('/api/auth-required', (req, res) => res.json({ required: !!PASSWORD }));

app.get('/api/firms', requireAuth, (req, res) => res.json(loadDB()));

app.patch('/api/firms/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const firms = loadDB();
  const idx = firms.findIndex(f => f.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const allowed = ['status', 'notes', 'followup_date'];
  allowed.forEach(k => { if (req.body[k] !== undefined) firms[idx][k] = req.body[k]; });
  if (req.body.status && req.body.status !== 'not contacted') {
    firms[idx].last_contacted = new Date().toISOString().split('T')[0];
  }
  saveDB(firms);
  res.json(firms[idx]);
});

app.post('/api/firms', requireAuth, (req, res) => {
  const firms = loadDB();
  const next = {
    id: Math.max(0, ...firms.map(f => f.id)) + 1,
    tier: req.body.tier || 3,
    name: req.body.name || 'New Firm',
    why: req.body.why || '',
    contact: req.body.contact || '',
    status: 'not contacted',
    notes: '',
    linkedin: req.body.linkedin || '',
    website: req.body.website || '',
    last_contacted: null,
    followup_date: null,
    contacts: []
  };
  firms.push(next);
  saveDB(firms);
  res.status(201).json(next);
});

// Contact routes
app.post('/api/firms/:id/contacts', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const firms = loadDB();
  const firm = firms.find(f => f.id === id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });
  const contacts = firm.contacts || [];
  const contact = {
    id: Math.max(0, ...contacts.map(c => c.id)) + 1,
    name: req.body.name || '',
    title: req.body.title || '',
    email: req.body.email || '',
    linkedin: req.body.linkedin || '',
    last_contacted: req.body.last_contacted || null,
    status: req.body.status || 'not contacted',
    notes: req.body.notes || ''
  };
  firm.contacts = [...contacts, contact];
  saveDB(firms);
  res.status(201).json(contact);
});

app.patch('/api/firms/:id/contacts/:cid', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const cid = parseInt(req.params.cid);
  const firms = loadDB();
  const firm = firms.find(f => f.id === id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });
  const contact = (firm.contacts || []).find(c => c.id === cid);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  ['name', 'title', 'email', 'linkedin', 'last_contacted', 'status', 'notes'].forEach(k => {
    if (req.body[k] !== undefined) contact[k] = req.body[k];
  });
  saveDB(firms);
  res.json(contact);
});

app.delete('/api/firms/:id/contacts/:cid', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const cid = parseInt(req.params.cid);
  const firms = loadDB();
  const firm = firms.find(f => f.id === id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });
  firm.contacts = (firm.contacts || []).filter(c => c.id !== cid);
  saveDB(firms);
  res.json({ ok: true });
});

// CSV export
app.get('/api/export.csv', requireAuth, (req, res) => {
  const firms = loadDB();
  const headers = ['id', 'tier', 'name', 'status', 'last_contacted', 'followup_date', 'why', 'website', 'linkedin', 'notes', 'contacts_count'];
  const escape = v => '"' + String(v || '').replace(/"/g, '""') + '"';
  const rows = firms.map(f => [
    ...headers.slice(0, -1).map(h => escape(f[h])),
    escape((f.contacts || []).length)
  ].join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="recruiter-tracker.csv"');
  res.send([headers.join(','), ...rows].join('\n'));
});

app.post('/api/import', requireAuth, (req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows must be array' });
  const firms = loadDB();
  let added = 0, updated = 0;
  rows.forEach(row => {
    const existing = firms.find(f => f.name.toLowerCase() === (row.name || '').toLowerCase());
    if (existing) {
      ['tier', 'why', 'website', 'linkedin', 'notes', 'status', 'followup_date'].forEach(k => {
        if (row[k] !== undefined && row[k] !== '') existing[k] = row[k];
      });
      updated++;
    } else {
      firms.push({
        id: Math.max(0, ...firms.map(f => f.id)) + 1,
        tier: parseInt(row.tier) || 3,
        name: row.name || 'Unnamed',
        why: row.why || '',
        status: row.status || 'not contacted',
        notes: row.notes || '',
        linkedin: row.linkedin || '',
        website: row.website || '',
        last_contacted: row.last_contacted || null,
        followup_date: row.followup_date || null,
        contacts: []
      });
      added++;
    }
  });
  saveDB(firms);
  res.json({ ok: true, added, updated });
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log('Recruiter tracker running on :' + PORT));
