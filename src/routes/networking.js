const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const db = require('../db/store');
const { todayET, daysAgoStr } = require('../utils');

const router = Router();

router.get('/events', requireAuth, async (req, res) => {
  const { days, include_hidden } = req.query;
  const events = await db.listEvents(req.user.tenantId, req.user.id, {
    includeHidden: include_hidden === 'true',
    days: days ? parseInt(days) : null,
  });
  res.json(events);
});

router.post('/events', requireAuth, validate(schemas.eventCreate), async (req, res) => {
  const event = await db.createEvent(req.user.tenantId, req.user.id, req.body);
  res.json(event);
});

router.patch('/events/:id', requireAuth, async (req, res) => {
  const updated = await db.updateEvent(req.user.tenantId, req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// Add a next-step to an event
router.post('/events/:id/steps', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });

  const existing = await db.getEvent(req.user.tenantId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const newStep = {
    id: require('crypto').randomUUID(),
    text: text.trim(),
    done: false,
    due_date: req.body.due_date || null,
    created_at: new Date().toISOString(),
  };
  const steps = [...(existing.next_steps || []), newStep];
  const updated = await db.updateEvent(req.user.tenantId, req.params.id, { next_steps: steps });
  res.json(updated);
});

// Toggle/update a next-step
router.patch('/events/:id/steps/:stepId', requireAuth, async (req, res) => {
  const existing = await db.getEvent(req.user.tenantId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const steps = (existing.next_steps || []).map(s =>
    s.id === req.params.stepId ? { ...s, ...req.body } : s
  );
  const updated = await db.updateEvent(req.user.tenantId, req.params.id, { next_steps: steps });
  res.json(updated);
});

// Delete a next-step
router.delete('/events/:id/steps/:stepId', requireAuth, async (req, res) => {
  const existing = await db.getEvent(req.user.tenantId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const steps = (existing.next_steps || []).filter(s => s.id !== req.params.stepId);
  const updated = await db.updateEvent(req.user.tenantId, req.params.id, { next_steps: steps });
  res.json(updated);
});

// Add a contact to an event
router.post('/events/:id/contacts', requireAuth, async (req, res) => {
  const { name, email, role, company } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  const existing = await db.getEvent(req.user.tenantId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const newContact = {
    id: require('crypto').randomUUID(),
    name: name.trim(),
    email: email?.trim() || '',
    role: role?.trim() || '',
    company: company?.trim() || '',
    notes: req.body.notes || '',
  };
  const contacts = [...(existing.contacts || []), newContact];
  const updated = await db.updateEvent(req.user.tenantId, req.params.id, { contacts });
  res.json(updated);
});

// Update a contact on an event
router.patch('/events/:id/contacts/:contactId', requireAuth, async (req, res) => {
  const existing = await db.getEvent(req.user.tenantId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const contacts = (existing.contacts || []).map(c =>
    c.id === req.params.contactId ? { ...c, ...req.body } : c
  );
  const updated = await db.updateEvent(req.user.tenantId, req.params.id, { contacts });
  res.json(updated);
});

// Delete a contact from an event
router.delete('/events/:id/contacts/:contactId', requireAuth, async (req, res) => {
  const existing = await db.getEvent(req.user.tenantId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const contacts = (existing.contacts || []).filter(c => c.id !== req.params.contactId);
  const updated = await db.updateEvent(req.user.tenantId, req.params.id, { contacts });
  res.json(updated);
});

router.delete('/events/:id', requireAuth, async (req, res) => {
  const deleted = await db.deleteEvent(req.user.tenantId, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

router.post('/calendar-sync', requireAuth, async (req, res) => {
  let incoming = req.body.events || [];
  if (!incoming.length) return res.json({ ok: true, added: 0, updated: 0, filtered: 0 });

  const calCfg = await db.getCalConfig(req.user.id);
  let filtered = 0;
  if (calCfg.setup_complete && calCfg.whitelisted_calendar_ids?.length > 0) {
    const before = incoming.length;
    incoming = incoming.filter(ev => !ev.calendar_id || calCfg.whitelisted_calendar_ids.includes(ev.calendar_id));
    filtered = before - incoming.length;
  }

  // Get existing events to check for updates
  const existing = await db.listEvents(req.user.tenantId, req.user.id, { includeHidden: true });
  const extIds = new Set(existing.filter(e => e.external_id).map(e => e.external_id));

  let added = 0, updated = 0;
  for (const ev of incoming) {
    if (!ev.title || !ev.start_date) continue;
    if (ev.external_id && extIds.has(ev.external_id)) {
      const existingEvent = existing.find(e => e.external_id === ev.external_id);
      if (existingEvent) {
        await db.updateEvent(req.user.tenantId, existingEvent.id, {
          title: ev.title, start_date: ev.start_date,
          start_time: ev.start_time || existingEvent.start_time || '',
          end_time: ev.end_time || existingEvent.end_time || '',
          location: ev.location || existingEvent.location || '',
          attendees: ev.attendees || existingEvent.attendees || [],
        });
        updated++;
      }
    } else {
      await db.createEvent(req.user.tenantId, req.user.id, {
        source: 'google_calendar', external_id: ev.external_id,
        calendar_id: ev.calendar_id, calendar_name: ev.calendar_name,
        title: ev.title, start_date: ev.start_date,
        start_time: ev.start_time || '', end_time: ev.end_time || '',
        location: ev.location || '', attendees: ev.attendees || [],
      });
      if (ev.external_id) extIds.add(ev.external_id);
      added++;
    }
  }
  res.json({ ok: true, added, updated, filtered });
});

router.get('/calendar-config', requireAuth, async (req, res) => {
  res.json(await db.getCalConfig(req.user.id));
});

router.post('/calendar-config', requireAuth, async (req, res) => {
  const config = await db.getCalConfig(req.user.id);
  const { whitelisted_calendar_ids, whitelisted_calendar_names, setup_complete } = req.body;
  const updated = { ...config };
  if (whitelisted_calendar_ids !== undefined) updated.whitelisted_calendar_ids = whitelisted_calendar_ids;
  if (whitelisted_calendar_names !== undefined) updated.whitelisted_calendar_names = whitelisted_calendar_names;
  if (setup_complete !== undefined) updated.setup_complete = setup_complete;
  await db.saveCalConfig(req.user.id, updated);
  res.json({ ok: true, config: updated });
});

// Export networking contacts
router.get('/export/networking', requireAuth, async (req, res) => {
  const events = await db.listEvents(req.user.tenantId, req.user.id, { includeHidden: false });
  const contactMap = {};
  events.forEach(e => {
    (e.contacts || []).forEach(c => {
      const key = c.email ? c.email.toLowerCase() : (c.name || '').toLowerCase();
      if (!contactMap[key]) contactMap[key] = { name: c.name, company: c.company || '', role: c.role || '', email: c.email || '', events: [] };
      contactMap[key].events.push(e.title);
    });
  });
  const contacts = Object.values(contactMap);

  if (req.query.format === 'csv') {
    const header = 'Name,Company,Role,Email,Events';
    const rows = contacts.map(c =>
      [c.name, c.company, c.role, c.email, c.events.join('; ')]
        .map(f => `"${String(f || '').replace(/"/g, '""')}"`).join(',')
    );
    res.set('Content-Type', 'text/csv').set('Content-Disposition', 'attachment; filename="networking-contacts.csv"');
    return res.send([header, ...rows].join('\n'));
  }
  res.json(contacts);
});

module.exports = router;
