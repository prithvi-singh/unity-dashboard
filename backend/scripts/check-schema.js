'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  options:  { encrypt: true, trustServerCertificate: false },
};

async function run() {
  const pool = await sql.connect(config);

  for (const table of ['AllocatePatient', 'PatientAuditLog', 'Patient', 'Centre', 'AdminUserCentre']) {
    const r = await pool.request().query(
      `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`
    );
    console.log(`\n${table} columns:`, r.recordset.map(c => c.COLUMN_NAME).join(', '));
  }

  // Sample the centre id field used in audit-log-related queries in workload.js
  const r2 = await pool.request().query(`
    SELECT TOP 5 pal.Id, pal.PatientId, pal.AllocatePatientId, pal.AdminUserId, pal.Type
    FROM PatientAuditLog pal
    WHERE pal.AllocatePatientId IS NOT NULL
  `);
  console.log('\nSample PAL rows with AllocatePatientId:', JSON.stringify(r2.recordset, null, 2));

  // See what ap looks like
  const r3 = await pool.request().query(`
    SELECT TOP 3 *
    FROM AllocatePatient
    WHERE Id IN (SELECT TOP 3 AllocatePatientId FROM PatientAuditLog WHERE AllocatePatientId IS NOT NULL)
  `);
  console.log('\nSample AllocatePatient rows:', JSON.stringify(r3.recordset, null, 2));

  await pool.close();
}

run().catch(err => { console.error(err); process.exit(1); });
