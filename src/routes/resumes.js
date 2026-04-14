const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const { requireAuth } = require('../middleware/auth');
const { expensiveLimiter } = require('../middleware/security');
const { query } = require('../db/pool');
const { logEvent, lengthBucket } = require('../services/events');

const router = Router();

// Store uploads in data/resumes/ (persisted on Railway volume)
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'resumes');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

// Extract text from a PDF buffer using pdf-parse v2 (class-based) API.
// Returns normalized text or throws with a useful message.
async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const { text } = await parser.getText();
    return (text || '').replace(/\s+/g, ' ').trim();
  } finally {
    try { await parser.destroy(); } catch (_) {}
  }
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'angle';
}

// GET /api/resumes — list all variants for the user
router.get('/', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, slug, label, file_url, filename, is_default,
            (parsed_text IS NOT NULL AND length(parsed_text) > 0) AS has_content,
            length(parsed_text) AS text_length,
            created_at
     FROM resume_variants WHERE user_id = $1 ORDER BY
       CASE WHEN slug = 'base' THEN 0 ELSE 1 END,
       created_at`,
    [req.user.id]
  );
  res.json(rows);
});

// POST /api/resumes/base/upload — upload the user's single base resume PDF.
// Creates the 'base' variant on first upload; replaces its file on subsequent ones.
router.post('/base/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let parsedText = '';
  try {
    parsedText = await extractPdfText(req.file.buffer);
  } catch (e) {
    console.error('[resume] PDF parse error:', e.stack || e.message);
    return res.status(400).json({
      error: `PDF parse failed: ${e.message || 'unknown error'}. If this is a scanned image, run it through OCR first.`,
    });
  }

  if (!parsedText || parsedText.length < 30) {
    return res.status(400).json({
      error: 'PDF contained no extractable text (likely scanned or image-only). Run it through OCR or export from Word/Pages as text-based PDF.',
    });
  }

  const filename = `${req.user.id}_base_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, req.file.buffer);

  await query(
    `INSERT INTO resume_variants (user_id, slug, label, file_url, filename, parsed_text, is_default)
     VALUES ($1, 'base', 'Base Resume', $2, $3, $4, TRUE)
     ON CONFLICT (user_id, slug) DO UPDATE
       SET file_url = EXCLUDED.file_url,
           filename = EXCLUDED.filename,
           parsed_text = EXCLUDED.parsed_text,
           is_default = TRUE`,
    [req.user.id, `/data/resumes/${filename}`, req.file.originalname, parsedText]
  );

  // Ensure only base is marked default
  await query(
    `UPDATE resume_variants SET is_default = FALSE WHERE user_id = $1 AND slug <> 'base'`,
    [req.user.id]
  );

  logEvent(req.user.tenantId, req.user.id, 'resume.uploaded', {
    payload: { text_length: parsedText.length },
  });
  res.json({ ok: true, text_length: parsedText.length });
});

