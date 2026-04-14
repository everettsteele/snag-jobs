const Anthropic = require('@anthropic-ai/sdk');

let _client = null;
function getClient() {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

// ================================================================
// Build cover letter system prompt dynamically from user profile
// ================================================================

function buildCoverLetterSystemPrompt(userProfile) {
  const name = userProfile.fullName || userProfile.full_name || 'the candidate';
  const background = userProfile.backgroundText || userProfile.background_text || '';

  return `You are writing a cover letter for ${name}.

CRITICAL OUTPUT RULES:
- Begin your response with the FIRST SENTENCE OF THE LETTER. Nothing else before it.
- Do NOT include any preamble, disclaimers, notes, meta-commentary, or explanations of what you are doing.
- Do NOT write things like "The job description didn't load" or "I'll write based on" or "Note:" or any separator like "---".
- Do NOT use markdown bold (**text**) or any other markdown formatting. Plain text only.
- If the job description is incomplete, write the best letter you can from the available context. Do not mention the gap.

VOICE AND STYLE:
- First person. Direct and declarative. No filler phrases. No "I am excited to" openings.
- Start with a strong statement tied specifically to the role.
${background ? `\n${name.split(' ')[0].toUpperCase()}'S BACKGROUND:\n${background}` : ''}

FORMAT:
3-4 paragraphs. Under 350 words. No sign-off needed. Output the letter text only.`;
}

// ================================================================
// Build variant selection prompt from user's resume variants
// ================================================================

function buildVariantPrompt(userName, variants, appRecord, jdText) {
  const variantLines = variants.map(v => `- ${v.slug}: ${v.label}`).join('\n');
  const slugs = variants.map(v => v.slug);

  return `Based on this job description, pick the single best resume variant for ${userName} to use.

VARIANTS:
${variantLines}

RULES:
- If the JD uses "Integrator" language explicitly, pick the COO/operator-type variant.
- If the title says "Chief of Staff", pick the chief-of-staff/partner-type variant.
- For roles that fit two categories, default to the one matching the JD title.
- Respond with ONLY a single word matching one of these slugs: ${slugs.join(', ')}. Nothing else.

ROLE: ${appRecord.role} at ${appRecord.company}
JOB DESCRIPTION:
${jdText.slice(0, 2000)}`;
}

// Default variants for backwards compatibility (used when user has no custom variants)
const DEFAULT_VARIANT_LABELS = {
  operator: 'Integrator/COO — EOS, scaling, building the operational machine',
  partner: 'Chief of Staff — right-hand to CEO, strategic ops, force multiplier',
  builder: 'VP/SVP Operations — multi-function ownership, revenue ops, GTM, cross-functional',
  innovator: 'AI/Special Projects — AI, automation, innovation, special initiatives',
};

function cleanCoverLetterText(raw) {
  if (!raw) return '';
  let text = raw.trim();
  const sepIdx = text.indexOf('---');
  if (sepIdx > -1) {
    const afterSep = text.slice(sepIdx + 3).trim();
    if (afterSep.length > 100) text = afterSep;
  }
  const metaPatterns = [
    /^the job description/i, /^i(?:'m| am) working with/i, /^i(?:'ll| will) write/i,
    /^since the (job|jd|description)/i, /^note:/i, /^based on the/i, /^working from/i,
  ];
  const lines = text.split('\n');
  let startIdx = 0;
  while (startIdx < lines.length && metaPatterns.some(p => p.test(lines[startIdx].trim()))) startIdx++;
  text = lines.slice(startIdx).join('\n').trim();
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  return text;
}

// ================================================================
// selectResumeVariant — now accepts user context
// userContext: { fullName, variants: [{slug, label}] }
// ================================================================

async function selectResumeVariant(appRecord, jdText, userContext) {
  if (!process.env.ANTHROPIC_API_KEY) return 'operator';

  // Determine available variants
  const variants = userContext?.variants?.length
    ? userContext.variants
    : Object.entries(DEFAULT_VARIANT_LABELS).map(([slug, label]) => ({ slug, label }));

  const defaultSlug = variants.find(v => v.is_default)?.slug || variants[0]?.slug || 'operator';
  const validSlugs = new Set(variants.map(v => v.slug));
  const userName = userContext?.fullName || 'the candidate';

  try {
    const client = getClient();
    const prompt = buildVariantPrompt(userName, variants, appRecord, jdText);

    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (resp.content?.[0]?.text || '').trim().toLowerCase();
    if (validSlugs.has(raw)) return raw;
    return defaultSlug;
  } catch (e) {
    console.error('[selectResumeVariant]', e.message);
    return defaultSlug;
  }
}

// ================================================================
// generateCoverLetter — now accepts user profile for personalization
// userProfile: { fullName, backgroundText, ... }
// ================================================================

async function generateCoverLetter(appRecord, jdText, userProfile) {
  const client = getClient();
  const systemPrompt = buildCoverLetterSystemPrompt(userProfile || {});
  const prompt = `ROLE: ${appRecord.role} at ${appRecord.company}\n\nJOB DESCRIPTION:\n${jdText.slice(0, 3000)}\n\nNotes about this role: ${appRecord.notes || 'None'}\n\nWrite the cover letter now. Start immediately with the first sentence.`;

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 700,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = resp.content?.[0]?.text || '';
  return cleanCoverLetterText(raw);
}

// ================================================================
// generateEmailDraft — cold outreach emails (recruiter/CEO/VC)
// ================================================================

async function generateEmailDraft({ recipientName, company, recipientRole, type, senderContext }) {
  const client = getClient();

  const typePrompts = {
    recruiter: `Write a cold outreach email to a recruiter at ${company}. Under 100 words. Open with a direct value statement, not a greeting question. Reference their company specifically. Include one specific achievement. End with a clear ask for a brief call. Conversational but professional. No "I hope this finds you well."`,
    ceo: `Write a cold outreach email to ${recipientName}, ${recipientRole || 'CEO'} at ${company}. Direct CEO outreach from a senior operations candidate. Under 80 words. Open with something specific about the company. One-line value statement. Direct ask. Founder-to-founder tone.`,
    vc: `Write a cold outreach email to ${recipientName} at ${company} VC firm. The sender is a SaaS operations executive exploring COO and President roles at portfolio companies. Under 80 words. Lead with the firm's portfolio focus. One specific operations achievement. Ask if they have relevant portcos in search.`,
  };

  const prompt = `${typePrompts[type] || typePrompts.recruiter}

SENDER BACKGROUND:
${senderContext || 'Senior operations executive with experience scaling startups and enterprise organizations.'}

RECIPIENT: ${recipientName}${recipientRole ? ', ' + recipientRole : ''} at ${company}`;

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return resp.content?.[0]?.text || '';
}

