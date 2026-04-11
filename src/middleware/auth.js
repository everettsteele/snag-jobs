const jwt = require('jsonwebtoken');
const { findUserById } = require('../db/users');

const JWT_SECRET = process.env.JWT_SECRET || 'hopespot-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

function signToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenant_id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Extract token from Authorization header or x-auth-token
function extractToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return req.headers['x-auth-token'] || req.query.token || null;
}

// Main auth middleware — sets req.user with full context
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  // Hydrate full user from DB (cached per-request)
  try {
    const user = await findUserById(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });

    req.user = {
      id: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
      tenantName: user.tenant_name,
      tenantPlan: user.tenant_plan,
      profile: {
        phone: user.phone,
        emailDisplay: user.email_display,
        linkedinUrl: user.linkedin_url,
        location: user.location,
        backgroundText: user.background_text,
        targetRoles: user.target_roles,
        targetGeography: user.target_geography,
        targetIndustries: user.target_industries,
        dailyOutreachTarget: user.daily_outreach_target,
        slaTarget: user.sla_target,
      },
    };
    next();
  } catch (e) {
    console.error('[auth] Error hydrating user:', e.message);
    res.status(500).json({ error: 'Authentication error' });
  }
}

// Optional auth — sets req.user if token present, but doesn't block
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  const payload = verifyToken(token);
  if (!payload) return next();

  try {
    const user = await findUserById(payload.userId);
    if (user) {
      req.user = {
        id: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
      };
    }
  } catch (e) { /* proceed without user context */ }
  next();
}

module.exports = { requireAuth, optionalAuth, signToken, verifyToken, JWT_SECRET };
