const { query } = require('../db/pool');

// Free tier limits
const LIMITS = {
  cover_letters_per_week: 3,
  resumes: 1,
};

// Middleware: require Pro plan
function requirePro(req, res, next) {
  if (req.user?.tenantPlan === 'pro') return next();
  res.status(403).json({ error: 'Pro plan required', upgrade: true });
}

// Middleware: check AI usage limit for free tier
function checkAiLimit(action) {
  return async (req, res, next) => {
    // Pro users are unlimited
    if (req.user?.tenantPlan === 'pro') return next();

    const limit = LIMITS[`${action}_per_week`];
    if (!limit) return next();

    try {
      const { rows } = await query(
        `SELECT COUNT(*)::int as count FROM usage_log
         WHERE user_id = $1 AND action = $2
         AND created_at > NOW() - INTERVAL '7 days'`,
        [req.user.id, action]
      );
      if (rows[0].count >= limit) {
        return res.status(429).json({
          error: `Free plan limit reached (${limit} ${action.replace('_', ' ')}s per week). Upgrade to Pro for unlimited.`,
          limit,
          used: rows[0].count,
          upgrade: true,
        });
      }
    } catch (e) {
      console.error('[checkAiLimit]', e.message);
    }
    next();
  };
}

// Log AI usage
async function logAiUsage(tenantId, userId, action, tokensUsed, metadata) {
  try {
    await query(
      `INSERT INTO usage_log (tenant_id, user_id, action, tokens_used, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [tenantId, userId, action, tokensUsed || 0, JSON.stringify(metadata || {})]
    );
  } catch (e) {
    console.error('[logAiUsage]', e.message);
  }
}

// Get weekly usage counts for a user
async function getWeeklyUsage(userId) {
  try {
    const { rows } = await query(
      `SELECT action, COUNT(*)::int as count FROM usage_log
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY action`,
      [userId]
    );
    return rows.reduce((acc, r) => { acc[r.action] = r.count; return acc; }, {});
  } catch (e) {
    return {};
  }
}

module.exports = { requirePro, checkAiLimit, logAiUsage, getWeeklyUsage, LIMITS };
