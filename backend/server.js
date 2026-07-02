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
const { initCron, startupWarmUp, getStatus: getCacheStatus } = require('./services/nightlyJob');
const overviewRouter = require('./routes/overview');
const cliniciansRouter = require('./routes/clinicians');
const managersRouter = require('./routes/managers');
const centreAdminsRouter = require('./routes/centre-admins');
const monitoringRouter = require('./routes/monitoring');
const bottlenecksRouter = require('./routes/bottlenecks');
const assessmentsRouter = require('./routes/assessments');
const usersRouter = require('./routes/users');
const pipelineRouter = require('./routes/pipeline');
const workloadRouter       = require('./routes/workload');
const topPerformersRouter  = require('./routes/topPerformers');
const dailyReviewRouter    = require('./routes/dailyReview');
const centresRouter        = require('./routes/centres');
const issuesRouter         = require('./routes/issues');
const goalProgressRouter   = require('./routes/goal-progress');
const adminCacheRouter     = require('./routes/adminCache');

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
app.get('/api/health', async (_req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request().query('SELECT 1');

    // Include cache status so we can verify pre-computation is working
    let cacheStatus = null;
    try {
      cacheStatus = await getCacheStatus();
    } catch (e) {
      cacheStatus = { error: e.message };
    }

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      dbConnected: true,
      cache: cacheStatus
        ? {
            warm: cacheStatus.windows ? cacheStatus.windows.some((w) => w.exists) : false,
            windows: cacheStatus.windows || [],
            lastComputed: cacheStatus.lastJobRun || null,
            nextComputed: cacheStatus.nextJobRun || null,
          }
        : { warm: false, windows: [], lastComputed: null, nextComputed: null },
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
app.use('/api/admin/cache', adminCacheRouter);

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
  initCron();

  // Run startup warm-up: if the cache is cold (new deploy/restart),
  // pre-compute everything now so the first real request is fast.
  try {
    await startupWarmUp();
  } catch (err) {
    console.warn('[startup] Cache warm-up error (non-fatal):', err.message);
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
