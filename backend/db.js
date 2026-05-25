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
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  connectionTimeout: 30000,
  requestTimeout: 30000,
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then((pool) => {
    console.log(`[db] Connected to ${process.env.DB_SERVER} / ${process.env.DB_NAME} (read-only)`);
    return pool;
  })
  .catch((err) => {
    console.error('[db] FATAL: Could not connect to Azure SQL:', err.message);
    process.exit(1);
  });

module.exports = { sql, poolPromise };
