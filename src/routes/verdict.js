const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { expensiveLimiter } = require('../middleware/security');
const { validate, schemas } = require('../middleware/validate');
const { fetchJobDescription, extractJobPostingMeta } = require('../services/anthropic');
const { generateVerdict, neutralVerdict } = require('../services/verdict');
const { getResumeVariants } = require('../db/users');
const { logEvent, lengthBucket, urlHost } = require('../services/events');

const router = Router();

// POST /applications/verdict — returns a Haiku-powered fit verdict for a pasted URL.
router.post('/applications/verdict',
  requireAuth, expensiveLimiter, validate(schemas.parseUrlRequest),
  async (req, res) => {
    const { url } = req.body;
    const host = urlHost(url);

    // Fetch JD + lightweight meta extraction in parallel with resume load.
    let jdText = '';
    try { jdText = await fetchJobDescription(url); } catch (_) {}

    const [meta, variants] = await Promise.all([
      jdText && jdText.length > 200
        ? extractJobPostingMeta(jdText, url).catch(() => ({ company: '', role: '' }))
        : Promise.resolve({ company: '', role: '' }),
      getResumeVariants(req.user.id).catch(() => []),
    ]);

    // Pick the base resume if present; else any variant with content.
    const base = variants.find(v => v.slug === 'base' && v.parsed_text)
      || variants.find(v => v.parsed_text);
    const resumeText = base?.parsed_text || '';
    const profile = req.user.profile || {};

    let verdict;
    try {
      verdict = await generateVerdict({
        url,
        jdText,
        resumeText,
        targetRoles: profile.target_roles || profile.targetRoles || [],
        background: profile.background_text || profile.backgroundText || '',
        displayCompany: meta.company,
        displayRole: meta.role,
      });
    } catch (e) {
      console.error('[verdict]', e.message);
      // Return a neutral fallback so the UI still renders something useful
      // rather than propagating an error that would just blank the card.
      verdict = neutralVerdict("Couldn't run the fit check. Save or edit manually.");
    }

    logEvent(req.user.tenantId, req.user.id, 'verdict.generated', {
      payload: {
        verdict: verdict.verdict,
        score: verdict.score,
        host,
        jd_length_bucket: lengthBucket(jdText),
        has_base_resume: !!resumeText,
      },
    });

    res.json({ ...verdict, host });
  });

module.exports = router;
