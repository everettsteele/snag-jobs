const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { query } = require('../db/pool');

const router = Router();

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
    _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

// GET /api/billing/status — current tier and billing info
router.get('/status', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT plan, stripe_customer_id, stripe_subscription_id FROM tenants WHERE id = $1`,
    [req.user.tenantId]
  );
  const tenant = rows[0] || {};

  // Get weekly AI usage
  const { getWeeklyUsage, isPro, LIMITS } = require('../middleware/tier');
  const usage = await getWeeklyUsage(req.user.id);
  const effectivePlan = isPro(req.user) ? 'pro' : (tenant.plan || 'free');

  res.json({
    plan: effectivePlan,
    hasStripe: !!tenant.stripe_customer_id,
    hasSubscription: !!tenant.stripe_subscription_id,
    usage: {
      cover_letters: usage.cover_letters || 0,
      limit: effectivePlan === 'pro' ? null : LIMITS.cover_letters_per_week,
    },
  });
});

// POST /api/billing/checkout — create Stripe checkout session for Pro upgrade
router.post('/checkout', requireAuth, async (req, res) => {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) return res.status(503).json({ error: 'Billing not configured' });

  const { rows } = await query(
    `SELECT stripe_customer_id, plan FROM tenants WHERE id = $1`,
    [req.user.tenantId]
  );
  const tenant = rows[0];
  if (tenant?.plan === 'pro') return res.status(400).json({ error: 'Already on Pro' });

  // Create or reuse Stripe customer
  let customerId = tenant?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: req.user.email });
    customerId = customer.id;
    await query(`UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2`, [customerId, req.user.tenantId]);
  }

  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/settings?billing=success`,
    cancel_url: `${appUrl}/settings?billing=cancel`,
  });

  res.json({ url: session.url });
});

// POST /api/billing/portal — redirect to Stripe billing portal
router.post('/portal', requireAuth, async (req, res) => {
  const stripe = getStripe();
  const { rows } = await query(
    `SELECT stripe_customer_id FROM tenants WHERE id = $1`,
    [req.user.tenantId]
  );
  if (!rows[0]?.stripe_customer_id) return res.status(400).json({ error: 'No billing account' });

  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const session = await stripe.billingPortal.sessions.create({
    customer: rows[0].stripe_customer_id,
    return_url: `${appUrl}/settings`,
  });

  res.json({ url: session.url });
});

// POST /api/billing/webhook — Stripe webhook handler
// NOTE: This must be mounted BEFORE express.json() middleware for raw body access
router.post('/webhook', async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) return res.status(503).json({ error: 'Webhook not configured' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.customer) {
        await query(
          `UPDATE tenants SET plan = 'pro', stripe_subscription_id = $1 WHERE stripe_customer_id = $2`,
          [session.subscription, session.customer]
        );
        console.log('[stripe] Upgraded to pro:', session.customer);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await query(
        `UPDATE tenants SET plan = 'free', stripe_subscription_id = NULL WHERE stripe_customer_id = $1`,
        [sub.customer]
      );
      console.log('[stripe] Downgraded to free:', sub.customer);
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      if (['canceled', 'unpaid'].includes(sub.status)) {
        await query(
          `UPDATE tenants SET plan = 'free', stripe_subscription_id = NULL WHERE stripe_customer_id = $1`,
          [sub.customer]
        );
        console.log('[stripe] Subscription canceled/unpaid:', sub.customer);
      }
      break;
    }
    case 'invoice.payment_failed': {
      console.warn('[stripe] Payment failed for customer:', event.data.object.customer);
      break;
    }
  }

  res.json({ received: true });
});

module.exports = router;
