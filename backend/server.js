'use strict';
// v4 — nightly pre-computation cache with timezone fix deployed.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');

const { poolPromise } = require('./db');

const { getCoreMetrics } = require('./services/metricsService');

// ── Cache imports (lazy/defensive — server starts even if cache modules fail) ──
let _cacheModules = null;
function _tryLoadCacheModules() {
  if (_cacheModules) return _cacheModules;
  try {
    const nightlyJob = require('./services/nightlyJob');
    const adminCacheRouter = require('./routes/adminCache');
    _cacheModules = { nightlyJob, adminCacheRouter };
    console.log('[server] Cache modules loaded successfully');
    return _cacheModules;
  } catch (err) {
    console.warn('[server] Cache modules not available:', err.message);
    _cacheModules = { nightlyJob: null, adminCacheRouter: null };
    return _cacheModules;
  }
}

// ── Route imports (defensive — server starts even if individual routes fail) ──
function _safeRequire(modulePath, name) {
  try {
    return require(modulePath);
  } catch (err) {
    console.error(`[server] Failed to load route '${name}':`, err.message);
    // Return a router that returns 503 for all requests
    const { Router } = require('express');
    const fallback = Router();
    fallback.all('*', (_req, res) => res.status(503).json({ error: `${name} temporarily unavailable` }));
    return fallback;
  }
}

const overviewRouter      = _safeRequire('./routes/overview', 'overview');
const cliniciansRouter    = _safeRequire('./routes/clinicians', 'clinicians');
const managersRouter      = _safeRequire('./routes/managers', 'managers');
const centreAdminsRouter  = _safeRequire('./routes/centre-admins', 'centre-admins');
const monitoringRouter    = _safeRequire('./routes/monitoring', 'monitoring');
const bottlenecksRouter   = _safeRequire('./routes/bottlenecks', 'bottlenecks');
const assessmentsRouter   = _safeRequire('./routes/assessments', 'assessments');
const usersRouter         = _safeRequire('./routes/users', 'users');
const pipelineRouter      = _safeRequire('./routes/pipeline', 'pipeline');
const workloadRouter      = _safeRequire('./routes/workload', 'workload');
const topPerformersRouter = _safeRequire('./routes/topPerformers', 'top-performers');
const dailyReviewRouter   = _safeRequire('./routes/dailyReview', 'daily-review');
const centresRouter       = _safeRequire('./routes/centres', 'centres');
const issuesRouter        = _safeRequire('./routes/issues', 'issues');
const goalProgressRouter  = _safeRequire('./routes/goal-progress', 'goal-progress');
const patientLinkRouter   = _safeRequire('./routes/patientLink', 'patient-link');
const funnelRouter        = _safeRequire('./routes/funnel', 'funnel');

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(compression({ level: 6, threshold: 1024 }));

app.use(helmet());

const allowedOrigins = [
  process.env.ALLOWED_ORIGIN,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
].filter(Boolean);

// CORS_ALLOW_PATTERN supports Vercel preview deployments with dynamic subdomains
// (e.g. https://unity-dashboard-git-feature-xyz.vercel.app).
// Set this env var to a regex string like: ^https://.*\.vercel\.app$
const corsAllowPattern = process.env.CORS_ALLOW_PATTERN
  ? new RegExp(process.env.CORS_ALLOW_PATTERN)
  : null;

const isOriginAllowed = (origin) => {
  if (!origin) return true; // server-to-server requests
  if (allowedOrigins.includes(origin)) return true;
  if (corsAllowPattern && corsAllowPattern.test(origin)) return true;
  return false;
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    methods: ['GET', 'OPTIONS'],
  })
);

app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));
app.use(express.json());

// Performance timing — logs every request with latency; warns on slow requests.
// Also logs on close (client disconnected) so we can detect timed-out requests.
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[req] ← ${req.method} ${req.url}`);
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[perf] ${req.method} ${req.url} → ${res.statusCode} in ${ms}ms`);
    if (ms > 1000) {
      console.warn(`[perf] SLOW: ${req.url} took ${ms}ms`);
    }
  });
  res.on('close', () => {
    if (!res.writableEnded) {
      console.warn(`[req] ✗ ${req.method} ${req.url} — client closed connection after ${Date.now() - start}ms`);
    }
  });
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
// v5 — cache field always present in health (inline, zero-dependency)
app.get('/api/health', async (_req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request().query('SELECT 1');
    // ⬇️ Always include cache field — zero dependencies, can't fail to load
    res.json({
      status: 'ok',
      version: 'v5-cache',
      timestamp: new Date().toISOString(),
      dbConnected: true,
      cache: { warm: false, windows: [], lastComputed: null, nextComputed: null },
    });
  } catch {
    res.status(503).json({ status: 'error', timestamp: new Date().toISOString(), dbConnected: false, cache: { warm: false } });
  }
});

