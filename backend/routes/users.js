'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion } = require('../lib/queryHelpers');

const router = Router();

const VALID_ROLES = new Set(['clinician', 'manager', 'centre-admin']);

// ── User exclusion filter (shared across routes) ──────────────────────────────
const USER_EXCLUSION = `
  LOWER(au.FirstName) NOT LIKE '%test%'
  AND LOWER(au.LastName)  NOT LIKE '%test%'
  AND LOWER(au.Email)     NOT LIKE '%@webority.com'
`;

function bindBreakdownParams(request, { centreId, dateFrom, dateTo }) {
  return request
    .input('centreId', sql.BigInt, centreId)
    .input('dateFrom', sql.DateTimeOffset, dateFrom)
    .input('dateTo', sql.DateTimeOffset, dateTo);
}

function parseBreakdownFilters(req) {
  const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
  const dateFrom = parseDateParam(req.query.dateFrom);
  const dateTo = parseDateParam(req.query.dateTo);

  if (req.query.centreId && isNaN(centreId)) {
    const err = new Error('centreId must be a number');
    err.status = 400;
    throw err;
  }
  if (req.query.dateFrom && !dateFrom) {
    const err = new Error('dateFrom must be a valid ISO date');
    err.status = 400;
    throw err;
  }
  if (req.query.dateTo && !dateTo) {
    const err = new Error('dateTo must be a valid ISO date');
    err.status = 400;
    throw err;
  }

  return { centreId, dateFrom, dateTo };
}

/**
 * GET /api/users/breakdown
 * Query params: centreId (optional), dateFrom, dateTo (optional)
 *
 * Returns roster counts scoped to centre, with active/inactive measured by
 * audit-log activity in the selected date range (not AdminUser.Status).
 */
