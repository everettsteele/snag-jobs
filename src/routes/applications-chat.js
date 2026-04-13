const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { expensiveLimiter } = require('../middleware/security');
const { isPro, logAiUsage } = require('../middleware/tier');
const { getResumeVariants } = require('../db/users');
const {
  fetchJobDescription,
  buildInterviewChatSystemPrompt,
} = require('../services/anthropic');
const db = require('../db/store');

const CHAT_TURN_CAP = 80;
const MODEL = 'claude-sonnet-4-6';

const router = Router();

let _client = null;
function getClient() {
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

function requireInterviewing(app) {
  return app && app.status === 'interviewing';
}

// GET /applications/:id/chat → history + turn count
router.get('/applications/:id/chat', requireAuth, async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const messages = await db.listChatMessages(req.user.tenantId, req.params.id);
  const turnCount = messages.filter((m) => m.role === 'user').length;
  res.json({ messages, turn_count: turnCount, cap: CHAT_TURN_CAP });
});

// POST /applications/:id/chat → send a message, get a reply
router.post('/applications/:id/chat', requireAuth, expensiveLimiter,
  validate(schemas.chatMessageRequest), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }
  if (!isPro(req.user)) {
    return res.status(403).json({ error: 'Interview prep chat is a Pro feature', upgrade: true });
  }

  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (!requireInterviewing(app)) {
    return res.status(400).json({ error: 'Interview prep unlocks at Interviewing status' });
  }

  const turnCount = await db.countChatTurns(req.user.tenantId, req.params.id);
  if (turnCount >= CHAT_TURN_CAP) {
    return res.status(429).json({ error: 'Chat history full — clear to continue', cap: CHAT_TURN_CAP });
  }

  // Ensure JD text is cached.
  let jdText = app.jd_text || '';
  if (!jdText && app.source_url) {
    try {
      jdText = await fetchJobDescription(app.source_url);
      if (jdText && jdText.length > 50) {
        await db.setJdText(req.user.tenantId, app.id, jdText);
      }
    } catch (_) {}
  }

  // Pull resume variant text.
  let resumeText = '';
  if (app.resume_variant) {
    const variants = await getResumeVariants(req.user.id);
    const v = variants.find((x) => x.slug === app.resume_variant);
    resumeText = v?.parsed_text || '';
  }

  const contacts = await db.listApplicationContacts(req.user.tenantId, app.id);

  const systemPrompt = buildInterviewChatSystemPrompt({
    app,
    jdText,
    resumeText,
    coverLetter: app.cover_letter_text || '',
    profile: req.user.profile || {},
    contacts,
    notes: app.notes || '',
    activity: Array.isArray(app.activity) ? app.activity : [],
  });

  const history = await db.listChatMessages(req.user.tenantId, app.id);
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: req.body.message });

  let reply = '';
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const client = getClient();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages,
    });
    reply = (resp.content?.[0]?.text || '').trim();
    tokensIn = resp.usage?.input_tokens || 0;
    tokensOut = resp.usage?.output_tokens || 0;
  } catch (e) {
    console.error('[chat]', e.message);
    return res.status(500).json({ error: e.message || 'Chat failed' });
  }

  if (!reply) return res.status(500).json({ error: 'Empty reply from model' });

  await db.appendChatMessage(req.user.tenantId, app.id, 'user', req.body.message, 0, 0);
  const stored = await db.appendChatMessage(req.user.tenantId, app.id, 'assistant', reply, tokensIn, tokensOut);
  await logAiUsage(req.user.tenantId, req.user.id, 'interview_chat', tokensIn + tokensOut, {
    company: app.company, role: app.role,
  });

  const newTurnCount = await db.countChatTurns(req.user.tenantId, app.id);
  res.json({
    id: stored.id,
    reply,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    turn_count: newTurnCount,
    cap: CHAT_TURN_CAP,
  });
});

// DELETE /applications/:id/chat → clear history
router.delete('/applications/:id/chat', requireAuth, async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app || app.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  await db.clearChatMessages(req.user.tenantId, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
