const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { expensiveLimiter } = require('../middleware/security');
const { logAiUsage, isPro } = require('../middleware/tier');
const db = require('../db/store');
const { fetchJobDescription } = require('../services/anthropic');
const {
  companyKey, getCachedDossier, buildDossier, isFresh, ageDays,
} = require('../services/dossier');
const { logEvent, lengthBucket } = require('../services/events');

const router = Router();

// Count how many fresh dossier generations this user has logged in the past 7 days.
async function dossierQuotaUsed(userId) {
  const { query } = require('../db/pool');
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM usage_log
       WHERE user_id = $1 AND action = 'dossier_generation'
       AND created_at > NOW() - INTERVAL '7 days'`,
    [userId]
  );
  return rows[0]?.n || 0;
}

// Describe the user's current quota state for the UI.
async function quotaState(user) {
  if (isPro(user)) return { pro: true, used: null, cap: null, remaining: null };
  const used = await dossierQuotaUsed(user.id);
  const cap = 3;
  return { pro: false, used, cap, remaining: Math.max(0, cap - used) };
}

// GET /applications/:id/dossier
// Returns { dossier, cached, stale, quota } — never triggers generation.
router.get('/applications/:id/dossier', requireAuth, async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const key = companyKey(app.company, app.source_url);
  const dossier = key ? await getCachedDossier(key) : null;
  const quota = await quotaState(req.user);

  if (dossier) {
    logEvent(req.user.tenantId, req.user.id, 'company_dossier.read', {
      entityType: 'application',
      entityId: app.id,
      payload: { company_key: key, from_cache: true, stale: !isFresh(dossier), age_days: ageDays(dossier) },
    });
  }

  res.json({
    dossier,
    cached: !!dossier,
    stale: dossier ? !isFresh(dossier) : false,
    quota,
  });
});

// POST /applications/:id/dossier/build
// Generates (or regenerates) a dossier. Quota-gated for Free users.
router.post('/applications/:id/dossier/build',
  requireAuth, expensiveLimiter,
  async (req, res) => {
    const app = await db.getApplication(req.user.tenantId, req.params.id);
    if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });

    const key = companyKey(app.company, app.source_url);
    if (!key) return res.status(422).json({ error: 'Cannot build dossier: company and source URL both empty' });

    // Cached + fresh? Serve from cache without incurring quota.
    const existing = await getCachedDossier(key);
    const forceRefresh = req.body?.refresh === true;
    if (existing && isFresh(existing) && !forceRefresh) {
      const quota = await quotaState(req.user);
      return res.json({ dossier: existing, cached: true, stale: false, quota });
    }

    // If a refresh was requested, only Pro can do it.
    if (forceRefresh && existing && !isPro(req.user)) {
      return res.status(403).json({ error: 'Dossier refresh is a Pro feature', upgrade: true });
    }

    // Quota check for Free users — only on net-new generations (cached fresh hits returned above).
    if (!isPro(req.user)) {
      const { query } = require('../db/pool');
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM usage_log
           WHERE user_id = $1 AND action = 'dossier_generation'
           AND created_at > NOW() - INTERVAL '7 days'`,
        [req.user.id]
      );
      if ((rows[0]?.n || 0) >= 3) {
        return res.status(429).json({
          error: 'Free plan limit reached (3 dossier generations per week). Upgrade to Pro for unlimited.',
          limit: 3,
          used: rows[0]?.n || 0,
          upgrade: true,
        });
      }
    }

    // Need JD text for generation.
    let jdText = app.jd_text || '';
    if (!jdText && app.source_url) {
      try {
        jdText = await fetchJobDescription(app.source_url);
        if (jdText && jdText.length > 50) {
          await db.setJdText(req.user.tenantId, app.id, jdText);
        }
      } catch (_) {}
    }
    if (!jdText || jdText.length < 200) {
      return res.status(422).json({ error: 'Not enough context — the job description is missing or too short to summarize the company.' });
    }

    let dossier;
    try {
      dossier = await buildDossier({
        userId: req.user.id,
        company: app.company,
        sourceUrl: app.source_url,
        jdText,
      });
    } catch (e) {
      console.error('[dossier build]', e.message);
      return res.status(500).json({ error: e.message || 'Dossier build failed' });
    }

    // Log quota usage for net-new generations.
    await logAiUsage(req.user.tenantId, req.user.id, 'dossier_generation',
      (dossier.tokens_in || 0) + (dossier.tokens_out || 0),
      { company_key: key });

    logEvent(req.user.tenantId, req.user.id,
      forceRefresh ? 'company_dossier.refresh_requested' : 'company_dossier.built', {
      entityType: 'application',
      entityId: app.id,
      payload: {
        company_key: key,
        from_cache: false,
        tokens_in: dossier.tokens_in || 0,
        tokens_out: dossier.tokens_out || 0,
        jd_length_bucket: lengthBucket(jdText),
        ...(forceRefresh ? { was_stale: !!(existing && !isFresh(existing)) } : {}),
      },
    });

    const quota = await quotaState(req.user);
    res.json({ dossier, cached: false, stale: false, quota });
  });

module.exports = router;
