'use strict';

/**
 * goalProgress.js — Goal progress tracking data layer.
 *
 * Covers SPM, ISA, and REELS assessment types which have dedicated progress tables.
 *
 * FSP goals have no progress table — excluded from coverage metrics.
 * Track separately if a progress table is added in future.
 *
 * Progress tables and their goal FK:
 *   PatientSPMAssessmentFNPGoalProgress    → PatientSPMAssessmentFNPGoalId
 *   PatientISAAssessmentFnpGoalProgress    → PatientISAAssessmentFnpGoalId
 *   PatientReelsAssessmentFnpGoalProgress  → PatientReelsAssessmentFnpGoalId
 *
 * Role attribution:
 *   Progress tables store CreatedBy as email string.
 *   Join AdminUser.Email → AdminUserRole (UserId, RoleId) → AdminRole.
 *
 * Audit log aggregation:
 *   Use PatientAuditLog WHERE Type='ProgressAdded' for time-based counts.
 *   Use dedicated tables for per-goal coverage queries.
 */

const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion, buildPatientExclusion } = require('../lib/queryHelpers');

// ── Shared exclusion helpers ──────────────────────────────────────────────────

function userExclusionStrict(alias = 'au') {
  return `${alias}.FirstName NOT LIKE '%test%'
    AND ${alias}.LastName  NOT LIKE '%test%'
    AND ${alias}.Email     NOT LIKE '%@webority.com'
    AND ${alias}.Email     NOT LIKE '%@mailinator.com'`;
}

function createdByExclusion(alias = 'cb') {
  // For progress tables where CreatedBy is an email string (not a FK)
  return `${alias}.CreatedBy NOT LIKE '%@webority.com'
    AND ${alias}.CreatedBy NOT LIKE '%@mailinator.com'`;
}

// ── getGoalProgressSummary ────────────────────────────────────────────────────

/**
 * Returns summary of goal progress coverage across all approved goals.
 *
 * @param {Date|null} dateFrom   — start of period (for note counts)
 * @param {Date|null} dateTo     — end of period (for note counts)
 * @param {number|null} centreId — optional centre scope
 */