router.get('/breakdown', async (req, res, next) => {
  try {
    const filters = parseBreakdownFilters(req);
    const { centreId, dateFrom, dateTo } = filters;
    const pool = await poolPromise;
    const centreExclusion = buildCentreExclusion('c');
    const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

    const rosterCte = `
      WITH roster AS (
        SELECT DISTINCT
          au.Id AS userId,
          ISNULL(ar.Name, 'Unassigned') AS roleName
        FROM AdminUser au
        LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
        LEFT JOIN AdminRole ar ON ar.Id = aur.RoleId
        LEFT JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        LEFT JOIN Centre c ON c.Id = auc.CentreId
        WHERE ${USER_EXCLUSION}
          AND (@centreId IS NULL OR c.Id = @centreId)
          AND (c.Id IS NULL OR ${centreExclusion})
      ),
      period_active AS (
        SELECT DISTINCT pal.AdminUserId AS userId
        FROM PatientAuditLog pal
        WHERE ${dateFilterPal}
      )`;

    const centreScope = `
      AND (@centreId IS NULL OR EXISTS (
        SELECT 1
        FROM AdminUserCentre auc_f
        JOIN Centre c_f ON c_f.Id = auc_f.CentreId
        WHERE auc_f.AdminUserId = au.Id
          AND c_f.Id = @centreId
          AND ${buildCentreExclusion('c_f')}
      ))`;

    const [
      totalsResult,
      byRoleResult,
      byCentreResult,
      recentlyInactiveResult,
      neverActiveResult,
    ] = await Promise.all([

      bindBreakdownParams(pool.request(), filters).query(`
        ${rosterCte}
        SELECT
          COUNT(DISTINCT r.userId) AS total,
          COUNT(DISTINCT CASE WHEN pa.userId IS NOT NULL THEN r.userId END) AS active,
          COUNT(DISTINCT CASE WHEN pa.userId IS NULL THEN r.userId END) AS inactive
        FROM roster r
        LEFT JOIN period_active pa ON pa.userId = r.userId
      `),

      bindBreakdownParams(pool.request(), filters).query(`
        ${rosterCte}
        SELECT
          r.roleName,
          COUNT(DISTINCT r.userId) AS count,
          COUNT(DISTINCT CASE WHEN pa.userId IS NOT NULL THEN r.userId END) AS activeCount,
          COUNT(DISTINCT CASE WHEN pa.userId IS NULL THEN r.userId END) AS inactiveCount
        FROM roster r
        LEFT JOIN period_active pa ON pa.userId = r.userId
        GROUP BY r.roleName
        ORDER BY count DESC
      `),

      bindBreakdownParams(pool.request(), filters).query(`
        WITH period_active AS (
          SELECT DISTINCT pal.AdminUserId AS userId
          FROM PatientAuditLog pal
          WHERE ${dateFilterPal}
        )
        SELECT
          c.Id AS centreId,
          c.CentreName,
          COUNT(DISTINCT au.Id) AS total,
          COUNT(DISTINCT CASE WHEN LOWER(ar.Name) LIKE '%clinician%' THEN au.Id END) AS clinicians,
          COUNT(DISTINCT CASE WHEN LOWER(ar.Name) NOT LIKE '%clinician%' AND ar.Name IS NOT NULL THEN au.Id END) AS managers,
          COUNT(DISTINCT CASE WHEN pa.userId IS NOT NULL THEN au.Id END) AS activeInPeriod
        FROM AdminUser au
        JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        JOIN Centre c ON c.Id = auc.CentreId
        LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
        LEFT JOIN AdminRole ar ON ar.Id = aur.RoleId
        LEFT JOIN period_active pa ON pa.userId = au.Id
        WHERE ${USER_EXCLUSION}
          AND ${centreExclusion}
          AND (@centreId IS NULL OR c.Id = @centreId)
        GROUP BY c.Id, c.CentreName
        ORDER BY total DESC
      `),

      bindBreakdownParams(pool.request(), filters).query(`
        SELECT TOP 200
          au.Id AS id,
          au.FirstName AS firstName,
          au.LastName AS lastName,
          au.Email AS email,
          ISNULL(ar.Name, 'Unassigned') AS roleName,
          MAX(c.CentreName) AS centreName,
          MAX(pal.CreatedDateTime) AS lastActivityDate,
          au.LastLoginDateTimeUtc AS lastLoginDate,
          DATEDIFF(day, MAX(pal.CreatedDateTime), SYSDATETIMEOFFSET()) AS daysSinceActive
        FROM AdminUser au
        LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
        LEFT JOIN AdminRole ar ON ar.Id = aur.RoleId
        LEFT JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        LEFT JOIN Centre c ON c.Id = auc.CentreId AND ${centreExclusion}
        INNER JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
        WHERE ${USER_EXCLUSION}
          ${centreScope}
        GROUP BY au.Id, au.FirstName, au.LastName, au.Email, ar.Name, au.LastLoginDateTimeUtc
        HAVING MAX(pal.CreatedDateTime) < DATEADD(day, -30, SYSDATETIMEOFFSET())
        ORDER BY daysSinceActive DESC
      `),

      bindBreakdownParams(pool.request(), filters).query(`
        SELECT TOP 100
          au.Id AS id,
          au.FirstName AS firstName,
          au.LastName AS lastName,
          au.Email AS email,
          ISNULL(ar.Name, 'Unassigned') AS roleName,
          MAX(c.CentreName) AS centreName,
          MAX(au.CreatedDateTimeUtc) AS createdDate
        FROM AdminUser au
        LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
        LEFT JOIN AdminRole ar ON ar.Id = aur.RoleId
        LEFT JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        LEFT JOIN Centre c ON c.Id = auc.CentreId AND ${centreExclusion}
        WHERE ${USER_EXCLUSION}
          ${centreScope}
          AND NOT EXISTS (
            SELECT 1 FROM PatientAuditLog pal WHERE pal.AdminUserId = au.Id
          )
        GROUP BY au.Id, au.FirstName, au.LastName, au.Email, ar.Name
        ORDER BY MAX(au.CreatedDateTimeUtc) DESC
      `),
    ]);

    const t = totalsResult.recordset[0] || {};

    res.json({
      total: t.total ?? 0,
      dateFrom: req.query.dateFrom ?? null,
      dateTo: req.query.dateTo ?? null,
      byRole: byRoleResult.recordset.map((r) => ({
        roleName: r.roleName,
        count: r.count,
        activeCount: r.activeCount,
        inactiveCount: r.inactiveCount,
      })),
      byStatus: { active: t.active ?? 0, inactive: t.inactive ?? 0 },
      byCentre: byCentreResult.recordset.map((r) => ({
        centreId: r.centreId,
        centreName: r.CentreName,
        total: r.total,
        clinicians: r.clinicians,
        managers: r.managers,
        activeInPeriod: r.activeInPeriod ?? 0,
      })),
      recentlyInactive: recentlyInactiveResult.recordset.map((r) => ({
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        roleName: r.roleName,
        centreName: r.centreName || null,
        lastActivityDate: r.lastActivityDate || null,
        lastLoginDate: r.lastLoginDate || null,
        daysSinceActive: r.daysSinceActive ?? 0,
      })),
      neverActive: neverActiveResult.recordset.map((r) => ({
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        roleName: r.roleName,
        centreName: r.centreName || null,
        createdDate: r.createdDate || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users/:id
 * Lightweight profile for the dashboard drawer — no date-range filters.
 * Auto-detects role from AdminUserRole.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'user id must be a number' });
    }

    const pool = await poolPromise;

    // User info + role + primary centre
    const userResult = await pool.request()
      .input('userId', sql.BigInt, userId)
      .query(`
        SELECT
          au.Id,
          au.FirstName,
          au.LastName,
          au.Email,
          au.Status,
          au.LastLoginDateTimeUtc,
          ar.Name  AS roleName,
          c.Id     AS centreId,
          c.CentreName
        FROM AdminUser au
        LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
        LEFT JOIN AdminRole ar      ON ar.Id = aur.RoleId
        LEFT JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        LEFT JOIN Centre c            ON c.Id = auc.CentreId
        WHERE au.Id = @userId
          AND ${USER_EXCLUSION}
        ORDER BY c.CentreName
      `);

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const first = userResult.recordset[0];
    const roleName = first.roleName || '';
    const isClinician = roleName.toLowerCase().includes('clinician');
    const centreName = first.CentreName || null;

    const [
      activityResult,
      recentResult,
      assessmentResult,
      caseloadResult,
      managerAuditResult,
      goalApprovalsResult,
    ] = await Promise.all([

      // Activity summary
      pool.request()
        .input('userId', sql.BigInt, userId)
        .query(`
          SELECT
            COUNT(*) AS totalAuditActions,
            MAX(pal.CreatedDateTime) AS lastActivityDate
          FROM PatientAuditLog pal
          WHERE pal.AdminUserId = @userId
        `),

      // Recent activity (last 20)
      pool.request()
        .input('userId', sql.BigInt, userId)
        .query(`
          SELECT TOP 20
            pal.CreatedDateTime                   AS date,
            pal.Type                              AS type,
            ISNULL(pal.Description, pal.Type)     AS description,
            pal.PatientId                         AS patientId
          FROM PatientAuditLog pal
          WHERE pal.AdminUserId = @userId
          ORDER BY pal.CreatedDateTime DESC
        `),

      // Assessment breakdown — clinician only
      isClinician
        ? pool.request()
            .input('userId', sql.BigInt, userId)
            .query(`
              SELECT
                ISNULL(ap.Assessment, 'Unknown') AS assessmentType,
                COUNT(*) AS assigned,
                SUM(CASE WHEN ap.IsResultGenerate = 1 THEN 1 ELSE 0 END) AS completed,
                AVG(
                  CASE WHEN ap.IsResultGenerate = 1
                    AND ap.UpdatedDateTimeUtc > ap.CreatedDateTimeUtc
                  THEN CAST(DATEDIFF(day, ap.CreatedDateTimeUtc, ap.UpdatedDateTimeUtc) AS FLOAT)
                  ELSE NULL END
                ) AS avgDaysToComplete
              FROM AllocatePatient ap
              WHERE ap.ClinicianUserId = @userId
                AND ap.Assessment IS NOT NULL
              GROUP BY ap.Assessment
              ORDER BY assigned DESC
            `)
        : Promise.resolve({ recordset: [] }),

      // Active + total caseload — clinician only
      isClinician
        ? pool.request()
            .input('userId', sql.BigInt, userId)
            .query(`
              SELECT
                SUM(CASE WHEN ap.Status IN ('NotStarted', 'InProgress', 'OnHold') THEN 1 ELSE 0 END) AS activeCaseload,
                COUNT(*) AS totalCasesAllTime
              FROM AllocatePatient ap
              WHERE ap.ClinicianUserId = @userId
            `)
        : Promise.resolve({ recordset: [{ activeCaseload: 0, totalCasesAllTime: 0 }] }),

      // Manager: cases registered + assessments assigned from audit log
      !isClinician
        ? pool.request()
            .input('userId', sql.BigInt, userId)
            .query(`
              SELECT
                SUM(CASE WHEN pal.Type = 'CaseRegistered' THEN 1 ELSE 0 END) AS casesRegistered,
                SUM(CASE WHEN pal.Type = 'CaseAssigned'   THEN 1 ELSE 0 END) AS assessmentsAssigned
              FROM PatientAuditLog pal
              WHERE pal.AdminUserId = @userId
            `)
        : Promise.resolve({ recordset: [{ casesRegistered: 0, assessmentsAssigned: 0 }] }),

      // Manager: goal approvals for their centre(s)
      !isClinician
        ? pool.request()
            .input('userId', sql.BigInt, userId)
            .query(`
              SELECT
                SUM(CASE WHEN pgarg.Status NOT IN ('Approved','Rejected') THEN 1 ELSE 0 END) AS goalApprovalsPending,
                SUM(CASE WHEN pgarg.Status = 'Approved' THEN 1 ELSE 0 END)                   AS goalApprovalsCompleted,
                AVG(
                  CASE WHEN pgarg.Status = 'Approved'
                    AND pgarg.UpdatedDateTimeUtc > pgar.CreatedDateTimeUtc
                  THEN CAST(DATEDIFF(minute, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) AS FLOAT) / 60.0
                  ELSE NULL END
                ) AS avgApprovalTurnaroundHours
              FROM PatientGoalApprovalRequestGoal pgarg
              JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
              JOIN AllocatePatient ap              ON ap.Id  = pgar.AllocatePatientId
              JOIN Patient pt                      ON pt.Id  = ap.PatientId
              WHERE pt.CentreId IN (
                SELECT auc.CentreId FROM AdminUserCentre auc WHERE auc.AdminUserId = @userId
              )
            `)
        : Promise.resolve({ recordset: [{ goalApprovalsPending: 0, goalApprovalsCompleted: 0, avgApprovalTurnaroundHours: null }] }),
    ]);

    const act  = activityResult.recordset[0] || {};
    const cs   = caseloadResult.recordset[0] || {};
    const ma   = managerAuditResult.recordset[0] || {};
    const ga   = goalApprovalsResult.recordset[0] || {};

    const payload = {
      id: first.Id,
      firstName: first.FirstName,
      lastName: first.LastName,
      email: first.Email,
      status: first.Status,
      roleName: roleName || null,
      centreName,
      lastLoginDate: first.LastLoginDateTimeUtc || null,
      lastActivityDate: act.lastActivityDate || null,
      totalAuditActions: act.totalAuditActions ?? 0,
      recentActivity: recentResult.recordset.map((r) => ({
        date: r.date,
        type: r.type,
        description: r.description || null,
        patientId: r.patientId ?? null,
      })),
    };

    if (isClinician) {
      Object.assign(payload, {
        activeCaseload: cs.activeCaseload ?? 0,
        totalCasesAllTime: cs.totalCasesAllTime ?? 0,
        assessmentBreakdown: assessmentResult.recordset.map((r) => ({
          assessmentType: r.assessmentType,
          assigned: r.assigned,
          completed: r.completed,
          completionRate: r.assigned > 0 ? Math.round((r.completed / r.assigned) * 100) : 0,
          avgDaysToComplete: r.avgDaysToComplete != null
            ? Math.round(r.avgDaysToComplete * 10) / 10
            : null,
        })),
      });
    } else {
      Object.assign(payload, {
        casesRegistered: ma.casesRegistered ?? 0,
        assessmentsAssigned: ma.assessmentsAssigned ?? 0,
        goalApprovalsPending: ga.goalApprovalsPending ?? 0,
        goalApprovalsCompleted: ga.goalApprovalsCompleted ?? 0,
        avgApprovalTurnaroundHours: ga.avgApprovalTurnaroundHours != null
          ? Math.round(ga.avgApprovalTurnaroundHours * 10) / 10
          : null,
      });
    }

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

function bindCommon(req, { userId, centreId, dateFrom, dateTo }) {
  return req
    .input('userId', sql.BigInt, userId)
    .input('centreId', sql.BigInt, centreId)
    .input('dateFrom', sql.DateTimeOffset, dateFrom)
    .input('dateTo', sql.DateTimeOffset, dateTo);
}

function centrePatientFilter(patientAlias = 'p') {
  return `(@centreId IS NULL OR ${patientAlias}.CentreId = @centreId)`;
}

/**
 * GET /api/users/:id/profile
 * Query: role (clinician|manager|centre-admin), centreId, dateFrom, dateTo
 */
router.get('/:id/profile', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const role = req.query.role;
    const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
    const dateFrom = parseDateParam(req.query.dateFrom);
    const dateTo = parseDateParam(req.query.dateTo);

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'user id must be a number' });
    }
    if (!role || !VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'role must be clinician, manager, or centre-admin' });
    }
    if (req.query.centreId && isNaN(centreId)) {
      return res.status(400).json({ error: 'centreId must be a number' });
    }
    if (req.query.dateFrom && !dateFrom) {
      return res.status(400).json({ error: 'dateFrom must be a valid ISO date' });
    }
    if (req.query.dateTo && !dateTo) {
      return res.status(400).json({ error: 'dateTo must be a valid ISO date' });
    }

    const pool = await poolPromise;
    const centreExclusion = buildCentreExclusion('c');
    const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
    const cpf = centrePatientFilter('p');
    const cpfPt = centrePatientFilter('pt');

    const userResult = await bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
      SELECT
        au.Id,
        au.FirstName,
        au.LastName,
        au.Email,
        au.LastLoginDateTimeUtc,
        ar.Name AS roleName,
        c.Id    AS centreId,
        c.CentreName
      FROM AdminUser au
      LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
      LEFT JOIN AdminRole ar      ON ar.Id = aur.RoleId
      LEFT JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
      LEFT JOIN Centre c            ON c.Id = auc.CentreId
      WHERE au.Id = @userId
        AND LOWER(au.FirstName) NOT LIKE '%test%'
        AND LOWER(au.LastName)  NOT LIKE '%test%'
        AND LOWER(au.Email)     NOT LIKE '%@webority.com'
      ORDER BY c.CentreName
    `);

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const first = userResult.recordset[0];
    const centresMap = new Map();
    for (const row of userResult.recordset) {
      if (row.centreId != null) {
        centresMap.set(row.centreId, { id: row.centreId, name: row.CentreName });
      }
    }
    const centres = [...centresMap.values()];

    const [
      trendResult,
      breakdownResult,
      recentResult,
      summaryResult,
      activeCasesResult,
    ] = await Promise.all([
      // Daily activity trend (date range or last 30 days)
      bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
        SELECT
          CONVERT(varchar(10), CAST(pal.CreatedDateTime AS DATE), 23) AS date,
          COUNT(*) AS count
        FROM PatientAuditLog pal
        LEFT JOIN Patient p ON p.Id = pal.PatientId
        LEFT JOIN Centre c  ON c.Id = p.CentreId
        WHERE pal.AdminUserId = @userId
          AND ${dateFrom || dateTo ? dateFilterPal : 'pal.CreatedDateTime >= DATEADD(day, -30, GETDATE())'}
          AND (@centreId IS NULL OR p.Id IS NULL OR p.CentreId = @centreId)
          AND (p.Id IS NULL OR ${buildCentreExclusion('c')})
        GROUP BY CAST(pal.CreatedDateTime AS DATE)
        ORDER BY date
      `),

      // Action type breakdown
      bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
        SELECT pal.Type AS type, COUNT(*) AS count
        FROM PatientAuditLog pal
        LEFT JOIN Patient p ON p.Id = pal.PatientId
        LEFT JOIN Centre c  ON c.Id = p.CentreId
        WHERE pal.AdminUserId = @userId
          AND ${dateFilterPal}
          AND (p.Id IS NULL OR (${cpf} AND ${buildCentreExclusion('c')}))
        GROUP BY pal.Type
        ORDER BY count DESC
      `),

      // Recent actions
      bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
        SELECT TOP 50
          pal.CreatedDateTime AS time,
          pal.Type            AS type,
          pal.Description     AS description,
          pal.PatientId       AS patientId,
          c.CentreName        AS centreName
        FROM PatientAuditLog pal
        LEFT JOIN Patient p ON p.Id = pal.PatientId
        LEFT JOIN Centre c  ON c.Id = p.CentreId
        WHERE pal.AdminUserId = @userId
          AND ${dateFilterPal}
          AND (p.Id IS NULL OR (${cpf} AND ${buildCentreExclusion('c')}))
        ORDER BY pal.CreatedDateTime DESC
      `),

      // Role-specific summary (built per role below)
      buildSummaryQuery(pool, role, { userId, centreId, dateFrom, dateTo, centreExclusion, dateFilterPal, cpf, cpfPt }),

      // Active caseload (clinicians only)
      role === 'clinician'
        ? bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
            SELECT
              ap.PatientId       AS patientId,
              ap.Status          AS status,
              pt.CentreId        AS centreId,
              c.CentreName       AS centreName,
              ap.CreatedDateTimeUtc AS assignedAt,
              DATEDIFF(day, ap.CreatedDateTimeUtc, GETDATE()) AS daysSinceAssigned,
              (
                SELECT MAX(pal2.CreatedDateTime)
                FROM PatientAuditLog pal2
                WHERE pal2.PatientId = ap.PatientId AND pal2.AdminUserId = @userId
              ) AS lastAction
            FROM AllocatePatient ap
            JOIN Patient pt ON pt.Id = ap.PatientId
            JOIN Centre c   ON c.Id = pt.CentreId
            WHERE ap.ClinicianUserId = @userId
              AND ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
              AND ${cpfPt}
              AND ${buildCentreExclusion('c')}
            ORDER BY daysSinceAssigned DESC
          `)
        : Promise.resolve({ recordset: [] }),
    ]);

    const summary = mapSummary(role, summaryResult.recordset[0] || {});

    res.json({
      user: {
        id: first.Id,
        firstName: first.FirstName,
        lastName: first.LastName,
        email: first.Email,
        roleName: first.roleName || null,
        lastLoginDate: first.LastLoginDateTimeUtc || null,
        centres,
      },
      role,
      summary,
      trend: trendResult.recordset.map((r) => ({
        date: String(r.date).slice(0, 10),
        count: r.count,
      })),
      actionBreakdown: breakdownResult.recordset.map((r) => ({
        type: r.type,
        count: r.count,
      })),
      recentActions: recentResult.recordset.map((r) => ({
        time: r.time,
        type: r.type,
        description: r.description || null,
        patientId: r.patientId ?? null,
        centreName: r.CentreName || null,
      })),
      activeCases: activeCasesResult.recordset.map((r) => ({
        patientId: r.patientId,
        status: r.status,
        centreId: r.centreId,
        centreName: r.CentreName || null,
        assignedAt: r.assignedAt || null,
        daysSinceAssigned: r.daysSinceAssigned ?? 0,
        lastAction: r.lastAction || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

async function buildSummaryQuery(pool, role, ctx) {
  const { userId, centreId, dateFrom, dateTo, centreExclusion, dateFilterPal, cpf, cpfPt } = ctx;

  if (role === 'clinician') {
    return bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
      SELECT
        ISNULL(rs.reportPdfCreated, 0) AS resultsGenerated,
        ISNULL(rs.scoringComplete, 0) AS scoringComplete,
        ISNULL(rs.reportPdfCreated, 0) AS reportPdfCreated,
        ISNULL(cs.activeCaseload, 0)   AS activeCaseload,
        ISNULL(act.totalAuditActions, 0) AS totalAuditActions,
        ISNULL(act.activeDays, 0) AS activeDays,
        tat.avgTimeToResultHours,
        ISNULL(stuck.stuckCases, 0) AS stuckCases
      FROM AdminUser au
      OUTER APPLY (
        SELECT
          COUNT(DISTINCT CASE WHEN pal2.Type = 'AssessmentResultGenerated' THEN pal2.AllocatePatientId END) AS scoringComplete,
          COUNT(DISTINCT CASE WHEN pal2.Type = 'ReportPDFGenerated' THEN pal2.AllocatePatientId END) AS reportPdfCreated
        FROM PatientAuditLog pal2
        JOIN AllocatePatient ap ON ap.Id = pal2.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre rc          ON rc.Id = pt.CentreId
        WHERE ap.ClinicianUserId = au.Id
          AND pal2.Type IN ('ReportPDFGenerated', 'AssessmentResultGenerated')
          AND pal2.AllocatePatientId IS NOT NULL
          AND ${buildDateFilter('pal2.CreatedDateTime', '@dateFrom', '@dateTo')}
          AND ${cpfPt.replace(/\bpt\b/g, 'pt')}
          AND ${buildCentreExclusion('rc')}
      ) rs
      OUTER APPLY (
        SELECT COUNT(*) AS activeCaseload
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre cc ON cc.Id = pt.CentreId
        WHERE ap.ClinicianUserId = au.Id
          AND ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
          AND ${cpfPt}
          AND ${buildCentreExclusion('cc')}
      ) cs
      OUTER APPLY (
        SELECT
          COUNT(*) AS totalAuditActions,
          COUNT(DISTINCT CAST(pal.CreatedDateTime AS DATE)) AS activeDays
        FROM PatientAuditLog pal
        LEFT JOIN Patient p ON p.Id = pal.PatientId
        WHERE pal.AdminUserId = au.Id
          AND ${dateFilterPal}
          AND (p.Id IS NULL OR ${cpf})
      ) act
      OUTER APPLY (
        SELECT AVG(CAST(DATEDIFF(minute, a.assignedAt, r.resultAt) AS FLOAT) / 60.0) AS avgTimeToResultHours
        FROM (
          SELECT ap.Id AS allocatePatientId, MIN(pal.CreatedDateTime) AS assignedAt
          FROM AllocatePatient ap
          JOIN PatientAuditLog pal ON pal.AllocatePatientId = ap.Id AND pal.Type = 'CaseAssigned'
          JOIN Patient pt ON pt.Id = ap.PatientId
          WHERE ap.ClinicianUserId = au.Id AND ${cpfPt}
          GROUP BY ap.Id
        ) a
        JOIN (
          SELECT pal.AllocatePatientId, MIN(pal.CreatedDateTime) AS resultAt
          FROM PatientAuditLog pal
          JOIN AllocatePatient ap ON ap.Id = pal.AllocatePatientId
          JOIN Patient pt ON pt.Id = ap.PatientId
          WHERE ap.ClinicianUserId = au.Id
            AND pal.Type = 'ReportPDFGenerated'
            AND pal.AllocatePatientId IS NOT NULL
            AND ${cpfPt}
          GROUP BY pal.AllocatePatientId
        ) r ON r.AllocatePatientId = a.allocatePatientId
        WHERE r.resultAt > a.assignedAt
          AND ${dateFrom || dateTo ? `a.assignedAt >= ISNULL(@dateFrom, '1900-01-01') AND a.assignedAt < DATEADD(day, 1, ISNULL(@dateTo, '9999-12-31'))` : '1=1'}
      ) tat
      OUTER APPLY (
        SELECT COUNT(*) AS stuckCases
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        WHERE ap.ClinicianUserId = au.Id
          AND ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
          AND ap.CreatedDateTimeUtc < DATEADD(day, -14, GETDATE())
          AND NOT EXISTS (
            SELECT 1 FROM PatientAuditLog pal3
            WHERE pal3.AllocatePatientId = ap.Id
              AND pal3.Type IN ('ReportPDFGenerated', 'AssessmentResultGenerated')
          )
          AND ${cpfPt}
      ) stuck
      WHERE au.Id = @userId
    `);
  }

  if (role === 'manager') {
    return bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
      SELECT
        SUM(CASE WHEN pal.Type = 'CaseRegistered' AND ${cpf} THEN 1 ELSE 0 END) AS casesRegistered,
        SUM(CASE WHEN pal.Type = 'CaseAssigned'   AND ${cpf} THEN 1 ELSE 0 END) AS assessmentsAssigned,
        SUM(CASE WHEN p.Id IS NOT NULL AND ${cpf} THEN 1 ELSE 0 END) AS totalActions,
        ISNULL(stuck.stuckOnboarding, 0) AS stuckOnboarding,
        onboard.avgOnboardingHours,
        ISNULL(xfers.transfers, 0) AS transfers,
        ISNULL(xfers.statusChanges, 0) AS statusChanges
      FROM AdminUser au
      LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id AND ${dateFilterPal}
      LEFT JOIN Patient p ON p.Id = pal.PatientId
      LEFT JOIN Centre c  ON c.Id = p.CentreId
      OUTER APPLY (
        SELECT COUNT(DISTINCT pal_reg.PatientId) AS stuckOnboarding
        FROM PatientAuditLog pal_reg
        JOIN Patient pt ON pt.Id = pal_reg.PatientId
        WHERE pal_reg.AdminUserId = au.Id
          AND pal_reg.Type = 'CaseRegistered'
          AND pal_reg.CreatedDateTime < DATEADD(hour, -48, SYSDATETIMEOFFSET())
          AND ${cpfPt.replace(/\bpt\b/g, 'pt')}
          AND NOT EXISTS (
            SELECT 1 FROM PatientAuditLog p2
            WHERE p2.PatientId = pal_reg.PatientId AND p2.Type = 'CaseAssigned'
          )
      ) stuck
      OUTER APPLY (
        SELECT AVG(CAST(DATEDIFF(minute, r.registeredAt, a.assignedAt) AS FLOAT) / 60.0) AS avgOnboardingHours
        FROM (
          SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
          FROM PatientAuditLog pal
          JOIN Patient pt ON pt.Id = pal.PatientId
          WHERE pal.AdminUserId = au.Id AND pal.Type = 'CaseRegistered' AND ${cpfPt}
          GROUP BY pal.PatientId
        ) r
        JOIN (
          SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS assignedAt
          FROM PatientAuditLog pal
          WHERE pal.Type = 'CaseAssigned'
          GROUP BY pal.PatientId
        ) a ON a.PatientId = r.PatientId
        WHERE a.assignedAt > r.registeredAt
      ) onboard
      OUTER APPLY (
        SELECT
          SUM(CASE WHEN pal.Type = 'CaseTransfer' THEN 1 ELSE 0 END) AS transfers,
          SUM(CASE WHEN pal.Type = 'CaseStatusChanged' THEN 1 ELSE 0 END) AS statusChanges
        FROM PatientAuditLog pal
        LEFT JOIN Patient p ON p.Id = pal.PatientId
        WHERE pal.AdminUserId = au.Id
          AND pal.Type IN ('CaseTransfer', 'CaseStatusChanged')
          AND ${dateFilterPal}
          AND (p.Id IS NULL OR ${cpf})
      ) xfers
      WHERE au.Id = @userId
      GROUP BY au.Id, stuck.stuckOnboarding, onboard.avgOnboardingHours, xfers.transfers, xfers.statusChanges
    `);
  }

  // centre-admin
  return bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
    SELECT
      SUM(CASE WHEN pal.Type = 'CaseRegistered' AND ${cpf} THEN 1 ELSE 0 END) AS casesRegistered,
      SUM(CASE WHEN pal.Type = 'CaseAssigned'   AND ${cpf} THEN 1 ELSE 0 END) AS casesAssignedToClinical,
      SUM(CASE WHEN p.Id IS NOT NULL AND ${cpf} THEN 1 ELSE 0 END) AS totalActions,
      route.avgRoutingHours,
      ISNULL(sameDay.sameDayRoutingPct, 0) AS sameDayRoutingPct
    FROM AdminUser au
    LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id AND ${dateFilterPal}
    LEFT JOIN Patient p ON p.Id = pal.PatientId
    LEFT JOIN Centre c  ON c.Id = p.CentreId
    OUTER APPLY (
      SELECT AVG(CAST(DATEDIFF(minute, r.registeredAt, a.assignedAt) AS FLOAT) / 60.0) AS avgRoutingHours
      FROM (
        SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        WHERE pal.AdminUserId = au.Id AND pal.Type = 'CaseRegistered' AND ${cpfPt}
        GROUP BY pal.PatientId
      ) r
      JOIN (
        SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS assignedAt
        FROM PatientAuditLog pal
        WHERE pal.Type = 'CaseAssigned'
        GROUP BY pal.PatientId
      ) a ON a.PatientId = r.PatientId
      WHERE a.assignedAt > r.registeredAt
    ) route
    OUTER APPLY (
      SELECT
        CASE WHEN COUNT(*) = 0 THEN 0
        ELSE CAST(SUM(CASE WHEN DATEDIFF(hour, r.registeredAt, a.assignedAt) <= 24 THEN 1 ELSE 0 END) AS FLOAT)
             / COUNT(*) * 100
        END AS sameDayRoutingPct
      FROM (
        SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        WHERE pal.AdminUserId = au.Id AND pal.Type = 'CaseRegistered' AND ${cpfPt}
          AND ${dateFilterPal.replace(/pal\./g, 'pal.')}
        GROUP BY pal.PatientId
      ) r
      JOIN (
        SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS assignedAt
        FROM PatientAuditLog pal
        WHERE pal.Type = 'CaseAssigned'
        GROUP BY pal.PatientId
      ) a ON a.PatientId = r.PatientId
      WHERE a.assignedAt > r.registeredAt
    ) sameDay
    WHERE au.Id = @userId
    GROUP BY au.Id, route.avgRoutingHours, sameDay.sameDayRoutingPct
  `);
}

