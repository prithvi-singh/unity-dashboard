'use strict';

/**
 * Step 0 Investigation Script
 * ===========================
 * Investigates all completion paths for assessments in Unity.
 * Run: node backend/audit/step0-investigate.js
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
  requestTimeout:   30000,
  connectionTimeout: 15000,
};

async function run() {
  console.log('Connecting to', process.env.DB_SERVER, '/', process.env.DB_NAME);
  const pool = await new sql.ConnectionPool(config).connect();
  console.log('Connected.\n');

  // ── Q1: All distinct Status values in AllocatePatient ──────────────────────
  console.log('═══════════════════════════════════════');
  console.log('Q1: ALL DISTINCT AllocatePatient.Status VALUES WITH COUNTS');
  console.log('═══════════════════════════════════════');
  const q1 = await pool.request().query(`
    SELECT Status, COUNT(*) AS cnt
    FROM AllocatePatient
    GROUP BY Status
    ORDER BY cnt DESC
  `);
  console.table(q1.recordset);

  // ── Q2: Find Leo Arya's assessments ────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('Q2: LEO ARYA\'S ALLOCATEPATIENT ROWS');
  console.log('═══════════════════════════════════════');
  const q2 = await pool.request().query(`
    SELECT
      ap.Id               AS allocatePatientId,
      ap.PatientId,
      pt.FirstName,
      pt.LastName,
      ap.Assessment,
      ap.Status,
      ap.IsResultGenerate,
      ap.CreatedDateTimeUtc,
      ap.UpdatedDateTimeUtc
    FROM AllocatePatient ap
    JOIN Patient pt ON pt.Id = ap.PatientId
    WHERE (pt.FirstName LIKE '%Leo%' OR pt.FirstName LIKE '%Arya%'
           OR pt.LastName LIKE '%Leo%' OR pt.LastName LIKE '%Arya%')
    ORDER BY ap.CreatedDateTimeUtc DESC
  `);
  console.table(q2.recordset);

  // ── Q3: PatientAuditLog for Leo Arya - ALL events ──────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('Q3: ALL PatientAuditLog EVENTS FOR LEO ARYA');
  console.log('═══════════════════════════════════════');
  const q3 = await pool.request().query(`
    SELECT
      pal.Id,
      pal.PatientId,
      pal.AllocatePatientId,
      pal.Type,
      pal.Description,
      pal.CreatedDateTime,
      au.FirstName + ' ' + au.LastName AS actor
    FROM PatientAuditLog pal
    JOIN Patient pt ON pt.Id = pal.PatientId
    LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
    WHERE (pt.FirstName LIKE '%Leo%' OR pt.FirstName LIKE '%Arya%'
           OR pt.LastName LIKE '%Leo%' OR pt.LastName LIKE '%Arya%')
    ORDER BY pal.CreatedDateTime ASC
  `);
  console.table(q3.recordset);

  // ── Q4: PatientGoalApprovalRequest for Leo Arya ────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('Q4: GOAL APPROVAL RECORDS FOR LEO ARYA');
  console.log('═══════════════════════════════════════');
  const q4 = await pool.request().query(`
    SELECT
      pgar.Id               AS requestId,
      pgar.AllocatePatientId,
      pgar.CreatedDateTimeUtc,
      pgarg.Id              AS goalId,
      pgarg.Status          AS goalStatus,
      pgarg.UpdatedDateTimeUtc
    FROM PatientGoalApprovalRequest pgar
    JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
    JOIN Patient pt ON pt.Id = ap.PatientId
    LEFT JOIN PatientGoalApprovalRequestGoal pgarg
      ON pgarg.PatientGoalApprovalRequestId = pgar.Id
    WHERE (pt.FirstName LIKE '%Leo%' OR pt.FirstName LIKE '%Arya%'
           OR pt.LastName LIKE '%Leo%' OR pt.LastName LIKE '%Arya%')
    ORDER BY pgar.CreatedDateTimeUtc DESC
  `);
  console.table(q4.recordset);

  // ── Q5: CaseStatusChanged events - all distinct descriptions ───────────────
  console.log('\n═══════════════════════════════════════');
  console.log('Q5: ALL DISTINCT CaseStatusChanged DESCRIPTIONS');
  console.log('═══════════════════════════════════════');
  const q5 = await pool.request().query(`
    SELECT
      Description,
      COUNT(*) AS cnt
    FROM PatientAuditLog
    WHERE Type = 'CaseStatusChanged'
    GROUP BY Description
    ORDER BY cnt DESC
  `);
  console.table(q5.recordset);

  // ── Q6: AssessmentStatusChanged events - all distinct descriptions ─────────
  console.log('\n═══════════════════════════════════════');
  console.log('Q6: ALL DISTINCT AssessmentStatusChanged DESCRIPTIONS (sample)');
  console.log('═══════════════════════════════════════');
  const q6 = await pool.request().query(`
    SELECT TOP 30
      Description,
      COUNT(*) AS cnt
    FROM PatientAuditLog
    WHERE Type = 'AssessmentStatusChanged'
    GROUP BY Description
    ORDER BY cnt DESC
  `);
  console.table(q6.recordset);

  // ── Q7: Status distribution — assessments with Completed/Closed status ─────
  console.log('\n═══════════════════════════════════════');
  console.log('Q7: AllocatePatient WHERE Status NOT IN active set — sample rows');
  console.log('═══════════════════════════════════════');
  const q7 = await pool.request().query(`
    SELECT TOP 20
      ap.Id,
      ap.Assessment,
      ap.Status,
      ap.IsResultGenerate,
      pt.FirstName,
      pt.LastName,
      ap.CreatedDateTimeUtc,
      ap.UpdatedDateTimeUtc
    FROM AllocatePatient ap
    JOIN Patient pt ON pt.Id = ap.PatientId
    WHERE ap.Status NOT IN ('NotStarted','InProgress','OnHold')
      AND pt.FirstName NOT LIKE '%test%'
      AND pt.LastName  NOT LIKE '%test%'
    ORDER BY ap.UpdatedDateTimeUtc DESC
  `);
  console.table(q7.recordset);

  // ── Q8: Audit log for any Completed/Closed AllocatePatient rows ─────────────
  console.log('\n═══════════════════════════════════════');
  console.log('Q8: PatientAuditLog for sample Completed/Closed AllocatePatient rows');
  console.log('═══════════════════════════════════════');
  const q8 = await pool.request().query(`
    SELECT TOP 50
      pal.AllocatePatientId,
      pal.Type,
      pal.Description,
      pal.CreatedDateTime,
      ap.Status AS apStatus
    FROM PatientAuditLog pal
    JOIN AllocatePatient ap ON ap.Id = pal.AllocatePatientId
    JOIN Patient pt ON pt.Id = ap.PatientId
    WHERE ap.Status NOT IN ('NotStarted','InProgress','OnHold')
      AND pt.FirstName NOT LIKE '%test%'
      AND pt.LastName  NOT LIKE '%test%'
      AND pal.AllocatePatientId IS NOT NULL
    ORDER BY pal.CreatedDateTime DESC
  `);
  console.table(q8.recordset);

  // ── Q9: Do Completed rows have approved goals? ──────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('Q9: Completed/Closed rows — do they have approved goals?');
  console.log('═══════════════════════════════════════');
  const q9 = await pool.request().query(`
    SELECT
      ap.Status,
      COUNT(ap.Id) AS totalAPs,
      SUM(CASE WHEN pgar.Id IS NOT NULL THEN 1 ELSE 0 END) AS hasGoalRequest,
      SUM(CASE WHEN pgarg.Status = 'Approved' THEN 1 ELSE 0 END) AS hasApprovedGoal
    FROM AllocatePatient ap
    JOIN Patient pt ON pt.Id = ap.PatientId
    LEFT JOIN PatientGoalApprovalRequest pgar ON pgar.AllocatePatientId = ap.Id
    LEFT JOIN PatientGoalApprovalRequestGoal pgarg
      ON pgarg.PatientGoalApprovalRequestId = pgar.Id
    WHERE ap.Status NOT IN ('NotStarted','InProgress','OnHold')
      AND pt.FirstName NOT LIKE '%test%'
      AND pt.LastName  NOT LIKE '%test%'
    GROUP BY ap.Status
    ORDER BY totalAPs DESC
  `);
  console.table(q9.recordset);

  // ── Q10: ALL distinct event types in PatientAuditLog ───────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('Q10: ALL DISTINCT PatientAuditLog.Type values');
  console.log('═══════════════════════════════════════');
  const q10 = await pool.request().query(`
    SELECT Type, COUNT(*) AS cnt
    FROM PatientAuditLog
    GROUP BY Type
    ORDER BY cnt DESC
  `);
  console.table(q10.recordset);

  // ── Q11: PatientGoalApprovalRequestGoal distinct Status values ─────────────
  console.log('\n═══════════════════════════════════════');
  console.log('Q11: PatientGoalApprovalRequestGoal.Status values');
  console.log('═══════════════════════════════════════');
  const q11 = await pool.request().query(`
    SELECT Status, COUNT(*) AS cnt
    FROM PatientGoalApprovalRequestGoal
    GROUP BY Status
    ORDER BY cnt DESC
  `);
  console.table(q11.recordset);

  await pool.close();
  console.log('\nInvestigation complete.');
}

run().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
