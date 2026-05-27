'use strict';

const { Router } = require('express');
const { poolPromise } = require('../db');
const { buildCentreExclusion, buildPatientExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');
const { FILTERS } = require('../utils/metrics');
const { makeCache } = require('../lib/routeCache');
const { TERMINAL_STATUSES } = require('../utils/assessmentState');

// SQL fragment: exclude terminal (Completed) AllocatePatient rows from all
// issue groups. Assessments with Status IN TERMINAL_STATUSES are done and
// must never appear in any issue count regardless of audit-log state.
// This covers Path 1 (direct) and Path 3 (manual close) completion.
const AP_NOT_TERMINAL = `ap.Status NOT IN (${TERMINAL_STATUSES.map((s) => `'${s}'`).join(', ')})`;

const router = Router();

// Issues are point-in-time (no date filter). Cache for 2 minutes so
// rapid tab switches or multiple open browser tabs hit memory, not DB.
const issuesCache = makeCache(2 * 60 * 1000);

const ASSESSMENT_TYPES = ['SPM', 'DP3', 'REELS', 'ISAA'];
const RESPONSIBLE_ROLE = {
  SPM:   'Clinician',
  DP3:   'Clinician',
  REELS: 'Clinician + Manager',
  ISAA:  'Clinician + Manager',
};

// Single source of truth — call shared FILTERS helpers so every route
// uses identical exclusion criteria (including @mailinator.com).
const CENTRE_EXCL_C   = FILTERS.centreExclusion('c');
const PATIENT_EXCL_PT = FILTERS.patientExclusion('pt');
const USER_EXCL_AU    = FILTERS.userExclusionStrict('au');

// Centre manager lookup CTE — reused across multiple queries.
// Returns the first non-clinician, non-super-admin, non-ops user per centre.
const CENTRE_MANAGER_CTE = `
  centre_manager AS (
    SELECT
      c.Id AS centreId,
      MIN(au.Id)                              AS managerId,
      MIN(au.FirstName + ' ' + au.LastName)   AS managerName,
      MIN(au.Email)                           AS managerEmail
    FROM Centre c
    JOIN AdminUserCentre auc ON auc.CentreId = c.Id
    JOIN AdminUser au        ON au.Id = auc.AdminUserId
    JOIN AdminUserRole aur   ON aur.UserId = au.Id
    JOIN AdminRole ar        ON ar.Id = aur.RoleId
      AND ar.Name NOT IN ('Clinician', 'Super Admin', 'SuperAdmin')
    WHERE LOWER(au.FirstName) NOT LIKE '%test%'
      AND LOWER(au.LastName)  NOT LIKE '%test%'
      AND LOWER(au.Email)     NOT LIKE '%@webority.com'
      AND au.FirstName NOT LIKE '%(Ops)%'
    GROUP BY c.Id
  )
`;

/**
 * GET /api/issues
 *
 * State classification uses PatientAuditLog event sequences as the source of truth.
 * AllocatePatient.Status and IsResultGenerate are NOT trusted — they can be stale.
 *
 * In Unity: "In Progress" = at least one question answered.
 * It does NOT mean scoring is incomplete — report may be approved and only goals missing.
 *
 * Five assessment pipeline states tracked:
 *  1. overdue assessments   — AssessmentResultGenerated NOT in audit log (scoring incomplete)
 *  2. reports not drafted   — AssessmentResultGenerated fired but no ReportAdded
 *  3. reports pending approval — ReportAdded exists but no ReportPDFGenerated
 *  4. goals not added       — ReportPDFGenerated exists but no PatientGoalApprovalRequest
 *  5. goals pending approval — PatientGoalApprovalRequest exists but not approved
 */
router.get('/', async (req, res, next) => {
  try {
    const cacheKey = issuesCache.key(req);
    const hit = issuesCache.get(cacheKey);
    if (hit) return res.json(hit);

    const pool = await poolPromise;

    const [
      // ── Assessment pipeline: 5 states × 2 thresholds ─────────────────────
      overdueAssessmentsResult,       // critical: no result generated > 21d
      nudgeAssessmentsResult,         // warning:  no result generated 14-21d
      earlyOverdueResult,             // watching: no result generated 7-14d
      reportsNotDraftedCritResult,    // critical: result generated, no report > 14d
      reportsNotDraftedWarnResult,    // warning:  result generated, no report 7-14d
      reportsPendingApprovalCritResult,  // critical: report added, no PDF > 7d
      reportsPendingApprovalWarnResult,  // warning:  report added, no PDF 3-7d
      goalsNotAddedCritResult,        // critical: PDF generated, no goals > 14d
      goalsNotAddedWarnResult,        // warning:  PDF generated, no goals 7-14d
      goalsPendingApprovalCritResult, // critical: goals submitted, not approved > 7d
      goalsPendingApprovalWarnResult, // warning:  goals submitted, not approved 3-7d
      // ── Non-assessment issues (unchanged) ────────────────────────────────
      stuckOnboardingResult,
      darkCentresResult,
      lowCompClinicianResult,
      lowCompCentreResult,
      turnaroundResult,
      byTypeResult,
    ] = await Promise.all([

      // ── Critical: Overdue assessments > 21 days (audit-log based) ─────────
      // Uses AssessmentResultGenerated absence, NOT IsResultGenerate flag.
      // This correctly excludes cases where scoring is done but Unity shows
      // "In Progress" (e.g. Leo Arya DP3 — scoring complete, only goals missing).
      pool.request().query(`
        SELECT TOP 500
          ap.Id             AS allocatePatientId,
          ap.PatientId      AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment     AS assessmentType,
          au.Id             AS clinicianId,
          ISNULL(au.FirstName + ' ' + au.LastName, 'Unassigned') AS clinicianName,
          ISNULL(au.Email, '') AS clinicianEmail,
          c.CentreName      AS centreName,
          ap.CreatedDateTimeUtc AS assignedDate,
          DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS daysAssigned
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${AP_NOT_TERMINAL}
          AND NOT EXISTS (
            SELECT 1 FROM PatientAuditLog pal2
            WHERE pal2.AllocatePatientId = ap.Id
              AND pal2.Type = 'AssessmentResultGenerated'
          )
          AND DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 21
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysAssigned DESC
      `),

      // ── Warning: Overdue assessments 14-21 days ────────────────────────────
      pool.request().query(`
        SELECT TOP 500
          ap.Id             AS allocatePatientId,
          ap.PatientId      AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment     AS assessmentType,
          au.Id             AS clinicianId,
          ISNULL(au.FirstName + ' ' + au.LastName, 'Unassigned') AS clinicianName,
          ISNULL(au.Email, '') AS clinicianEmail,
          c.CentreName      AS centreName,
          ap.CreatedDateTimeUtc AS assignedDate,
          DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS daysAssigned
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${AP_NOT_TERMINAL}
          AND NOT EXISTS (
            SELECT 1 FROM PatientAuditLog pal2
            WHERE pal2.AllocatePatientId = ap.Id
              AND pal2.Type = 'AssessmentResultGenerated'
          )
          AND DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) BETWEEN 14 AND 21
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysAssigned DESC
      `),

      // ── Watching: Early overdue 7-14 days ──────────────────────────────────
      pool.request().query(`
        SELECT TOP 500
          ap.Id             AS allocatePatientId,
          ap.PatientId      AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment     AS assessmentType,
          au.Id             AS clinicianId,
          ISNULL(au.FirstName + ' ' + au.LastName, 'Unassigned') AS clinicianName,
          c.CentreName      AS centreName,
          DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS daysAssigned
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${AP_NOT_TERMINAL}
          AND NOT EXISTS (
            SELECT 1 FROM PatientAuditLog pal2
            WHERE pal2.AllocatePatientId = ap.Id
              AND pal2.Type = 'AssessmentResultGenerated'
          )
          AND DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) BETWEEN 7 AND 13
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysAssigned DESC
      `),

      // ── Critical: Reports not drafted > 14 days since scoring ──────────────
      // Scoring complete (AssessmentResultGenerated fired) but clinician has
      // not yet started the report (no ReportAdded event).
      pool.request().query(`
        WITH result_gen AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS resultGeneratedAt
          FROM PatientAuditLog
          WHERE Type = 'AssessmentResultGenerated' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        )
        SELECT TOP 300
          ap.Id             AS allocatePatientId,
          ap.PatientId      AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment     AS assessmentType,
          au.Id             AS clinicianId,
          ISNULL(au.FirstName + ' ' + au.LastName, 'Unassigned') AS clinicianName,
          ISNULL(au.Email, '') AS clinicianEmail,
          c.CentreName      AS centreName,
          DATEDIFF(day, rg.resultGeneratedAt, SYSDATETIMEOFFSET()) AS daysInCurrentState,
          DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS daysAssigned,
          rg.resultGeneratedAt AS resultGeneratedDate,
          ap.CreatedDateTimeUtc AS assignedDate
        FROM result_gen rg
        JOIN AllocatePatient ap ON ap.Id = rg.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre c           ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au  ON au.Id = ap.ClinicianUserId
        WHERE NOT EXISTS (
          SELECT 1 FROM PatientAuditLog pal2
          WHERE pal2.AllocatePatientId = ap.Id AND pal2.Type = 'ReportAdded'
        )
          AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${AP_NOT_TERMINAL}
          AND DATEDIFF(day, rg.resultGeneratedAt, SYSDATETIMEOFFSET()) > 14
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysInCurrentState DESC
      `),

      // ── Warning: Reports not drafted 7-14 days since scoring ───────────────
      pool.request().query(`
        WITH result_gen AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS resultGeneratedAt
          FROM PatientAuditLog
          WHERE Type = 'AssessmentResultGenerated' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        )
        SELECT TOP 300
          ap.Id             AS allocatePatientId,
          ap.PatientId      AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment     AS assessmentType,
          au.Id             AS clinicianId,
          ISNULL(au.FirstName + ' ' + au.LastName, 'Unassigned') AS clinicianName,
          ISNULL(au.Email, '') AS clinicianEmail,
          c.CentreName      AS centreName,
          DATEDIFF(day, rg.resultGeneratedAt, SYSDATETIMEOFFSET()) AS daysInCurrentState,
          DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS daysAssigned,
          rg.resultGeneratedAt AS resultGeneratedDate,
          ap.CreatedDateTimeUtc AS assignedDate
        FROM result_gen rg
        JOIN AllocatePatient ap ON ap.Id = rg.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre c           ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au  ON au.Id = ap.ClinicianUserId
        WHERE NOT EXISTS (
          SELECT 1 FROM PatientAuditLog pal2
          WHERE pal2.AllocatePatientId = ap.Id AND pal2.Type = 'ReportAdded'
        )
          AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${AP_NOT_TERMINAL}
          AND DATEDIFF(day, rg.resultGeneratedAt, SYSDATETIMEOFFSET()) BETWEEN 7 AND 14
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysInCurrentState DESC
      `),

      // ── Critical: Reports pending approval > 7 days ────────────────────────
      pool.request().query(`
        WITH drafted AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS draftedAt
          FROM PatientAuditLog
          WHERE Type = 'ReportAdded' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        ),
        approved AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientAuditLog
          WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
        ),
        ${CENTRE_MANAGER_CTE}
        SELECT TOP 200
          ap.PatientId AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment AS assessmentType,
          cl.Id         AS clinicianId,
          ISNULL(cl.FirstName + ' ' + cl.LastName, 'Unassigned') AS clinicianName,
          ISNULL(cl.Email, '') AS clinicianEmail,
          cm.managerId  AS managerId,
          ISNULL(cm.managerName, 'Unknown')  AS managerName,
          ISNULL(cm.managerEmail, '')        AS managerEmail,
          c.CentreName  AS centreName,
          DATEDIFF(day, d.draftedAt, SYSDATETIMEOFFSET()) AS daysInCurrentState,
          d.draftedAt   AS draftedDate
        FROM drafted d
        JOIN AllocatePatient ap ON ap.Id = d.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre c           ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser cl  ON cl.Id = ap.ClinicianUserId
        LEFT JOIN centre_manager cm ON cm.centreId = c.Id
        LEFT JOIN approved a    ON a.AllocatePatientId = d.AllocatePatientId
        WHERE a.AllocatePatientId IS NULL
          AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${AP_NOT_TERMINAL}
          AND DATEDIFF(day, d.draftedAt, SYSDATETIMEOFFSET()) > 7
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysInCurrentState DESC
      `),

      // ── Warning: Reports pending approval 3-7 days ─────────────────────────
      pool.request().query(`
        WITH drafted AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS draftedAt
          FROM PatientAuditLog
          WHERE Type = 'ReportAdded' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        ),
        approved AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientAuditLog
          WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
        ),
        ${CENTRE_MANAGER_CTE}
        SELECT TOP 200
          ap.PatientId AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment AS assessmentType,
          cl.Id         AS clinicianId,
          ISNULL(cl.FirstName + ' ' + cl.LastName, 'Unassigned') AS clinicianName,
          ISNULL(cl.Email, '') AS clinicianEmail,
          cm.managerId  AS managerId,
          ISNULL(cm.managerName, 'Unknown')  AS managerName,
          ISNULL(cm.managerEmail, '')        AS managerEmail,
          c.CentreName  AS centreName,
          DATEDIFF(day, d.draftedAt, SYSDATETIMEOFFSET()) AS daysInCurrentState,
          d.draftedAt   AS draftedDate
        FROM drafted d
        JOIN AllocatePatient ap ON ap.Id = d.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre c           ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser cl  ON cl.Id = ap.ClinicianUserId
        LEFT JOIN centre_manager cm ON cm.centreId = c.Id
        LEFT JOIN approved a    ON a.AllocatePatientId = d.AllocatePatientId
        WHERE a.AllocatePatientId IS NULL
          AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${AP_NOT_TERMINAL}
          AND DATEDIFF(day, d.draftedAt, SYSDATETIMEOFFSET()) BETWEEN 3 AND 7
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysInCurrentState DESC
      `),

      // ── Critical: Goals not added > 14 days since report approved ──────────
      // Report is approved (ReportPDFGenerated fired) but no PatientGoalApprovalRequest
      // exists AND no approved goals exist via date-proximity for this assessment.
      //
      // Goals are checked per-assessment not per-patient because a patient can
      // have multiple assessment types (SPM, DP3, REELS, ISAA) each with their own
      // goals. A goal approval for DP3 does not satisfy SPM goals — UNLESS the goal
      // request was created after this specific assessment's ReportPDFGenerated event
      // (date proximity), meaning the goals were submitted for this assessment cycle.
      pool.request().query(`
        WITH pdf_gen AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS pdfGeneratedAt
          FROM PatientAuditLog
          WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        )
        SELECT TOP 300
          ap.Id             AS allocatePatientId,
          ap.PatientId      AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment     AS assessmentType,
          au.Id             AS clinicianId,
          ISNULL(au.FirstName + ' ' + au.LastName, 'Unassigned') AS clinicianName,
          ISNULL(au.Email, '') AS clinicianEmail,
          c.CentreName      AS centreName,
          DATEDIFF(day, pg.pdfGeneratedAt, SYSDATETIMEOFFSET()) AS daysInCurrentState,
          DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS daysAssigned,
          pg.pdfGeneratedAt AS pdfGeneratedDate,
          ap.CreatedDateTimeUtc AS assignedDate
        FROM pdf_gen pg
        JOIN AllocatePatient ap ON ap.Id = pg.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre c           ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au  ON au.Id = ap.ClinicianUserId
        WHERE NOT EXISTS (
          -- Direct link: a goal request exists for this exact AllocatePatient row
          SELECT 1 FROM PatientGoalApprovalRequest pgar
          WHERE pgar.AllocatePatientId = ap.Id
        )
          -- Date-proximity: exclude if approved goals were submitted for this patient
          -- AFTER this assessment's report was approved (covers multi-assessment patients
          -- where goals are stored against a different AllocatePatient row, e.g. DP3
          -- goals mistakenly satisfying an SPM row — they must be after the SPM PDF date)
          AND NOT EXISTS (
            SELECT 1
            FROM PatientGoalApprovalRequest pgar2
            JOIN PatientGoalApprovalRequestGoal pgarg2
              ON pgarg2.PatientGoalApprovalRequestId = pgar2.Id
            JOIN AllocatePatient ap2 ON ap2.Id = pgar2.AllocatePatientId
            WHERE ap2.PatientId = ap.PatientId
              AND pgarg2.Status = 'Approved'
              AND pgar2.CreatedDateTimeUtc >= pg.pdfGeneratedAt
          )
          AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${AP_NOT_TERMINAL}
          AND DATEDIFF(day, pg.pdfGeneratedAt, SYSDATETIMEOFFSET()) > 14
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysInCurrentState DESC
      `),

      // ── Warning: Goals not added 7-14 days since report approved ───────────
      pool.request().query(`
        WITH pdf_gen AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS pdfGeneratedAt
          FROM PatientAuditLog
          WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        )
        SELECT TOP 300
          ap.Id             AS allocatePatientId,
          ap.PatientId      AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment     AS assessmentType,
          au.Id             AS clinicianId,
          ISNULL(au.FirstName + ' ' + au.LastName, 'Unassigned') AS clinicianName,
          ISNULL(au.Email, '') AS clinicianEmail,
          c.CentreName      AS centreName,
          DATEDIFF(day, pg.pdfGeneratedAt, SYSDATETIMEOFFSET()) AS daysInCurrentState,
          DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS daysAssigned,
          pg.pdfGeneratedAt AS pdfGeneratedDate,
          ap.CreatedDateTimeUtc AS assignedDate
        FROM pdf_gen pg
        JOIN AllocatePatient ap ON ap.Id = pg.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre c           ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au  ON au.Id = ap.ClinicianUserId
        WHERE NOT EXISTS (
          SELECT 1 FROM PatientGoalApprovalRequest pgar
          WHERE pgar.AllocatePatientId = ap.Id
        )
          AND NOT EXISTS (
            SELECT 1
            FROM PatientGoalApprovalRequest pgar2
            JOIN PatientGoalApprovalRequestGoal pgarg2
              ON pgarg2.PatientGoalApprovalRequestId = pgar2.Id
            JOIN AllocatePatient ap2 ON ap2.Id = pgar2.AllocatePatientId
            WHERE ap2.PatientId = ap.PatientId
              AND pgarg2.Status = 'Approved'
              AND pgar2.CreatedDateTimeUtc >= pg.pdfGeneratedAt
          )
          AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${AP_NOT_TERMINAL}
          AND DATEDIFF(day, pg.pdfGeneratedAt, SYSDATETIMEOFFSET()) BETWEEN 7 AND 14
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysInCurrentState DESC
      `),

      // ── Critical: Goals pending approval > 7 days ──────────────────────────
      pool.request().query(`
        WITH ${CENTRE_MANAGER_CTE}
        SELECT TOP 200
          ap.PatientId AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment AS assessmentType,
          cl.Id         AS clinicianId,
          ISNULL(cl.FirstName + ' ' + cl.LastName, 'Unassigned') AS clinicianName,
          ISNULL(cl.Email, '') AS clinicianEmail,
          cm.managerId  AS managerId,
          ISNULL(cm.managerName, 'Unknown')  AS managerName,
          ISNULL(cm.managerEmail, '')        AS managerEmail,
          c.CentreName  AS centreName,
          DATEDIFF(day, pgar.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS daysInCurrentState,
          pgar.CreatedDateTimeUtc AS submittedDate
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre c           ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser cl  ON cl.Id = ap.ClinicianUserId
        LEFT JOIN centre_manager cm ON cm.centreId = c.Id
        WHERE pgarg.Status NOT IN ('Approved', 'Rejected')
          AND ${AP_NOT_TERMINAL}
          AND DATEDIFF(day, pgar.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 7
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysInCurrentState DESC
      `),

      // ── Warning: Goals pending approval 3-7 days ───────────────────────────
      pool.request().query(`
        WITH ${CENTRE_MANAGER_CTE}
        SELECT TOP 200
          ap.PatientId AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment AS assessmentType,
          cl.Id         AS clinicianId,
          ISNULL(cl.FirstName + ' ' + cl.LastName, 'Unassigned') AS clinicianName,
          ISNULL(cl.Email, '') AS clinicianEmail,
          cm.managerId  AS managerId,
          ISNULL(cm.managerName, 'Unknown')  AS managerName,
          ISNULL(cm.managerEmail, '')        AS managerEmail,
          c.CentreName  AS centreName,
          DATEDIFF(day, pgar.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS daysInCurrentState,
          pgar.CreatedDateTimeUtc AS submittedDate
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre c           ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser cl  ON cl.Id = ap.ClinicianUserId
        LEFT JOIN centre_manager cm ON cm.centreId = c.Id
        WHERE pgarg.Status NOT IN ('Approved', 'Rejected')
          AND ${AP_NOT_TERMINAL}
          AND DATEDIFF(day, pgar.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) BETWEEN 3 AND 7
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY daysInCurrentState DESC
      `),

      // ── Critical: Stuck onboarding > 48h unassigned ────────────────────────
      pool.request().query(`
        WITH reg AS (
          SELECT
            pal.PatientId,
            MIN(pal.CreatedDateTime)   AS registeredAt,
            MAX(pal.AdminUserId)        AS registeredByUserId
          FROM PatientAuditLog pal
          JOIN Patient pt ON pt.Id = pal.PatientId
          JOIN Centre c   ON c.Id  = pt.CentreId
          WHERE pal.Type = 'CaseRegistered'
            AND ${CENTRE_EXCL_C}
            AND ${PATIENT_EXCL_PT}
          GROUP BY pal.PatientId
        )
        SELECT TOP 200
          reg.PatientId AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          c.CentreName  AS centreName,
          reg.registeredAt AS registeredDate,
          DATEDIFF(hour, reg.registeredAt, SYSDATETIMEOFFSET()) AS hoursUnassigned,
          ISNULL(au.FirstName + ' ' + au.LastName, 'Unknown') AS registeredBy
        FROM reg
        JOIN Patient pt ON pt.Id = reg.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = reg.registeredByUserId
        WHERE reg.registeredAt < DATEADD(hour, -48, SYSDATETIMEOFFSET())
          AND NOT EXISTS (
            SELECT 1 FROM PatientAuditLog p2
            WHERE p2.PatientId = reg.PatientId AND p2.Type = 'CaseAssigned'
          )
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        ORDER BY reg.registeredAt ASC
      `),

      // ── Critical: Dark centres > 7 days no activity ────────────────────────
      pool.request().query(`
        WITH last_activity AS (
          SELECT
            c.Id AS centreId,
            c.CentreName,
            MAX(pal.CreatedDateTime) AS lastActivityDate
          FROM Centre c
          LEFT JOIN Patient pt   ON pt.CentreId = c.Id
          LEFT JOIN PatientAuditLog pal ON pal.PatientId = pt.Id
          WHERE LOWER(c.CentreName) NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%delete%'
          GROUP BY c.Id, c.CentreName
        ),
        staff_count AS (
          SELECT
            c.Id AS centreId,
            COUNT(DISTINCT au.Id) AS staffCount
          FROM Centre c
          LEFT JOIN AdminUserCentre auc ON auc.CentreId = c.Id
          LEFT JOIN AdminUser au ON au.Id = auc.AdminUserId
            AND LOWER(au.FirstName) NOT LIKE '%test%'
            AND LOWER(au.LastName)  NOT LIKE '%test%'
            AND LOWER(au.Email)     NOT LIKE '%@webority.com'
          WHERE LOWER(c.CentreName) NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%delete%'
          GROUP BY c.Id
        ),
        active_caseload AS (
          SELECT
            c.Id AS centreId,
            COUNT(ap.Id) AS activeCaseload
          FROM Centre c
          LEFT JOIN Patient pt ON pt.CentreId = c.Id
          LEFT JOIN AllocatePatient ap ON ap.PatientId = pt.Id
            AND ap.IsResultGenerate = 0
          WHERE LOWER(c.CentreName) NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%delete%'
          GROUP BY c.Id
        )
        SELECT
          la.CentreName                                            AS centreName,
          la.lastActivityDate,
          DATEDIFF(day, la.lastActivityDate, SYSDATETIMEOFFSET()) AS daysInactive,
          ISNULL(sc.staffCount, 0)                                AS staffCount,
          ISNULL(ac.activeCaseload, 0)                            AS activeCaseload
        FROM last_activity la
        LEFT JOIN staff_count sc    ON sc.centreId   = la.centreId
        LEFT JOIN active_caseload ac ON ac.centreId  = la.centreId
        WHERE (
          la.lastActivityDate IS NULL
          OR la.lastActivityDate < DATEADD(day, -7, SYSDATETIMEOFFSET())
        )
        ORDER BY la.lastActivityDate ASC
      `),

      // ── Watching: Low completion clinicians < 30% (min 3 assigned) ─────────
      // Use a pre-join CTE for scored assessments — SQL Server forbids subqueries
      // inside aggregate functions (SUM/AVG/HAVING), so we cannot use EXISTS there.
      pool.request().query(`
        WITH scored AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientAuditLog
          WHERE Type = 'AssessmentResultGenerated' AND AllocatePatientId IS NOT NULL
        )
        SELECT
          au.Id   AS clinicianId,
          au.FirstName + ' ' + au.LastName AS clinicianName,
          au.Email AS clinicianEmail,
          c.CentreName AS centreName,
          ap.Assessment AS assessmentType,
          COUNT(*)  AS assigned,
          SUM(CASE WHEN sc.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS completed
        FROM AllocatePatient ap
        JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        JOIN Patient pt   ON pt.Id = ap.PatientId
        JOIN Centre c     ON c.Id  = pt.CentreId
        LEFT JOIN scored sc ON sc.AllocatePatientId = ap.Id
        WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${USER_EXCL_AU}
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        GROUP BY au.Id, au.FirstName, au.LastName, au.Email, c.CentreName, ap.Assessment
        HAVING COUNT(*) >= 3
          AND CAST(SUM(CASE WHEN sc.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) < 0.30
        ORDER BY
          CAST(SUM(CASE WHEN sc.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) ASC
      `),

      // ── Watching: Low completion centres < 30% (min 5 assigned) ───────────
      pool.request().query(`
        WITH scored AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientAuditLog
          WHERE Type = 'AssessmentResultGenerated' AND AllocatePatientId IS NOT NULL
        )
        SELECT
          c.CentreName AS centreName,
          COUNT(*)  AS assigned,
          SUM(CASE WHEN sc.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS completed
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        LEFT JOIN scored sc ON sc.AllocatePatientId = ap.Id
        WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        GROUP BY c.Id, c.CentreName
        HAVING COUNT(*) >= 5
          AND CAST(SUM(CASE WHEN sc.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) < 0.30
        ORDER BY
          CAST(SUM(CASE WHEN sc.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) ASC
      `),

      // ── Turnaround trend — last 12 weeks ───────────────────────────────────
      pool.request().query(`
        WITH onboarding_pairs AS (
          SELECT
            r.PatientId,
            r.registeredAt,
            CAST(DATEDIFF(minute, r.registeredAt, a.assignedAt) AS FLOAT) / 60.0 AS hours
          FROM (
            SELECT PatientId, MIN(CreatedDateTime) AS registeredAt
            FROM PatientAuditLog WHERE Type = 'CaseRegistered'
            GROUP BY PatientId
          ) r
          JOIN (
            SELECT PatientId, MIN(CreatedDateTime) AS assignedAt
            FROM PatientAuditLog WHERE Type = 'CaseAssigned'
            GROUP BY PatientId
          ) a ON a.PatientId = r.PatientId
          WHERE a.assignedAt > r.registeredAt
        ),
        onboarding_weeks AS (
          SELECT
            DATEPART(year, registeredAt) AS yr,
            DATEPART(week, registeredAt) AS wk,
            MIN(CAST(registeredAt AS date)) AS weekStart,
            AVG(hours) AS avgOnboardingHours
          FROM onboarding_pairs
          GROUP BY DATEPART(year, registeredAt), DATEPART(week, registeredAt)
        ),
        report_pairs AS (
          SELECT
            d.AllocatePatientId,
            d.draftedAt,
            CAST(DATEDIFF(hour, d.draftedAt, a.approvedAt) AS FLOAT) / 24.0 AS approvalDays
          FROM (
            SELECT AllocatePatientId, MIN(CreatedDateTime) AS draftedAt
            FROM PatientAuditLog WHERE Type = 'ReportAdded' AND AllocatePatientId IS NOT NULL
            GROUP BY AllocatePatientId
          ) d
          JOIN (
            SELECT AllocatePatientId, MIN(CreatedDateTime) AS approvedAt
            FROM PatientAuditLog WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
            GROUP BY AllocatePatientId
          ) a ON a.AllocatePatientId = d.AllocatePatientId
          WHERE a.approvedAt > d.draftedAt
        ),
        report_weeks AS (
          SELECT
            DATEPART(year, draftedAt) AS yr,
            DATEPART(week, draftedAt) AS wk,
            MIN(CAST(draftedAt AS date)) AS weekStart,
            AVG(approvalDays) AS avgReportApprovalDays
          FROM report_pairs
          GROUP BY DATEPART(year, draftedAt), DATEPART(week, draftedAt)
        ),
        goal_weeks AS (
          SELECT
            DATEPART(year, pgarg.UpdatedDateTimeUtc) AS yr,
            DATEPART(week, pgarg.UpdatedDateTimeUtc) AS wk,
            MIN(CAST(pgarg.UpdatedDateTimeUtc AS date)) AS weekStart,
            AVG(
              CAST(DATEDIFF(hour, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) AS FLOAT) / 24.0
            ) AS avgGoalApprovalDays
          FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          WHERE pgarg.Status = 'Approved'
            AND pgarg.UpdatedDateTimeUtc > pgar.CreatedDateTimeUtc
          GROUP BY DATEPART(year, pgarg.UpdatedDateTimeUtc), DATEPART(week, pgarg.UpdatedDateTimeUtc)
        ),
        all_weeks AS (
          SELECT yr, wk, weekStart FROM onboarding_weeks
          UNION SELECT yr, wk, weekStart FROM report_weeks
          UNION SELECT yr, wk, weekStart FROM goal_weeks
        )
        SELECT TOP 12
          aw.weekStart,
          ow.avgOnboardingHours,
          rw.avgReportApprovalDays,
          gw.avgGoalApprovalDays
        FROM (
          SELECT yr, wk, MIN(weekStart) AS weekStart
          FROM all_weeks GROUP BY yr, wk
        ) aw
        LEFT JOIN onboarding_weeks ow ON ow.yr = aw.yr AND ow.wk = aw.wk
        LEFT JOIN report_weeks rw    ON rw.yr  = aw.yr AND rw.wk  = aw.wk
        LEFT JOIN goal_weeks gw      ON gw.yr  = aw.yr AND gw.wk  = aw.wk
        ORDER BY aw.weekStart DESC
      `),

      // ── By type summary ────────────────────────────────────────────────────
      // Pre-join scored CTE to avoid subqueries inside aggregate functions.
      pool.request().query(`
        WITH scored AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientAuditLog
          WHERE Type = 'AssessmentResultGenerated' AND AllocatePatientId IS NOT NULL
        )
        SELECT
          ap.Assessment AS type,
          COUNT(*)      AS total,
          SUM(CASE WHEN sc.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN sc.AllocatePatientId IS NULL     THEN 1 ELSE 0 END) AS pending,
          AVG(
            CASE WHEN sc.AllocatePatientId IS NOT NULL
                  AND ap.UpdatedDateTimeUtc > ap.CreatedDateTimeUtc
            THEN CAST(DATEDIFF(day, ap.CreatedDateTimeUtc, ap.UpdatedDateTimeUtc) AS FLOAT)
            ELSE NULL END
          ) AS avgDays
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        LEFT JOIN scored sc ON sc.AllocatePatientId = ap.Id
        WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${CENTRE_EXCL_C}
          AND ${PATIENT_EXCL_PT}
        GROUP BY ap.Assessment
      `),
    ]);

    // ── Shape helpers ──────────────────────────────────────────────────────────

    function fmtDate(v) {
      if (!v) return null;
      if (typeof v === 'string') return v.slice(0, 10);
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }

    function shapeOverdueRow(r) {
      return {
        allocatePatientId: r.allocatePatientId,
        patientName:    (r.patientName ?? '').trim() || 'Unknown',
        patientId:      r.patientId,
        assessmentType: r.assessmentType,
        clinicianId:    r.clinicianId ?? null,
        clinicianName:  r.clinicianName,
        clinicianEmail: r.clinicianEmail || '',
        centreName:     abbreviateCentre(r.centreName),
        daysAssigned:   r.daysAssigned ?? 0,
        // Keep daysPending as alias for backward compatibility
        daysPending:    r.daysAssigned ?? 0,
        assignedDate:   fmtDate(r.assignedDate),
      };
    }

    function shapeStateRow(r, dateField, dateKey) {
      return {
        allocatePatientId:    r.allocatePatientId,
        patientName:          (r.patientName ?? '').trim() || 'Unknown',
        patientId:            r.patientId,
        assessmentType:       r.assessmentType,
        clinicianId:          r.clinicianId ?? null,
        clinicianName:        r.clinicianName,
        clinicianEmail:       r.clinicianEmail || '',
        centreName:           abbreviateCentre(r.centreName),
        daysInCurrentState:   r.daysInCurrentState ?? 0,
        daysAssigned:         r.daysAssigned ?? 0,
        [dateKey]:            fmtDate(r[dateField]),
        assignedDate:         fmtDate(r.assignedDate),
      };
    }

    function shapeApprovalRow(r, dateField, dateKey) {
      return {
        patientName:    (r.patientName ?? '').trim() || 'Unknown',
        patientId:      r.patientId,
        assessmentType: r.assessmentType,
        clinicianId:    r.clinicianId ?? null,
        clinicianName:  r.clinicianName,
        clinicianEmail: r.clinicianEmail || '',
        managerId:      r.managerId ?? null,
        managerName:    r.managerName,
        managerEmail:   r.managerEmail || '',
        centreName:     abbreviateCentre(r.centreName),
        daysInCurrentState: r.daysInCurrentState ?? 0,
        // Keep daysPending as alias for backward compatibility
        daysPending:    r.daysInCurrentState ?? 0,
        [dateKey]:      fmtDate(r[dateField]),
      };
    }

    const overdueAssessmentsCrit = overdueAssessmentsResult.recordset.map(shapeOverdueRow);
    const overdueAssessmentsWarn = nudgeAssessmentsResult.recordset.map(shapeOverdueRow);

    const earlyOverdue = earlyOverdueResult.recordset.map((r) => ({
      patientName:    (r.patientName ?? '').trim() || 'Unknown',
      patientId:      r.patientId,
      assessmentType: r.assessmentType,
      clinicianId:    r.clinicianId ?? null,
      clinicianName:  r.clinicianName,
      centreName:     abbreviateCentre(r.centreName),
      daysPending:    r.daysAssigned ?? 0,
    }));

    const reportsNotDraftedCrit = reportsNotDraftedCritResult.recordset.map(
      (r) => shapeStateRow(r, 'resultGeneratedDate', 'resultGeneratedDate')
    );
    const reportsNotDraftedWarn = reportsNotDraftedWarnResult.recordset.map(
      (r) => shapeStateRow(r, 'resultGeneratedDate', 'resultGeneratedDate')
    );

    const reportsPendingApprovalCrit = reportsPendingApprovalCritResult.recordset.map(
      (r) => shapeApprovalRow(r, 'draftedDate', 'draftedDate')
    );
    const reportsPendingApprovalWarn = reportsPendingApprovalWarnResult.recordset.map(
      (r) => shapeApprovalRow(r, 'draftedDate', 'draftedDate')
    );

    const goalsNotAddedCrit = goalsNotAddedCritResult.recordset.map(
      (r) => shapeStateRow(r, 'pdfGeneratedDate', 'pdfGeneratedDate')
    );
    const goalsNotAddedWarn = goalsNotAddedWarnResult.recordset.map(
      (r) => shapeStateRow(r, 'pdfGeneratedDate', 'pdfGeneratedDate')
    );

    const goalsPendingApprovalCrit = goalsPendingApprovalCritResult.recordset.map(
      (r) => shapeApprovalRow(r, 'submittedDate', 'submittedDate')
    );
    const goalsPendingApprovalWarn = goalsPendingApprovalWarnResult.recordset.map(
      (r) => shapeApprovalRow(r, 'submittedDate', 'submittedDate')
    );

    const stuckOnboarding = stuckOnboardingResult.recordset.map((r) => ({
      patientName:     (r.patientName ?? '').trim() || 'Unknown',
      patientId:       r.patientId,
      centreName:      abbreviateCentre(r.centreName),
      registeredDate:  r.registeredDate,
      hoursUnassigned: r.hoursUnassigned ?? 0,
      registeredBy:    r.registeredBy || 'Unknown',
    }));

    const darkCentres = darkCentresResult.recordset.map((r) => ({
      centreName:       abbreviateCentre(r.centreName),
      lastActivityDate: r.lastActivityDate || null,
      daysInactive:     r.daysInactive ?? 0,
      staffCount:       r.staffCount ?? 0,
      activeCaseload:   r.activeCaseload ?? 0,
    }));

    const lowCompletionClinicians = lowCompClinicianResult.recordset.map((r) => {
      const assigned  = r.assigned  ?? 0;
      const completed = r.completed ?? 0;
      return {
        clinicianId:    r.clinicianId,
        clinicianName:  r.clinicianName,
        clinicianEmail: r.clinicianEmail || '',
        centreName:     abbreviateCentre(r.centreName),
        assigned,
        completed,
        completionRate: assigned > 0
          ? parseFloat(((completed / assigned) * 100).toFixed(1))
          : 0,
        assessmentType: r.assessmentType,
      };
    });

    const lowCompletionCentres = lowCompCentreResult.recordset.map((r) => {
      const assigned  = r.assigned  ?? 0;
      const completed = r.completed ?? 0;
      return {
        centreName:     abbreviateCentre(r.centreName),
        assigned,
        completed,
        completionRate: assigned > 0
          ? parseFloat(((completed / assigned) * 100).toFixed(1))
          : 0,
      };
    });

    const turnaroundWeeks = turnaroundResult.recordset
      .map((r) => ({
        weekStart:              fmtDate(r.weekStart),
        avgOnboardingHours:     r.avgOnboardingHours      != null ? parseFloat(Number(r.avgOnboardingHours).toFixed(2))      : null,
        avgReportApprovalHours: r.avgReportApprovalDays   != null ? parseFloat(Number(r.avgReportApprovalDays).toFixed(2))   : null,
        avgGoalApprovalHours:   r.avgGoalApprovalDays     != null ? parseFloat(Number(r.avgGoalApprovalDays).toFixed(2))     : null,
      }))
      .filter((r) => r.weekStart)
      .sort((a, b) => (a.weekStart || '').localeCompare(b.weekStart || ''))
      .slice(-12);

    const typeMap = new Map(ASSESSMENT_TYPES.map((t) => [t, {
      type: t, total: 0, pending: 0, completionRate: 0, avgDays: null,
      responsibleRole: RESPONSIBLE_ROLE[t],
    }]));
    for (const r of byTypeResult.recordset) {
      if (!ASSESSMENT_TYPES.includes(r.type)) continue;
      const total     = r.total     ?? 0;
      const completed = r.completed ?? 0;
      typeMap.set(r.type, {
        type: r.type,
        total,
        pending: r.pending ?? 0,
        completionRate: total > 0
          ? parseFloat(((completed / total) * 100).toFixed(1))
          : 0,
        avgDays: r.avgDays != null ? parseFloat(Number(r.avgDays).toFixed(1)) : null,
        responsibleRole: RESPONSIBLE_ROLE[r.type],
      });
    }
    const byType = [...typeMap.values()];

    const criticalTotal =
      overdueAssessmentsCrit.length +
      reportsNotDraftedCrit.length +
      reportsPendingApprovalCrit.length +
      goalsNotAddedCrit.length +
      goalsPendingApprovalCrit.length +
      stuckOnboarding.length +
      darkCentres.length;

    const warningTotal =
      overdueAssessmentsWarn.length +
      reportsNotDraftedWarn.length +
      reportsPendingApprovalWarn.length +
      goalsNotAddedWarn.length +
      goalsPendingApprovalWarn.length;

    const watchingTotal =
      earlyOverdue.length +
      lowCompletionClinicians.length +
      lowCompletionCentres.length;

    const payload = {
      critical: {
        total: criticalTotal,
        overdueAssessments:        overdueAssessmentsCrit,
        reportsNotDrafted:         reportsNotDraftedCrit,
        reportsPendingApproval:    reportsPendingApprovalCrit,
        goalsNotAdded:             goalsNotAddedCrit,
        goalsPendingApproval:      goalsPendingApprovalCrit,
        stuckOnboarding,
        darkCentres,
      },
      warning: {
        total: warningTotal,
        // nudgeAssessments kept for backward compatibility (same data as overdueAssessments)
        nudgeAssessments:          overdueAssessmentsWarn,
        overdueAssessments:        overdueAssessmentsWarn,
        reportsNotDrafted:         reportsNotDraftedWarn,
        reportsPendingApproval:    reportsPendingApprovalWarn,
        // pendingReportApprovals kept for backward compatibility
        pendingReportApprovals:    reportsPendingApprovalWarn,
        goalsNotAdded:             goalsNotAddedWarn,
        goalsPendingApproval:      goalsPendingApprovalWarn,
        // pendingGoalApprovals kept for backward compatibility
        pendingGoalApprovals:      goalsPendingApprovalWarn,
      },
      watching: {
        total: watchingTotal,
        earlyOverdue,
        lowCompletionClinicians,
        lowCompletionCentres,
      },
      turnaroundTrend: { weeks: turnaroundWeeks },
      byType,
      generatedAt: new Date().toISOString(),
    };

    issuesCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
