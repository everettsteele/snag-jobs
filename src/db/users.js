const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('./pool');

const SALT_ROUNDS = 12;

// Create a new tenant + owner user in one transaction
async function createTenantWithOwner({ tenantName, email, password, fullName }) {
  return withTransaction(async (client) => {
    // Create tenant
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (name) VALUES ($1) RETURNING *`,
      [tenantName || `${fullName}'s Workspace`]
    );

    // Create user
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows: [user] } = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner') RETURNING id, tenant_id, email, role, created_at`,
      [tenant.id, email, passwordHash]
    );

    // Create empty profile
    await client.query(
      `INSERT INTO user_profiles (user_id, full_name, email_display)
       VALUES ($1, $2, $3)`,
      [user.id, fullName || '', email]
    );

    // Create default resume variants
    const defaultVariants = [
      { slug: 'operator', label: 'Integrator/COO — EOS, scaling, building the operational machine' },
      { slug: 'partner', label: 'Chief of Staff — right-hand to CEO, strategic ops, force multiplier' },
      { slug: 'builder', label: 'VP/SVP Operations — multi-function ownership, revenue ops, GTM' },
      { slug: 'innovator', label: 'AI/Special Projects — AI, automation, innovation' },
    ];
    for (const v of defaultVariants) {
      await client.query(
        `INSERT INTO resume_variants (user_id, slug, label, is_default)
         VALUES ($1, $2, $3, $4)`,
        [user.id, v.slug, v.label, v.slug === 'operator']
      );
    }

    // Create default job search config
    await client.query(
      `INSERT INTO job_search_config (user_id) VALUES ($1)`,
      [user.id]
    );

    // Create default calendar config
    await client.query(
      `INSERT INTO calendar_config (user_id) VALUES ($1)`,
      [user.id]
    );

    return { tenant, user };
  });
}

async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT u.*, up.full_name, t.name as tenant_name, t.plan as tenant_plan
     FROM users u
     JOIN user_profiles up ON up.user_id = u.id
     JOIN tenants t ON t.id = u.tenant_id
     WHERE u.email = $1`,
    [email]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await query(
    `SELECT u.id, u.tenant_id, u.email, u.role, u.created_at,
            up.full_name, up.phone, up.email_display, up.linkedin_url,
            up.location, up.background_text, up.target_roles, up.target_geography,
            up.target_industries, up.daily_outreach_target, up.sla_target,
            up.weekly_outreach_target, up.weekly_apps_target,
            up.weekly_events_target, up.weekly_followups_target,
            up.signature_style, up.signature_image_url, up.signature_closing,
            t.name as tenant_name, t.plan as tenant_plan
     FROM users u
     JOIN user_profiles up ON up.user_id = u.id
     JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.password_hash);
}

async function updateProfile(userId, fields) {
  const allowed = [
    'full_name', 'phone', 'email_display', 'linkedin_url', 'location',
    'background_text', 'target_roles', 'target_geography', 'target_industries',
    'daily_outreach_target', 'sla_target',
    'weekly_outreach_target', 'weekly_apps_target', 'weekly_events_target', 'weekly_followups_target',
    'signature_style', 'signature_closing',
  ];

  const sets = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }
  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  values.push(userId);

  const { rows } = await query(
    `UPDATE user_profiles SET ${sets.join(', ')} WHERE user_id = $${idx} RETURNING *`,
    values
  );
  return rows[0];
}

async function getResumeVariants(userId) {
  const { rows } = await query(
    `SELECT * FROM resume_variants WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );
  return rows;
}

module.exports = {
  createTenantWithOwner,
  findUserByEmail,
  findUserById,
  verifyPassword,
  updateProfile,
  getResumeVariants,
};
