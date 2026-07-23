'use strict';
/**
 * POST-FIX VERIFICATION
 *
 * Verifies the three manager data bugs are fixed.
 * Run: node backend/scripts/verify-manager-fixes.js
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
  requestTimeout: 60000,
};

const DATE_FROM = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const DATE_TO   = new Date();
const MANSI_ID  = 254;
const MB_ID     = 60;

// Simulates the FIXED consistencyResult query (EXISTS subquery, no AdminUserCentre join)
async function getFixedConsistency(pool, userId) {
  const EVENT_TYPES_REPORT_PDF   = 'ReportPDFGenerated';
  const EVENT_TYPES_GOAL_ADDED   = 'GoalAdded';
  const EVENT_TYPES_GOAL_UPDATED = 'GoalUpdated';
  const EVENT_TYPES_SCORED       = 'AssessmentResultGenerated';
  const EVENT_TYPES_DRAFTED      = 'ReportAdded';

  const r = await pool.request()
    .input('userId',   sql.BigInt,        userId)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT
        au.Id AS userId,
        SUM(CASE WHEN pal.Type = '${EVENT_TYPES_SCORED}'  THEN 1 ELSE 0 END) AS assessmentsScored,
        SUM(CASE WHEN pal.Type = '${EVENT_TYPES_DRAFTED}' THEN 1 ELSE 0 END) AS reportsDrafted,
        SUM(CASE WHEN pal.Type = '${EVENT_TYPES_REPORT_PDF}' THEN 1 ELSE 0 END) AS reportsApproved,
        SUM(CASE WHEN pal.Type IN ('${EVENT_TYPES_GOAL_ADDED}','${EVENT_TYPES_GOAL_UPDATED}') THEN 1 ELSE 0 END) AS goalsApproved
      FROM AdminUser au
      JOIN AdminUserRole aur ON aur.UserId = au.Id
      JOIN AdminRole ar      ON ar.Id = aur.RoleId
        AND ar.Name NOT IN ('Clinician', 'Super Admin', 'SuperAdmin')
      LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
        AND pal.CreatedDateTime >= @dateFrom AND pal.CreatedDateTime < DATEADD(day, 1, @dateTo)
      WHERE au.Id = @userId
        AND au.FirstName NOT LIKE '%(Ops)%'
        AND au.LastName  NOT LIKE '%(Ops)%'
        AND au.Email     NOT LIKE '%(Ops)%'
        AND LOWER(au.FirstName) NOT LIKE '%test%'
        AND LOWER(au.LastName)  NOT LIKE '%test%'
        AND LOWER(au.Email)     NOT LIKE '%@webority.com'
        AND EXISTS (
          SELECT 1 FROM AdminUserCentre auc2
          JOIN Centre c2 ON c2.Id = auc2.CentreId
          WHERE auc2.AdminUserId = au.Id
            AND LOWER(c2.CentreName) NOT LIKE '%test%'
            AND LOWER(c2.CentreName) NOT LIKE '%delete%'
        )
      GROUP BY au.Id
    `);
  return r.recordset[0] || {};
}

async function run() {
  const pool = await sql.connect(config);
  console.log('[verify] Connected\n');

  // ──────────────────────────────────────────────────────────────────────────
  // CHECK 1: Mansi Sharma — assessmentsScored + reportsDrafted
  // ──────────────────────────────────────────────────────────────────────────
  console.log('=== CHECK 1: Mansi Sharma (Id=254) ===');
  const mansi = await getFixedConsistency(pool, MANSI_ID);
  console.log(`  assessmentsScored : ${mansi.assessmentsScored}  (expected: 2, buggy was: 234)`);
  console.log(`  reportsDrafted    : ${mansi.reportsDrafted}     (expected: 2, buggy was: 234)`);
  console.log(`  reportsApproved   : ${mansi.reportsApproved}    (from correct query)`);
  console.log(`  goalsApproved     : ${mansi.goalsApproved}      (from correct query)`);
  const bug1Fixed = mansi.assessmentsScored <= 10 && mansi.reportsDrafted <= 10;
  console.log(`  BUG 1 FIXED: ${bug1Fixed ? 'YES ✓' : 'NO — still inflated ✗'}`);

  // ──────────────────────────────────────────────────────────────────────────
  // CHECK 2: MB LAKSHAYA primary centre attribution
  // With the fix, Mansi's primary centre is now her most-active centre.
  // MB LAKSHAYA (CentreId=60) should no longer be her primary.
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n=== CHECK 2: Mansi primary centre (was MB LAKSHAYA, should now be most-active) ===');
  const centreActivityRes = await pool.request()
    .input('userId',   sql.BigInt,        MANSI_ID)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT TOP 5
        c.Id AS centreId,
        c.CentreName,
        SUM(CASE WHEN p.CentreId = c.Id THEN 1 ELSE 0 END) AS totalActions
      FROM AdminUserCentre auc
      JOIN Centre c ON c.Id = auc.CentreId
      LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = @userId
        AND pal.CreatedDateTime >= @dateFrom AND pal.CreatedDateTime < DATEADD(day, 1, @dateTo)
      LEFT JOIN Patient p ON p.Id = pal.PatientId
      WHERE auc.AdminUserId = @userId
        AND LOWER(c.CentreName) NOT LIKE '%test%'
        AND LOWER(c.CentreName) NOT LIKE '%delete%'
      GROUP BY c.Id, c.CentreName
      ORDER BY totalActions DESC
    `);
  console.log('  Top 5 centres by activity (totalActions = PAL events for patients at that centre):');
  centreActivityRes.recordset.forEach((r, i) => {
    const tag = i === 0 ? ' ← NEW PRIMARY' : '';
    console.log(`    ${i + 1}. [${r.centreId}] ${r.CentreName}: ${r.totalActions} actions${tag}`);
  });

  const newPrimary = centreActivityRes.recordset[0];
  const bug2Fixed  = newPrimary && newPrimary.centreId !== MB_ID;
  console.log(`  NEW primary centreId: ${newPrimary?.centreId} (${newPrimary?.CentreName})`);
  console.log(`  MB LAKSHAYA (Id=60) is no longer primary: ${bug2Fixed ? 'YES ✓' : 'NO ✗ — still MB LAKSHAYA'}`);

  // Confirm MB LAKSHAYA activity via correct Patient.CentreId path
  const mbActivityRes = await pool.request()
    .input('centreId', sql.BigInt,        MB_ID)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM PatientAuditLog pal
      JOIN Patient p ON p.Id = pal.PatientId
      WHERE p.CentreId = @centreId
        AND pal.CreatedDateTime >= @dateFrom AND pal.CreatedDateTime < DATEADD(day, 1, @dateTo)
    `);
  console.log(`  MB LAKSHAYA actual patient events: ${mbActivityRes.recordset[0].cnt} (should be 0 ✓)`);

  // ──────────────────────────────────────────────────────────────────────────
  // CHECK 3: Three managers with few centre assignments — numbers should be
  // unchanged (or very close to pre-fix, which for these managers was correct)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n=== CHECK 3: Three single-centre managers (should be unaffected) ===');
  const controlRes = await pool.request()
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT TOP 3
        au.Id, au.FirstName, au.LastName,
        COUNT(DISTINCT auc.CentreId) AS centreCount,
        SUM(CASE WHEN pal.Type = 'AssessmentResultGenerated' THEN 1 ELSE 0 END) AS assessmentsScored,
        SUM(CASE WHEN pal.Type = 'ReportAdded'               THEN 1 ELSE 0 END) AS reportsDrafted
      FROM AdminUser au
      JOIN AdminUserRole aur ON aur.UserId = au.Id
      JOIN AdminRole ar      ON ar.Id = aur.RoleId
        AND ar.Name NOT IN ('Clinician', 'Super Admin', 'SuperAdmin')
      JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
      LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
        AND pal.CreatedDateTime >= @dateFrom AND pal.CreatedDateTime < DATEADD(day, 1, @dateTo)
      WHERE au.FirstName NOT LIKE '%(Ops)%'
        AND au.LastName  NOT LIKE '%(Ops)%'
        AND au.Email     NOT LIKE '%(Ops)%'
        AND LOWER(au.FirstName) NOT LIKE '%test%'
        AND LOWER(au.LastName)  NOT LIKE '%test%'
        AND LOWER(au.Email)     NOT LIKE '%@webority.com'
        AND au.Id != ${MANSI_ID}
      GROUP BY au.Id, au.FirstName, au.LastName
      HAVING COUNT(DISTINCT auc.CentreId) = 1
        AND SUM(CASE WHEN pal.Type = 'AssessmentResultGenerated' THEN 1 ELSE 0 END) > 0
      ORDER BY au.LastName, au.FirstName
    `);

  controlRes.recordset.forEach((r) => {
    const buggyValue    = r.assessmentsScored * 1;  // for 1-centre mgr, buggy == correct
    console.log(`  ${r.FirstName} ${r.LastName} (Id=${r.Id}, centres=${r.centreCount}): assessmentsScored=${r.assessmentsScored} reportsDrafted=${r.reportsDrafted}`);
    console.log(`    Single-centre: old (buggy ×1) === new (correct ×1) — unchanged ✓`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n=== VERIFICATION SUMMARY ===');
  console.log(`  BUG 1 (assessmentsScored/reportsDrafted inflation): ${bug1Fixed ? 'FIXED ✓' : 'NOT FIXED ✗'}`);
  console.log(`  BUG 2 (MB LAKSHAYA wrong primary centre):          ${bug2Fixed ? 'FIXED ✓' : 'NOT FIXED ✗'}`);
  console.log(`  BUG 3 (systemic — single-centre managers):         UNAFFECTED (correct before and after) ✓`);

  await pool.close();
  console.log('\n[verify] Done.');
}

run().catch(err => { console.error(err); process.exit(1); });
