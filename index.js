const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'tracker.json');
const CEO_PATH = path.join(DATA_DIR, 'ceos.json');
const VC_PATH = path.join(DATA_DIR, 'vcs.json');
const PASSWORD = process.env.AUTH_PASSWORD || '';
const SEED_VERSION = '2026-04-01-v3';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const sessions = new Set();

// STATUS FLOW:
// not contacted → draft (email queued) → contacted (sent+delivered) → in conversation (reply received)
// Also: bounced | passed | linkedin (LI message sent)

const SEED_FIRMS = [
  { id: 1, tier: 1, name: 'Bespoke Partners', why: 'Top PE-backed SaaS exec search. COO/President roles. Healthcare software practice.', status: 'contacted', last_contacted: '2026-03-26', followup_date: '2026-04-02', notes: '', contacts: [{ id: 1, name: 'Katherine Baker', title: 'Partner, CEO & P&L Practice', email: 'katherine.baker@bespokepartners.com', last_contacted: '2026-03-26', status: 'contacted', notes: 'Email sent 3/26.' }] },
  { id: 2, tier: 1, name: 'Talentfoot', why: 'SaaS-only exec search. PE-backed sweet spot. Atlanta reach. Strong COO/ops practice.', status: 'in conversation', last_contacted: '2026-03-26', followup_date: null, notes: 'Camille responded same day. Flagged President (Martech) role. Replied highlighting marketing ownership at ChartRequest.', contacts: [{ id: 1, name: 'Camille Fetter', title: 'Founder & CEO', email: 'cfetter@talentfoot.com', last_contacted: '2026-03-26', status: 'in conversation', notes: 'Active conversation.' }] },
  { id: 3, tier: 1, name: 'Cowen Partners', why: 'Forbes Top 100. PE-backed COO specialists.', status: 'contacted', last_contacted: '2026-03-26', followup_date: '2026-04-02', notes: '', contacts: [{ id: 1, name: 'Shawn Cole', title: 'President & Founding Partner', email: 'shawn@cowenpartners.com', last_contacted: '2026-03-26', status: 'contacted', notes: 'Email sent 3/26.' }] },
  { id: 4, tier: 1, name: 'BSG (Boston Search Group)', why: 'Mid-market PE. SaaS and healthcare tech verticals.', status: 'contacted', last_contacted: '2026-03-26', followup_date: '2026-04-02', notes: '', contacts: [{ id: 1, name: 'Clark Waterfall', title: 'Founder & Managing Director', email: 'cwaterfall@bostonsearchgroup.com', last_contacted: '2026-03-26', status: 'contacted', notes: 'Email sent 3/26.' }] },
  { id: 5, tier: 1, name: 'Bloom Recruiting', why: 'Warm relationship. Callie has full context and is actively working the pipeline.', status: 'in conversation', last_contacted: '2026-03-26', followup_date: null, notes: 'Active. Has resume and full context.', contacts: [{ id: 1, name: 'Callie Vandegrift', title: 'Recruiter', email: '', last_contacted: '2026-03-26', status: 'in conversation', notes: 'Active.' }] },
  { id: 6, tier: 1, name: 'JM Search', why: '20+ years PE-backed healthcare tech COO placements. Hunt Scanlon Top 50.', status: 'bounced', last_contacted: null, followup_date: null, notes: 'ahenry@jmsearch.com bounced 3/27. Use LinkedIn.', contacts: [{ id: 1, name: 'Andrew Henry', title: 'Managing Partner, Healthcare & Life Sciences', email: 'ahenry@jmsearch.com', last_contacted: null, status: 'bounced', notes: 'Email bounced 3/27. LinkedIn only.' }] },
  { id: 7, tier: 1, name: 'Daversa Partners', why: 'CEO/President/COO at growth-stage VC-backed SaaS. Forbes #145.', status: 'contacted', last_contacted: '2026-03-27', followup_date: '2026-04-03', notes: '', contacts: [{ id: 1, name: 'Will Sheridan', title: 'Director', email: 'will@daversa.com', last_contacted: '2026-03-27', status: 'contacted', notes: 'Email sent 3/27.' }] },
  { id: 8, tier: 1, name: 'Acertitude', why: 'Technology & Healthcare. PE portfolio C-suite specialist. Forbes #139.', status: 'contacted', last_contacted: '2026-04-01', followup_date: '2026-04-08', notes: 'Emailed 3/27 and again 4/1.', contacts: [{ id: 1, name: 'Rick DeRose', title: 'Co-Founder & Managing Partner', email: 'rderose@acertitude.com', last_contacted: '2026-04-01', status: 'contacted', notes: 'Emailed 3/27 and 4/1.' }] },
  { id: 9, tier: 1, name: 'ON Partners', why: 'Dedicated SaaS practice. Forbes #34. Explicit VC/PE SaaS COO work.', status: 'bounced', last_contacted: null, followup_date: null, notes: 'sharris@onpartners.com bounced 3/27. Use LinkedIn.', contacts: [{ id: 1, name: 'Seth Harris', title: 'Partner, SaaS & Technology', email: 'sharris@onpartners.com', last_contacted: null, status: 'bounced', notes: 'Email bounced 3/27. LinkedIn only.' }] },
  { id: 10, tier: 1, name: 'CarterBaldwin', why: 'Atlanta HQ (Roswell). Technology practice. PE-backed C-suite. Home-field.', status: 'contacted', last_contacted: '2026-03-27', followup_date: '2026-04-03', notes: '', contacts: [{ id: 1, name: 'Jennifer Sobocinski', title: 'Founding Partner, Technology Practice', email: 'jsobocinski@carterbaldwin.com', last_contacted: '2026-03-27', status: 'contacted', notes: 'Email sent 3/27.' }] },
  { id: 11, tier: 1, name: 'Crist|Kolder Associates', why: 'CEO/CFO/COO/Board only firm. Scott Simmons leads COO search.', status: 'contacted', last_contacted: '2026-03-27', followup_date: '2026-04-03', notes: '', contacts: [{ id: 1, name: 'Scott Simmons', title: 'Co-Managing Partner', email: 'ssimmons@cristkolder.com', last_contacted: '2026-03-27', status: 'contacted', notes: 'Email sent 3/27.' }] },
  { id: 26, tier: 1, name: 'SPMB Executive Search', why: 'VC/PE-backed CEO/COO practice. Okta, GitHub, Snowflake, Klaviyo placements.', status: 'contacted', last_contacted: '2026-03-27', followup_date: '2026-04-03', notes: '', contacts: [{ id: 1, name: 'Dave Mullarkey', title: 'Managing Partner', email: 'dave@spmb.com', last_contacted: '2026-03-27', status: 'contacted', notes: 'Email sent 3/27.' }] },
  { id: 27, tier: 2, name: 'WittKieffer', why: 'Julie Chavey is Atlanta-based. VC/PE healthcare, healthtech, life sciences.', status: 'in conversation', last_contacted: '2026-03-27', followup_date: null, notes: 'Active conversation. Call scheduled.', contacts: [{ id: 1, name: 'Julie Chavey', title: 'Consultant, Investor-Backed Healthcare', email: 'jchavey@wittkieffer.com', last_contacted: '2026-03-27', status: 'in conversation', notes: 'Active. Call scheduled.' }] },
  { id: 28, tier: 2, name: 'ZRG Partners', why: 'Fast-growing global talent advisory. PE-backed tech and healthcare COO practice.', status: 'contacted', last_contacted: '2026-04-01', followup_date: '2026-04-08', notes: 'Three contacts emailed. Tim Henn and Jim Urquhart sent 4/1. Joni Noel sent 3/27.', contacts: [{ id: 1, name: 'Joni Noel', title: 'Co-Head, Healthcare & Life Sciences', email: 'jnoel@zrgpartners.com', last_contacted: '2026-03-27', status: 'contacted', notes: 'Email sent 3/27.' }, { id: 2, name: 'Timothy Henn', title: 'Managing Director, Global Technology & Board Services (Atlanta)', email: 'thenn@zrgpartners.com', last_contacted: '2026-04-01', status: 'contacted', notes: 'Email delivered 4/1.' }, { id: 3, name: 'Jim Urquhart', title: 'Managing Director, COO/SaaS & FinTech Practice', email: 'jurquhart@zrgpartners.com', last_contacted: '2026-04-01', status: 'contacted', notes: 'Email delivered 4/1.' }] },
  { id: 42, tier: 1, name: 'Raines International', why: 'COO and ops executives in PE/growth-stage. Technology and FinTech practices.', status: 'contacted', last_contacted: '2026-04-01', followup_date: '2026-04-08', notes: 'Two contacts emailed 4/1, both delivered.', contacts: [{ id: 1, name: 'Ceylan Higgins', title: 'Managing Director, Global Software & Technology Practice', email: 'chiggins@rainesinternational.com', last_contacted: '2026-04-01', status: 'contacted', notes: 'Email delivered 4/1.' }, { id: 2, name: 'Gerard Dash', title: 'SVP, FinTech (Atlanta-based)', email: 'gdash@rainesinternational.com', last_contacted: '2026-04-01', status: 'contacted', notes: 'Email delivered 4/1.' }] },
  { id: 43, tier: 1, name: 'DHR Global', why: 'COO/ops practice. PE-backed technology and mid-market. Atlanta office.', status: 'contacted', last_contacted: '2026-04-01', followup_date: '2026-04-08', notes: 'Two contacts emailed 4/1, both delivered.', contacts: [{ id: 1, name: 'Kathryn Ullrich', title: 'Managing Partner, Technology/SaaS COO Practice', email: 'kullrich@dhrglobal.com', last_contacted: '2026-04-01', status: 'contacted', notes: 'Email delivered 4/1.' }, { id: 2, name: 'Ginny Edwards', title: 'Partner, PE & Founder-led Companies', email: 'gedwards@dhrglobal.com', last_contacted: '2026-04-01', status: 'contacted', notes: 'Email delivered 4/1.' }] },
  { id: 44, tier: 2, name: 'N2Growth', why: 'C-suite and COO search for growth-stage and PE-backed companies.', status: 'bounced', last_contacted: null, followup_date: null, notes: 'mmyatt@n2growth.com bounced 4/1. Find correct email or use LinkedIn.', contacts: [{ id: 1, name: 'Mike Myatt', title: 'Founder & Chairman', email: 'mmyatt@n2growth.com', last_contacted: null, status: 'bounced', notes: 'Email bounced 4/1. Find correct address.' }] },
  { id: 45, tier: 2, name: 'Odgers Berndtson', why: 'Strong PE and technology practices. COO placements. Atlanta office.', status: 'bounced', last_contacted: null, followup_date: null, notes: 'mobydell@odgersberndtson.com bounced 4/1. Try matsola.bydell@ or LinkedIn.', contacts: [{ id: 1, name: 'Mats-Ola Bydell', title: 'Managing Partner (Atlanta)', email: 'mobydell@odgersberndtson.com', last_contacted: null, status: 'bounced', notes: 'Bounced 4/1. Try matsola.bydell@odgersberndtson.com or LinkedIn.' }] },
  { id: 46, tier: 1, name: 'Buffkin/Baker', why: 'PE and technology practice. Southeast footprint. Partner-led boutique.', status: 'bounced', last_contacted: null, followup_date: null, notes: 'cbuffkin@buffkinbaker.com bounced 4/1. Try craig@ or c.buffkin@ or LinkedIn.', contacts: [{ id: 1, name: 'Craig Buffkin', title: 'Managing Partner', email: 'cbuffkin@buffkinbaker.com', last_contacted: null, status: 'bounced', notes: 'Bounced 4/1. Try alternate format or LinkedIn.' }] },
  { id: 12, tier: 2, name: 'True Search', why: 'PE/VC tech. Strong Series B/C COO practice.', status: 'contacted', last_contacted: '2026-03-26', followup_date: '2026-04-02', notes: '', contacts: [{ id: 1, name: 'Steve Tutelman', title: 'Managing Director, PE Practice', email: 'steve.tutelman@truesearch.com', last_contacted: '2026-03-26', status: 'contacted', notes: 'Email sent 3/26.' }] },
  { id: 13, tier: 2, name: 'Korn Ferry', why: 'National. COO/SVP Ops practice. Series C/D and PE-owned.', status: 'contacted', last_contacted: '2026-03-26', followup_date: '2026-04-02', notes: '', contacts: [{ id: 1, name: 'Doug Greenberg', title: 'Senior Partner, Healthcare Technology', email: 'doug.greenberg@kornferry.com', last_contacted: '2026-03-26', status: 'contacted', notes: 'Email sent 3/26.' }] },
  { id: 14, tier: 2, name: 'Charles Aris', why: 'NC-based, national reach. COO placements in Southeast growth companies.', status: 'contacted', last_contacted: '2026-03-26', followup_date: '2026-04-02', notes: '', contacts: [{ id: 1, name: 'Kevin Stemke', title: 'Practice Leader', email: 'kevin.stemke@charlesaris.com', last_contacted: '2026-03-26', status: 'contacted', notes: 'Email sent 3/26.' }] },
  { id: 15, tier: 2, name: 'StevenDouglas', why: 'Atlanta-based. Operations & COO search. PE-backed portfolio.', status: 'contacted', last_contacted: '2026-03-27', followup_date: '2026-04-03', notes: '', contacts: [{ id: 1, name: 'Drew Zachmann', title: 'Director, Operations & Supply Chain', email: 'dzachmann@stevendouglas.com', last_contacted: '2026-03-27', status: 'contacted', notes: 'Email sent 3/27.' }] },
  { id: 16, tier: 2, name: 'Slayton Search Partners', why: 'Forbes #38. PE-backed portfolio COO/CFO/C-suite.', status: 'contacted', last_contacted: '2026-03-27', followup_date: '2026-04-03', notes: '', contacts: [{ id: 1, name: 'Rick Slayton', title: 'Managing Partner & CEO', email: 'rslayton@slaytonsearch.com', last_contacted: '2026-03-27', status: 'contacted', notes: 'Email sent 3/27.' }] },
  { id: 17, tier: 2, name: 'Nexus Search Partners', why: 'Charlotte. PE-backed COO/President placements.', status: 'contacted', last_contacted: '2026-03-27', followup_date: '2026-04-03', notes: '', contacts: [{ id: 1, name: 'Thaddeus Jones', title: 'Founder & Managing Partner', email: 'tjones@nexussearchpartners.com', last_contacted: '2026-03-27', status: 'contacted', notes: 'Email sent 3/27.' }] },
  { id: 18, tier: 3, name: 'Riviera Partners', why: 'Ryan Brogan in PE practice. Primarily technical roles.', status: 'contacted', last_contacted: '2026-03-27', followup_date: null, notes: 'Passed on most recent role. No current fit. Keeping warm.', contacts: [{ id: 1, name: 'Ryan Brogan', title: 'Client Partner, PE Practice', email: 'rbrogan@rivierapartners.com', last_contacted: '2026-03-27', status: 'contacted', notes: 'Responded — no current fit, keeping in system.' }] },
  { id: 19, tier: 3, name: 'ReadySetExec', why: 'Founder-led boutique. Operations and SaaS.', status: 'contacted', last_contacted: '2026-03-26', followup_date: '2026-04-02', notes: 'Bounce resolved. Correct address is pshea@.', contacts: [{ id: 1, name: 'Patrick Shea', title: 'Co-Founder & Managing Partner', email: 'pshea@readysetexec.com', last_contacted: '2026-03-26', status: 'contacted', notes: 'Bounce resolved. Email sent 3/26.' }] },
  { id: 20, tier: 3, name: 'Klein Hersh', why: 'Healthcare tech and digital health SaaS. Direct vertical fit.', status: 'contacted', last_contacted: '2026-03-26', followup_date: '2026-04-02', notes: '', contacts: [{ id: 1, name: 'Jesse Klein', title: 'Managing Director & COO', email: 'jklein@kleinhersh.com', last_contacted: '2026-03-26', status: 'contacted', notes: 'Bounce resolved. Email sent 3/26.' }] },
  { id: 21, tier: 3, name: 'TGC Search', why: 'COOs for IPO-prep SaaS.', status: 'contacted', last_contacted: '2026-03-26', followup_date: '2026-04-02', notes: 'Sent to general inbox. Find named contact.', contacts: [{ id: 1, name: 'General Inbox', title: '', email: 'info@tgcsearch.com', last_contacted: '2026-03-26', status: 'contacted', notes: 'Sent to general inbox.' }] },
  { id: 22, tier: 3, name: 'Heidrick & Struggles', why: 'National. COO practice.', status: 'passed', last_contacted: null, followup_date: null, notes: 'Doug Greenberg moved to Korn Ferry. Need new contact.', contacts: [{ id: 1, name: 'Doug Greenberg', title: 'Now at Korn Ferry', email: '', last_contacted: null, status: 'passed', notes: 'Moved to Korn Ferry.' }] },
  { id: 23, tier: 3, name: 'Diversified Search Group', why: 'PE-backed tech practice.', status: 'passed', last_contacted: null, followup_date: null, notes: 'Nora Sutherland moved to True Search. Address bounced.', contacts: [{ id: 1, name: 'Nora Sutherland', title: 'Now at True Search', email: '', last_contacted: null, status: 'passed', notes: 'Moved to True Search.' }] },
  { id: 24, tier: 3, name: 'Storm3', why: 'HealthTech specialist. Finance & Operations practice places COOs.', status: 'passed', last_contacted: null, followup_date: null, notes: 'perrin.joel@storm3.com blocked. Find current US contact.', contacts: [{ id: 1, name: 'Perrin Joel', title: 'May have departed', email: '', last_contacted: null, status: 'passed', notes: 'Email blocked. Find current US contact.' }] },
  { id: 30, tier: 2, name: 'Direct Recruiters Inc.', why: 'Digital health and healthcare IT. ChartRequest background directly relevant.', status: 'not contacted', last_contacted: null, followup_date: null, notes: 'Norman Volsky hosts Digital Health Heavyweights Podcast — warm angle.', contacts: [{ id: 1, name: 'Norman Volsky', title: 'Managing Partner, Digital Health Practice', email: 'nvolsky@directrecruiters.com', last_contacted: null, status: 'not contacted', notes: 'Primary target. Podcast angle.' }] }
];

