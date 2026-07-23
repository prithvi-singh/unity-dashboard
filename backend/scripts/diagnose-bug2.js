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
  requestTimeout: 45000,
};

const DATE_FROM = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const DATE_TO   = new Date();
const MANSI_ID  = 254;  // confirmed from diagnose step
const MB_ID     = 60;   // confirmed from diagnose step

async function run() {
  const pool = await sql.connect(config);
  console.log('[diagnose-bug2] Connected\n');

  // ──────────────────────────────────────────────────────────────────────────
  // BUG 2 — Correct attribution via PatientId → Patient → CentreId
  // AllocatePatient has NO CentreId — centre comes from Patient.CentreId
  // ──────────────────────────────────────────────────────────────────────────
  console.log('=== BUG 2: MB LAKSHAYA (CentreId=60) attribution ===');

  // WRONG approach (AdminUserCentre join = inflated)
  const wrongRes = await pool.request()
    .input('centreId', sql.BigInt, MB_ID)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM PatientAuditLog pal
      JOIN AdminUserCentre auc ON auc.AdminUserId = pal.AdminUserId
      WHERE auc.CentreId = @centreId
        AND pal.CreatedDateTime BETWEEN @dateFrom AND @dateTo
    `);
  console.log(`  ✗ Events via AdminUserCentre join (WRONG): ${wrongRes.recordset[0].cnt}`);

  // CORRECT approach: PatientAuditLog → PatientId → Patient → CentreId
  const correctRes = await pool.request()
    .input('centreId', sql.BigInt, MB_ID)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM PatientAuditLog pal
      JOIN Patient p ON p.Id = pal.PatientId
      WHERE p.CentreId = @centreId
        AND pal.CreatedDateTime BETWEEN @dateFrom AND @dateTo
    `);
  console.log(`  ✓ Events via Patient.CentreId (CORRECT): ${correctRes.recordset[0].cnt}`);

  // Mansi's actions at MB LAKSHAYA via Patient.CentreId
  const mansiAtMbRes = await pool.request()
    .input('userId',   sql.BigInt,        MANSI_ID)
    .input('centreId', sql.BigInt,        MB_ID)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM PatientAuditLog pal
      JOIN Patient p ON p.Id = pal.PatientId
      WHERE pal.AdminUserId = @userId
        AND p.CentreId = @centreId
        AND pal.CreatedDateTime BETWEEN @dateFrom AND @dateTo
    `);
  console.log(`  ✓ Mansi's actions at MB LAKSHAYA (should be 0): ${mansiAtMbRes.recordset[0].cnt}`);

  // Patient count at MB LAKSHAYA
  const mbPatientsRes = await pool.request()
    .input('centreId', sql.BigInt, MB_ID)
    .query(`
      SELECT COUNT(*) AS cnt FROM Patient
      WHERE CentreId = @centreId
        AND FirstName NOT LIKE '%test%'
        AND LastName  NOT LIKE '%test%'
    `);
  console.log(`  ✓ Non-test patients at MB LAKSHAYA: ${mbPatientsRes.recordset[0].cnt} (should be 0)`);

  // ──────────────────────────────────────────────────────────────────────────
  // BUG 2 — metricsService Q3 per-centre breakdown
  // What does Mansi's case load look like broken down by actual centre?
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n=== Mansi — cases by actual centre (correct attribution) ===');
  const mansiBycentreRes = await pool.request()
    .input('userId',   sql.BigInt,        MANSI_ID)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT
        c.Id AS centreId,
        c.CentreName,
        COUNT(DISTINCT CASE WHEN pal.Type = 'CaseRegistered' THEN pal.PatientId END)       AS casesRegistered,
        COUNT(DISTINCT CASE WHEN pal.Type = 'CaseAssigned'   THEN pal.AllocatePatientId END) AS assessmentsAssigned,
        COUNT(DISTINCT CASE WHEN pal.Type = 'AssessmentResultGenerated' THEN pal.Id END)  AS assessmentsScored,
        COUNT(DISTINCT CASE WHEN pal.Type = 'ReportAdded' THEN pal.Id END)                AS reportsDrafted
      FROM PatientAuditLog pal
      JOIN Patient p ON p.Id = pal.PatientId
      JOIN Centre  c ON c.Id = p.CentreId
      WHERE pal.AdminUserId = @userId
        AND pal.Type IN ('CaseRegistered','CaseAssigned','AssessmentResultGenerated','ReportAdded','ProgressAdded')
        AND pal.CreatedDateTime BETWEEN @dateFrom AND @dateTo
        AND LOWER(c.CentreName) NOT LIKE '%test%'
        AND LOWER(c.CentreName) NOT LIKE '%delete%'
        AND p.FirstName NOT LIKE '%test%'
        AND p.LastName  NOT LIKE '%test%'
      GROUP BY c.Id, c.CentreName
      HAVING COUNT(*) > 0
      ORDER BY c.CentreName
    `);
  console.log('  Mansi actual activity by centre:');
  mansiBycentreRes.recordset.forEach(r => {
    console.log(`    [${r.centreId}] ${r.CentreName}: cases=${r.casesRegistered}, assessments=${r.assessmentsAssigned}, scored=${r.assessmentsScored}, drafted=${r.reportsDrafted}`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BUG 1 — final summary numbers
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n=== BUG 1 SUMMARY ===');
  const p = await pool.request()
    .input('userId',   sql.BigInt,        MANSI_ID)
    .input('dateFrom', sql.DateTimeOffset, DATE_FROM)
    .input('dateTo',   sql.DateTimeOffset, DATE_TO)
    .query(`
      SELECT
        SUM(CASE WHEN Type = 'AssessmentResultGenerated' THEN 1 ELSE 0 END) AS assessmentsScored_CORRECT,
        SUM(CASE WHEN Type = 'ReportAdded'               THEN 1 ELSE 0 END) AS reportsDrafted_CORRECT,
        SUM(CASE WHEN Type = 'ProgressAdded'             THEN 1 ELSE 0 END) AS progressNotes_CORRECT
      FROM PatientAuditLog
      WHERE AdminUserId = @userId
        AND CreatedDateTime BETWEEN @dateFrom AND @dateTo
    `);
  const pr = p.recordset[0];
  console.log(`  CORRECT (personal): assessmentsScored=${pr.assessmentsScored_CORRECT}, reportsDrafted=${pr.reportsDrafted_CORRECT}, progressNotes=${pr.progressNotes_CORRECT}`);
  console.log(`  BUGGY  (UI shows) : assessmentsScored=234, reportsDrafted=234`);
  console.log(`  Inflation factor  : ${mansiRes_cached} centres pass filter on the join`);

  await pool.close();
  console.log('\n[diagnose-bug2] Done.');
}

let mansiRes_cached = '~117 (120 total minus ~3 test centres)';
run().catch(err => { console.error(err); process.exit(1); });
