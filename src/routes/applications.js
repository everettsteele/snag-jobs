const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas, VALID_APP_STATUSES } = require('../middleware/validate');
const { expensiveLimiter } = require('../middleware/security');
const { checkAiLimit, logAiUsage } = require('../middleware/tier');
const db = require('../db/store');
const { todayET, diagLog } = require('../utils');
const { generateCoverLetter, selectResumeVariant, fetchJobDescription, cleanCoverLetterText } = require('../services/anthropic');
const { getResumeVariants } = require('../db/users');

const router = Router();

// SSE clients for batch progress
const sseClients = new Map();

// Helper: Google Apps Script webhook
async function postToAppsScript(url, body) {
  const payload = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  let resp = await fetch(url, { method: 'POST', headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  let hops = 0;
  while (resp.status >= 300 && resp.status < 400 && hops < 5) {
    const loc = resp.headers.get('location');
    if (!loc) throw new Error('Redirect with no Location');
    diagLog('WEBHOOK redirect ' + resp.status + ' -> ' + loc.slice(0, 120));
    resp = await fetch(loc, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    hops++;
  }
  return resp;
}

function sendSSE(userId, event, data) {
  const client = sseClients.get(userId);
  if (client) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Fire-and-forget: auto-select a resume variant for a newly created app.
// Fast path — skips JD fetch if no source_url and lets selectResumeVariant
// work off role + notes. Keeps new apps from sitting with a blank Resume column.
function autoSelectResumeInBackground(tenantId, userId, app, userCtx) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  if (app.resume_variant) return;
  setImmediate(async () => {
    try {
      let jdText = '';
      if (app.source_url) {
        try { jdText = await fetchJobDescription(app.source_url); } catch (e) {}
      }
      if (!jdText || jdText.length < 50) {
        jdText = `Position: ${app.role} at ${app.company}. ${app.notes || ''}`.trim();
      }
      const userVariants = await getResumeVariants(userId);
      const variant = await selectResumeVariant(app, jdText, {
        fullName: userCtx.fullName,
        variants: userVariants,
      });
      if (!variant) return;
      // Re-read in case the app was deleted between creation and now
      const fresh = await db.getApplication(tenantId, app.id);
      if (!fresh || fresh.resume_variant) return;
      await db.updateApplication(tenantId, app.id, { resume_variant: variant });
      await db.logUsage(tenantId, userId, 'variant_select', 20, { company: app.company, variant, autocreate: true });
      diagLog(`AUTO-SELECT resume=${variant} for app=${app.id} company=${app.company}`);
    } catch (e) {
      diagLog('AUTO-SELECT failed: ' + e.message);
    }
  });
}

// ================================================================
// Routes — all scoped by req.user.tenantId / req.user.id
// ================================================================

router.get('/applications', requireAuth, async (req, res) => {
  const apps = await db.listApplications(req.user.tenantId, req.user.id);
  res.json(apps);
});

router.post('/applications', requireAuth, validate(schemas.applicationCreate), async (req, res) => {
  const { company, role, source_url, notion_url, notes, applied_date, status } = req.body;
  const today = applied_date || todayET();
  const fd = new Date(today + 'T12:00:00Z');
  fd.setDate(fd.getDate() + 7);

  const app = await db.createApplication(req.user.tenantId, req.user.id, {
    company, role, applied_date: today, status: status || 'queued',
    source_url: source_url || '', notion_url: notion_url || '',
    follow_up_date: fd.toISOString().split('T')[0],
    notes: notes || '',
    activity: [{ date: today, type: status || 'queued', note: 'Added to queue' }],
  });
  autoSelectResumeInBackground(req.user.tenantId, req.user.id, app, { fullName: req.user.fullName });
  res.json(app);
});

router.patch('/applications/:id', requireAuth, validate(schemas.applicationPatch), async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const today = todayET();
  const updates = { ...req.body, last_activity: today };

  // Log status changes to activity array
  if (req.body.status && req.body.status !== app.status) {
    const activity = Array.isArray(app.activity) ? [...app.activity] : [];
    activity.push({ date: today, type: req.body.status, note: req.body.activity_note || '' });
    updates.activity = activity;
  }
  delete updates.activity_note;

  const updated = await db.updateApplication(req.user.tenantId, req.params.id, updates);
  res.json(updated);
});

router.delete('/applications/:id', requireAuth, async (req, res) => {
  const deleted = await db.deleteApplication(req.user.tenantId, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Email sync — match emails to applications
router.post('/applications/email-sync', requireAuth, async (req, res) => {
  const matches = req.body.matches || [];
  if (!matches.length) return res.json({ ok: true, changed: 0 });

  let changed = 0;
  for (const { id, status, note, date } of matches) {
    const app = await db.getApplication(req.user.tenantId, id);
    if (!app) continue;
    const actDate = date || todayET();
    const updates = { last_activity: actDate };
    if (status && VALID_APP_STATUSES.includes(status) && status !== app.status) {
      updates.status = status;
    }
    const activity = Array.isArray(app.activity) ? [...app.activity] : [];
    activity.push({ date: actDate, type: status || 'note', note: note || '' });
    updates.activity = activity;
    await db.updateApplication(req.user.tenantId, id, updates);
    changed++;
  }
  res.json({ ok: true, changed });
});

// Cover letter — render as printable HTML
router.get('/applications/:id/cover-letter', requireAuth, async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app) return res.status(404).send('Application not found.');
  if (!app.cover_letter_text) return res.status(404).send('No cover letter generated yet.');

  const letterText = cleanCoverLetterText(app.cover_letter_text);
  const paragraphs = letterText.split(/\n{2,}/).map(p => p.replace(/\n/g, ' ').trim()).filter(p => p.length > 0);
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphsHtml = paragraphs.map(p => `<p>${esc(p)}</p>`).join('\n');
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const companyEsc = esc(app.company || '');

  // Use user profile for header instead of hardcoded values
  const profile = req.user.profile || {};
  const nameEsc = esc(req.user.fullName || '');
  const contactParts = [
    profile.emailDisplay || req.user.email,
    profile.phone,
    profile.linkedinUrl,
    profile.location,
  ].filter(Boolean).join(' &nbsp;|&nbsp; ');

  // Signature block
  const sigStyle = profile.signatureStyle || 'script';
  const sigClosing = esc(profile.signatureClosing || 'Sincerely,');
  let signatureHtml = '';
  if (sigStyle === 'none') {
    signatureHtml = '';
  } else if (sigStyle === 'image' && profile.signatureImageUrl) {
    // Pass auth token through so the image loads
    const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token || '';
    const filename = profile.signatureImageUrl.split('/').pop();
    const imgSrc = `/api/signature/file/${filename}?token=${encodeURIComponent(token)}`;
    signatureHtml = `<div class="sig-block"><div>${sigClosing}</div><img class="sig-img" src="${imgSrc}" alt="${nameEsc}" /><div class="sig-name">${nameEsc}</div></div>`;
  } else if (sigStyle === 'typed') {
    signatureHtml = `<div class="sig-block"><div>${sigClosing}</div><div class="sig-typed">${nameEsc}</div></div>`;
  } else {
    // script (default) — cursive font
    signatureHtml = `<div class="sig-block"><div>${sigClosing}</div><div class="sig-script">${nameEsc}</div><div class="sig-name">${nameEsc}</div></div>`;
  }

  const styles = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Times New Roman',serif;font-size:12pt;color:#000;background:#fff}
.page{max-width:8in;margin:0 auto;padding:1in}
.header{text-align:center;margin-bottom:32pt}
.header h1{font-size:14pt;font-weight:bold;letter-spacing:1px;margin-bottom:6pt}
.header .contact{font-size:10pt;color:#333}
.date{margin-bottom:10pt}
.company{margin-bottom:24pt}
p{margin-bottom:12pt;line-height:1.6;text-align:justify}
.sig-block{margin-top:24pt}
.sig-block > div:first-child{margin-bottom:4pt}
.sig-img{display:block;max-height:60pt;max-width:200pt;margin:4pt 0;object-fit:contain}
.sig-script{font-family:'Brush Script MT','Lucida Handwriting','Segoe Script',cursive;font-size:26pt;margin:4pt 0 6pt;color:#1a1a1a}
.sig-typed{margin:28pt 0 4pt;font-weight:bold}
.sig-name{font-size:11pt;color:#333}
.no-print{position:fixed;top:16px;right:16px;padding:10px 20px;background:#1f2d3d;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-family:sans-serif}
@media print{.no-print{display:none}body{font-size:12pt}.page{padding:0;max-width:100%}@page{margin:1in;size:letter}}
  `.trim();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${companyEsc} Cover Letter</title>
<style>${styles}</style>
</head>
<body>
<button class="no-print" onclick="window.print()">Print / Save as PDF</button>
<div class="page">
  <div class="header">
    <h1>${nameEsc}</h1>
    <div class="contact">${contactParts}</div>
  </div>
  <div class="date">${dateStr}</div>
  <div class="company">${companyEsc}</div>
  ${paragraphsHtml}
  ${signatureHtml}
</div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},400);});</script>
</body>
</html>`;
  res.set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-store').send(html);
});

// Generate cover letter for a single application (no Drive folder)
router.post('/applications/:id/generate-letter', requireAuth, checkAiLimit('cover_letters'), async (req, res) => {
  const app = await db.getApplication(req.user.tenantId, req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    let jdText = '';
    if (app.source_url) {
      jdText = await fetchJobDescription(app.source_url);
    }
    if (!jdText || jdText.length < 50) {
      jdText = `Position: ${app.role} at ${app.company}. ${app.notes || ''}`.trim();
    }

    const userProfile = req.user.profile || {};
    const coverLetter = await generateCoverLetter(app, jdText, {
      fullName: req.user.fullName,
      backgroundText: userProfile.backgroundText,
    });

    if (!coverLetter || coverLetter.length < 50) {
      return res.status(500).json({ error: 'AI returned empty letter' });
    }

    // Auto-select resume variant if not already set
    const today = todayET();
    const patch = { cover_letter_text: coverLetter, last_activity: today };
    if (!app.resume_variant) {
      try {
        const userVariants = await getResumeVariants(req.user.id);
        const variant = await selectResumeVariant(app, jdText, {
          fullName: req.user.fullName,
          variants: userVariants,
        });
        if (variant) {
          patch.resume_variant = variant;
          await db.logUsage(req.user.tenantId, req.user.id, 'variant_select', 20, { company: app.company, variant });
        }
      } catch (e) {
        diagLog('generate-letter auto-select failed: ' + e.message);
      }
    }

    const updated = await db.updateApplication(req.user.tenantId, app.id, patch);
    await db.logUsage(req.user.tenantId, req.user.id, 'cover_letters', 700, { company: app.company, single: true });

    res.json({ ok: true, application: updated });
  } catch (e) {
    console.error('[generate-letter]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Batch: generate cover letters + auto-select resume for all "identified" apps
router.post('/applications/batch-generate-letters', requireAuth, expensiveLimiter, checkAiLimit('cover_letters'), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const apps = await db.listApplications(req.user.tenantId, req.user.id);
  const targets = apps.filter(a => a.status === 'identified' && !a.cover_letter_text);
  if (!targets.length) return res.json({ ok: true, built: 0, message: 'No identified applications need cover letters' });

  const userId = req.user.id;
  const tenantId = req.user.tenantId;
  const userProfile = req.user.profile || {};

  diagLog(`BATCH-LETTERS starting for ${targets.length} identified apps (user=${userId})`);
  res.json({ ok: true, queued: targets.length, message: `Generating cover letters for ${targets.length} applications in background.` });

  setImmediate(async () => {
    let built = 0, failed = 0;
    const userVariants = await getResumeVariants(userId);
    for (let i = 0; i < targets.length; i++) {
      const appRec = targets[i];
      try {
        sendSSE(userId, 'progress', { current: i + 1, total: targets.length, company: appRec.company });
        let jdText = '';
        if (appRec.source_url) jdText = await fetchJobDescription(appRec.source_url);
        if (!jdText || jdText.length < 50) jdText = `Position: ${appRec.role} at ${appRec.company}. ${appRec.notes || ''}`.trim();

        const coverLetter = await generateCoverLetter(appRec, jdText, {
          fullName: req.user.fullName,
          backgroundText: userProfile.backgroundText,
        });
        if (!coverLetter || coverLetter.length < 50) { failed++; continue; }

        const today = todayET();
        const patch = { cover_letter_text: coverLetter, last_activity: today };
        if (!appRec.resume_variant) {
          try {
            const variant = await selectResumeVariant(appRec, jdText, {
              fullName: req.user.fullName,
              variants: userVariants,
            });
            if (variant) {
              patch.resume_variant = variant;
              await db.logUsage(tenantId, userId, 'variant_select', 20, { company: appRec.company, variant });
            }
          } catch (e) { diagLog('BATCH-LETTERS auto-select failed: ' + e.message); }
        }
        await db.updateApplication(tenantId, appRec.id, patch);
        await db.logUsage(tenantId, userId, 'cover_letter', 700, { company: appRec.company });
        built++;
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) { diagLog('BATCH-LETTERS EXCEPTION: ' + err.message); failed++; }
    }
    sendSSE(userId, 'complete', { built, failed });
    diagLog(`BATCH-LETTERS complete. Built: ${built}, Failed: ${failed}`);
  });
});

// Batch packages — generate cover letters + Drive folders
router.post('/applications/batch-packages', requireAuth, expensiveLimiter, checkAiLimit('cover_letters'), async (req, res) => {
  const webhookUrl = process.env.DRIVE_WEBHOOK_URL;
  if (!webhookUrl) return res.status(503).json({ error: 'DRIVE_WEBHOOK_URL not configured' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const apps = await db.listApplications(req.user.tenantId, req.user.id);
  const targets = apps.filter(a => a.status === 'queued' && (!a.cover_letter_text || !a.drive_url));
  if (!targets.length) return res.json({ ok: true, built: 0, message: 'All queued applications already have complete packages' });

  const userId = req.user.id;
  const tenantId = req.user.tenantId;
  const userProfile = req.user.profile || {};

  diagLog(`BATCH-PKG starting for ${targets.length} apps (user=${userId})`);
  res.json({ ok: true, queued: targets.length, message: `Building packages for ${targets.length} applications in background.` });

  // Process in background
  setImmediate(async () => {
    let built = 0, failed = 0;
    for (let i = 0; i < targets.length; i++) {
      const appRec = targets[i];
      try {
        sendSSE(userId, 'progress', { current: i + 1, total: targets.length, company: appRec.company });
        const today = todayET();
        let coverLetter = appRec.cover_letter_text;
        let jdText = '';

        // Phase 1: Generate cover letter
        if (!coverLetter) {
          jdText = await fetchJobDescription(appRec.source_url);
          if (!jdText || jdText.length < 50) jdText = `Position: ${appRec.role} at ${appRec.company}. ${appRec.notes || ''}`.trim();

          coverLetter = await generateCoverLetter(appRec, jdText, {
            fullName: req.user.fullName,
            backgroundText: userProfile.backgroundText,
          });
          if (!coverLetter || coverLetter.length < 50) { failed++; continue; }
          await db.updateApplication(tenantId, appRec.id, { cover_letter_text: coverLetter, last_activity: today });
          await db.logUsage(tenantId, userId, 'cover_letter', 700, { company: appRec.company });
        }

        // Phase 2: Resume variant + Drive folder
        if (!appRec.drive_url) {
          if (!jdText) {
            jdText = await fetchJobDescription(appRec.source_url);
            if (!jdText || jdText.length < 50) jdText = `Position: ${appRec.role} at ${appRec.company}. ${appRec.notes || ''}`.trim();
          }
          const userVariants = await getResumeVariants(userId);
          const variant = await selectResumeVariant(appRec, jdText, {
            fullName: req.user.fullName,
            variants: userVariants,
          });
          await db.updateApplication(tenantId, appRec.id, { resume_variant: variant });
          await db.logUsage(tenantId, userId, 'variant_select', 20, { company: appRec.company, variant });

          try {
            const response = await postToAppsScript(webhookUrl, {
              folderName: `${appRec.company} - ${appRec.role}`,
              variant, coverLetterText: coverLetter,
              company: appRec.company, role: appRec.role,
              // Pass user info for personalized documents
              userName: req.user.fullName,
              userEmail: userProfile.emailDisplay || req.user.email,
              userPhone: userProfile.phone || '',
              userLinkedin: userProfile.linkedinUrl || '',
              userLocation: userProfile.location || '',
            });
            const text = await response.text();
            let result; try { result = JSON.parse(text); } catch (e) { result = null; }
            if (result && result.ok) {
              const folderUrl = result.folderUrl || result.driveUrl || result.url || result.folder_url || '';
              if (folderUrl) {
                const activity = Array.isArray(appRec.activity) ? [...appRec.activity] : [];
                activity.push({ date: today, type: 'package_created', note: `${variant} package: ${folderUrl}` });
                await db.updateApplication(tenantId, appRec.id, {
                  drive_url: folderUrl, drive_folder_id: result.folderId || '',
                  last_activity: today, activity,
                });
              }
            }
          } catch (driveErr) { diagLog('BATCH-PKG webhook error: ' + driveErr.message); }
        }

        built++;
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) { diagLog('BATCH-PKG EXCEPTION: ' + err.message); failed++; }
    }
    sendSSE(userId, 'complete', { built, failed });
    diagLog(`BATCH-PKG complete. Built: ${built}, Failed: ${failed}`);
  });
});

// SSE endpoint for batch progress
router.get('/sse/batch-progress', requireAuth, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('event: connected\ndata: {}\n\n');
  sseClients.set(req.user.id, res);
  req.on('close', () => sseClients.delete(req.user.id));
});

// Single Drive package creation
router.post('/create-drive-package', requireAuth, async (req, res) => {
  const { app_id, variant, cover_letter_text, company, role } = req.body;
  if (!app_id || !variant || !cover_letter_text) return res.status(400).json({ error: 'app_id, variant, and cover_letter_text required' });
  const webhookUrl = process.env.DRIVE_WEBHOOK_URL;
  if (!webhookUrl) return res.status(503).json({ error: 'DRIVE_WEBHOOK_URL not configured.' });

  const app = await db.getApplication(req.user.tenantId, app_id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  try {
    const profile = req.user.profile || {};
    const response = await postToAppsScript(webhookUrl, {
      folderName: `${company || app.company} - ${role || app.role}`,
      variant, coverLetterText: cover_letter_text,
      company: company || app.company, role: role || app.role,
      userName: req.user.fullName,
      userEmail: profile.emailDisplay || req.user.email,
      userPhone: profile.phone || '',
      userLinkedin: profile.linkedinUrl || '',
      userLocation: profile.location || '',
    });
    const text = await response.text();
    let result; try { result = JSON.parse(text); } catch (e) { return res.status(500).json({ error: 'Apps Script non-JSON response' }); }
    if (!result.ok) return res.status(500).json({ error: result.error || 'Drive webhook failed' });

    const today = todayET();
    const activity = Array.isArray(app.activity) ? [...app.activity] : [];
    activity.push({ date: today, type: 'package_created', note: 'Drive: ' + result.folderUrl });
    await db.updateApplication(req.user.tenantId, app_id, {
      drive_url: result.folderUrl, drive_folder_id: result.folderId,
      last_activity: today, activity,
    });
    res.json({ ok: true, folderUrl: result.folderUrl, folderId: result.folderId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Data export
router.get('/export/applications', requireAuth, async (req, res) => {
  const apps = await db.listApplications(req.user.tenantId, req.user.id);
  if (req.query.format === 'csv') {
    const header = 'Company,Role,Status,Applied Date,Follow-up,Source URL,Notes';
    const rows = apps.map(a =>
      [a.company, a.role, a.status, a.applied_date, a.follow_up_date || '', a.source_url, (a.notes || '').replace(/"/g, '""')]
        .map(f => `"${f}"`).join(',')
    );
    res.set('Content-Type', 'text/csv').set('Content-Disposition', 'attachment; filename="applications.csv"');
    return res.send([header, ...rows].join('\n'));
  }
  res.json(apps);
});

module.exports = router;
module.exports.autoSelectResumeInBackground = autoSelectResumeInBackground;