const SEED_CEOS = [
  { id: 101, company: 'Greenlight Financial', why: 'Fintech SaaS for families. $556M raised. 650+ employees. Growth inflection.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Tim Sheehan is CEO. Pete Santora — LinkedIn message sent 4/1, email unknown (pete@thundrlizard.com bounced — domain does not exist). Draft email queued for Tim Sheehan.', contacts: [{ id: 1, name: 'Pete Santora', title: 'Contact at Greenlight (role TBD)', email: '', last_contacted: '2026-04-01', status: 'linkedin', notes: 'LinkedIn message sent 4/1. Email unknown — pete@thundrlizard.com domain does not exist.' }, { id: 2, name: 'Tim Sheehan', title: 'Co-Founder & CEO', email: 'tsheehan@greenlight.com', last_contacted: null, status: 'draft', notes: 'Draft queued. Send if Pete does not respond.' }] },
  { id: 102, company: 'Flock Safety', why: 'Public safety tech. $655M+ raised. 900 employees. Civic/government angle.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Garrett Langley', title: 'Co-Founder & CEO', email: 'glangley@flocksafety.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1 — referral ask.' }] },
  { id: 103, company: 'Stord', why: 'Logistics SaaS. $1.1B valuation. 1,500+ employees. Kanga founder parallel.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1 — logistics founder angle.', contacts: [{ id: 1, name: 'Sean Henry', title: 'Co-Founder & CEO', email: 'shenry@stord.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1 — logistics founder angle.' }] },
  { id: 104, company: 'CallRail', why: 'Call tracking analytics SaaS. 350 employees. Bootstrapped to growth equity.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Marc Ginsberg', title: 'CEO', email: 'mginsberg@callrail.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1 — referral ask.' }] },
  { id: 105, company: 'FinQuery', why: 'Lease/contract accounting SaaS. Compliance vertical parallel to ChartRequest.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1 — compliance SaaS vertical angle.', contacts: [{ id: 1, name: 'George Azih', title: 'Founder & Executive Chairman', email: 'gazih@finquery.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] },
  { id: 106, company: 'BetterCloud', why: 'SaaS ops management. Vista Equity-backed. PE mandate COO fit.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Jesse Levin', title: 'CEO', email: 'jesse.levin@bettercloud.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1 — referral ask.' }] },
  { id: 107, company: 'Pindrop', why: 'Voice security AI. Atlanta-based. 325 employees.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Vijay Balasubramaniyan', title: 'Co-Founder & CEO', email: 'vijay@pindrop.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1 — referral ask.' }] },
  { id: 108, company: 'Salesloft', why: 'Revenue orchestration SaaS. Vista Equity-backed. Atlanta.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'David Obrand', title: 'CEO', email: 'dobrand@salesloft.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1 — referral ask.' }] },
  { id: 109, company: 'Florence Healthcare', why: 'Clinical trial SaaS. Atlanta. 307 employees. Healthcare vertical match.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1 — healthcare SaaS vertical angle.', contacts: [{ id: 1, name: 'Ryan Jones', title: 'Co-Founder & CEO', email: 'ryan.jones@florencehc.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] }
];

const SEED_VCS = [
  { id: 201, firm: 'BIP Ventures', why: 'Southeast largest VC. Multi-stage B2B SaaS portfolio. 150+ investments.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Mark Buffington', title: 'Co-Founder & Managing Partner', email: 'mbuffington@bip-capital.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] },
  { id: 202, firm: 'Noro-Moseley Partners', why: '40-year Atlanta VC. B2B software and healthcare IT. $1B+ invested.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Alan Taetle', title: 'General Partner, IT Practice', email: 'ataetle@noromoseley.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] },
  { id: 203, firm: 'Overline', why: 'Operator-first seed VC. Southeast focus. Operating Partner network.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Michael Cohn', title: 'Managing Partner', email: 'mcohn@overline.vc', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] },
  { id: 204, firm: 'TTV Capital', why: 'Atlanta fintech VC since 2000. $250M Fund VI. Seed through late-stage.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Gardiner Garrard', title: 'Co-Founder & Managing Partner', email: 'ggarrard@ttvcapital.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] },
  { id: 205, firm: 'Fulcrum Equity Partners', why: 'Atlanta growth equity. B2B software and healthcare services.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Philip Lewis', title: 'Partner', email: 'plewis@fulcrumep.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] },
  { id: 206, firm: 'Resurgens Technology Partners', why: 'Atlanta PE. $800M Fund III. Software buyouts. Operating value model.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Fred Sturgis', title: 'Co-Founder & Managing Director', email: 'fred@resurgenstech.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] },
  { id: 207, firm: 'TechOperators', why: 'Operators-as-investors. B2B SaaS and cybersecurity. Atlanta. Founder-led model.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Glenn McGonnigle', title: 'General Partner', email: 'gmcgonnigle@techoperators.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] },
  { id: 208, firm: 'Atlanta Ventures', why: 'David Cummings portfolio: Calendly, SalesLoft, SingleOps, Terminus. Seed B2B SaaS.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'David Cummings', title: 'Founder', email: 'david@atlantaventures.com', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] },
  { id: 209, firm: 'Valor Ventures', why: 'Atlanta seed VC. B2B SaaS and Southeast focus.', status: 'draft', last_contacted: null, followup_date: null, notes: 'Draft email queued 4/1.', contacts: [{ id: 1, name: 'Lisa Calhoun', title: 'Founding General Partner', email: 'lisa@valorventures.co', last_contacted: null, status: 'draft', notes: 'Draft queued 4/1.' }] }
];

function initDB(filePath, seed) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ version: SEED_VERSION, data: seed }, null, 2));
    return seed;
  }
  const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!stored.version || stored.version !== SEED_VERSION) {
    fs.writeFileSync(filePath, JSON.stringify({ version: SEED_VERSION, data: seed }, null, 2));
    return seed;
  }
  return stored.data;
}

function loadDB(filePath, seed) {
  if (!fs.existsSync(filePath)) return seed;
  const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(stored) ? stored : (stored.data || seed);
}

function saveDB(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify({ version: SEED_VERSION, data }, null, 2));
}

// Initialize all three DBs on startup — version bump triggers seed reload
initDB(DB_PATH, SEED_FIRMS);
initDB(CEO_PATH, SEED_CEOS);
initDB(VC_PATH, SEED_VCS);

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
app.get('/api/firms', requireAuth, (req, res) => res.json(loadDB(DB_PATH, SEED_FIRMS)));
app.get('/api/ceos', requireAuth, (req, res) => res.json(loadDB(CEO_PATH, SEED_CEOS)));
app.get('/api/vcs', requireAuth, (req, res) => res.json(loadDB(VC_PATH, SEED_VCS)));

function makePatch(dbPath, seed) {
  return (req, res) => {
    const id = parseInt(req.params.id);
    const data = loadDB(dbPath, seed);
    const idx = data.findIndex(f => f.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    ['status', 'notes', 'followup_date'].forEach(k => { if (req.body[k] !== undefined) data[idx][k] = req.body[k]; });
    if (req.body.status && !['not contacted', 'draft'].includes(req.body.status)) {
      data[idx].last_contacted = new Date().toISOString().split('T')[0];
    }
    saveDB(dbPath, data); res.json(data[idx]);
  };
}

app.patch('/api/firms/:id', requireAuth, makePatch(DB_PATH, SEED_FIRMS));
app.patch('/api/ceos/:id', requireAuth, makePatch(CEO_PATH, SEED_CEOS));
app.patch('/api/vcs/:id', requireAuth, makePatch(VC_PATH, SEED_VCS));

// Sync endpoint — called by Claude after scanning Gmail for replies
// Body: { updates: [{email, note, status}] }
app.post('/api/sync', requireAuth, (req, res) => {
  const updates = req.body.updates || [];
  if (!updates.length) return res.json({ ok: true, changed: 0 });
  let changed = 0;
  const dbs = [
    { path: DB_PATH, seed: SEED_FIRMS },
    { path: CEO_PATH, seed: SEED_CEOS },
    { path: VC_PATH, seed: SEED_VCS }
  ];
  dbs.forEach(({ path: p, seed }) => {
    const data = loadDB(p, seed);
    let dirty = false;
    data.forEach(item => {
      (item.contacts || []).forEach(c => {
        const match = updates.find(u => u.email && c.email && u.email.toLowerCase() === c.email.toLowerCase());
        if (!match) return;
        if (match.status) { c.status = match.status; item.status = match.status; }
        if (match.note) {
          const ts = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const line = `[${ts}] ${match.note}`;
          item.notes = item.notes ? item.notes + '\n' + line : line;
          c.notes = c.notes ? c.notes + '\n' + line : line;
        }
        item.last_contacted = new Date().toISOString().split('T')[0];
        dirty = true;
        changed++;
      });
    });
    if (dirty) saveDB(p, data);
  });
  res.json({ ok: true, changed });
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log('HopeSpot running on :' + PORT));
