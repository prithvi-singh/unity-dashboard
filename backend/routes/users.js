'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');

const router = Router();

const { getCoreMetrics } = require('../services/metricsService');

const VALID_ROLES = new Set(['clinician', 'manager', 'centre-admin']);

// ── User exclusion filter (shared across routes) ──────────────────────────────
// Includes both @webority.com and @mailinator.com dev/test accounts.
const USER_EXCLUSION = `
  LOWER(au.FirstName) NOT LIKE '%test%'
  AND LOWER(au.LastName)  NOT LIKE '%test%'
  AND LOWER(au.Email)     NOT LIKE '%@webority.com'
  AND LOWER(au.Email)     NOT LIKE '%@mailinator.com'
`;

// ── Core job definitions ──────────────────────────────────────────────────────
const CORE_JOB_EVENTS = {
  clinician:      new Set(['AssessmentResultGenerated', 'ReportAdded', 'UpdateReport', 'GoalAdded', 'ActivityAdded']),
  manager:        new Set(['ReportPDFGenerated', 'GoalAdded', 'GoalUpdated', 'ActivityAdded', 'CaseRegistered']),
  'centre-admin': new Set(['CaseRegistered', 'CaseAssigned']),
};

const CORE_JOB_DEFINITION = {
  clinician:      'Score assessments · draft reports · add goals · case history',
  manager:        'Approve reports · approve goals · case history · register cases',
  'centre-admin': 'Register cases · assign clinicians',
};

const EVENT_LABELS = {
  AssessmentResultGenerated: 'Assessment scored',
  AssessmentStatusChanged:   'Assessment status updated',
  ReportAdded:               'Report drafted',
  UpdateReport:              'Report edited',
  ReportPDFGenerated:        'Report approved',
  GoalAdded:                 'Goal added',
  GoalUpdated:               'Goal updated',
  CaseRegistered:            'Case registered',
  CaseAssigned:              'Clinician assigned',
  CaseTransfer:              'Assessment transferred',
  BaselineAdded:             'Baseline added',
  ProgressAdded:             'Progress noted',
  ActivityAdded:             'Case history updated',
  AssessmentAdd:             'Assessment added',
};

function translateEvent(type) {
  if (!type) return 'Unknown action';
  return EVENT_LABELS[type] ?? type.replace(/([A-Z])/g, ' $1').trim();
}

/**
 * Count Mon–Fri working days between two Date boundaries (inclusive).
 *
 * Uses UTC noon for all comparisons so the function is robust to any timezone
 * stored in the Date objects (parseDateParam now returns IST midnight, which is
 * UTC-18:30 of the same calendar day — iterating with setUTCDate + comparing
 * UTC noon values keeps us on the correct calendar day regardless).
 */