// POST /api/resumes/generate-variants — generate angled variants from the base resume.
// Body: { angles: [{ name, targetRole? }, ...] }  — up to 4 on Pro, 1 on Free.
router.post('/generate-variants', requireAuth, expensiveLimiter, async (req, res) => {
  const angles = Array.isArray(req.body?.angles) ? req.body.angles : [];
  if (!angles.length) return res.status(400).json({ error: 'angles required (array of { name, targetRole? })' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { isPro } = require('../middleware/tier');
  const { generateResumeVariant } = require('../services/anthropic');
  const pro = isPro(req.user);
  const limit = pro ? 4 : 1;
  const allowed = angles.slice(0, limit).filter(a => a && a.name && a.name.trim());
  if (!allowed.length) return res.status(400).json({ error: 'No valid angles provided' });

  // Load the user's base text — prefer 'base' slug, fall back to any uploaded variant with content.
  const { rows: baseRows } = await query(
    `SELECT parsed_text FROM resume_variants
      WHERE user_id = $1
        AND parsed_text IS NOT NULL
        AND length(parsed_text) > 100
      ORDER BY CASE WHEN slug = 'base' THEN 0 ELSE 1 END, created_at
      LIMIT 1`,
    [req.user.id]
  );
  if (!baseRows.length) {
    return res.status(400).json({ error: 'Upload a base resume first' });
  }
  const baseText = baseRows[0].parsed_text;

  const results = [];
  for (const a of allowed) {
    const name = a.name.trim();
    let slug = slugify(name);
    if (slug === 'base') slug = `${slug}-angle`;
    try {
      const text = await generateResumeVariant({
        baseText,
        angleName: name,
        targetRole: a.targetRole || name,
      });
      if (!text || text.length < 100) throw new Error('Model returned empty variant');
      await query(
        `INSERT INTO resume_variants (user_id, slug, label, parsed_text, is_default)
         VALUES ($1, $2, $3, $4, FALSE)
         ON CONFLICT (user_id, slug) DO UPDATE
           SET label = EXCLUDED.label,
               parsed_text = EXCLUDED.parsed_text`,
        [req.user.id, slug, name, text]
      );
      logEvent(req.user.tenantId, req.user.id, 'resume_variant.generated', {
        entityType: 'resume_variant',
        payload: {
          base_word_count: baseText.split(/\s+/).filter(Boolean).length,
          output_word_count: text.split(/\s+/).filter(Boolean).length,
          angle_source: a.targetRole && a.targetRole !== name ? 'target_role' : 'custom',
        },
      });
      results.push({ slug, label: name, ok: true, preview: text.slice(0, 200) });
    } catch (e) {
      console.error(`[resume-gen] ${name} failed:`, e.message);
      results.push({ slug, label: name, ok: false, error: e.message });
    }
  }

  res.json({ ok: true, pro, limit, results });
});

// POST /api/resumes/:slug/upload — upload PDF for an existing variant (legacy)
router.post('/:slug/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { slug } = req.params;
  if (slug === 'base') {
    return res.status(400).json({ error: 'Use /resumes/base/upload for the base resume' });
  }

  const { rows } = await query(
    `SELECT id FROM resume_variants WHERE user_id = $1 AND slug = $2`,
    [req.user.id, slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Resume variant not found' });

  let parsedText = '';
  try {
    parsedText = await extractPdfText(req.file.buffer);
  } catch (e) {
    console.error('[resume] PDF parse error:', e.stack || e.message);
    return res.status(400).json({ error: `PDF parse failed: ${e.message}` });
  }
  if (!parsedText || parsedText.length < 30) {
    return res.status(400).json({ error: 'PDF contained no extractable text (scanned or image-only).' });
  }

  const filename = `${req.user.id}_${slug}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, req.file.buffer);

  const { rows: updated } = await query(
    `UPDATE resume_variants
     SET file_url = $1, filename = $2, parsed_text = $3
     WHERE user_id = $4 AND slug = $5
     RETURNING id, slug, label, file_url, filename, is_default, created_at`,
    [`/data/resumes/${filename}`, req.file.originalname, parsedText, req.user.id, slug]
  );

  res.json(updated[0]);
});

// DELETE /api/resumes/:slug/file — clear uploaded file and parsed text (keeps the row)
router.delete('/:slug/file', requireAuth, async (req, res) => {
  const { slug } = req.params;
  const { rows } = await query(
    `SELECT id, file_url FROM resume_variants WHERE user_id = $1 AND slug = $2`,
    [req.user.id, slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Resume variant not found' });

  if (rows[0].file_url) {
    const filePath = path.join(__dirname, '..', '..', rows[0].file_url);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
  }

  await query(
    `UPDATE resume_variants SET file_url = '', filename = '', parsed_text = '' WHERE id = $1`,
    [rows[0].id]
  );

  res.json({ ok: true });
});

// DELETE /api/resumes/:slug — fully remove a variant row (and its file, if any).
// Blocks deleting the base resume — use /base/file to clear it without losing the slot.
router.delete('/:slug', requireAuth, async (req, res) => {
  const { slug } = req.params;
  if (slug === 'base') return res.status(400).json({ error: 'Cannot delete base variant — upload a new one to replace it.' });

  const { rows } = await query(
    `SELECT id, file_url FROM resume_variants WHERE user_id = $1 AND slug = $2`,
    [req.user.id, slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Resume variant not found' });

  if (rows[0].file_url) {
    const filePath = path.join(__dirname, '..', '..', rows[0].file_url);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
  }

  await query(`DELETE FROM resume_variants WHERE id = $1`, [rows[0].id]);
  res.json({ ok: true });
});

// GET /api/resumes/:slug/text — return the parsed resume text for a single variant
router.get('/:slug/text', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT slug, label, filename, parsed_text FROM resume_variants WHERE user_id = $1 AND slug = $2`,
    [req.user.id, req.params.slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Variant not found' });
  res.json(rows[0]);
});

// POST /api/resumes/generate — legacy: hardcoded operator/partner/builder/innovator angles
router.post('/generate', requireAuth, async (req, res) => {
  const { baseSlug, targetRole, angles } = req.body;
  if (!baseSlug) return res.status(400).json({ error: 'baseSlug required' });

  const { isPro } = require('../middleware/tier');
  const { generateResumeVariant } = require('../services/anthropic');
  const pro = isPro(req.user);

  const { rows: baseRows } = await query(
    `SELECT parsed_text FROM resume_variants WHERE user_id = $1 AND slug = $2`,
    [req.user.id, baseSlug]
  );
  if (!baseRows.length || !baseRows[0].parsed_text) {
    return res.status(400).json({ error: 'Base resume not uploaded or empty' });
  }
  const baseText = baseRows[0].parsed_text;

  const requestedAngles = Array.isArray(angles) && angles.length
    ? angles
    : ['operator', 'partner', 'builder', 'innovator'];
  const allowed = pro ? requestedAngles : requestedAngles.slice(0, 1);

  const results = [];
  for (const angle of allowed) {
    if (angle === baseSlug) continue;
    try {
      const text = await generateResumeVariant({ baseText, angle, targetRole });
      await query(
        `UPDATE resume_variants SET parsed_text = $1 WHERE user_id = $2 AND slug = $3`,
        [text, req.user.id, angle]
      );
      results.push({ angle, ok: true, preview: text.slice(0, 200) });
    } catch (e) {
      console.error(`[resume-gen] ${angle} failed:`, e.message);
      results.push({ angle, ok: false, error: e.message });
    }
  }

  res.json({ ok: true, results, pro });
});

// PATCH /api/resumes/:slug/default — set a variant as default
router.patch('/:slug/default', requireAuth, async (req, res) => {
  const { slug } = req.params;

  await query(`UPDATE resume_variants SET is_default = false WHERE user_id = $1`, [req.user.id]);

  const { rows } = await query(
    `UPDATE resume_variants SET is_default = true WHERE user_id = $1 AND slug = $2 RETURNING *`,
    [req.user.id, slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Variant not found' });

  res.json(rows[0]);
});

module.exports = router;
