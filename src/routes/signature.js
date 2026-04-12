const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { query } = require('../db/pool');

const router = Router();

// Store signatures on Railway volume at data/signatures/
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'signatures');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed (PNG, JPEG, GIF, WebP)'));
  },
});

// POST /api/signature/upload — upload signature image (PNG with transparency preferred)
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = req.file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : req.file.mimetype.split('/')[1];
  const filename = `${req.user.id}_sig_${Date.now()}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, req.file.buffer);

  const signatureUrl = `/data/signatures/${filename}`;

  await query(
    `UPDATE user_profiles SET signature_image_url = $1, signature_style = 'image' WHERE user_id = $2`,
    [signatureUrl, req.user.id]
  );

  res.json({ ok: true, signature_image_url: signatureUrl });
});

// DELETE /api/signature — remove uploaded signature image
router.delete('/', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT signature_image_url FROM user_profiles WHERE user_id = $1`,
    [req.user.id]
  );
  if (rows[0]?.signature_image_url) {
    const filePath = path.join(__dirname, '..', '..', rows[0].signature_image_url);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
  }
  await query(
    `UPDATE user_profiles SET signature_image_url = '', signature_style = 'script' WHERE user_id = $1`,
    [req.user.id]
  );
  res.json({ ok: true });
});

// GET /data/signatures/:filename — serve uploaded signatures (authed via token query param)
router.get('/file/:filename', requireAuth, (req, res) => {
  // Verify the file belongs to the current user (prefix-match)
  if (!req.params.filename.startsWith(req.user.id + '_sig_')) {
    return res.status(403).send('Forbidden');
  }
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

module.exports = router;