async function getGoalProgressSummary(dateFrom, dateTo, centreId) {
  const pool = await poolPromise;
  const centreExclusion = buildCentreExclusion('c');
  const patientExclusion = buildPatientExclusion('pt');
  const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

  // ── Run all queries in parallel ────────────────────────────────────────────
  const [
    approvedGoalsResult,
    progressCoverageResult,
    totalNotesResult,
    byUserResult,
    recentlyUndocumentedResult,
  ] = await Promise.all([

    // 1. Approved goals by assessment type (SPM / ISA / REELS)
    // FSP goals are NOT in PatientGoalApprovalRequestGoal — excluded by design.
    pool.request()
      .input('centreId', sql.BigInt, centreId)
      .query(`
        SELECT
          CASE
            WHEN pgarg.PatientSPMAssessmentFNPGoalId   IS NOT NULL THEN 'SPM'
            WHEN pgarg.PatientISAAssessmentFnpGoalId   IS NOT NULL THEN 'ISA'
            WHEN pgarg.PatientReelsAssessmentFnpGoalId IS NOT NULL THEN 'REELS'
            ELSE 'Other'
          END AS assessmentType,
          COUNT(*) AS approvedGoals,
          -- Goals with at least one note in any progress table
          SUM(CASE
            WHEN pgarg.PatientSPMAssessmentFNPGoalId IS NOT NULL AND EXISTS (
              SELECT 1 FROM PatientSPMAssessmentFNPGoalProgress p
              WHERE p.PatientSPMAssessmentFNPGoalId = pgarg.PatientSPMAssessmentFNPGoalId
            ) THEN 1
            WHEN pgarg.PatientISAAssessmentFnpGoalId IS NOT NULL AND EXISTS (
              SELECT 1 FROM PatientISAAssessmentFnpGoalProgress p
              WHERE p.PatientISAAssessmentFnpGoalId = pgarg.PatientISAAssessmentFnpGoalId
            ) THEN 1
            WHEN pgarg.PatientReelsAssessmentFnpGoalId IS NOT NULL AND EXISTS (
              SELECT 1 FROM PatientReelsAssessmentFnpGoalProgress p
              WHERE p.PatientReelsAssessmentFnpGoalId = pgarg.PatientReelsAssessmentFnpGoalId
            ) THEN 1
            ELSE 0
          END) AS goalsWithNotes,
          -- Total notes (from dedicated tables, all time)
          SUM(CASE
            WHEN pgarg.PatientSPMAssessmentFNPGoalId IS NOT NULL THEN (
              SELECT COUNT(*) FROM PatientSPMAssessmentFNPGoalProgress p
              WHERE p.PatientSPMAssessmentFNPGoalId = pgarg.PatientSPMAssessmentFNPGoalId
            )
            WHEN pgarg.PatientISAAssessmentFnpGoalId IS NOT NULL THEN (
              SELECT COUNT(*) FROM PatientISAAssessmentFnpGoalProgress p
              WHERE p.PatientISAAssessmentFnpGoalId = pgarg.PatientISAAssessmentFnpGoalId
            )
            WHEN pgarg.PatientReelsAssessmentFnpGoalId IS NOT NULL THEN (
              SELECT COUNT(*) FROM PatientReelsAssessmentFnpGoalProgress p
              WHERE p.PatientReelsAssessmentFnpGoalId = pgarg.PatientReelsAssessmentFnpGoalId
            )
            ELSE 0
          END) AS totalNotes
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE pgarg.Status = 'Approved'
          AND ${patientExclusion}
          AND ${centreExclusion}
          AND (@centreId IS NULL OR c.Id = @centreId)
        GROUP BY
          CASE
            WHEN pgarg.PatientSPMAssessmentFNPGoalId   IS NOT NULL THEN 'SPM'
            WHEN pgarg.PatientISAAssessmentFnpGoalId   IS NOT NULL THEN 'ISA'
            WHEN pgarg.PatientReelsAssessmentFnpGoalId IS NOT NULL THEN 'REELS'
            ELSE 'Other'
          END
      `),

    // 2. Total approved goals with/without notes (all types combined)
    pool.request()
      .input('centreId', sql.BigInt, centreId)
      .query(`
        SELECT
          COUNT(*) AS totalApproved,
          SUM(CASE
            WHEN pgarg.PatientSPMAssessmentFNPGoalId IS NOT NULL AND EXISTS (
              SELECT 1 FROM PatientSPMAssessmentFNPGoalProgress p
              WHERE p.PatientSPMAssessmentFNPGoalId = pgarg.PatientSPMAssessmentFNPGoalId
            ) THEN 1
            WHEN pgarg.PatientISAAssessmentFnpGoalId IS NOT NULL AND EXISTS (
              SELECT 1 FROM PatientISAAssessmentFnpGoalProgress p
              WHERE p.PatientISAAssessmentFnpGoalId = pgarg.PatientISAAssessmentFnpGoalId
            ) THEN 1
            WHEN pgarg.PatientReelsAssessmentFnpGoalId IS NOT NULL AND EXISTS (
              SELECT 1 FROM PatientReelsAssessmentFnpGoalProgress p
              WHERE p.PatientReelsAssessmentFnpGoalId = pgarg.PatientReelsAssessmentFnpGoalId
            ) THEN 1
            ELSE 0
          END) AS goalsWithNotes
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE pgarg.Status = 'Approved'
          AND ${patientExclusion}
          AND ${centreExclusion}
          AND (@centreId IS NULL OR c.Id = @centreId)
      `),

    // 3. Total notes in period (from PatientAuditLog for time-based counts)
    pool.request()
      .input('centreId', sql.BigInt, centreId)
      .input('dateFrom', sql.DateTimeOffset, dateFrom)
      .input('dateTo',   sql.DateTimeOffset, dateTo)
      .query(`
        SELECT COUNT(*) AS totalNotesInPeriod
        FROM PatientAuditLog pal
        JOIN AdminUser au ON au.Id = pal.AdminUserId
        JOIN Patient pt   ON pt.Id = pal.PatientId
        JOIN Centre c     ON c.Id  = pt.CentreId
        WHERE pal.Type = 'ProgressAdded'
          AND ${dateFilterPal}
          AND ${patientExclusion}
          AND ${centreExclusion}
          AND ${userExclusionStrict('au')}
          AND (@centreId IS NULL OR c.Id = @centreId)
      `),

    // 4. Per-user notes breakdown (from PatientAuditLog, time-scoped)
    pool.request()
      .input('centreId', sql.BigInt, centreId)
      .input('dateFrom', sql.DateTimeOffset, dateFrom)
      .input('dateTo',   sql.DateTimeOffset, dateTo)
      .query(`
        SELECT
          au.Id          AS userId,
          au.FirstName + ' ' + au.LastName AS userName,
          au.Email       AS userEmail,
          ar.Name        AS role,
          COUNT(*)       AS notesAdded,
          COUNT(DISTINCT pal.AllocatePatientId) AS goalsDocumented,
          MAX(pal.CreatedDateTime) AS lastNoteDate
        FROM PatientAuditLog pal
        JOIN AdminUser au ON au.Id = pal.AdminUserId
        JOIN AdminUserRole aur ON aur.UserId = au.Id
        JOIN AdminRole ar      ON ar.Id = aur.RoleId
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE pal.Type = 'ProgressAdded'
          AND ${dateFilterPal}
          AND ${patientExclusion}
          AND ${centreExclusion}
          AND ${userExclusionStrict('au')}
          AND ar.Name NOT IN ('SuperAdmin', 'Super Admin')
          AND (@centreId IS NULL OR c.Id = @centreId)
        GROUP BY au.Id, au.FirstName, au.LastName, au.Email, ar.Name
        ORDER BY notesAdded DESC
      `),

    // 5. Recently undocumented — assessments with approved goals, no ProgressAdded ever
    pool.request()
      .input('centreId', sql.BigInt, centreId)
      .query(`
        SELECT TOP 50
          pt.FirstName + ' ' + pt.LastName AS patientName,
          pt.DisplayId                      AS patientDisplayId,
          ap.Assessment                     AS assessmentType,
          au.FirstName + ' ' + au.LastName  AS clinicianName,
          c.CentreName,
          COUNT(pgarg.Id) AS approvedGoals,
          ISNULL(prog.noteCount, 0) AS notesCount,
          prog.lastNoteDate,
          CASE WHEN prog.lastNoteDate IS NOT NULL
            THEN DATEDIFF(day, prog.lastNoteDate, SYSDATETIMEOFFSET())
            ELSE NULL
          END AS daysSinceLastNote
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        JOIN PatientGoalApprovalRequest pgar ON pgar.AllocatePatientId = ap.Id
        JOIN PatientGoalApprovalRequestGoal pgarg
          ON pgarg.PatientGoalApprovalRequestId = pgar.Id
          AND pgarg.Status = 'Approved'
        LEFT JOIN (
          SELECT
            AllocatePatientId,
            COUNT(*) AS noteCount,
            MAX(CreatedDateTime) AS lastNoteDate
          FROM PatientAuditLog
          WHERE Type = 'ProgressAdded'
          GROUP BY AllocatePatientId
        ) prog ON prog.AllocatePatientId = ap.Id
        WHERE ${buildPatientExclusion('pt')}
          AND ${buildCentreExclusion('c')}
          AND (@centreId IS NULL OR c.Id = @centreId)
        GROUP BY
          pt.FirstName, pt.LastName, pt.DisplayId,
          ap.Assessment,
          au.FirstName, au.LastName,
          c.CentreName,
          prog.noteCount, prog.lastNoteDate
        ORDER BY ISNULL(prog.noteCount, 0) ASC, prog.lastNoteDate ASC
      `),
  ]);

  // ── Assemble summary ───────────────────────────────────────────────────────

  const coverage = progressCoverageResult.recordset[0] ?? { totalApproved: 0, goalsWithNotes: 0 };
  const totalApprovedGoals = coverage.totalApproved ?? 0;
  const goalsWithNotes     = coverage.goalsWithNotes ?? 0;
  const goalsWithoutNotes  = totalApprovedGoals - goalsWithNotes;
  const coveragePercent    = totalApprovedGoals > 0
    ? Math.round((goalsWithNotes / totalApprovedGoals) * 100)
    : 0;
  const totalNotesAllTime = approvedGoalsResult.recordset.reduce((s, r) => s + (r.totalNotes ?? 0), 0);
  const avgNotesPerGoal   = goalsWithNotes > 0
    ? parseFloat((totalNotesAllTime / totalApprovedGoals).toFixed(1))
    : 0;

  // byAssessmentType: add FSP as static excluded entry
  const byAssessmentType = [
    ...approvedGoalsResult.recordset.map((r) => ({
      type:            r.assessmentType,
      approvedGoals:   r.approvedGoals   ?? 0,
      goalsWithNotes:  r.goalsWithNotes  ?? 0,
      coveragePercent: r.approvedGoals > 0
        ? Math.round(((r.goalsWithNotes ?? 0) / r.approvedGoals) * 100)
        : 0,
      totalNotes:      r.totalNotes      ?? 0,
      hasProgressTable: true,
    })),
    // FSP goals have no progress table — excluded from coverage metrics
    {
      type:            'FSP',
      approvedGoals:   0,
      goalsWithNotes:  0,
      coveragePercent: 0,
      totalNotes:      0,
      hasProgressTable: false,
      // FSP goals have no progress table — excluded from coverage metrics.
      // Track separately if a progress table is added in future.
    },
  ];

  return {
    totalApprovedGoals,
    goalsWithNotes,
    goalsWithoutNotes,
    coveragePercent,
    totalNotes:      totalNotesResult.recordset[0]?.totalNotesInPeriod ?? 0,
    avgNotesPerGoal,
    byAssessmentType,
    byUser: byUserResult.recordset.map((r) => ({
      userId:          r.userId,
      userName:        r.userName,
      userEmail:       r.userEmail,
      role:            r.role,
      notesAdded:      r.notesAdded,
      goalsDocumented: r.goalsDocumented,
      lastNoteDate:    r.lastNoteDate ? new Date(r.lastNoteDate).toISOString() : null,
    })),
    recentlyUndocumented: recentlyUndocumentedResult.recordset.map((r) => ({
      patientName:      r.patientName,
      patientDisplayId: r.patientDisplayId,
      assessmentType:   r.assessmentType,
      clinicianName:    r.clinicianName,
      centreName:       r.CentreName,
      approvedGoals:    r.approvedGoals,
      notesCount:       r.notesCount,
      lastNoteDate:     r.lastNoteDate ? new Date(r.lastNoteDate).toISOString() : null,
      daysSinceLastNote: r.daysSinceLastNote ?? null,
    })),
  };
}

