const { Router } = require('express');
const { z } = require('zod');
const { signToken, requireAuth } = require('../middleware/auth');
const { createTenantWithOwner, findUserByEmail, verifyPassword, updateProfile, getResumeVariants } = require('../db/users');

const router = Router();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  full_name: z.string().min(1).max(200),
  tenant_name: z.string().max(200).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const profileUpdateSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).optional(),
  email_display: z.string().max(320).optional(),
  linkedin_url: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  background_text: z.string().max(10000).optional(),
  target_roles: z.array(z.string().max(100)).max(20).optional(),
  target_geography: z.array(z.string().max(100)).max(20).optional(),
  target_industries: z.array(z.string().max(100)).max(20).optional(),
  daily_outreach_target: z.number().int().min(1).max(100).optional(),
  sla_target: z.number().int().min(1).max(100).optional(),
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
  }
  const { email, password, full_name, tenant_name } = parsed.data;

  // Check if email already exists
  const existing = await findUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  try {
    const { tenant, user } = await createTenantWithOwner({
      tenantName: tenant_name,
      email,
      password,
      fullName: full_name,
    });

    const token = signToken(user);
    res.status(201).json({
      ok: true,
      token,
      user: { id: user.id, email: user.email, role: user.role, tenant_id: tenant.id },
    });
  } catch (e) {
    console.error('[auth] Registration error:', e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const { email, password } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await verifyPassword(user, password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user);
  res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      full_name: user.full_name,
    },
  });
});

// GET /api/auth/me — returns current user + profile
router.get('/me', requireAuth, async (req, res) => {
  const variants = await getResumeVariants(req.user.id);
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      tenantId: req.user.tenantId,
      tenantName: req.user.tenantName,
      tenantPlan: req.user.tenantPlan,
    },
    profile: req.user.profile,
    resumeVariants: variants,
  });
});

// PATCH /api/auth/profile — update current user's profile
router.patch('/profile', requireAuth, async (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
  }

  const updated = await updateProfile(req.user.id, parsed.data);
  if (!updated) return res.status(400).json({ error: 'No valid fields to update' });
  res.json({ ok: true, profile: updated });
});

// GET /api/auth/check — lightweight auth check (no DB lookup needed since middleware does it)
router.get('/check', requireAuth, (req, res) => {
  res.json({ ok: true, userId: req.user.id, tenantId: req.user.tenantId });
});

module.exports = router;