// ================================================================
// generateResumeVariant — rewrite a base resume for a specific angle
// ================================================================

const RESUME_ANGLE_PROMPTS = {
  operator: `You're rewriting the resume to position the candidate as an Integrator/COO-type leader — EOS experience, scaling operational machines, building org infrastructure, process rigor, accountability systems. Lead with metrics-driven outcomes and systems thinking. Reorder bullets to surface operations impact first.`,
  partner: `You're rewriting the resume to position the candidate as a Chief of Staff — right-hand to CEO, strategic partner, cross-functional leader, stakeholder management. Lead with high-leverage judgment calls, coalition-building, and executive proximity. Emphasize cadence, strategic planning, and being the connective tissue.`,
  builder: `You're rewriting the resume to position the candidate as a zero-to-one builder — founder, early-stage operator, creating from scratch. Emphasize starting things, ambiguity tolerance, wearing many hats, early revenue/traction, and founding skills. Reorder to surface founding and build experiences first.`,
  innovator: `You're rewriting the resume to position the candidate as an AI-native operator / technology-forward executive — applying emerging tools to transform operations, automation, AI-first workflows. Emphasize technical leverage, AI/automation projects, and technology-driven productivity gains.`,
};

async function generateResumeVariant({ baseText, angle, angleName, targetRole }) {
  const client = getClient();
  // New API: angleName is the free-form positioning label (e.g. "Chief of Staff").
  // Legacy API: angle is one of operator/partner/builder/innovator.
  const angleInstr = angleName
    ? `You're rewriting the resume to position the candidate specifically for "${angleName}" roles. Reshape the summary, reorder bullets under each job, and sharpen emphasis so the candidate reads as a strong "${angleName}" fit. Do not invent experience — use only what's present in the base resume, but lead with the parts most relevant to this positioning.`
    : (RESUME_ANGLE_PROMPTS[angle] || RESUME_ANGLE_PROMPTS.operator);
  const positioningLabel = angleName || angle || 'operations leadership';

  const prompt = `You are rewriting a candidate's resume for a specific positioning angle. Output ONLY the rewritten resume text — no preamble, no explanation, no markdown formatting.

POSITIONING ANGLE: ${positioningLabel}
${angleInstr}

TARGET ROLE: ${targetRole || positioningLabel}

BASE RESUME (preserve factual content — same jobs, same dates, same companies, same metrics — but rewrite the framing, reorder bullets to emphasize the angle, sharpen action verbs, and tighten language):

${baseText}

RULES:
- Keep all factual claims exactly as-is. Do not invent achievements, roles, or dates.
- Same section structure: Summary, Experience, Education, etc.
- Rewrite the Summary section to lead with the angle's positioning.
- Within each job, reorder bullets so the most angle-relevant ones come first.
- Sharpen verbs. Remove weak filler. Keep under 800 words total.
- Output plain text only. No markdown, no bullets with asterisks, no headers with hashes.
  Use CAPS for section headers and standard formatting.

Begin the rewritten resume now.`;

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  });
  return (resp.content?.[0]?.text || '').trim();
}

