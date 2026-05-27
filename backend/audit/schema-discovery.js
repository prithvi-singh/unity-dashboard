#!/usr/bin/env node
'use strict';

/**
 * schema-discovery.js
 *
 * Runs seven discovery queries against the live database and saves the results
 * to backend/audit/schema-discovery.json.
 *
 * The output is the ground truth for every filter constant in the codebase:
 *   - AllocatePatient.Status values (active vs closed)
 *   - PatientGoalApprovalRequestGoal.Status values (pending vs approved)
 *   - AdminRole names (used for SuperAdmin exclusion)
 *   - PatientAuditLog.Type event names
 *   - Test/dev user email patterns
 *   - Test/deleted centre name patterns
 *   - Test patient name patterns
 *
 * Usage:
 *   node backend/audit/schema-discovery.js
 *
 * The file is also executed automatically at server startup in development
 * mode (NODE_ENV !== 'production') and its results are logged to the console.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs   = require('fs');
const sql  = require('mssql');

const OUTPUT_FILE = path.join(__dirname, 'schema-discovery.json');

const config = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  pool: { max: 3, min: 0, idleTimeoutMillis: 10000 },
  connectionTimeout: 30000,
  requestTimeout:    30000,
};

async function runDiscovery() {
  let pool;
  try {
    pool = await new sql.ConnectionPool(config).connect();
  } catch (err) {
    console.error('[schema-discovery] Cannot connect to DB:', err.message);
    process.exit(1);
  }

  const q = (query) => pool.request().query(query);

  console.log('[schema-discovery] Running discovery queries…');

  const [
    apStatuses,
    goalStatuses,
    adminRoles,
    auditTypes,
    testUserEmails,
    deletedCentres,
    testPatients,
  ] = await Promise.all([

    // D1: AllocatePatient.Status distribution
    q(`
      SELECT Status, COUNT(*) AS cnt
      FROM AllocatePatient
      GROUP BY Status
      ORDER BY cnt DESC
    `),

    // D2: PatientGoalApprovalRequestGoal.Status distribution
    q(`
      SELECT Status, COUNT(*) AS cnt
      FROM PatientGoalApprovalRequestGoal
      GROUP BY Status
      ORDER BY cnt DESC
    `),

    // D3: AdminRole names
    q(`
      SELECT Name, COUNT(*) AS cnt
      FROM AdminRole
      GROUP BY Name
      ORDER BY cnt DESC
    `),

    // D4: PatientAuditLog.Type event types
    q(`
      SELECT Type, COUNT(*) AS cnt
      FROM PatientAuditLog
      GROUP BY Type
      ORDER BY cnt DESC
    `),

    // D5: Test/dev user email patterns
    q(`
      SELECT DISTINCT Email
      FROM AdminUser
      WHERE Email LIKE '%@webority.com'
         OR Email LIKE '%@mailinator.com'
         OR Email LIKE '%test%'
      ORDER BY Email
    `),

    // D6: Deleted/test centre names
    q(`
      SELECT CentreName
      FROM Centre
      WHERE LOWER(CentreName) LIKE '%delete%'
         OR LOWER(CentreName) LIKE '%test%'
      ORDER BY CentreName
    `),

    // D7: Test patient name patterns
    q(`
      SELECT DISTINCT FirstName, LastName, COUNT(*) AS cnt
      FROM Patient
      WHERE FirstName LIKE '%test%'
         OR LastName  LIKE '%test%'
      GROUP BY FirstName, LastName
      ORDER BY cnt DESC
    `),
  ]);

  const result = {
    generatedAt: new Date().toISOString(),
    allocatePatientStatuses:         apStatuses.recordset,
    patientGoalApprovalStatuses:     goalStatuses.recordset,
    adminRoles:                      adminRoles.recordset,
    patientAuditLogTypes:            auditTypes.recordset,
    testUserEmails:                  testUserEmails.recordset,
    deletedOrTestCentres:            deletedCentres.recordset,
    testPatients:                    testPatients.recordset,

    // Derived: active vs closed statuses (anything NOT in these three is closed)
    activeAllocateStatuses: ['NotStarted', 'InProgress', 'OnHold'],
    closedAllocateStatuses: apStatuses.recordset
      .map((r) => r.Status)
      .filter((s) => !['NotStarted', 'InProgress', 'OnHold'].includes(s)),

    // Derived: goal approved value
    approvedGoalStatus: 'Approved',

    // Derived: superAdmin role names to exclude
    superAdminRoles: adminRoles.recordset
      .map((r) => r.Name)
      .filter((n) => /super.?admin/i.test(n)),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`[schema-discovery] Saved to ${OUTPUT_FILE}`);

  await pool.close();
  return result;
}

/**
 * Exported for use in server.js startup logging.
 * Returns the discovery result object.
 */
async function logDiscovery() {
  const result = await runDiscovery();

  console.log('\n[schema-discovery] ══════════════════════════════════════════════');
  console.log('[schema-discovery] AllocatePatient.Status values:');
  result.allocatePatientStatuses.forEach((r) =>
    console.log(`  ${r.Status}: ${r.cnt} rows`));

  console.log('[schema-discovery] Active statuses:', result.activeAllocateStatuses.join(', '));
  console.log('[schema-discovery] Closed statuses:', result.closedAllocateStatuses.join(', ') || '(none detected)');

  console.log('[schema-discovery] PatientGoalApprovalRequestGoal.Status:');
  result.patientGoalApprovalStatuses.forEach((r) =>
    console.log(`  ${r.Status}: ${r.cnt} rows`));

  console.log('[schema-discovery] AdminRole names:');
  result.adminRoles.forEach((r) =>
    console.log(`  ${r.Name}: ${r.cnt} rows`));

  console.log('[schema-discovery] SuperAdmin roles to exclude:', result.superAdminRoles.join(', ') || '(none found)');

  console.log('[schema-discovery] PatientAuditLog.Type values (top 20):');
  result.patientAuditLogTypes.slice(0, 20).forEach((r) =>
    console.log(`  ${r.Type}: ${r.cnt} events`));

  console.log('[schema-discovery] Test/dev user emails:', result.testUserEmails.length, 'found');
  console.log('[schema-discovery] Deleted/test centres:', result.deletedOrTestCentres.length, 'found');
  console.log('[schema-discovery] Test patients:', result.testPatients.length, 'found');
  console.log('[schema-discovery] ══════════════════════════════════════════════\n');

  return result;
}

module.exports = { runDiscovery, logDiscovery };

// Run standalone when invoked directly
if (require.main === module) {
  runDiscovery()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[schema-discovery] Error:', err.message);
      process.exit(1);
    });
}
