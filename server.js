// HopeSpot v9.0 — Multi-tenant server entrypoint
const express = require('express');
const path = require('path');

// Route modules
const authRoutes = require('./src/routes/auth');
const firmsRoutes = require('./src/routes/firms');
const applicationRoutes = require('./src/routes/applications');
const jobboardRoutes = require('./src/routes/jobboard');
const networkingRoutes = require('./src/routes/networking');
const diagnosticsRoutes = require('./src/routes/diagnostics');
const googleRoutes = require('./src/routes/google');

// Middleware
const { helmetMiddleware, corsMiddleware, globalLimiter } = require('./src/middleware/security');

const app = express();
const PORT = process.env.PORT || 3000;

// ================================================================
// Global middleware
// ================================================================
app.use(helmetMiddleware);
app.use(express.json({ limit: '1mb' }));
app.use('/api', corsMiddleware);
app.use('/api', globalLimiter);

// ================================================================
// API routes
// ================================================================
app.use('/api/auth', authRoutes);
app.use('/api', firmsRoutes);
app.use('/api', applicationRoutes);
app.use('/api', jobboardRoutes);
app.use('/api/networking', networkingRoutes);
app.use('/api', diagnosticsRoutes);
app.use('/api/google', googleRoutes);

// ================================================================
// Static files — serve Vite build if available, otherwise legacy public/
// ================================================================
const fs = require('fs');
const distPath = path.join(__dirname, 'dist');
const publicPath = path.join(__dirname, 'public');
const staticRoot = fs.existsSync(distPath) ? distPath : publicPath;
app.use(express.static(staticRoot));

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(staticRoot, 'index.html'));
});

// ================================================================
// Error handler
// ================================================================
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ================================================================
// Startup
// ================================================================
async function start() {
  // Verify database connection
  if (process.env.DATABASE_URL) {
    try {
      const { query } = require('./src/db/pool');
      await query('SELECT 1');
      console.log('[db] PostgreSQL connected');

      // Run migrations automatically
      const { migrate } = require('./src/db/migrate');
      await migrate();
    } catch (e) {
      console.error('[db] Connection failed:', e.message);
      console.error('[db] Set DATABASE_URL to a valid PostgreSQL connection string');
      process.exit(1);
    }
  } else {
    console.warn('[db] DATABASE_URL not set — running without database (legacy JSON mode)');
    console.warn('[db] Multi-user features require PostgreSQL. Set DATABASE_URL to enable.');
  }

  app.listen(PORT, () => {
    console.log(`HopeSpot v9.0 — listening on port ${PORT}`);
    console.log(`  Database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON files (legacy)'}`);
    console.log(`  Anthropic: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured'}`);
    console.log(`  Drive: ${process.env.DRIVE_WEBHOOK_URL ? 'configured' : 'not configured'}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[shutdown] SIGTERM received');
  if (process.env.DATABASE_URL) {
    const { closePool } = require('./src/db/pool');
    await closePool();
  }
  process.exit(0);
});

start();

module.exports = app;