// ================================================================
// extractJobPostingMeta — pull {company, role, location} from a page
// ================================================================

function humanizeSlug(slug) {
  if (!slug) return '';
  // Strip common corporate suffixes so "machinifyinc" → "machinify"
  const clean = String(slug).replace(/(inc|llc|corp|co)$/i, '').trim();
  const base = clean || String(slug);
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim();
}

// Extract a company name from common ATS URL patterns. Returns '' if unknown.
function extractCompanyFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.split('/').filter(Boolean);

    // Greenhouse: boards.greenhouse.io/{slug}/jobs/...
    //             job-boards.greenhouse.io/{slug}/jobs/...
    if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
      if (path[0] && path[0] !== 'jobs') return humanizeSlug(path[0]);
    }
    // Lever: jobs.lever.co/{slug}/...
    if (host === 'jobs.lever.co' && path[0]) return humanizeSlug(path[0]);
    // Workable: apply.workable.com/{slug}/...
    if (host === 'apply.workable.com' && path[0]) return humanizeSlug(path[0]);
    // Ashby: jobs.ashbyhq.com/{slug}/...
    if (host === 'jobs.ashbyhq.com' && path[0]) return humanizeSlug(path[0]);
    // Rippling ATS: ats.rippling.com/{slug}/...
    if (host === 'ats.rippling.com' && path[0]) return humanizeSlug(path[0]);
    // Workday: {company}.wdNN.myworkdayjobs.com/...
    const wd = host.match(/^([^.]+)\..*myworkdayjobs\.com$/);
    if (wd) return humanizeSlug(wd[1]);
    // SmartRecruiters: jobs.smartrecruiters.com/{slug}/...
    if (host === 'jobs.smartrecruiters.com' && path[0]) return humanizeSlug(path[0]);
    // BambooHR: {slug}.bamboohr.com/...
    const bamboo = host.match(/^([^.]+)\.bamboohr\.com$/);
    if (bamboo) return humanizeSlug(bamboo[1]);
    // JazzHR: {slug}.applytojob.com/...
    const jazz = host.match(/^([^.]+)\.applytojob\.com$/);
    if (jazz) return humanizeSlug(jazz[1]);
    // Generic careers.{company}.com / jobs.{company}.com
    if ((host.startsWith('careers.') || host.startsWith('jobs.')) && host.split('.').length >= 3) {
      const parts = host.split('.');
      return humanizeSlug(parts[1]);
    }
    return '';
  } catch (_) { return ''; }
}