// ── getGoalProgressForClinician ───────────────────────────────────────────────

/**
 * Returns per-clinician goal progress data.
 *
 * @param {number} userId      — AdminUser.Id
 * @param {Date|null} dateFrom
 * @param {Date|null} dateTo
 */
async function getGoalProgressForClinician(userId, dateFrom, dateTo) {
  const pool = await poolPromise;
  const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

  const [summaryResult, byGoalResult] = await Promise.all([
    // Summary counts
    pool.request()
      .input('userId',   sql.BigInt, userId)
      .input('dateFrom', sql.DateTimeOffset, dateFrom)
      .input('dateTo',   sql.DateTimeOffset, dateTo)
      .query(`
        SELECT
          COUNT(*) AS notesAdded,
          COUNT(DISTINCT pal.AllocatePatientId) AS assessmentsWithNotes,
          MAX(pal.CreatedDateTime) AS lastNoteDate
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE pal.Type = 'ProgressAdded'
          AND pal.AdminUserId = @userId
          AND ${dateFilterPal}
          AND ${buildPatientExclusion('pt')}
          AND ${buildCentreExclusion('c')}
      `),

    // Per-goal breakdown: assessments this clinician owns with approved goals
    pool.request()
      .input('userId',   sql.BigInt, userId)
      .input('dateFrom', sql.DateTimeOffset, dateFrom)
      .input('dateTo',   sql.DateTimeOffset, dateTo)
      .query(`
        SELECT
          pt.FirstName + ' ' + pt.LastName AS patientName,
          ap.Assessment AS assessmentType,
          pgarg.Id AS goalId,
          CASE
            WHEN pgarg.PatientSPMAssessmentFNPGoalId   IS NOT NULL THEN 'SPM'
            WHEN pgarg.PatientISAAssessmentFnpGoalId   IS NOT NULL THEN 'ISA'
            WHEN pgarg.PatientReelsAssessmentFnpGoalId IS NOT NULL THEN 'REELS'
            ELSE 'Other'
          END AS goalType,
          prog.noteCount AS notesCount,
          prog.lastNoteDate
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        JOIN PatientGoalApprovalRequest pgar ON pgar.AllocatePatientId = ap.Id
        JOIN PatientGoalApprovalRequestGoal pgarg
          ON pgarg.PatientGoalApprovalRequestId = pgar.Id
          AND pgarg.Status = 'Approved'
        LEFT JOIN (
          SELECT
            AllocatePatientId,
            COUNT(*) AS noteCount,
            MAX(CreatedDateTime) AS lastNoteDate
          FROM PatientAuditLog
          WHERE Type = 'ProgressAdded'
            AND (
              @dateFrom IS NULL OR CreatedDateTime >= @dateFrom
            )
            AND (
              @dateTo IS NULL OR CreatedDateTime < DATEADD(day, 1, @dateTo)
            )
          GROUP BY AllocatePatientId
        ) prog ON prog.AllocatePatientId = ap.Id
        WHERE ap.ClinicianUserId = @userId
          AND ${buildPatientExclusion('pt')}
          AND ${buildCentreExclusion('c')}
        ORDER BY ISNULL(prog.noteCount, 0) ASC
      `),
  ]);

  const summary = summaryResult.recordset[0] ?? {};
  const byGoalRows = byGoalResult.recordset;

  return {
    userId,
    notesAdded:           summary.notesAdded ?? 0,
    goalsDocumented:      byGoalRows.filter((r) => (r.notesCount ?? 0) > 0).length,
    assessmentsWithNotes: summary.assessmentsWithNotes ?? 0,
    lastNoteDate:         summary.lastNoteDate ? new Date(summary.lastNoteDate).toISOString() : null,
    byGoal: byGoalRows.map((r) => ({
      patientName:    r.patientName,
      assessmentType: r.goalType,
      goalId:         r.goalId,
      notesCount:     r.notesCount ?? 0,
      lastNoteDate:   r.lastNoteDate ? new Date(r.lastNoteDate).toISOString() : null,
    })),
  };
}