function mapSummary(role, row) {
  if (role === 'clinician') {
    const results = row.resultsGenerated ?? 0;
    const caseload = row.activeCaseload ?? 0;
    const denom = results + caseload;
    return {
      resultsGenerated: results,
      activeCaseload: caseload,
      yield: denom > 0 ? Math.round((results / denom) * 100) : null,
      totalAuditActions: row.totalAuditActions ?? 0,
      activeDays: row.activeDays ?? 0,
      avgTimeToResultHours: row.avgTimeToResultHours != null ? Math.round(row.avgTimeToResultHours * 10) / 10 : null,
      stuckCases: row.stuckCases ?? 0,
    };
  }

  if (role === 'manager') {
    const registered = row.casesRegistered ?? 0;
    const assigned = row.assessmentsAssigned ?? 0;
    return {
      casesRegistered: registered,
      assessmentsAssigned: assigned,
      handoffRate: registered > 0 ? Math.round((assigned / registered) * 100) : null,
      totalActions: row.totalActions ?? 0,
      stuckOnboarding: row.stuckOnboarding ?? 0,
      avgOnboardingHours: row.avgOnboardingHours != null ? Math.round(row.avgOnboardingHours * 10) / 10 : null,
      transfers: row.transfers ?? 0,
      statusChanges: row.statusChanges ?? 0,
    };
  }

  const registered = row.casesRegistered ?? 0;
  const assigned = row.casesAssignedToClinical ?? 0;
  return {
    casesRegistered: registered,
    casesAssignedToClinical: assigned,
    routingRate: registered > 0 ? Math.round((assigned / registered) * 100) : null,
    totalActions: row.totalActions ?? 0,
    avgRoutingHours: row.avgRoutingHours != null ? Math.round(row.avgRoutingHours * 10) / 10 : null,
    sameDayRoutingPct: row.sameDayRoutingPct != null ? Math.round(row.sameDayRoutingPct) : null,
  };
}

module.exports = router;