async function extractJobPostingMeta(jdText, sourceUrl) {
  const urlCompany = extractCompanyFromUrl(sourceUrl || '');

  if (!process.env.ANTHROPIC_API_KEY) {
    return { company: urlCompany, role: '', location: '' };
  }
  const client = getClient();
  const prompt = `Extract the employer company, the role title, and the location from this job posting.

IMPORTANT — company and role are DIFFERENT fields:
- "company" is the EMPLOYER (e.g. "Machinify", "Stripe", "Acme Corp")
- "role" is the POSITION TITLE (e.g. "Chief of Staff", "VP Engineering", "Software Engineer")
Never put the same value in both.

${urlCompany ? `HINT from URL: the company appears to be "${urlCompany}". Use this unless the page text clearly contradicts it.` : ''}

Respond with ONLY a JSON object like {"company":"Acme Corp","role":"Chief of Staff","location":"Remote"}. If a field is unknown use an empty string. No explanation.

URL: ${sourceUrl || '(unknown)'}

PAGE TEXT:
${(jdText || '').slice(0, 3500)}`;

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (resp.content?.[0]?.text || '').trim();
    const jsonStr = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(jsonStr);
    let company = String(parsed.company || '').slice(0, 200);
    const role = String(parsed.role || '').slice(0, 200);
    const location = String(parsed.location || '').slice(0, 200);
    // If the model returned the role as the company, or nothing for company,
    // prefer the URL-derived company.
    if (urlCompany && (!company || company.toLowerCase() === role.toLowerCase())) {
      company = urlCompany;
    }
    return { company, role, location };
  } catch (e) {
    console.error('[extractJobPostingMeta]', e.message);
    return { company: urlCompany, role: '', location: '' };
  }
}

async function fetchJobDescription(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; snag/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;/g, "'")
      .replace(/\s{2,}/g, ' ').trim().slice(0, 4000);
  } catch (e) { return ''; }
}

// ================================================================
// buildInterviewChatSystemPrompt — context injection for interview chat
// ================================================================

function buildInterviewChatSystemPrompt(ctx) {
  const {
    app, jdText, resumeText, coverLetter, profile, contacts, notes, activity,
    mode,
  } = ctx;
  const fullName = profile?.full_name || profile?.fullName || 'the candidate';
  const background = profile?.background_text || profile?.backgroundText || '';
  const targetRoles = Array.isArray(profile?.target_roles) ? profile.target_roles.join(', ') : '';

  const contactsBlock = (contacts || []).length
    ? (contacts || []).map((c) =>
        `- ${c.name}${c.title ? ` (${c.title})` : ''} — ${c.kind}${c.linkedin_url ? ` · ${c.linkedin_url}` : ''}${c.notes ? `\n   Notes: ${c.notes}` : ''}`
      ).join('\n')
    : '(none recorded)';

  const activityBlock = (activity || []).slice(-30).map((a) =>
    `- ${a.date || ''} ${a.type || ''}${a.note ? `: ${a.note}` : ''}`
  ).join('\n') || '(none)';

  const openingCoach = `You are a focused interview prep coach for ${fullName}. They are interviewing for the ${app.role} role at ${app.company}. Use the context below to help them prepare specific answers, anticipate questions, and research the people interviewing them. Ground every answer in the resume and cover letter facts — never invent experience. When they ask to practice, act as the interviewer.`;

  const openingPractice = `You are a skeptical hiring manager interviewing ${fullName} for the ${app.role} role at ${app.company}. Your job is to conduct a mock interview.

RULES:
- Ask ONE question per turn. Start behavioral or role-specific; escalate difficulty as the candidate warms up.
- After each candidate response, deliver your turn in this exact order:
  1. FEEDBACK: one short paragraph — what worked, what to sharpen. Be direct, specific, kind.
  2. FOLLOW-UP: one next question.
- Push for specifics when the answer is vague ("give me a number", "who was involved", "what happened next").
- Acknowledge when the candidate uses a fact from the resume well.
- NEVER invent experience or facts the candidate doesn't have in their resume.
- Keep each feedback paragraph under 80 words. Keep each question under 40 words.`;

  const opening = mode === 'practice' ? openingPractice : openingCoach;

  return `${opening}

ROLE: ${app.role}
COMPANY: ${app.company}

JOB DESCRIPTION:
${(jdText || '(not available)').slice(0, 4000)}

CANDIDATE:
Name: ${fullName}
Background: ${background}
Target roles: ${targetRoles}

RESUME (variant they submitted for this app):
${(resumeText || '(no resume attached)').slice(0, 4000)}

COVER LETTER:
${(coverLetter || '(none)').slice(0, 2000)}

PEOPLE ON THIS APPLICATION:
${contactsBlock}

RECENT NOTES:
${notes || '(none)'}

RECENT ACTIVITY:
${activityBlock}`;
}

module.exports = {
  buildCoverLetterSystemPrompt,
  buildInterviewChatSystemPrompt,
  DEFAULT_VARIANT_LABELS,
  cleanCoverLetterText,
  selectResumeVariant,
  generateCoverLetter,
  generateEmailDraft,
  generateResumeVariant,
  fetchJobDescription,
  extractJobPostingMeta,
  extractCompanyFromUrl,
};
