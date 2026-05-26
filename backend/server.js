'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const { poolPromise } = require('./db');

const overviewRouter = require('./routes/overview');
const cliniciansRouter = require('./routes/clinicians');
const managersRouter = require('./routes/managers');
const centreAdminsRouter = require('./routes/centre-admins');
const monitoringRouter = require('./routes/monitoring');
const bottlenecksRouter = require('./routes/bottlenecks');
const assessmentsRouter = require('./routes/assessments');
const usersRouter = require('./routes/users');
const pipelineRouter = require('./routes/pipeline');
const workloadRouter = require('./routes/workload');

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet());

const allowedOrigins = [
  process.env.ALLOWED_ORIGIN,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // allow server-to-server requests (no origin header) and listed origins
      if (!origin || allowedOrigins.includes(origin)) {
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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request().query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString(), dbConnected: true });
  } catch {
    res.status(503).json({ status: 'error', timestamp: new Date().toISOString(), dbConnected: false });
  }
});

app.use('/api/overview', overviewRouter);
app.use('/api/clinicians', cliniciansRouter);
app.use('/api/managers', managersRouter);
app.use('/api/centre-admins', centreAdminsRouter);
app.use('/api/monitoring', monitoringRouter);
app.use('/api/bottlenecks', bottlenecksRouter);
app.use('/api/assessments', assessmentsRouter);
app.use('/api/role', require('./routes/role'));
app.use('/api/users', usersRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/workload', workloadRouter);

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
async function logAuditLogTypes(pool) {
  try {
    const result = await pool.request().query(
      "SELECT DISTINCT Type FROM PatientAuditLog ORDER BY Type"
    );
    const types = result.recordset.map((r) => r.Type);
    console.log('[startup] PatientAuditLog.Type values found in DB:', types);
  } catch (err) {
    console.warn('[startup] Could not query PatientAuditLog types:', err.message);
  }
}

poolPromise.then(async (pool) => {
  await logAuditLogTypes(pool);

  app.listen(PORT, () => {
    console.log(`[server] Unity Dashboard API listening on port ${PORT}`);
    console.log(`[server] CORS allowed origins: ${allowedOrigins.join(', ')}`);
  });
});