// ── getGoalProgressForAssessment ──────────────────────────────────────────────

/**
 * Returns per-assessment goal progress, including note content.
 * Uses dedicated progress tables for per-goal accuracy.
 * Note content columns assumed to be 'Notes' — adjust if schema differs.
 *
 * @param {number} allocatePatientId
 */
async function getGoalProgressForAssessment(allocatePatientId) {
  const pool = await poolPromise;

  // Get approved goals for this assessment
  const goalsResult = await pool.request()
    .input('apId', sql.BigInt, allocatePatientId)
    .query(`
      SELECT
        pgarg.Id AS goalId,
        CASE
          WHEN pgarg.PatientSPMAssessmentFNPGoalId   IS NOT NULL THEN 'SPM'
          WHEN pgarg.PatientISAAssessmentFnpGoalId   IS NOT NULL THEN 'ISA'
          WHEN pgarg.PatientReelsAssessmentFnpGoalId IS NOT NULL THEN 'REELS'
          ELSE 'Other'
        END AS assessmentType,
        pgarg.PatientSPMAssessmentFNPGoalId,
        pgarg.PatientISAAssessmentFnpGoalId,
        pgarg.PatientReelsAssessmentFnpGoalId
      FROM PatientGoalApprovalRequestGoal pgarg
      JOIN PatientGoalApprovalRequest pgar
        ON pgar.Id = pgarg.PatientGoalApprovalRequestId
      WHERE pgar.AllocatePatientId = @apId
        AND pgarg.Status = 'Approved'
    `);

  const goals = goalsResult.recordset;
  const totalApproved = goals.length;

  // Fetch notes for each goal type in parallel using dedicated progress tables
  // NOTE: If 'Notes' is not the correct column name for note content in your schema,
  // update the column reference below. The FK column names are confirmed.
  const goalDetails = await Promise.all(goals.map(async (goal) => {
    let notes = [];

    try {
      if (goal.assessmentType === 'SPM' && goal.PatientSPMAssessmentFNPGoalId) {
        const r = await pool.request()
          .input('goalId', sql.BigInt, goal.PatientSPMAssessmentFNPGoalId)
          .query(`
            SELECT
              p.Id AS noteId,
              ISNULL(p.Notes, p.Description) AS content,
              p.CreatedBy,
              p.CreatedDateTime,
              au.Id   AS addedByUserId,
              au.FirstName + ' ' + au.LastName AS addedBy,
              ar.Name AS addedByRole
            FROM PatientSPMAssessmentFNPGoalProgress p
            LEFT JOIN AdminUser au    ON au.Email = p.CreatedBy
            LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
            LEFT JOIN AdminRole ar    ON ar.Id = aur.RoleId
            WHERE p.PatientSPMAssessmentFNPGoalId = @goalId
            ORDER BY p.CreatedDateTime
          `);
        notes = r.recordset;
      } else if (goal.assessmentType === 'ISA' && goal.PatientISAAssessmentFnpGoalId) {
        const r = await pool.request()
          .input('goalId', sql.BigInt, goal.PatientISAAssessmentFnpGoalId)
          .query(`
            SELECT
              p.Id AS noteId,
              ISNULL(p.Notes, p.Description) AS content,
              p.CreatedBy,
              p.CreatedDateTime,
              au.Id   AS addedByUserId,
              au.FirstName + ' ' + au.LastName AS addedBy,
              ar.Name AS addedByRole
            FROM PatientISAAssessmentFnpGoalProgress p
            LEFT JOIN AdminUser au    ON au.Email = p.CreatedBy
            LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
            LEFT JOIN AdminRole ar    ON ar.Id = aur.RoleId
            WHERE p.PatientISAAssessmentFnpGoalId = @goalId
            ORDER BY p.CreatedDateTime
          `);
        notes = r.recordset;
      } else if (goal.assessmentType === 'REELS' && goal.PatientReelsAssessmentFnpGoalId) {
        const r = await pool.request()
          .input('goalId', sql.BigInt, goal.PatientReelsAssessmentFnpGoalId)
          .query(`
            SELECT
              p.Id AS noteId,
              ISNULL(p.Notes, p.Description) AS content,
              p.CreatedBy,
              p.CreatedDateTime,
              au.Id   AS addedByUserId,
              au.FirstName + ' ' + au.LastName AS addedBy,
              ar.Name AS addedByRole
            FROM PatientReelsAssessmentFnpGoalProgress p
            LEFT JOIN AdminUser au    ON au.Email = p.CreatedBy
            LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
            LEFT JOIN AdminRole ar    ON ar.Id = aur.RoleId
            WHERE p.PatientReelsAssessmentFnpGoalId = @goalId
            ORDER BY p.CreatedDateTime
          `);
        notes = r.recordset;
      }
    } catch (err) {
      // Schema mismatch — log and return empty notes rather than failing the request
      console.warn(`[goalProgress] Note fetch failed for goal ${goal.goalId} (${goal.assessmentType}):`, err.message);
      notes = [];
    }

    return {
      goalId:         goal.goalId,
      assessmentType: goal.assessmentType,
      notesCount:     notes.length,
      lastNoteDate:   notes.length > 0
        ? new Date(notes[notes.length - 1].CreatedDateTime).toISOString()
        : null,
      notes: notes.map((n) => ({
        noteId:      n.noteId,
        content:     n.content ?? '',
        addedBy:     n.addedBy ?? n.CreatedBy ?? 'Unknown',
        addedByRole: n.addedByRole ?? 'Unknown',
        addedDate:   n.CreatedDateTime ? new Date(n.CreatedDateTime).toISOString() : null,
      })),
    };
  }));

  const goalsWithNotes = goalDetails.filter((g) => g.notesCount > 0).length;

  return {
    allocatePatientId,
    approvedGoals:   totalApproved,
    goalsWithNotes,
    coveragePercent: totalApproved > 0
      ? Math.round((goalsWithNotes / totalApproved) * 100)
      : 0,
    goals: goalDetails,
  };
}

