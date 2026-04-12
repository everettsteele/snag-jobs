const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const { requireAuth } = require('../middleware/auth');
const { query } = require('../db/pool');

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

// GET /api/resumes — list all variants for the user
router.get('/', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, slug, label, file_url, filename, is_default,
            (parsed_text IS NOT NULL AND length(parsed_text) > 0) AS has_content,
            length(parsed_text) AS text_length,
            created_at
     FROM resume_variants WHERE user_id = $1 ORDER BY created_at`,
    [req.user.id]
  );
  res.json(rows);
});

// POST /api/resumes/:slug/upload — upload PDF for a variant
router.post('/:slug/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { slug } = req.params;

  // Verify the variant exists and belongs to user
  const { rows } = await query(
    `SELECT id FROM resume_variants WHERE user_id = $1 AND slug = $2`,
    [req.user.id, slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Resume variant not found' });

  // Parse PDF text
  let parsedText = '';
  try {
    const pdfData = await pdfParse(req.file.buffer);
    parsedText = pdfData.text.replace(/\s+/g, ' ').trim();
  } catch (e) {
    console.error('[resume] PDF parse error:', e.message);
    return res.status(400).json({ error: 'Could not parse PDF. Make sure it contains text (not scanned images).' });
  }

  if (!parsedText || parsedText.length < 50) {
    return res.status(400).json({ error: 'PDF appears to be empty or image-only. Upload a text-based PDF.' });
  }

  // Save file to disk
  const filename = `${req.user.id}_${slug}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, req.file.buffer);

  // Update DB
  const { rows: updated } = await query(
    `UPDATE resume_variants
     SET file_url = $1, filename = $2, parsed_text = $3
     WHERE user_id = $4 AND slug = $5
     RETURNING id, slug, label, file_url, filename, is_default, created_at`,
    [`/data/resumes/${filename}`, req.file.originalname, parsedText, req.user.id, slug]
  );

  res.json(updated[0]);
});

// DELETE /api/resumes/:slug/file — remove uploaded file from a variant
router.delete('/:slug/file', requireAuth, async (req, res) => {
  const { slug } = req.params;
  const { rows } = await query(
    `SELECT id, file_url FROM resume_variants WHERE user_id = $1 AND slug = $2`,
    [req.user.id, slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Resume variant not found' });

  // Delete physical file if it exists
  if (rows[0].file_url) {
    const filePath = path.join(__dirname, '..', '..', rows[0].file_url);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
  }

  // Clear DB fields
  await query(
    `UPDATE resume_variants SET file_url = '', filename = '', parsed_text = '' WHERE id = $1`,
    [rows[0].id]
  );

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

// POST /api/resumes/generate — AI-generate angle variants from a base resume
// Free users: 1 angle. Pro: 4 angles.
router.post('/generate', requireAuth, async (req, res) => {
  const { baseSlug, targetRole, angles } = req.body;
  if (!baseSlug) return res.status(400).json({ error: 'baseSlug required' });

  const { isPro } = require('../middleware/tier');
  const { generateResumeVariant } = require('../services/anthropic');
  const pro = isPro(req.user);

  // Load base resume text
  const { rows: baseRows } = await query(
    `SELECT parsed_text FROM resume_variants WHERE user_id = $1 AND slug = $2`,
    [req.user.id, baseSlug]
  );
  if (!baseRows.length || !baseRows[0].parsed_text) {
    return res.status(400).json({ error: 'Base resume not uploaded or empty' });
  }
  const baseText = baseRows[0].parsed_text;

  // Determine which angles to generate
  const requestedAngles = Array.isArray(angles) && angles.length
    ? angles
    : ['operator', 'partner', 'builder', 'innovator'];
  const allowed = pro ? requestedAngles : requestedAngles.slice(0, 1);

  const results = [];
  for (const angle of allowed) {
    if (angle === baseSlug) continue; // Don't overwrite base
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

  // Unset all defaults for this user
  await query(`UPDATE resume_variants SET is_default = false WHERE user_id = $1`, [req.user.id]);

  // Set the specified variant as default
  const { rows } = await query(
    `UPDATE resume_variants SET is_default = true WHERE user_id = $1 AND slug = $2 RETURNING *`,
    [req.user.id, slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Variant not found' });

  res.json(rows[0]);
});

module.exports = router;
