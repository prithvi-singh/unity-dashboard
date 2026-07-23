'use strict';
/**
 * MANAGER DATA BUG DIAGNOSIS
 *
 * Diagnoses three related bugs caused by AdminUserCentre join multiplication
 * and incorrect centre attribution in manager output queries.
 *
 * Run: node backend/scripts/diagnose-manager-bugs.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  options:  { encrypt: true, trustServerCertificate: false },
  requestTimeout: 45000,
};

// -- Use a date range matching the current 30-day default window
const DATE_FROM = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const DATE_TO   = new Date();

async function run() {
  const pool = await sql.connect(config);
  console.log('[diagnose] Connected to DB\n');

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 0: Find Mansi Sharma's ID
  // ──────────────────────────────────────────────────────────────────────────
  console.log('=== STEP 0: Find Mansi Sharma ===');
  const mansiRes = await pool.request().query(`
    SELECT au.Id, au.FirstName, au.LastName, au.Email,
           COUNT(auc.CentreId) AS centreCount
    FROM AdminUser au
    LEFT JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
    WHERE LOWER(au.FirstName) LIKE '%mansi%'
       OR LOWER(au.LastName)  LIKE '%sharma%'
    GROUP BY au.Id, au.FirstName, au.LastName, au.Email
    ORDER BY centreCount DESC
  `);
  console.log('Mansi Sharma candidates:', JSON.stringify(mansiRes.recordset, null, 2));

  if (!mansiRes.recordset.length) {
    console.warn('  !! Could not find Mansi Sharma — check name spelling in DB');
    await pool.close();
    return;
  }

  // Take the candidate with the most centre assignments (most likely the right one)
  const mansi = mansiRes.recordset[0];
  const MANSI_ID = mansi.Id;
  console.log(`\n  → Using Id=${MANSI_ID} (${mansi.FirstName} ${mansi.LastName}, ${mansi.centreCount} centres)\n`);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 0b: Count her centre assignments
  // ──────────────────────────────────────────────────────────────────────────
  const centresRes = await pool.request()
    .input('userId', sql.BigInt, MANSI_ID)
    .query(`
      SELECT c.Id, c.CentreName
      FROM AdminUserCentre auc
      JOIN Centre c ON c.Id = auc.CentreId
      WHERE auc.AdminUserId = @userId
      ORDER BY c.CentreName
    `);
  console.log(`  Mansi is assigned to ${centresRes.recordset.length} centres:`);
  centresRes.recordset.slice(0, 10).forEach((r) => console.log(`    - [${r.Id}] ${r.CentreName}`));
  if (centresRes.recordset.length > 10) console.log(`    ... and ${centresRes.recordset.length - 10} more`);

  const N_CENTRES = centresRes.recordset.length;

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1 — SPOT CHECK BUG 1
  // Her PERSONAL scoring and drafting actions
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n=== STEP 1: BUG 1 — Personal output spot-check ===');

  const personalRes = await pool.request()
    .input('userId',   sql.BigInt,        MANSI_ID)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT
        SUM(CASE WHEN Type = 'AssessmentResultGenerated' THEN 1 ELSE 0 END) AS assessmentsScored_CORRECT,
        SUM(CASE WHEN Type = 'ReportAdded'               THEN 1 ELSE 0 END) AS reportsDrafted_CORRECT
      FROM PatientAuditLog
      WHERE AdminUserId = @userId
        AND CreatedDateTime BETWEEN @dateFrom AND @dateTo
    `);
  const personal = personalRes.recordset[0];
  console.log(`  ✓ Personal assessmentsScored (CORRECT): ${personal.assessmentsScored_CORRECT}`);
  console.log(`  ✓ Personal reportsDrafted    (CORRECT): ${personal.reportsDrafted_CORRECT}`);

  // Simulate what the CURRENT BUGGY query returns (with AdminUserCentre join multiplication)
  const buggyRes = await pool.request()
    .input('userId',   sql.BigInt,        MANSI_ID)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT
        SUM(CASE WHEN pal.Type = 'AssessmentResultGenerated' THEN 1 ELSE 0 END) AS assessmentsScored_BUGGY,
        SUM(CASE WHEN pal.Type = 'ReportAdded'               THEN 1 ELSE 0 END) AS reportsDrafted_BUGGY
      FROM AdminUser au
      JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
      JOIN Centre c            ON c.Id = auc.CentreId
      LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
        AND pal.CreatedDateTime BETWEEN @dateFrom AND @dateTo
      WHERE au.Id = @userId
        AND LOWER(c.CentreName) NOT LIKE '%test%'
        AND LOWER(c.CentreName) NOT LIKE '%delete%'
      GROUP BY au.Id
    `);
  const buggy = buggyRes.recordset[0];
  console.log(`  ✗ BUGGY assessmentsScored (×${N_CENTRES} inflation): ${buggy?.assessmentsScored_BUGGY}`);
  console.log(`  ✗ BUGGY reportsDrafted    (×${N_CENTRES} inflation): ${buggy?.reportsDrafted_BUGGY}`);

  const expected_assessments_inflation = (personal.assessmentsScored_CORRECT ?? 0) * N_CENTRES;
  const expected_reports_inflation = (personal.reportsDrafted_CORRECT ?? 0) * N_CENTRES;
  console.log(`\n  Expected buggy values: assessmentsScored=${expected_assessments_inflation}, reportsDrafted=${expected_reports_inflation}`);
  console.log(`  Bug confirmed: ${buggy?.assessmentsScored_BUGGY === expected_assessments_inflation ? 'YES ✓' : 'MISMATCH — check logic'}`);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2 — SPOT CHECK BUG 2: MB LAKSHAYA audit events
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n=== STEP 2: BUG 2 — MB LAKSHAYA centre attribution ===');

  // Find MB LAKSHAYA centre ID
  const mbRes = await pool.request().query(`
    SELECT Id, CentreName FROM Centre
    WHERE LOWER(CentreName) LIKE '%lakshaya%'
  `);
  console.log('MB LAKSHAYA candidates:', JSON.stringify(mbRes.recordset, null, 2));

  if (mbRes.recordset.length === 0) {
    console.warn('  !! Could not find MB LAKSHAYA — check centre name spelling');
  } else {
    const MB_ID = mbRes.recordset[0].Id;

    // Check ALL audit events at MB LAKSHAYA via AdminUserCentre (the WRONG way)
    const wrongAttrRes = await pool.request()
      .input('centreId', sql.BigInt, MB_ID)
      .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
      .input('dateTo',   sql.DateTimeOffset, DATE_TO)
      .query(`
        SELECT COUNT(*) AS events_wrong_attribution
        FROM PatientAuditLog pal
        JOIN AdminUserCentre auc ON auc.AdminUserId = pal.AdminUserId
        JOIN Centre c ON c.Id = auc.CentreId
        WHERE c.Id = @centreId
          AND pal.CreatedDateTime BETWEEN @dateFrom AND @dateTo
      `);
    console.log(`  ✗ Events at MB LAKSHAYA via AdminUserCentre (WRONG — inflated): ${wrongAttrRes.recordset[0].events_wrong_attribution}`);

    // Check audit events AT MB LAKSHAYA via Patient→CentreId (the CORRECT way)
    const correctAttrRes = await pool.request()
      .input('centreId', sql.BigInt, MB_ID)
      .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
      .input('dateTo',   sql.DateTimeOffset, DATE_TO)
      .query(`
        SELECT COUNT(*) AS events_correct_attribution
        FROM PatientAuditLog pal
        JOIN Patient p ON p.Id = pal.PatientId
        JOIN Centre c  ON c.Id = p.CentreId
        WHERE c.Id = @centreId
          AND pal.CreatedDateTime BETWEEN @dateFrom AND @dateTo
      `);
    console.log(`  ✓ Events at MB LAKSHAYA via Patient→CentreId (CORRECT): ${correctAttrRes.recordset[0].events_correct_attribution}`);

    // Check Mansi's actions at MB LAKSHAYA via AllocatePatient→CentreId (Rule 2 path)
    const mansiAtMbRes = await pool.request()
      .input('userId',   sql.BigInt,        MANSI_ID)
      .input('centreId', sql.BigInt,        MB_ID)
      .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
      .input('dateTo',   sql.DateTimeOffset, DATE_TO)
      .query(`
        SELECT COUNT(*) AS mansi_actions_at_mb
        FROM PatientAuditLog pal
        JOIN AllocatePatient ap ON ap.Id = pal.AllocatePatientId
        JOIN Centre c ON c.Id = ap.CentreId
        WHERE pal.AdminUserId = @userId
          AND c.Id = @centreId
          AND pal.CreatedDateTime BETWEEN @dateFrom AND @dateTo
      `);
    console.log(`  ✓ Mansi's actions AT MB LAKSHAYA via AllocatePatient: ${mansiAtMbRes.recordset[0].mansi_actions_at_mb}`);

    // Also verify patient count at MB LAKSHAYA
    const mbPatientsRes = await pool.request()
      .input('centreId', sql.BigInt, MB_ID)
      .query(`
        SELECT COUNT(*) AS patient_count
        FROM Patient p
        WHERE p.CentreId = @centreId
          AND p.FirstName NOT LIKE '%test%'
          AND p.LastName  NOT LIKE '%test%'
      `);
    console.log(`  ✓ Non-test patients at MB LAKSHAYA: ${mbPatientsRes.recordset[0].patient_count} (should be 0)`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3 — Check which queries are affected (Admin UserCentre + PAL without centre filter)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n=== STEP 3: Inflation factor analysis ===');
  console.log(`  Mansi has ${N_CENTRES} centre assignments.`);
  console.log(`  Any SUM over PAL events joined via AdminUserCentre (without DISTINCT) is inflated by ${N_CENTRES}×.`);
  console.log('  AFFECTED fields in consistencyResult query:');
  console.log('    - assessmentsScored  (SUM without DISTINCT)');
  console.log('    - reportsDrafted     (SUM without DISTINCT)');
  console.log('    - reportsApproved    (SUM without DISTINCT) [coreOutput field]');
  console.log('    - goalsApproved      (SUM without DISTINCT) [coreOutput field]');
  console.log('  NOT AFFECTED:');
  console.log('    - coreJobDays        (COUNT DISTINCT on dates — DISTINCT removes duplication)');
  console.log('    - lastActiveDate     (MAX — same regardless of N)');

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 4 — Verify metricsService data (should be correct, no AdminUserCentre join)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n=== STEP 4: metricsService Q3 — casesRegistered for Mansi ===');
  const metricsQ3Res = await pool.request()
    .input('userId',   sql.BigInt,        MANSI_ID)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT
        COUNT(DISTINCT CASE WHEN pal.Type = 'CaseRegistered' THEN pal.PatientId END) AS casesRegistered,
        COUNT(DISTINCT CASE WHEN pal.Type = 'CaseAssigned'   THEN pal.AllocatePatientId END) AS assessmentsAssigned
      FROM PatientAuditLog pal
      JOIN Patient pt ON pt.Id = pal.PatientId
      JOIN Centre  c  ON c.Id  = pt.CentreId
      WHERE pal.AdminUserId = @userId
        AND pal.Type IN ('CaseRegistered', 'CaseAssigned')
        AND LOWER(c.CentreName) NOT LIKE '%test%'
        AND LOWER(c.CentreName) NOT LIKE '%delete%'
        AND pt.FirstName NOT LIKE '%test%'
        AND pt.LastName  NOT LIKE '%test%'
        AND pal.CreatedDateTime BETWEEN @dateFrom AND @dateTo
    `);
  const q3 = metricsQ3Res.recordset[0];
  console.log(`  Mansi casesRegistered (Q3 total): ${q3.casesRegistered}`);
  console.log(`  Mansi assessmentsAssigned (Q3 total): ${q3.assessmentsAssigned}`);
  console.log('  NOTE: These totals are correct for the manager table row.');
  console.log('  BUG 2 occurs when aggregateManagersByCentre() maps these totals to m.centreId (primary centre).');

  // Show which centre is Mansi's "primary" (first alphabetically from the rosterResult query)
  const primaryRes = await pool.request()
    .input('userId', sql.BigInt, MANSI_ID)
    .query(`
      SELECT TOP 1 c.Id, c.CentreName
      FROM AdminUserCentre auc
      JOIN Centre c ON c.Id = auc.CentreId
      WHERE auc.AdminUserId = @userId
        AND LOWER(c.CentreName) NOT LIKE '%test%'
        AND LOWER(c.CentreName) NOT LIKE '%delete%'
      ORDER BY c.CentreName ASC
    `);
  if (primaryRes.recordset.length) {
    const primary = primaryRes.recordset[0];
    console.log(`\n  Mansi's "primary" centre (first alphabetically): [${primary.Id}] ${primary.CentreName}`);
    console.log(`  → ALL ${q3.casesRegistered} cases + ${q3.assessmentsAssigned} assessments are attributed to ${primary.CentreName}`);
    console.log(`  → This is WRONG. MB LAKSHAYA should show 0 (it has no patients).`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n=== DIAGNOSIS SUMMARY ===');
  console.log(`  BUG 1: consistencyResult query inflates via AdminUserCentre JOIN (${N_CENTRES}× for Mansi)`);
  console.log(`    BEFORE FIX: assessmentsScored=${buggy?.assessmentsScored_BUGGY}, reportsDrafted=${buggy?.reportsDrafted_BUGGY}`);
  console.log(`    AFTER  FIX: assessmentsScored=${personal.assessmentsScored_CORRECT}, reportsDrafted=${personal.reportsDrafted_CORRECT}`);
  console.log('');
  console.log(`  BUG 2: aggregateManagersByCentre() attributes Mansi's ${q3.casesRegistered} cases + ${q3.assessmentsAssigned} assessments`);
  console.log(`    to her PRIMARY centre (first alphabetically), not the actual centres where they occurred.`);
  console.log('    Fix: return per-centre breakdown from backend OR add managerCasesRegistered to workload endpoint.');

  await pool.close();
  console.log('\n[diagnose] Done.');
}

run().catch((err) => {
  console.error('[diagnose] Error:', err);
  process.exit(1);
});