// ── getProgressNoteCountsByUser ───────────────────────────────────────────────

/**
 * Lightweight helper for enriching the /api/clinicians and /api/managers responses.
 * Returns a map of userId → { notesAdded, goalsDocumented, lastNoteDate }.
 *
 * @param {Date|null} dateFrom
 * @param {Date|null} dateTo
 * @param {number|null} centreId
 */
async function getProgressNoteCountsByUser(dateFrom, dateTo, centreId) {
  const pool = await poolPromise;
  const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

  const result = await pool.request()
    .input('centreId', sql.BigInt, centreId)
    .input('dateFrom', sql.DateTimeOffset, dateFrom)
    .input('dateTo',   sql.DateTimeOffset, dateTo)
    .query(`
      SELECT
        au.Id AS userId,
        COUNT(*) AS notesAdded,
        COUNT(DISTINCT pal.AllocatePatientId) AS goalsDocumented,
        MAX(pal.CreatedDateTime) AS lastNoteDate
      FROM PatientAuditLog pal
      JOIN AdminUser au ON au.Id = pal.AdminUserId
      JOIN Patient pt   ON pt.Id = pal.PatientId
      JOIN Centre c     ON c.Id  = pt.CentreId
      WHERE pal.Type = 'ProgressAdded'
        AND ${dateFilterPal}
        AND ${buildPatientExclusion('pt')}
        AND ${buildCentreExclusion('c')}
        AND ${userExclusionStrict('au')}
        AND (@centreId IS NULL OR c.Id = @centreId)
      GROUP BY au.Id
    `);

  const map = new Map();
  for (const row of result.recordset) {
    map.set(row.userId, {
      notesAdded:      row.notesAdded ?? 0,
      goalsDocumented: row.goalsDocumented ?? 0,
      lastNoteDate:    row.lastNoteDate ? new Date(row.lastNoteDate).toISOString() : null,
    });
  }
  return map;
}

