const { diagLog } = require('../utils');

const VALID_VERDICTS = new Set(['strong_fit', 'fit', 'stretch', 'weak_fit']);

// Neutral fallback used when the JD can't be fetched.
function neutralVerdict(reason) {
  return {
    verdict: 'stretch',
    score: 50,
    reasoning: reason || "Couldn't read the posting clearly — fit estimate is uncertain.",
    green_flags: [],
    red_flags: [],
  };
}

// Call Haiku 4.5 for a structured fit verdict.
// Throws only on SDK/network errors. Callers decide how to surface them.
async function generateVerdict({ url, jdText, resumeText, targetRoles, background, displayCompany, displayRole }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  // No JD at all → return neutral fallback instead of calling the model.
  if (!jdText || jdText.length < 200) {
    return neutralVerdict();
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const roles = Array.isArray(targetRoles) ? targetRoles.join(', ') : '';
  const prompt = `You are sizing up whether a specific job posting is a good fit for a specific candidate. Return ONLY a JSON object with this exact shape, no preamble or explanation:

{
  "verdict": "strong_fit" | "fit" | "stretch" | "weak_fit",
  "score": 0..100,
  "reasoning": "2-3 sentence explanation.",
  "green_flags": ["up to 3 short strings"],
  "red_flags":   ["up to 3 short strings"]
}

STRICT RULES:
- Ground every flag in text actually present in either the posting or the resume. DO NOT invent facts about the candidate.
- "green_flags" are specific things the candidate's resume or background clearly matches with this role.
- "red_flags" are specific mismatches or concerns visible in the posting vs. the candidate.
- If neither is meaningfully inferable, leave the array empty.
- score: 80-100 = strong_fit, 60-79 = fit, 40-59 = stretch, 0-39 = weak_fit. Pick a score that matches the verdict you chose.
- reasoning: plain prose, 2-3 sentences. Reference concrete signals.

ROLE: ${displayRole || '(unknown)'}
COMPANY: ${displayCompany || '(unknown)'}
POSTING URL: ${url || '(unknown)'}

TARGET ROLES (candidate is searching for):
${roles || '(none listed)'}

CANDIDATE BACKGROUND:
${(background || '(none recorded)').slice(0, 1500)}

CANDIDATE RESUME (base):
${(resumeText || '(no base resume uploaded)').slice(0, 3000)}

JOB POSTING TEXT:
${jdText.slice(0, 4000)}`;

  let raw = '';
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    raw = (resp.content?.[0]?.text || '').trim();
  } catch (e) {
    diagLog('verdict model error: ' + e.message);
    throw new Error('Verdict model call failed: ' + e.message);
  }

  // Extract the first {...} block (robust to preambles or code fences).
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    diagLog('verdict: no JSON block in response');
    throw new Error('Could not parse verdict from model output');
  }

  let parsed;
  try { parsed = JSON.parse(match[0]); } catch (e) {
    diagLog('verdict parse failed: ' + e.message);
    throw new Error('Could not parse verdict JSON');
  }

  // Validate + clamp.
  const verdict = VALID_VERDICTS.has(parsed.verdict) ? parsed.verdict : 'stretch';
  let score = Number(parsed.score);
  if (!Number.isFinite(score)) score = 50;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const reasoning = String(parsed.reasoning || '').slice(0, 1000);
  const clean = (arr) => Array.isArray(arr)
    ? arr.filter(s => typeof s === 'string').slice(0, 3).map(s => s.slice(0, 200))
    : [];

  return {
    verdict,
    score,
    reasoning,
    green_flags: clean(parsed.green_flags),
    red_flags: clean(parsed.red_flags),
  };
}

module.exports = { generateVerdict, neutralVerdict, VALID_VERDICTS };
