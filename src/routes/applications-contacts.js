const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const db = require('../db/store');

const router = Router();

// GET /applications/:id/contacts
router.get('/applications/:id/contacts', requireAuth, async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const contacts = await db.listApplicationContacts(req.user.tenantId, req.params.id);
  res.json(contacts);
});

// POST /applications/:id/contacts
router.post('/applications/:id/contacts', requireAuth, validate(schemas.applicationContactCreate), async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const created = await db.createApplicationContact(req.user.tenantId, req.params.id, req.body);
  res.json(created);
});

// PATCH /applications/contacts/:contactId
router.patch('/applications/contacts/:contactId', requireAuth, validate(schemas.applicationContactPatch), async (req, res) => {
  const updated = await db.updateApplicationContact(req.user.tenantId, req.params.contactId, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// DELETE /applications/contacts/:contactId
router.delete('/applications/contacts/:contactId', requireAuth, async (req, res) => {
  const ok = await db.deleteApplicationContact(req.user.tenantId, req.params.contactId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