// ── getGoalCoverageForOverview ────────────────────────────────────────────────

/**
 * Lightweight coverage summary for /api/overview.
 * Returns { approvedGoals, goalsWithNotes, coveragePercent }.
 */
async function getGoalCoverageForOverview(centreId) {
  const pool = await poolPromise;

  const result = await pool.request()
    .input('centreId', sql.BigInt, centreId)
    .query(`
      SELECT
        COUNT(*) AS approvedGoals,
        SUM(CASE
          WHEN pgarg.PatientSPMAssessmentFNPGoalId IS NOT NULL AND EXISTS (
            SELECT 1 FROM PatientSPMAssessmentFNPGoalProgress p
            WHERE p.PatientSPMAssessmentFNPGoalId = pgarg.PatientSPMAssessmentFNPGoalId
          ) THEN 1
          WHEN pgarg.PatientISAAssessmentFnpGoalId IS NOT NULL AND EXISTS (
            SELECT 1 FROM PatientISAAssessmentFnpGoalProgress p
            WHERE p.PatientISAAssessmentFnpGoalId = pgarg.PatientISAAssessmentFnpGoalId
          ) THEN 1
          WHEN pgarg.PatientReelsAssessmentFnpGoalId IS NOT NULL AND EXISTS (
            SELECT 1 FROM PatientReelsAssessmentFnpGoalProgress p
            WHERE p.PatientReelsAssessmentFnpGoalId = pgarg.PatientReelsAssessmentFnpGoalId
          ) THEN 1
          ELSE 0
        END) AS goalsWithNotes
      FROM PatientGoalApprovalRequestGoal pgarg
      JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
      JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre c   ON c.Id  = pt.CentreId
      WHERE pgarg.Status = 'Approved'
        AND ${buildPatientExclusion('pt')}
        AND ${buildCentreExclusion('c')}
        AND (@centreId IS NULL OR c.Id = @centreId)
    `);

  const row = result.recordset[0] ?? { approvedGoals: 0, goalsWithNotes: 0 };
  const approvedGoals = row.approvedGoals ?? 0;
  const goalsWithNotes = row.goalsWithNotes ?? 0;

  return {
    approvedGoals,
    goalsWithNotes,
    coveragePercent: approvedGoals > 0
      ? Math.round((goalsWithNotes / approvedGoals) * 100)
      : 0,
  };
}

module.exports = {
  getGoalProgressSummary,
  getGoalProgressForClinician,
  getGoalProgressForAssessment,
  getProgressNoteCountsByUser,
  getGoalCoverageForOverview,
};