function countWorkingDays(from, to) {
  const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const end   = to   ? new Date(to)   : new Date();
  let count = 0;
  const d = new Date(start);
  // Normalise to UTC noon so the day-of-week and date arithmetic are unambiguous
  // regardless of what timezone the input Date objects carry.
  d.setUTCHours(12, 0, 0, 0);
  const endNoon = new Date(end);
  endNoon.setUTCHours(12, 0, 0, 0);
  while (d <= endNoon) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

function calcConsistencyStatus(pct) {
  if (pct === 0)  return 'silent';
  if (pct < 30)   return 'inactive';
  if (pct < 70)   return 'irregular';
  return 'consistent';
}

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
 * SuperAdmin role is excluded from all counts and user lists.
 */
router.get('/breakdown', async (req, res, next) => {
  try {
    const filters = parseBreakdownFilters(req);
    const { centreId, dateFrom, dateTo } = filters;
    const pool = await poolPromise;
    const centreExclusion = buildCentreExclusion('c');
    const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

    const superAdminExclusion = `(ar.Name IS NULL OR ar.Name NOT IN ('SuperAdmin', 'Super Admin'))`;

    const centreScope = `
      AND (@centreId IS NULL OR EXISTS (
        SELECT 1
        FROM AdminUserCentre auc_f
        JOIN Centre c_f ON c_f.Id = auc_f.CentreId
        WHERE auc_f.AdminUserId = au.Id
          AND c_f.Id = @centreId
          AND ${buildCentreExclusion('c_f')}
      ))`;

    const userStatsCtes = `
      WITH period_counts AS (
        SELECT pal.AdminUserId AS userId, COUNT(*) AS actionsInPeriod
        FROM PatientAuditLog pal
        WHERE ${dateFilterPal}
        GROUP BY pal.AdminUserId
      ),
      last_seen AS (
        SELECT pal.AdminUserId AS userId, MAX(pal.CreatedDateTime) AS lastActivityDate
        FROM PatientAuditLog pal
        GROUP BY pal.AdminUserId
      )`;

    // Totals, byRole, and byCentre come from the shared metrics service.
    // Drawer-specific lists (per-user detail, recentlyInactive, neverActive)
    // remain as dedicated queries here since they're unique to this endpoint.
    const [
      metrics,
      recentlyInactiveResult,
      neverActiveResult,
      usersForRolesResult,
      usersForCentresResult,
    ] = await Promise.all([

      // Shared metrics — totals + byRole + byCentre
      getCoreMetrics({ dateFrom, dateTo, centreId }),

      // Recently inactive (>30 days, SuperAdmin excluded)
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
          AND ${superAdminExclusion}
          ${centreScope}
        GROUP BY au.Id, au.FirstName, au.LastName, au.Email, ar.Name, au.LastLoginDateTimeUtc
        HAVING MAX(pal.CreatedDateTime) < DATEADD(day, -30, SYSDATETIMEOFFSET())
        ORDER BY daysSinceActive DESC
      `),

      // Never active (zero audit history, SuperAdmin excluded)
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
          AND ${superAdminExclusion}
          ${centreScope}
          AND NOT EXISTS (
            SELECT 1 FROM PatientAuditLog pal WHERE pal.AdminUserId = au.Id
          )
        GROUP BY au.Id, au.FirstName, au.LastName, au.Email, ar.Name
        ORDER BY MAX(au.CreatedDateTimeUtc) DESC
      `),

      // Full user list for role drawers
      bindBreakdownParams(pool.request(), filters).query(`
        ${userStatsCtes}
        SELECT
          au.Id              AS id,
          au.FirstName       AS firstName,
          au.LastName        AS lastName,
          au.Email           AS email,
          ISNULL(ar.Name, 'Unassigned') AS roleName,
          MAX(c.CentreName)  AS centreName,
          ISNULL(pc.actionsInPeriod, 0) AS actionsInPeriod,
          ls.lastActivityDate,
          au.LastLoginDateTimeUtc AS lastLoginDate
        FROM AdminUser au
        LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
        LEFT JOIN AdminRole ar ON ar.Id = aur.RoleId
        LEFT JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        LEFT JOIN Centre c ON c.Id = auc.CentreId
        LEFT JOIN period_counts pc ON pc.userId = au.Id
        LEFT JOIN last_seen ls ON ls.userId = au.Id
        WHERE ${USER_EXCLUSION}
          AND ${superAdminExclusion}
          ${centreScope}
          AND (c.Id IS NULL OR ${centreExclusion})
        GROUP BY au.Id, au.FirstName, au.LastName, au.Email, ar.Name,
                 au.LastLoginDateTimeUtc, pc.actionsInPeriod, ls.lastActivityDate
        ORDER BY ISNULL(ar.Name, 'Unassigned'), au.LastName, au.FirstName
      `),

      // Full user list for centre drawers
      bindBreakdownParams(pool.request(), filters).query(`
        ${userStatsCtes}
        SELECT
          au.Id              AS id,
          au.FirstName       AS firstName,
          au.LastName        AS lastName,
          au.Email           AS email,
          ISNULL(MAX(ar.Name), 'Unassigned') AS roleName,
          c.Id               AS centreId,
          c.CentreName       AS centreName,
          ISNULL(MAX(pc.actionsInPeriod), 0) AS actionsInPeriod,
          MAX(ls.lastActivityDate) AS lastActivityDate,
          au.LastLoginDateTimeUtc AS lastLoginDate,
          CASE WHEN MAX(ls.lastActivityDate) IS NULL THEN 1 ELSE 0 END AS neverActive
        FROM AdminUser au
        LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
        LEFT JOIN AdminRole ar ON ar.Id = aur.RoleId
        JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        JOIN Centre c ON c.Id = auc.CentreId
        LEFT JOIN period_counts pc ON pc.userId = au.Id
        LEFT JOIN last_seen ls ON ls.userId = au.Id
        WHERE ${USER_EXCLUSION}
          AND ${superAdminExclusion}
          AND ${centreExclusion}
          AND (@centreId IS NULL OR c.Id = @centreId)
        GROUP BY au.Id, au.FirstName, au.LastName, au.Email, c.Id, c.CentreName,
                 au.LastLoginDateTimeUtc
        ORDER BY c.CentreName, ISNULL(MAX(pc.actionsInPeriod), 0) DESC
      `),
    ]);

    // Use shared metrics for totals and breakdowns
    const { users: mu } = metrics;

    // Build role → user lists map
    const roleUsersMap = new Map();
    for (const u of usersForRolesResult.recordset) {
      const key = u.roleName;
      if (!roleUsersMap.has(key)) roleUsersMap.set(key, { active: [], quiet: [] });
      const user = {
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        centreName: abbreviateCentre(u.centreName) || null,
        actionsInPeriod: u.actionsInPeriod,
        lastActivityDate: u.lastActivityDate || null,
        lastLoginDate: u.lastLoginDate || null,
      };
      if (u.actionsInPeriod > 0) roleUsersMap.get(key).active.push(user);
      else roleUsersMap.get(key).quiet.push(user);
    }

    // Sort role user lists
    for (const lists of roleUsersMap.values()) {
      lists.active.sort((a, b) => b.actionsInPeriod - a.actionsInPeriod);
      lists.quiet.sort((a, b) => {
        const ta = a.lastActivityDate ? new Date(a.lastActivityDate).getTime() : 0;
        const tb = b.lastActivityDate ? new Date(b.lastActivityDate).getTime() : 0;
        return tb - ta;
      });
    }

    // Build centreId → user lists map
    const centreUsersMap = new Map();
    for (const u of usersForCentresResult.recordset) {
      const key = u.centreId;
      if (!centreUsersMap.has(key)) centreUsersMap.set(key, { active: [], quiet: [] });
      const user = {
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        roleName: u.roleName,
        actionsInPeriod: u.actionsInPeriod,
        lastActivityDate: u.lastActivityDate || null,
        lastLoginDate: u.lastLoginDate || null,
        neverActive: u.neverActive === 1,
      };
      if (u.actionsInPeriod > 0) centreUsersMap.get(key).active.push(user);
      else centreUsersMap.get(key).quiet.push(user);
    }

    // Sort centre user lists
    for (const lists of centreUsersMap.values()) {
      lists.active.sort((a, b) => b.actionsInPeriod - a.actionsInPeriod);
      lists.quiet.sort((a, b) => {
        const ta = a.lastActivityDate ? new Date(a.lastActivityDate).getTime() : 0;
        const tb = b.lastActivityDate ? new Date(b.lastActivityDate).getTime() : 0;
        return tb - ta;
      });
    }

    res.json({
      // ── Totals + byRole + byCentre from shared metrics service ─────────────
      total:   mu.total,
      dateFrom: req.query.dateFrom ?? null,
      dateTo:   req.query.dateTo   ?? null,
      byRole: mu.byRole.map((r) => {
        const users = roleUsersMap.get(r.roleName) || { active: [], quiet: [] };
        return {
          roleName:     r.roleName,
          total:        r.total,
          active:       r.active,
          quiet:        r.quiet,
          activePercent: r.total > 0 ? Math.round((r.active / r.total) * 100) : 0,
          activeUsers:  users.active,
          quietUsers:   users.quiet,
        };
      }),
      byStatus: { active: mu.active, inactive: mu.quiet },
      byCentre: mu.byCentre.map((r) => {
        const users = centreUsersMap.get(r.centreId) || { active: [], quiet: [] };
        return {
          centreId:     r.centreId,
          centreName:   abbreviateCentre(r.centreName),
          total:        r.total,
          clinicians:   r.clinicians,
          managers:     r.managers,
          active:       r.active,
          quiet:        r.quiet,
          activePercent: r.total > 0 ? Math.round((r.active / r.total) * 100) : 0,
          activeUsers:  users.active,
          quietUsers:   users.quiet,
        };
      }),
      // ── Drawer-specific lists (not in shared service) ──────────────────────
      recentlyInactive: recentlyInactiveResult.recordset.map((r) => ({
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        roleName: r.roleName,
        centreName: abbreviateCentre(r.centreName) || null,
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
        centreName: abbreviateCentre(r.centreName) || null,
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

    // Collect all distinct centres for this user
    const centresMap = new Map();
    for (const row of userResult.recordset) {
      if (row.centreId != null) {
        centresMap.set(row.centreId, { centreId: row.centreId, centreName: abbreviateCentre(row.CentreName) });
      }
    }
    const centres = [...centresMap.values()];
    const centreName = centres.length > 0 ? centres[0].centreName : null;

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

      // Recent activity (last 20) — includes full patient name and display ID.
      // Test patients are excluded so "test" entries never surface in the drawer.
      pool.request()
        .input('userId', sql.BigInt, userId)
        .query(`
          SELECT TOP 20
            pal.CreatedDateTime                                                      AS date,
            pal.Type                                                                 AS type,
            ISNULL(pal.Description, pal.Type)                                        AS description,
            pal.PatientId                                                            AS patientId,
            NULLIF(LTRIM(RTRIM(ISNULL(pt.FirstName, '') + ' ' + ISNULL(pt.LastName, ''))), '') AS patientName,
            pt.PatientID                                                             AS patientDisplayId
          FROM PatientAuditLog pal
          LEFT JOIN Patient pt ON pt.Id = pal.PatientId
          WHERE pal.AdminUserId = @userId
            AND (pt.Id IS NULL OR (
              pt.FirstName NOT LIKE '%test%'
              AND pt.LastName  NOT LIKE '%test%'
            ))
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

      // Active + total caseload — clinician only.
      // Joins Patient and Centre so test patient / deleted centre rows are excluded,
      // matching the same filter contract used by activeCaseloadWhere() and the
      // clinician-caseload drill-down in roleDrillDown.js.
      isClinician
        ? pool.request()
            .input('userId', sql.BigInt, userId)
            .query(`
              SELECT
                SUM(CASE WHEN ap.Status IN ('NotStarted', 'InProgress', 'OnHold') THEN 1 ELSE 0 END) AS activeCaseload,
                COUNT(*) AS totalCasesAllTime
              FROM AllocatePatient ap
              JOIN Patient pt ON pt.Id = ap.PatientId
              JOIN Centre c   ON c.Id  = pt.CentreId
              WHERE ap.ClinicianUserId = @userId
                AND pt.FirstName NOT LIKE '%test%'
                AND pt.LastName  NOT LIKE '%test%'
                AND LOWER(c.CentreName) NOT LIKE '%test%'
                AND LOWER(c.CentreName) NOT LIKE '%delete%'
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
      centres,
      lastLoginDate: first.LastLoginDateTimeUtc
        ? (first.LastLoginDateTimeUtc instanceof Date
            ? first.LastLoginDateTimeUtc.toISOString()
            : new Date(first.LastLoginDateTimeUtc).toISOString())
        : null,
      lastActivityDate: act.lastActivityDate
        ? (act.lastActivityDate instanceof Date
            ? act.lastActivityDate.toISOString()
            : new Date(act.lastActivityDate).toISOString())
        : null,
      totalAuditActions: act.totalAuditActions ?? 0,
      recentActivity: recentResult.recordset.map((r) => {
        const dt = r.date instanceof Date ? r.date : new Date(r.date);
        const iso = isNaN(dt.getTime()) ? null : dt.toISOString();
        return {
          isoDateTime: iso,
          date: iso ? iso.slice(0, 10) : null,
          time: iso ? iso.slice(11, 16) : null,
          type: r.type,
          description: r.description || null,
          patientId: r.patientId ?? null,
          patientName: r.patientName || null,
          patientDisplayId: r.patientDisplayId || null,
        };
      }),
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
        centresMap.set(row.centreId, { id: row.centreId, name: abbreviateCentre(row.CentreName) });
      }
    }
    const centres = [...centresMap.values()];

    // Build core-job IN clause for this role (safe — validated against VALID_ROLES)
    const coreJobEvents = CORE_JOB_EVENTS[role] || new Set();
    const coreJobSqlIn  = coreJobEvents.size
      ? [...coreJobEvents].map((t) => `'${t}'`).join(', ')
      : "'__NONE__'";

    const [
      activityByDayResult,
      recentResult,
      summaryResult,
      activeCasesResult,
      activityCountResult,
    ] = await Promise.all([
      // Per-day activity with core-job indicators (replaces raw trend)
      bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
        SELECT
          CONVERT(varchar(10), CAST(pal.CreatedDateTime AS DATE), 23) AS date,
          COUNT(*) AS totalActions,
          SUM(CASE WHEN pal.Type IN (${coreJobSqlIn}) THEN 1 ELSE 0 END) AS coreJobCount,
          SUM(CASE WHEN pal.Type = 'AssessmentResultGenerated' THEN 1 ELSE 0 END) AS assessmentsScored,
          SUM(CASE WHEN pal.Type IN ('ReportAdded', 'UpdateReport') THEN 1 ELSE 0 END) AS reportsDrafted,
          SUM(CASE WHEN pal.Type IN ('GoalAdded', 'GoalUpdated') THEN 1 ELSE 0 END) AS goalsAdded,
          SUM(CASE WHEN pal.Type = 'ReportPDFGenerated' THEN 1 ELSE 0 END) AS reportsApproved,
          SUM(CASE WHEN pal.Type = 'CaseRegistered' THEN 1 ELSE 0 END) AS casesRegistered,
          SUM(CASE WHEN pal.Type = 'CaseAssigned' THEN 1 ELSE 0 END) AS cliniciansAssigned,
          SUM(CASE WHEN pal.Type IN ('ActivityAdded', 'BaselineAdded', 'ProgressAdded') THEN 1 ELSE 0 END) AS caseHistory
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

      // Recent actions — with full patient name, test-patient filtered, assessment type
      bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
        SELECT TOP 100
          pal.CreatedDateTime AS time,
          pal.Type            AS type,
          pal.PatientId       AS patientId,
          NULLIF(LTRIM(RTRIM(ISNULL(pt.FirstName, '') + ' ' + ISNULL(pt.LastName, ''))), '') AS patientName,
          c.CentreName        AS centreName,
          ap.Assessment       AS assessmentType
        FROM PatientAuditLog pal
        LEFT JOIN Patient pt          ON pt.Id = pal.PatientId
        LEFT JOIN Centre c            ON c.Id = pt.CentreId
        LEFT JOIN AllocatePatient ap  ON ap.Id = pal.AllocatePatientId
        WHERE pal.AdminUserId = @userId
          AND ${dateFilterPal}
          AND (pt.Id IS NULL OR (
            LOWER(pt.FirstName) NOT LIKE '%test%'
            AND LOWER(pt.LastName) NOT LIKE '%test%'
          ))
          AND (@centreId IS NULL OR pt.Id IS NULL OR pt.CentreId = @centreId)
          AND (pt.Id IS NULL OR ${buildCentreExclusion('c')})
        ORDER BY pal.CreatedDateTime DESC
      `),

      // Role-specific summary (core metrics)
      buildSummaryQuery(pool, role, { userId, centreId, dateFrom, dateTo, centreExclusion, dateFilterPal, cpf, cpfPt }),

      // Active caseload (clinicians only) — with patient name, assessment type, and pipeline state.
      role === 'clinician'
        ? bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
            SELECT
              ap.PatientId       AS patientId,
              NULLIF(LTRIM(RTRIM(ISNULL(pt.FirstName, '') + ' ' + ISNULL(pt.LastName, ''))), '') AS patientName,
              ap.Assessment      AS assessmentType,
              ap.Status          AS status,
              pt.CentreId        AS centreId,
              c.CentreName       AS centreName,
              ap.CreatedDateTimeUtc AS assignedAt,
              DATEDIFF(day, ap.CreatedDateTimeUtc, GETDATE()) AS daysSinceAssigned,
              (
                SELECT MAX(pal2.CreatedDateTime)
                FROM PatientAuditLog pal2
                WHERE pal2.PatientId = ap.PatientId AND pal2.AdminUserId = @userId
              ) AS lastAction,
              -- Pipeline state classification signals
              CASE WHEN EXISTS (
                SELECT 1 FROM PatientAuditLog pal
                WHERE pal.AllocatePatientId = ap.Id
                  AND pal.Type = 'AssessmentResultGenerated'
              ) THEN 1 ELSE 0 END AS scoringDone,
              CASE WHEN EXISTS (
                SELECT 1 FROM PatientAuditLog pal
                WHERE pal.AllocatePatientId = ap.Id
                  AND pal.Type IN ('ReportAdded','ReportPDFGenerated')
              ) THEN 1 ELSE 0 END AS hasReport,
              CASE WHEN EXISTS (
                SELECT 1 FROM PatientAuditLog pal
                WHERE pal.AllocatePatientId = ap.Id
                  AND pal.Type = 'AssessmentResultGenerated'
              ) THEN 1 ELSE 0 END AS reportApproved,
              CASE WHEN EXISTS (
                SELECT 1 FROM PatientGoalApprovalRequestGoal pgar
                JOIN PatientGoalApprovalRequest pga ON pga.Id = pgar.PatientGoalApprovalRequestId
                WHERE pga.AllocatePatientId = ap.Id
                  AND pgar.Status = 'Approved'
              ) THEN 1 ELSE 0 END AS goalsApproved,
              CASE WHEN (
                EXISTS (
                  SELECT 1 FROM PatientAuditLog pal
                  WHERE pal.AllocatePatientId = ap.Id AND pal.Type = 'ReportAdded'
                ) AND NOT EXISTS (
                  SELECT 1 FROM PatientAuditLog pal
                  WHERE pal.AllocatePatientId = ap.Id AND pal.Type = 'AssessmentResultGenerated'
                )
              ) OR (
                EXISTS (
                  SELECT 1 FROM PatientAuditLog pal
                  WHERE pal.AllocatePatientId = ap.Id AND pal.Type = 'GoalsAdded'
                ) AND NOT EXISTS (
                  SELECT 1 FROM PatientGoalApprovalRequestGoal pgar
                  JOIN PatientGoalApprovalRequest pga ON pga.Id = pgar.PatientGoalApprovalRequestId
                  WHERE pga.AllocatePatientId = ap.Id AND pgar.Status = 'Approved'
                )
              ) THEN 1 ELSE 0 END AS pendingApproval
            FROM AllocatePatient ap
            JOIN Patient pt ON pt.Id = ap.PatientId
            JOIN Centre c   ON c.Id = pt.CentreId
            WHERE ap.ClinicianUserId = @userId
              AND ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
              AND ${cpfPt}
              AND ${buildCentreExclusion('c')}
              AND pt.FirstName NOT LIKE '%test%'
              AND pt.LastName  NOT LIKE '%test%'
            ORDER BY daysSinceAssigned DESC
          `)
        : Promise.resolve({ recordset: [] }),

      // Period-wide action counts (supplementary metrics not in the summary query)
      bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
        SELECT
          SUM(CASE WHEN pal.Type = 'ReportAdded'               THEN 1 ELSE 0 END) AS reportsDrafted,
          SUM(CASE WHEN pal.Type = 'GoalAdded'                 THEN 1 ELSE 0 END) AS goalsAdded,
          SUM(CASE WHEN pal.Type = 'ActivityAdded'             THEN 1 ELSE 0 END) AS caseHistoryCompleted,
          SUM(CASE WHEN pal.Type = 'ReportPDFGenerated'        THEN 1 ELSE 0 END) AS reportsApproved,
          SUM(CASE WHEN pal.Type = 'AssessmentResultGenerated' THEN 1 ELSE 0 END) AS assessmentsScored
        FROM PatientAuditLog pal
        LEFT JOIN Patient p ON p.Id = pal.PatientId
        WHERE pal.AdminUserId = @userId
          AND ${dateFilterPal}
          AND (@centreId IS NULL OR p.Id IS NULL OR p.CentreId = @centreId)
      `),
    ]);

    const coreMetrics = mapCoreMetrics(role, summaryResult.recordset[0] || {}, activityCountResult.recordset[0] || {});

    // Build activityByDay array
    const activityByDay = activityByDayResult.recordset.map((r) => ({
      date:         String(r.date).slice(0, 10),
      didCoreJob:   r.coreJobCount > 0,
      coreJobCount: r.coreJobCount,
      totalActions: r.totalActions,
      breakdown: {
        assessmentsScored:  r.assessmentsScored,
        reportsDrafted:     r.reportsDrafted,
        goalsAdded:         r.goalsAdded,
        reportsApproved:    r.reportsApproved,
        goalsApproved:      0,
        casesRegistered:    r.casesRegistered,
        cliniciansAssigned: r.cliniciansAssigned,
        caseHistory:        r.caseHistory,
      },
    }));

    // Consistency score
    const totalWorkingDays   = countWorkingDays(dateFrom, dateTo);
    const coreJobDays        = activityByDay.filter((d) => d.didCoreJob).length;
    const consistencyPercent = totalWorkingDays > 0
      ? Math.round((coreJobDays / totalWorkingDays) * 100)
      : 0;
    const consistencyScore = {
      totalWorkingDays,
      coreJobDays,
      consistencyPercent,
      status: calcConsistencyStatus(consistencyPercent),
    };

    // Primary centre name
    const primaryCentreName = centres.length > 0
      ? centres.find((c) => c.id === centreId)?.name ?? centres[0].name
      : null;

    res.json({
      user: {
        id: first.Id,
        firstName: first.FirstName,
        lastName: first.LastName,
        email: first.Email,
        roleName: first.roleName || null,
        lastLoginDate: first.LastLoginDateTimeUtc || null,
        centres,
        centreName: primaryCentreName,
      },
      role,
      coreJobDefinition: CORE_JOB_DEFINITION[role] || '',
      consistencyScore,
      coreMetrics,
      activityByDay,
      recentActions: recentResult.recordset.map((r) => {
        const dt  = r.time instanceof Date ? r.time : new Date(r.time);
        const iso = isNaN(dt.getTime()) ? null : dt.toISOString();
        return {
          isoDateTime:    iso,
          date:           iso ? iso.slice(0, 10) : null,
          time:           iso ? iso.slice(11, 16) : null,
          eventType:      translateEvent(r.type),
          rawType:        r.type || null,
          assessmentType: r.assessmentType || null,
          patientName:    r.patientName || null,
          patientId:      r.patientId != null ? String(r.patientId) : null,
          centreName:     abbreviateCentre(r.centreName) || null,
          isCoreJob:      coreJobEvents.has(r.type),
        };
      }),
      activeCases: activeCasesResult.recordset.map((r) => {
        // Derive pipeline state label from signals
        let pipelineState = 'in_progress';
        if (r.goalsApproved)         pipelineState = 'completed';
        else if (r.pendingApproval)  pipelineState = r.hasReport ? 'goals_pending_approval' : 'report_pending_approval';
        else if (r.reportApproved)   pipelineState = 'goals_not_added';
        else if (r.hasReport)        pipelineState = 'report_not_drafted';
        else if (r.scoringDone)      pipelineState = 'report_not_drafted';
        else if (r.status === 'NotStarted') pipelineState = 'not_started';

        return {
          patientId:         r.patientId,
          patientName:       r.patientName || null,
          assessmentType:    r.assessmentType || null,
          status:            r.status,
          pipelineState,
          centreId:          r.centreId,
          centreName:        abbreviateCentre(r.centreName) || null,
          assignedAt:        r.assignedAt || null,
          daysSinceAssigned: r.daysSinceAssigned ?? 0,
          lastAction:        r.lastAction || null,
        };
      }),
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
        ISNULL(rs.scoringComplete, 0) AS assessmentsScored,
        ISNULL(cs.activeCaseload, 0)  AS activeCaseload,
        ISNULL(cs.totalCases, 0)      AS totalCases,
        ISNULL(cs.completedCases, 0)  AS completedCases,
        tat.avgDaysToResult,
        ISNULL(stuck.stuckCases, 0)   AS stuckCases
      FROM AdminUser au
      OUTER APPLY (
        SELECT
          COUNT(DISTINCT CASE WHEN pal2.Type = 'AssessmentResultGenerated' THEN pal2.AllocatePatientId END) AS scoringComplete
        FROM PatientAuditLog pal2
        JOIN AllocatePatient ap ON ap.Id = pal2.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre rc          ON rc.Id = pt.CentreId
        WHERE ap.ClinicianUserId = au.Id
          AND pal2.Type = 'AssessmentResultGenerated'
          AND pal2.AllocatePatientId IS NOT NULL
          AND ${buildDateFilter('pal2.CreatedDateTime', '@dateFrom', '@dateTo')}
          AND ${cpfPt.replace(/\bpt\b/g, 'pt')}
          AND ${buildCentreExclusion('rc')}
      ) rs
      OUTER APPLY (
        SELECT
          COUNT(*) AS totalCases,
          SUM(CASE WHEN ap.Status NOT IN ('NotStarted', 'InProgress', 'OnHold') THEN 1 ELSE 0 END) AS completedCases,
          SUM(CASE WHEN ap.Status IN ('NotStarted', 'InProgress', 'OnHold') THEN 1 ELSE 0 END) AS activeCaseload
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre cc  ON cc.Id = pt.CentreId
        WHERE ap.ClinicianUserId = au.Id
          AND ${cpfPt}
          AND ${buildCentreExclusion('cc')}
      ) cs
      OUTER APPLY (
        SELECT AVG(CAST(DATEDIFF(day, a.assignedAt, r.resultAt) AS FLOAT)) AS avgDaysToResult
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
            AND pal.Type = 'AssessmentResultGenerated'
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
              AND pal3.Type = 'AssessmentResultGenerated'
          )
          AND ${cpfPt}
      ) stuck
      OUTER APPLY (
        SELECT
          -- scoring: assigned but no AssessmentResultGenerated, not completed
          COUNT(CASE WHEN ap.Status NOT IN ('Completed')
            AND NOT EXISTS (
              SELECT 1 FROM PatientAuditLog pal4
              WHERE pal4.AllocatePatientId = ap.Id AND pal4.Type = 'AssessmentResultGenerated'
            )
            THEN 1 END) AS plScoring,
          -- reportsToWrite: result generated but no ReportAdded
          COUNT(CASE WHEN ap.Status NOT IN ('Completed')
            AND EXISTS (
              SELECT 1 FROM PatientAuditLog pal4
              WHERE pal4.AllocatePatientId = ap.Id AND pal4.Type = 'AssessmentResultGenerated'
            )
            AND NOT EXISTS (
              SELECT 1 FROM PatientAuditLog pal4
              WHERE pal4.AllocatePatientId = ap.Id AND pal4.Type = 'ReportAdded'
            )
            THEN 1 END) AS plReportsToWrite,
          -- goalsToAdd: ReportPDFGenerated but no goal request (and no approved goal)
          COUNT(CASE WHEN ap.Status NOT IN ('Completed')
            AND EXISTS (
              SELECT 1 FROM PatientAuditLog pal4
              WHERE pal4.AllocatePatientId = ap.Id AND pal4.Type = 'ReportPDFGenerated'
            )
            AND NOT EXISTS (
              SELECT 1 FROM PatientGoalApprovalRequest pgar6
              WHERE pgar6.AllocatePatientId = ap.Id
            )
            AND NOT EXISTS (
              SELECT 1 FROM PatientGoalApprovalRequest pgar7
              JOIN PatientGoalApprovalRequestGoal pgarg7 ON pgarg7.PatientGoalApprovalRequestId = pgar7.Id
              WHERE pgar7.AllocatePatientId = ap.Id AND pgarg7.Status = 'Approved'
            )
            THEN 1 END) AS plGoalsToAdd,
          -- pendingApproval: report or goals awaiting manager action
          COUNT(CASE WHEN ap.Status NOT IN ('Completed')
            AND (
              (EXISTS (SELECT 1 FROM PatientAuditLog pal4 WHERE pal4.AllocatePatientId = ap.Id AND pal4.Type = 'ReportAdded')
               AND NOT EXISTS (SELECT 1 FROM PatientAuditLog pal4 WHERE pal4.AllocatePatientId = ap.Id AND pal4.Type = 'ReportPDFGenerated'))
              OR
              (EXISTS (SELECT 1 FROM PatientGoalApprovalRequest pgar8 WHERE pgar8.AllocatePatientId = ap.Id)
               AND NOT EXISTS (
                  SELECT 1 FROM PatientGoalApprovalRequest pgar9
                  JOIN PatientGoalApprovalRequestGoal pgarg9 ON pgarg9.PatientGoalApprovalRequestId = pgar9.Id
                  WHERE pgar9.AllocatePatientId = ap.Id AND pgarg9.Status = 'Approved'
               ))
            )
            THEN 1 END) AS plPendingApproval
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        WHERE ap.ClinicianUserId = au.Id
          AND ${cpfPt}
      ) pl
      WHERE au.Id = @userId
    `);
  }

  if (role === 'manager') {
    return bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
      SELECT
        SUM(CASE WHEN pal.Type = 'CaseRegistered'    AND ${cpf} THEN 1 ELSE 0 END) AS casesRegistered,
        SUM(CASE WHEN pal.Type = 'ReportPDFGenerated' AND ${cpf} THEN 1 ELSE 0 END) AS reportsApproved,
        ISNULL(goals.goalsApproved, 0)    AS goalsApproved,
        ISNULL(goals.pendingApprovals, 0) AS pendingApprovals,
        ISNULL(goals.avgDaysToApproveGoal, NULL) AS avgDaysToApproveGoal,
        rptTat.avgDaysToApproveReport,
        ISNULL(ptApproval.reportsToApprove, 0) AS reportsToApprove,
        ISNULL(ptApproval.goalsToApprove, 0)   AS goalsToApprove
      FROM AdminUser au
      LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id AND ${dateFilterPal}
      LEFT JOIN Patient p ON p.Id = pal.PatientId
      LEFT JOIN Centre c  ON c.Id = p.CentreId
      OUTER APPLY (
        SELECT
          SUM(CASE WHEN pgarg.Status = 'Approved' THEN 1 ELSE 0 END) AS goalsApproved,
          SUM(CASE WHEN pgarg.Status NOT IN ('Approved','Rejected') THEN 1 ELSE 0 END) AS pendingApprovals,
          AVG(
            CASE WHEN pgarg.Status = 'Approved'
              AND pgarg.UpdatedDateTimeUtc > pgar.CreatedDateTimeUtc
            THEN CAST(DATEDIFF(day, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) AS FLOAT)
            ELSE NULL END
          ) AS avgDaysToApproveGoal
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap              ON ap.Id  = pgar.AllocatePatientId
        JOIN Patient pt                      ON pt.Id  = ap.PatientId
        WHERE pt.CentreId IN (
          SELECT auc.CentreId FROM AdminUserCentre auc WHERE auc.AdminUserId = au.Id
        )
          AND ${dateFrom || dateTo ? buildDateFilter('pgar.CreatedDateTimeUtc', '@dateFrom', '@dateTo') : '1=1'}
      ) goals
      OUTER APPLY (
        SELECT AVG(CAST(DATEDIFF(day, drafted.draftedAt, approved.approvedAt) AS FLOAT)) AS avgDaysToApproveReport
        FROM (
          SELECT pal_d.AllocatePatientId, MIN(pal_d.CreatedDateTime) AS draftedAt
          FROM PatientAuditLog pal_d
          WHERE pal_d.Type = 'ReportAdded' AND pal_d.AllocatePatientId IS NOT NULL
          GROUP BY pal_d.AllocatePatientId
        ) drafted
        JOIN (
          SELECT pal_a.AllocatePatientId, MIN(pal_a.CreatedDateTime) AS approvedAt
          FROM PatientAuditLog pal_a
          WHERE pal_a.AdminUserId = au.Id
            AND pal_a.Type = 'ReportPDFGenerated'
            AND pal_a.AllocatePatientId IS NOT NULL
          GROUP BY pal_a.AllocatePatientId
        ) approved ON approved.AllocatePatientId = drafted.AllocatePatientId
        WHERE approved.approvedAt > drafted.draftedAt
      ) rptTat
      OUTER APPLY (
        SELECT
          -- reports currently awaiting approval (drafted but not yet PDF-generated)
          SUM(CASE WHEN rptDrafted.apId IS NOT NULL AND rptApproved.apId IS NULL THEN 1 ELSE 0 END) AS reportsToApprove,
          -- goal sets currently awaiting approval
          SUM(CASE WHEN pgar2.Id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM PatientGoalApprovalRequestGoal g2
            WHERE g2.PatientGoalApprovalRequestId = pgar2.Id
              AND g2.Status = 'Approved'
          ) THEN 1 ELSE 0 END) AS goalsToApprove
        FROM AdminUserCentre auc2
        JOIN Patient pt2   ON pt2.CentreId = auc2.CentreId
        JOIN AllocatePatient ap2 ON ap2.PatientId = pt2.Id
          AND ap2.Status NOT IN ('Completed')
        LEFT JOIN (
          SELECT DISTINCT pal3.AllocatePatientId AS apId
          FROM PatientAuditLog pal3
          WHERE pal3.Type = 'ReportAdded'
        ) rptDrafted ON rptDrafted.apId = ap2.Id
        LEFT JOIN (
          SELECT DISTINCT pal4.AllocatePatientId AS apId
          FROM PatientAuditLog pal4
          WHERE pal4.Type = 'ReportPDFGenerated'
        ) rptApproved ON rptApproved.apId = ap2.Id
        LEFT JOIN PatientGoalApprovalRequest pgar2 ON pgar2.AllocatePatientId = ap2.Id
        WHERE auc2.AdminUserId = au.Id
      ) ptApproval
      WHERE au.Id = @userId
      GROUP BY au.Id, goals.goalsApproved, goals.pendingApprovals, goals.avgDaysToApproveGoal,
               rptTat.avgDaysToApproveReport, ptApproval.reportsToApprove, ptApproval.goalsToApprove
    `);
  }

  // centre-admin
  return bindCommon(pool.request(), { userId, centreId, dateFrom, dateTo }).query(`
    SELECT
      SUM(CASE WHEN pal.Type = 'CaseRegistered' AND ${cpf} THEN 1 ELSE 0 END) AS casesRegistered,
      SUM(CASE WHEN pal.Type = 'CaseAssigned'   AND ${cpf} THEN 1 ELSE 0 END) AS cliniciansAssigned,
      route.avgDaysToAssign,
      ISNULL(stuck.stuckOnboarding, 0) AS stuckOnboarding
    FROM AdminUser au
    LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id AND ${dateFilterPal}
    LEFT JOIN Patient p ON p.Id = pal.PatientId
    LEFT JOIN Centre c  ON c.Id = p.CentreId
    OUTER APPLY (
      SELECT AVG(CAST(DATEDIFF(day, r.registeredAt, a.assignedAt) AS FLOAT)) AS avgDaysToAssign
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
    WHERE au.Id = @userId
    GROUP BY au.Id, route.avgDaysToAssign, stuck.stuckOnboarding
  `);
}

function mapCoreMetrics(role, summaryRow, countRow) {
  if (role === 'clinician') {
    const scored = summaryRow.assessmentsScored ?? 0;
    const active = summaryRow.activeCaseload    ?? 0;
    return {
      assessmentsScored:    scored,
      reportsDrafted:       countRow.reportsDrafted      ?? 0,
      goalsAdded:           countRow.goalsAdded          ?? 0,
      caseHistoryCompleted: countRow.caseHistoryCompleted ?? 0,
      activeCaseload:       active,
      avgDaysToResult:      summaryRow.avgDaysToResult != null
        ? Math.round(summaryRow.avgDaysToResult * 10) / 10
        : null,
      stuckCases: summaryRow.stuckCases ?? 0,
      pipelineBreakdown: {
        scoring:        summaryRow.plScoring        ?? 0,
        reportsToWrite: summaryRow.plReportsToWrite ?? 0,
        goalsToAdd:     summaryRow.plGoalsToAdd     ?? 0,
        pendingApproval: summaryRow.plPendingApproval ?? 0,
      },
    };
  }

  if (role === 'manager') {
    return {
      reportsApproved:      summaryRow.reportsApproved     ?? 0,
      goalsApproved:        summaryRow.goalsApproved       ?? 0,
      casesRegistered:      summaryRow.casesRegistered     ?? 0,
      avgDaysToApproveReport: summaryRow.avgDaysToApproveReport != null
        ? Math.round(summaryRow.avgDaysToApproveReport * 10) / 10
        : null,
      avgDaysToApproveGoal: summaryRow.avgDaysToApproveGoal != null
        ? Math.round(summaryRow.avgDaysToApproveGoal * 10) / 10
        : null,
      pendingApprovals:  summaryRow.pendingApprovals  ?? 0,
      reportsToApprove:  summaryRow.reportsToApprove  ?? 0,
      goalsToApprove:    summaryRow.goalsToApprove    ?? 0,
    };
  }

  // centre-admin
  return {
    casesRegistered:  summaryRow.casesRegistered  ?? 0,
    cliniciansAssigned: summaryRow.cliniciansAssigned ?? 0,
    avgDaysToAssign:  summaryRow.avgDaysToAssign != null
      ? Math.round(summaryRow.avgDaysToAssign * 10) / 10
      : null,
    stuckOnboarding:  summaryRow.stuckOnboarding ?? 0,
  };
}

module.exports = router;
