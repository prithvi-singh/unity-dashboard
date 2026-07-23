'use strict';

/**
 * db.js — Shared Azure SQL connection pool (read-only).
 *
 * READ-ONLY ENFORCEMENT:
 *   The DB_USER credential is a read-only SQL login with SELECT-only
 *   permissions granted at the database level. This API layer never issues
 *   INSERT / UPDATE / DELETE / DDL statements as a defense-in-depth measure,
 *   but the ultimate enforcement is the database permission boundary.
 *
 * Usage in route files:
 *   const { sql, poolPromise } = require('../db');
 *   const pool = await poolPromise;
 *   const result = await pool.request()
 *     .input('paramName', sql.Int, value)
 *     .query('SELECT ...');
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  // 45s query timeout — the overview endpoint runs 8 parallel queries and can
  // take 20–30s on a cold start before the SQL plan cache is warm.
  // This was 15s during the perf pass but caused silent timeouts on cold starts.
  requestTimeout: 45000,
  connectionTimeout: 30000,
  pool: {
    max: 10,
    // Keep 2 warm connections at all times so the first requests after a
    // period of low traffic don't pay the TCP handshake + TLS cost.
    min: 2,
    idleTimeoutMillis: 60000,
    // Fail fast if all connections are busy rather than queuing indefinitely.
    acquireTimeoutMillis: 15000,
  },
};

const _pool = new sql.ConnectionPool(config);

if (process.env.NODE_ENV !== 'production') {
  _pool.on('connect', () => console.log('[db] New connection created'));
  _pool.on('remove',  () => console.log('[db] Connection removed from pool'));
}

const poolPromise = _pool
  .connect()
  .then((pool) => {
    console.log(`[db] Connected to ${process.env.DB_SERVER} / ${process.env.DB_NAME} (read-only)`);
    console.log(`[db] Pool: min=${config.pool.min} max=${config.pool.max}`);
    return pool;
  })
  .catch((err) => {
    console.error('[db] FATAL: Could not connect to Azure SQL:', err.message);
    process.exit(1);
  });

module.exports = { sql, poolPromise };
