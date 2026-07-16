'use strict';

/**
 * adhoc-team-report.js — One-off report for team Slack/email update.
 *
 * Outputs two numbered sections as console.table / JSON:
 *
 *   1. Inactive clinicians — count + list of names/emails.
 *      "Inactive" = zero PatientAuditLog rows ever, OR last audit activity
 *      is more than 30 days ago (effectively not using Unity).
 *
 *   2. Completed assessments (June 1 – July 16 2026) — total + centre-wise
 *      breakdown, using abbreviateCentre() for compact labels.
 *      Completion logic mirrors assessmentState.js:
 *        • AllocatePatient.Status IN ('Completed','Closed')    ← Path 1/3
 *        • PatientGoalApprovalRequestGoal.Status = 'Approved'  ← Path 2
 *      The completing-event date is the CaseStatusChanged audit event
 *      (for terminal status) or the goal-approval UpdatedDateTimeUtc
 *      (for approved goals).
 *
 * All queries apply the four DATA INTEGRITY FILTERS from filters.js:
 *   1. Test patients   — FirstName/LastName LIKE '%test%'
 *   2. Test users      — name/email pattern, webority, mailinator,
 *                         parivahealth, gmail
 *   3. Super Admin     — ar.Name NOT IN ('SuperAdmin','Super Admin')
 *   4. Deleted centres — CentreName LIKE '%test%' or '%delete%'
 *
 * Usage:  node backend/scripts/adhoc-team-report.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sql, poolPromise } = require('../db');
const { FILTERS, EVENT_TYPES, toSqlIn } = require('../utils/metrics');
const { abbreviateCentre } = require('../lib/formatters');
const { buildDateFilter } = require('../lib/queryHelpers');

// ── Constants ────────────────────────────────────────────────────────────────

const REPORT_FROM = '2026-06-01';
const REPORT_TO   = '2026-07-16';

/** Days since last activity before a clinician is considered "not using Unity". */
const STALE_DAYS = 30;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build an IST-midnight Date from a YYYY-MM-DD string. */
function istMidnight(yyyymmdd) {
  const d = new Date(`${yyyymmdd}T00:00:00+05:30`);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${yyyymmdd}`);
  return d;
}

function fmtName(first, last) {
  return `${first ?? ''} ${last ?? ''}`.trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// PART 1 — Inactive Clinicians
// ──────────────────────────────────────────────────────────────────────────────

async function reportInactiveClinicians(pool) {
  const CE = FILTERS.centreExclusion('c');
  const UE = FILTERS.userExclusionStrict('au');
  const SA = FILTERS.superAdminExclusion('ar');

  const result = await pool.request().query(`
    SELECT
      au.Id,
      au.FirstName,
      au.LastName,
      au.Email,
      MAX(pal.CreatedDateTime) AS lastActivityDate,
      DATEDIFF(day, MAX(pal.CreatedDateTime), SYSDATETIMEOFFSET()) AS daysSinceActivity
    FROM AdminUser au
    JOIN AdminUserRole aur ON aur.UserId = au.Id
    JOIN AdminRole ar      ON ar.Id = aur.RoleId
      AND ar.Name = 'Clinician'
    JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
    JOIN Centre c ON c.Id = auc.CentreId
    LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
    WHERE ${CE}
      AND ${UE}
      AND ${SA}
      AND EXISTS (
        SELECT 1 FROM AdminUserCentre auc2
        JOIN Centre c2 ON c2.Id = auc2.CentreId
        WHERE auc2.AdminUserId = au.Id
          AND LOWER(c2.CentreName) NOT LIKE '%test%'
          AND LOWER(c2.CentreName) NOT LIKE '%delete%'
      )
    GROUP BY au.Id, au.FirstName, au.LastName, au.Email
    HAVING MAX(pal.CreatedDateTime) IS NULL
      OR DATEDIFF(day, MAX(pal.CreatedDateTime), SYSDATETIMEOFFSET()) > ${STALE_DAYS}
    ORDER BY
      CASE WHEN MAX(pal.CreatedDateTime) IS NULL THEN 0 ELSE 1 END,
      daysSinceActivity DESC,
      au.LastName,
      au.FirstName
  `);

  const rows = result.recordset.map((r) => ({
    id:               r.Id,
    name:             fmtName(r.FirstName, r.LastName),
    email:            r.Email,
    lastActivityDate: r.lastActivityDate ? new Date(r.lastActivityDate).toISOString().slice(0, 10) : 'never',
    daysSince:        r.lastActivityDate ? r.daysSinceActivity : 'N/A',
  }));

  return {
    count: rows.length,
    clinicians: rows,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// PART 2 — Completed Assessments (June 1 – July 16 2026)
// ──────────────────────────────────────────────────────────────────────────────

async function reportCompletedAssessments(pool) {
  const dateFrom = istMidnight(REPORT_FROM);
  const dateTo   = istMidnight(REPORT_TO);

  const CE = FILTERS.centreExclusion('c');
  const PE = FILTERS.patientExclusion('pt');
  const UE = FILTERS.userExclusion('au');          // NULL-safe for LEFT JOINs
  const SA = FILTERS.superAdminExclusion('ar');

  // The standard inclusive date filter the codebase uses everywhere:
  //   col >= @dateFrom AND col < DATEADD(day, 1, @dateTo)
  // CAST-to-DATE equivalent: CAST(col AS DATE) >= @dateFrom AND CAST(col AS DATE) <= @dateTo
  // We use the same >=/< pattern for consistency.
  const dateFilterPal    = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
  const dateFilterGoal   = buildDateFilter('pgarg.UpdatedDateTimeUtc', '@dateFrom', '@dateTo');

  // ── Path 1 & 3: AllocatePatient.Status = 'Completed' or 'Closed' ───────────
  // The "completing event" is a CaseStatusChanged audit event that set the
  // status to terminal. We join AllocatePatient to PatientAuditLog where
  // Type = 'CaseStatusChanged' and the assessment's Status is terminal.
  // For centres, we route through Patient → Centre.
  const statusCompletedQuery = `
    SELECT
      pt.CentreId,
      COUNT(DISTINCT ap.Id) AS completed
    FROM AllocatePatient ap
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre  c  ON c.Id  = pt.CentreId
    JOIN PatientAuditLog pal ON pal.AllocatePatientId = ap.Id
      AND pal.Type = 'CaseStatusChanged'
      AND ${dateFilterPal}
    LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
    WHERE ap.Status IN ('Completed', 'Closed')
      AND ${CE}
      AND ${PE}
      AND ${UE}
    GROUP BY pt.CentreId
  `;

  // ── Path 2: PatientGoalApprovalRequestGoal.Status = 'Approved' ─────────────
  // The "completing event" is the UpdatedDateTimeUtc when the goal was approved.
  const goalsCompletedQuery = `
    SELECT
      pt.CentreId,
      COUNT(DISTINCT ap.Id) AS completed
    FROM PatientGoalApprovalRequestGoal pgarg
    JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
    JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre  c  ON c.Id  = pt.CentreId
    LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
    WHERE pgarg.Status = 'Approved'
      AND ${dateFilterGoal}
      AND ${CE}
      AND ${PE}
      AND ${UE}
      -- Exclude assessments already counted in Path 1/3 to avoid double-counting
      AND ap.Status NOT IN ('Completed', 'Closed')
    GROUP BY pt.CentreId
  `;

  // ── UNION both paths, then join to Centre for name ──────────────────────────
  const result = await pool.request()
    .input('dateFrom', sql.DateTimeOffset, dateFrom)
    .input('dateTo',   sql.DateTimeOffset, dateTo)
    .query(`
      WITH completed_by_centre AS (
        ${statusCompletedQuery}
        UNION ALL
        ${goalsCompletedQuery}
      ),
      merged AS (
        SELECT CentreId, SUM(completed) AS completed
        FROM completed_by_centre
        GROUP BY CentreId
      )
      SELECT
        c.Id AS centreId,
        c.CentreName,
        ISNULL(m.completed, 0) AS completed
      FROM Centre c
      LEFT JOIN merged m ON m.CentreId = c.Id
      WHERE ${FILTERS.centreExclusion('c')}
        AND ISNULL(m.completed, 0) > 0
      ORDER BY completed DESC, c.CentreName
    `);

  const rows = result.recordset.map((r) => ({
    centreId:   r.centreId,
    centreName: abbreviateCentre(r.CentreName),
    completed:  r.completed,
  }));

  const total = rows.reduce((sum, r) => sum + r.completed, 0);

  return { total, byCentre: rows };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('[adhoc-team-report] Connecting...');
  const pool = await poolPromise;

  // ── PART 1 ──────────────────────────────────────────────────────────────────
  console.log('\n========================================');
  console.log('PART 1 — INACTIVE CLINICIANS');
  console.log('  (zero PAL rows ever, or last activity > 30 days ago)');
  console.log('========================================\n');

  const inactive = await reportInactiveClinicians(pool);
  console.log(`Count: ${inactive.count}\n`);
  if (inactive.count > 0) {
    console.table(inactive.clinicians);
  } else {
    console.log('(none — all clinicians are active)\n');
  }

  // ── PART 2 ──────────────────────────────────────────────────────────────────
  console.log('\n========================================');
  console.log(`PART 2 — COMPLETED ASSESSMENTS (${REPORT_FROM} to ${REPORT_TO})`);
  console.log('  (Status IN Completed/Closed OR goals approved)');
  console.log('========================================\n');

  const completed = await reportCompletedAssessments(pool);
  console.log(`Total: ${completed.total}\n`);
  console.log('Centre-wise breakdown:\n');
  console.table(completed.byCentre);

  // ── JSON payload (paste-friendly) ───────────────────────────────────────────
  console.log('\n========================================');
  console.log('JSON PAYLOAD (copy-paste ready)');
  console.log('========================================\n');

  const payload = {
    generatedAt: new Date().toISOString(),
    part1_inactiveClinicians: {
      count: inactive.count,
      clinicians: inactive.clinicians,
    },
    part2_completedAssessments: {
      period: { from: REPORT_FROM, to: REPORT_TO },
      total: completed.total,
      byCentre: completed.byCentre,
    },
  };

  console.log(JSON.stringify(payload, null, 2));

  console.log('\n[adhoc-team-report] Done.');
  await pool.close();
}

run().catch((err) => {
  console.error('[adhoc-team-report] ERROR:', err);
  process.exit(1);
});
