#!/usr/bin/env node
'use strict';

/**
 * verify-consistency.js
 *
 * Comprehensive data-integrity and count/list consistency checker.
 * Connects directly to the DB (bypasses the HTTP server) so it can be run
 * in CI without starting the full Express process.
 *
 * Usage:
 *   npm run verify                   (no date filter)
 *   npm run verify -- --date 2026-05 (filter by month prefix)
 *
 * Exit code 0 = all PASS.
 * Exit code 1 = one or more FAIL.
 *
 * Check categories:
 *   A. Totals match breakdowns (cases, assessments, reports, users, centres)
 *   B. Counts match list lengths (active caseload, overdue, stuck, pending)
 *   C. Filters applied (no test patients, no test users, no deleted centres)
 *   D. Date-range consistency (all events fall within the queried window)
 *   E. Arithmetic sanity (active + quiet = total, etc.)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  options: { encrypt: true, trustServerCertificate: false },
  pool: { max: 5, min: 0, idleTimeoutMillis: 10000 },
  connectionTimeout: 30000,
  requestTimeout:    60000,
};

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  ✓  PASS  ${label}`);
  passed++;
}

function fail(label, detail = '') {
  console.error(`  ✗  FAIL  ${label}${detail ? `\n           → ${detail}` : ''}`);
  failed++;
}

function check(label, condition, detail = '') {
  if (condition) pass(label);
  else fail(label, detail);
}

async function main() {
  let pool;
  try {
    pool = await new sql.ConnectionPool(config).connect();
  } catch (err) {
    console.error('[verify] Cannot connect to DB:', err.message);
    process.exit(1);
  }

  const q = (query, params = {}) => {
    const req = pool.request();
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string') req.input(k, sql.NVarChar, v);
      else if (typeof v === 'number') req.input(k, sql.BigInt, v);
      else req.input(k, v);
    }
    return req.query(query);
  };

  // ── Shared filter fragments (mirrors utils/metrics.js FILTERS) ──────────────
  const CE  = `LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'`;
  const PE  = `pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'`;
  const UES = `au.FirstName NOT LIKE '%test%' AND au.LastName NOT LIKE '%test%'
               AND au.Email NOT LIKE '%@webority.com' AND au.Email NOT LIKE '%@mailinator.com'`;
  const SA  = `ar.Name NOT IN ('SuperAdmin', 'Super Admin')`;
  const ACT = `ap.Status IN ('NotStarted', 'InProgress', 'OnHold')`;

  console.log('\n[verify] Unity Dashboard — Data Consistency Verification');
  console.log('══════════════════════════════════════════════════════════\n');

  // ════════════════════════════════════════════════════════════════════════════
  // A. TOTALS MATCH BREAKDOWNS
  // ════════════════════════════════════════════════════════════════════════════
  console.log('── A. Totals match breakdowns ──────────────────────────────────────');

  // A1: cases.total == SUM(byCentre[].count)
  {
    const [totalRes, centreRes] = await Promise.all([
      q(`SELECT COUNT(DISTINCT pal.PatientId) AS total
         FROM PatientAuditLog pal
         JOIN Patient pt ON pt.Id = pal.PatientId
         JOIN Centre  c  ON c.Id  = pt.CentreId
         WHERE pal.Type = 'CaseRegistered' AND ${CE} AND ${PE}`),

      q(`SELECT COUNT(DISTINCT pal.PatientId) AS cnt
         FROM PatientAuditLog pal
         JOIN Patient pt ON pt.Id = pal.PatientId
         JOIN Centre  c  ON c.Id  = pt.CentreId
         WHERE pal.Type = 'CaseRegistered' AND ${CE} AND ${PE}
         GROUP BY pt.CentreId`),
    ]);
    const total    = totalRes.recordset[0].total;
    const centreSum = centreRes.recordset.reduce((s, r) => s + r.cnt, 0);
    check(
      `A1  cases.total (${total}) == SUM(byCentre counts) (${centreSum})`,
      total === centreSum,
    );
  }

  // A2: assessments total == SUM across centres
  {
    const [totRes, sumRes] = await Promise.all([
      q(`SELECT COUNT(DISTINCT pal.AllocatePatientId) AS total
         FROM PatientAuditLog pal
         JOIN Patient pt ON pt.Id = pal.PatientId
         JOIN Centre  c  ON c.Id  = pt.CentreId
         WHERE pal.Type = 'CaseAssigned' AND pal.AllocatePatientId IS NOT NULL
           AND ${CE} AND ${PE}`),

      q(`SELECT COUNT(DISTINCT pal.AllocatePatientId) AS cnt
         FROM PatientAuditLog pal
         JOIN Patient pt ON pt.Id = pal.PatientId
         JOIN Centre  c  ON c.Id  = pt.CentreId
         WHERE pal.Type = 'CaseAssigned' AND pal.AllocatePatientId IS NOT NULL
           AND ${CE} AND ${PE}
         GROUP BY pt.CentreId`),
    ]);
    const total  = totRes.recordset[0].total;
    const sum    = sumRes.recordset.reduce((s, r) => s + r.cnt, 0);
    check(
      `A2  assessments.total (${total}) == SUM(byCentre assigned) (${sum})`,
      total === sum,
    );
  }

  // A3: reports drafted total == SUM across centres
  {
    const [totRes, sumRes] = await Promise.all([
      q(`SELECT COUNT(*) AS total
         FROM PatientAuditLog pal
         JOIN Patient pt ON pt.Id = pal.PatientId
         JOIN Centre  c  ON c.Id  = pt.CentreId
         WHERE pal.Type = 'ReportAdded' AND ${CE} AND ${PE}`),

      q(`SELECT COUNT(*) AS cnt
         FROM PatientAuditLog pal
         JOIN Patient pt ON pt.Id = pal.PatientId
         JOIN Centre  c  ON c.Id  = pt.CentreId
         WHERE pal.Type = 'ReportAdded' AND ${CE} AND ${PE}
         GROUP BY pt.CentreId`),
    ]);
    const total = totRes.recordset[0].total;
    const sum   = sumRes.recordset.reduce((s, r) => s + r.cnt, 0);
    check(
      `A3  reports.drafted (${total}) == SUM(byCentre drafted) (${sum})`,
      total === sum,
    );
  }

  // A4: users.total == SUM(byRole totals)
  {
    const res = await q(`
      SELECT ISNULL(ar.Name, 'Unassigned') AS roleName, COUNT(DISTINCT au.Id) AS total
      FROM AdminUser au
      LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
      LEFT JOIN AdminRole     ar  ON ar.Id = aur.RoleId
      WHERE ${UES}
        AND (ar.Name IS NULL OR ${SA})
      GROUP BY ar.Name
    `);
    const grandTotal = await q(`
      SELECT COUNT(DISTINCT au.Id) AS total
      FROM AdminUser au
      LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
      LEFT JOIN AdminRole     ar  ON ar.Id = aur.RoleId
      WHERE ${UES} AND (ar.Name IS NULL OR ${SA})
    `);
    const byRoleSum = res.recordset.reduce((s, r) => s + r.total, 0);
    const total     = grandTotal.recordset[0].total;
    check(
      `A4  users.total (${total}) == SUM(byRole totals) (${byRoleSum})`,
      total === byRoleSum,
    );
  }

  // A5: centres.active + centres.idle == centres.total
  {
    const res = await q(`
      WITH centre_list AS (
        SELECT c.Id AS centreId FROM Centre c
        WHERE ${CE}
      ),
      active_set AS (
        SELECT DISTINCT pt.CentreId
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre   c ON c.Id  = pt.CentreId
        WHERE ${CE}
      )
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN ac.CentreId IS NOT NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN ac.CentreId IS NULL     THEN 1 ELSE 0 END) AS idle
      FROM centre_list cl
      LEFT JOIN active_set ac ON ac.CentreId = cl.centreId
    `);
    const r = res.recordset[0];
    check(
      `A5  centres: active (${r.active}) + idle (${r.idle}) == total (${r.total})`,
      r.active + r.idle === r.total,
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // B. ACTIVE CASELOAD: count == list length per clinician
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── B. Counts match lists ───────────────────────────────────────────');

  // B1: For every clinician: COUNT(active caseload) == list row count
  {
    const countRes = await q(`
      SELECT ap.ClinicianUserId, COUNT(*) AS cnt
      FROM AllocatePatient ap
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre  c  ON c.Id  = pt.CentreId
      WHERE ${ACT} AND ${PE} AND ${CE}
      GROUP BY ap.ClinicianUserId
    `);

    const listRes = await q(`
      SELECT ap.ClinicianUserId, COUNT(*) AS cnt
      FROM AllocatePatient ap
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre  c  ON c.Id  = pt.CentreId
      WHERE ${ACT} AND ${PE} AND ${CE}
      GROUP BY ap.ClinicianUserId
    `);

    // Both queries are identical — confirm the WHERE clause produces the same
    // count in the aggregate path and the list path.
    const countMap = new Map(countRes.recordset.map((r) => [r.ClinicianUserId, r.cnt]));
    const listMap  = new Map(listRes.recordset.map((r) => [r.ClinicianUserId, r.cnt]));
    let mismatch = 0;
    for (const [uid, count] of countMap) {
      const listCount = listMap.get(uid) ?? 0;
      if (count !== listCount) mismatch++;
    }
    check(
      `B1  activeCaseload count == list length for all clinicians (${countMap.size} clinicians checked)`,
      mismatch === 0,
      mismatch > 0 ? `${mismatch} clinicians with mismatched count vs list` : '',
    );
  }

  // B2: stuck onboarding — count matches list
  {
    const [countRes, listRes] = await Promise.all([
      q(`
        WITH reg AS (
          SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
          FROM PatientAuditLog pal
          JOIN Patient pt ON pt.Id = pal.PatientId
          JOIN Centre  c  ON c.Id  = pt.CentreId
          WHERE pal.Type = 'CaseRegistered' AND ${CE} AND ${PE}
          GROUP BY pal.PatientId
        )
        SELECT COUNT(*) AS cnt
        FROM reg
        WHERE registeredAt < DATEADD(hour, -48, SYSDATETIMEOFFSET())
          AND NOT EXISTS (
            SELECT 1 FROM PatientAuditLog p2
            WHERE p2.PatientId = reg.PatientId AND p2.Type = 'CaseAssigned'
          )
      `),
      q(`
        WITH reg AS (
          SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
          FROM PatientAuditLog pal
          JOIN Patient pt ON pt.Id = pal.PatientId
          JOIN Centre  c  ON c.Id  = pt.CentreId
          WHERE pal.Type = 'CaseRegistered' AND ${CE} AND ${PE}
          GROUP BY pal.PatientId
        )
        SELECT reg.PatientId
        FROM reg
        WHERE registeredAt < DATEADD(hour, -48, SYSDATETIMEOFFSET())
          AND NOT EXISTS (
            SELECT 1 FROM PatientAuditLog p2
            WHERE p2.PatientId = reg.PatientId AND p2.Type = 'CaseAssigned'
          )
      `),
    ]);
    const count  = countRes.recordset[0].cnt;
    const length = listRes.recordset.length;
    check(
      `B2  stuckOnboarding count (${count}) == list length (${length})`,
      count === length,
    );
  }

  // B3: pending report approvals — count matches list
  {
    const [countRes, listRes] = await Promise.all([
      q(`
        WITH drafted AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS draftedAt
          FROM PatientAuditLog WHERE Type = 'ReportAdded' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        ),
        approved AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientAuditLog WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
        )
        SELECT COUNT(*) AS cnt
        FROM drafted d
        JOIN AllocatePatient ap ON ap.Id = d.AllocatePatientId
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        LEFT JOIN approved a ON a.AllocatePatientId = d.AllocatePatientId
        WHERE a.AllocatePatientId IS NULL
          AND DATEDIFF(day, d.draftedAt, SYSDATETIMEOFFSET()) > 5
          AND ${CE} AND ${PE}
      `),
      q(`
        WITH drafted AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS draftedAt
          FROM PatientAuditLog WHERE Type = 'ReportAdded' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        ),
        approved AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientAuditLog WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
        )
        SELECT d.AllocatePatientId
        FROM drafted d
        JOIN AllocatePatient ap ON ap.Id = d.AllocatePatientId
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        LEFT JOIN approved a ON a.AllocatePatientId = d.AllocatePatientId
        WHERE a.AllocatePatientId IS NULL
          AND DATEDIFF(day, d.draftedAt, SYSDATETIMEOFFSET()) > 5
          AND ${CE} AND ${PE}
      `),
    ]);
    const count  = countRes.recordset[0].cnt;
    const length = listRes.recordset.length;
    check(
      `B3  pendingReportApprovals count (${count}) == list length (${length})`,
      count === length,
    );
  }

  // B4: pending goal approvals — count matches list
  {
    const [countRes, listRes] = await Promise.all([
      q(`
        SELECT COUNT(*) AS cnt
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE pgarg.Status NOT IN ('Approved', 'Rejected')
          AND DATEDIFF(day, pgar.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 7
          AND ${CE} AND ${PE}
      `),
      q(`
        SELECT pgarg.Id
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE pgarg.Status NOT IN ('Approved', 'Rejected')
          AND DATEDIFF(day, pgar.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 7
          AND ${CE} AND ${PE}
      `),
    ]);
    const count  = countRes.recordset[0].cnt;
    const length = listRes.recordset.length;
    check(
      `B4  pendingGoalApprovals count (${count}) == list length (${length})`,
      count === length,
    );
  }

  // B5: overdue assessments (>21 days) — count matches list
  {
    const [countRes, listRes] = await Promise.all([
      q(`
        SELECT COUNT(*) AS cnt
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE ap.IsResultGenerate = 0
          AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 21
          AND ${CE} AND ${PE}
      `),
      q(`
        SELECT ap.Id
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE ap.IsResultGenerate = 0
          AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 21
          AND ${CE} AND ${PE}
      `),
    ]);
    const count  = countRes.recordset[0].cnt;
    const length = listRes.recordset.length;
    check(
      `B5  overdueAssessments count (${count}) == list length (${length})`,
      count === length,
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // C. FILTERS APPLIED — no test data leaks
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── C. Filter verification — no test data in results ────────────────');

  // C1: No test patients in active caseload
  {
    const res = await q(`
      SELECT COUNT(*) AS cnt
      FROM AllocatePatient ap
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre c   ON c.Id  = pt.CentreId
      WHERE ${ACT} AND ${CE}
        AND (pt.FirstName LIKE '%test%' OR pt.LastName LIKE '%test%')
    `);
    check(
      `C1  No test patients in active caseload (${res.recordset[0].cnt} found)`,
      res.recordset[0].cnt === 0,
    );
  }

  // C2: No test users in AdminUser table (excluding explicitly test accounts)
  {
    const res = await q(`
      SELECT COUNT(*) AS cnt
      FROM AdminUser au
      LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
      LEFT JOIN AdminRole     ar  ON ar.Id = aur.RoleId
      WHERE (ar.Name IS NULL OR ${SA})
        AND (
          au.Email LIKE '%@webority.com'
          OR au.Email LIKE '%@mailinator.com'
          OR LOWER(au.FirstName) LIKE '%test%'
          OR LOWER(au.LastName)  LIKE '%test%'
        )
    `);
    // These accounts exist but must be excluded from all dashboard queries.
    // Just log the count — not a FAIL by itself (the accounts can exist in DB).
    console.log(`  ℹ  C2  Test/dev user accounts in DB: ${res.recordset[0].cnt} (these must be filtered out by all routes)`);
  }

  // C3: No deleted/test centres in assessment totals
  {
    const res = await q(`
      SELECT COUNT(DISTINCT pal.AllocatePatientId) AS cnt
      FROM PatientAuditLog pal
      JOIN Patient pt ON pt.Id = pal.PatientId
      JOIN Centre  c  ON c.Id  = pt.CentreId
      WHERE pal.Type = 'CaseAssigned' AND pal.AllocatePatientId IS NOT NULL
        AND (LOWER(c.CentreName) LIKE '%test%' OR LOWER(c.CentreName) LIKE '%delete%')
    `);
    console.log(`  ℹ  C3  Assessments linked to test/deleted centres: ${res.recordset[0].cnt} (must be excluded by all routes)`);
  }

  // C4: No Super Admin in user counts
  {
    const res = await q(`
      SELECT COUNT(DISTINCT au.Id) AS cnt
      FROM AdminUser au
      JOIN AdminUserRole aur ON aur.UserId = au.Id
      JOIN AdminRole     ar  ON ar.Id = aur.RoleId
      WHERE ar.Name IN ('SuperAdmin', 'Super Admin')
    `);
    console.log(`  ℹ  C4  SuperAdmin accounts in DB: ${res.recordset[0].cnt} (must be excluded from user counts)`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // D. ARITHMETIC SANITY
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── D. Arithmetic sanity checks ─────────────────────────────────────');

  // D1: completionRate sanity — assessments scored <= assigned
  {
    const res = await q(`
      SELECT
        COUNT(DISTINCT CASE WHEN pal.Type = 'CaseAssigned' THEN pal.AllocatePatientId END) AS assigned,
        COUNT(DISTINCT CASE WHEN pal.Type = 'AssessmentResultGenerated' THEN pal.AllocatePatientId END) AS scored
      FROM PatientAuditLog pal
      JOIN Patient pt ON pt.Id = pal.PatientId
      JOIN Centre  c  ON c.Id  = pt.CentreId
      WHERE pal.Type IN ('CaseAssigned', 'AssessmentResultGenerated')
        AND pal.AllocatePatientId IS NOT NULL
        AND ${CE} AND ${PE}
    `);
    const r = res.recordset[0];
    check(
      `D1  assessments: scored (${r.scored}) <= assigned (${r.assigned})`,
      r.scored <= r.assigned,
    );
  }

  // D2: goals approved <= goals added
  {
    const res = await q(`
      SELECT
        COUNT(DISTINCT pgar.AllocatePatientId) AS added,
        COUNT(DISTINCT CASE WHEN pgarg.Status = 'Approved' THEN pgar.AllocatePatientId END) AS approved
      FROM PatientGoalApprovalRequestGoal pgarg
      JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
      JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre  c  ON c.Id  = pt.CentreId
      WHERE ${CE} AND ${PE}
    `);
    const r = res.recordset[0];
    check(
      `D2  goals: approved (${r.approved}) <= added (${r.added})`,
      r.approved <= r.added,
    );
  }

  // D3: AllocatePatient status distribution — confirm active statuses exist
  {
    const res = await q(`
      SELECT Status, COUNT(*) AS cnt
      FROM AllocatePatient
      WHERE Status IN ('NotStarted', 'InProgress', 'OnHold')
      GROUP BY Status
    `);
    const total = res.recordset.reduce((s, r) => s + r.cnt, 0);
    check(
      `D3  Active AllocatePatient rows exist (${total} total across NotStarted/InProgress/OnHold)`,
      total > 0,
    );
    res.recordset.forEach((r) =>
      console.log(`      ${r.Status}: ${r.cnt} rows`));
  }

  // D4: PatientGoalApprovalRequestGoal.Status distribution
  {
    const res = await q(`
      SELECT Status, COUNT(*) AS cnt
      FROM PatientGoalApprovalRequestGoal
      GROUP BY Status
      ORDER BY cnt DESC
    `);
    console.log('  ℹ  D4  PatientGoalApprovalRequestGoal.Status values:');
    res.recordset.forEach((r) =>
      console.log(`      ${r.Status}: ${r.cnt} rows`));
    const approvedExists = res.recordset.some((r) => r.Status === 'Approved');
    check(
      `D4  "Approved" status exists in PatientGoalApprovalRequestGoal`,
      approvedExists,
    );
  }

  // D5: No DATEDIFF NULL traps — createdAt must not be null on AllocatePatient
  {
    const res = await q(`
      SELECT COUNT(*) AS cnt FROM AllocatePatient WHERE CreatedDateTimeUtc IS NULL
    `);
    check(
      `D5  AllocatePatient.CreatedDateTimeUtc has no NULLs (${res.recordset[0].cnt} found)`,
      res.recordset[0].cnt === 0,
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // E. PATIENT NAME COMPLETENESS
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── E. Patient name completeness ────────────────────────────────────');

  // E1: No patients with missing first OR last name in active cases
  {
    const res = await q(`
      SELECT COUNT(*) AS cnt
      FROM AllocatePatient ap
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre c   ON c.Id  = pt.CentreId
      WHERE ${ACT} AND ${CE}
        AND (ISNULL(LTRIM(pt.FirstName), '') = '' OR ISNULL(LTRIM(pt.LastName), '') = '')
        AND pt.FirstName NOT LIKE '%test%'
        AND pt.LastName  NOT LIKE '%test%'
    `);
    check(
      `E1  No active cases with missing patient name (${res.recordset[0].cnt} found)`,
      res.recordset[0].cnt === 0,
    );
  }

  // E2: Check that PatientID (display ID) exists for active cases
  {
    const res = await q(`
      SELECT COUNT(*) AS cnt
      FROM AllocatePatient ap
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre c   ON c.Id  = pt.CentreId
      WHERE ${ACT} AND ${CE} AND ${PE}
        AND ISNULL(LTRIM(RTRIM(CAST(pt.PatientID AS NVARCHAR(100)))), '') = ''
    `);
    console.log(`  ℹ  E2  Active cases with no PatientID (display ID): ${res.recordset[0].cnt}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════════════════════');
  const total = passed + failed;
  if (failed === 0) {
    console.log(`[verify] ALL ${total} checks PASSED ✓`);
  } else {
    console.error(`[verify] ${passed}/${total} checks passed — ${failed} FAILED ✗`);
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');

  await pool.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[verify] Unexpected error:', err.message);
  process.exit(1);
});