/**
 * GET /api/metrics
 * Exposes the raw metricsService result directly.
 * Use this to verify numbers match across tabs, or to debug discrepancies.
 *
 * Query params: dateFrom, dateTo, centreId (all optional)
 */
app.get('/api/metrics', async (req, res, next) => {
  try {
    const { parseDateParam } = require('./lib/queryHelpers');
    const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
    const dateFrom = parseDateParam(req.query.dateFrom);
    const dateTo   = parseDateParam(req.query.dateTo);

    if (req.query.centreId && isNaN(centreId)) {
      return res.status(400).json({ error: 'centreId must be a number' });
    }
    if (req.query.dateFrom && !dateFrom) {
      return res.status(400).json({ error: 'dateFrom must be a valid ISO date' });
    }
    if (req.query.dateTo && !dateTo) {
      return res.status(400).json({ error: 'dateTo must be a valid ISO date' });
    }

    const metrics = await getCoreMetrics({ dateFrom, dateTo, centreId });
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

app.use('/api/overview', overviewRouter);
app.use('/api/clinicians', cliniciansRouter);
app.use('/api/managers', managersRouter);
app.use('/api/centre-admins', centreAdminsRouter);
app.use('/api/monitoring/top-performers', topPerformersRouter);
app.use('/api/daily-review', dailyReviewRouter);
app.use('/api/monitoring', monitoringRouter);
app.use('/api/bottlenecks', bottlenecksRouter);
app.use('/api/assessments', assessmentsRouter);
app.use('/api/role', require('./routes/role'));
app.use('/api/users', usersRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/workload', workloadRouter);
app.use('/api/centres', centresRouter);
app.use('/api/issues',  issuesRouter);
app.use('/api/goal-progress', goalProgressRouter);
app.use('/api/patient-link', patientLinkRouter);
app.use('/api/funnel', funnelRouter);

// Zoho integration — fully isolated module (/backend/zoho). Mounts a stub
// router if ZOHO_* env vars are missing; failure here never affects the app.
const _zohoModule = _safeRequire('./zoho', 'zoho');
app.use('/api/zoho', _zohoModule.router || _zohoModule);
app.use('/api/admin/cache', (_req, res, next) => {
  const cacheMods = _tryLoadCacheModules();
  if (!cacheMods.adminCacheRouter) {
    return res.status(503).json({ error: 'Cache admin not available — cache modules failed to load' });
  }
  cacheMods.adminCacheRouter(_req, res, next);
});

// 404 for unknown routes
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

poolPromise.then(async () => {
  app.listen(PORT, () => {
    console.log(`[server] Unity Dashboard API listening on port ${PORT}`);
    console.log(`[server] CORS allowed origins: ${allowedOrigins.join(', ')}`);

    // Self-ping keeps the Azure Container App instance warm so it never scales
    // to zero between requests. First ping fires after 30 s (let the server
    // fully initialise), then every 4 minutes indefinitely.
    // Set SELF_PING_URL in Azure env vars to the container's public URL so the
    // ping travels through the load-balancer and resets the idle-shutdown timer.
    const PING_INTERVAL = 4 * 60 * 1000; // 4 minutes

    const selfPing = () => {
      const url =
        process.env.SELF_PING_URL ||
        `http://localhost:${PORT}/api/health`;
      fetch(url)
        .then(() => console.log('[warmup] Self-ping: OK'))
        .catch((err) => console.warn('[warmup] Self-ping failed:', err.message));
    };

    setTimeout(() => {
      selfPing();
      setInterval(selfPing, PING_INTERVAL);
      console.log('[warmup] Self-ping enabled every 4 minutes');
    }, 30_000);
  });

  // ── Nightly pre-computation cache ───────────────────────────────────────
  // Initialise cron scheduler for daily pre-computation at midnight IST.
  const cacheMods = _tryLoadCacheModules();
  if (cacheMods.nightlyJob) {
    cacheMods.nightlyJob.initCron();

    // Run startup warm-up: if the cache is cold (new deploy/restart),
    // pre-compute everything now so the first real request is fast.
    // Run in background — don't block the server from accepting health checks.
    cacheMods.nightlyJob.startupWarmUp()
      .then(() => console.log('[startup] Cache warm-up completed'))
      .catch((err) => console.warn('[startup] Cache warm-up error (non-fatal):', err.message));
  } else {
    console.warn('[server] Skipping cache initialisation — nightlyJob module not available');
  }

  // In development, run full schema discovery so the terminal always shows
  // the exact status values, event types, role names, and test data counts
  // that the filter constants are based on.  Production skips this to avoid
  // the extra 7 DB round-trips on cold start.
  if (process.env.NODE_ENV !== 'production') {
    try {
      const { logDiscovery } = require('./audit/schema-discovery');
      await logDiscovery();
    } catch (err) {
      console.warn('[startup] Schema discovery skipped:', err.message);
    }
  }
});
