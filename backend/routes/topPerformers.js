'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion, buildPatientExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');

const router = Router();

/**
 * GET /api/monitoring/top-performers
 *
 * Returns top performers ranked by role-specific clinical output score.
 *
 * Scoring:
 *   Clinician:        assessmentsScored + reportsDrafted + goalsAdded
 *   CentreManager:    reportsApproved + goalsApproved
 *   Ops Admin:        casesRegistered + assessmentsAssigned
 *
 * isOpsAdmin: FirstName OR LastName contains "(Ops)" — overrides role display.
 *
 * Query params:
 *   dateFrom  (optional, YYYY-MM-DD)
 *   dateTo    (optional, YYYY-MM-DD)
 *   centreId  (optional, number)
 *   role      (optional: Clinician | CentreManager | Ops)
 *   limit     (optional, default 12; 0 = all active users)
 */
router.get('/', async (req, res, next) => {
  try {
    const centreId  = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
    const limitRaw  = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 12;
    const roleParam = req.query.role || null;  // Clinician | CentreManager | Ops
    const dateFrom  = parseDateParam(req.query.dateFrom);
    const dateTo    = parseDateParam(req.query.dateTo);

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
    const centreExcl   = buildCentreExclusion('c');
    const patExcl      = buildPatientExclusion('pt');
    const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
    const dateFilterGoals = buildDateFilter(
      'DATEADD(minute, 330, pgarg.UpdatedDateTimeUtc)',
      '@dateFrom',
      '@dateTo',
    );

    // ── Q1: PAL events per user per day in the date range ──────────────────
    // Covers: assessmentsScored, reportsDrafted, goalsAdded, reportsApproved,
    //         casesRegistered, assessmentsAssigned, reportEdits
    // Data integrity filters applied on patients and centres.
    const palResult = await pool.request()
      .input('centreId', sql.BigInt,         centreId)
      .input('dateFrom', sql.DateTimeOffset,  dateFrom)
      .input('dateTo',   sql.DateTimeOffset,  dateTo)
      .query(`
        SELECT
          pal.AdminUserId                                                            AS userId,
          CONVERT(varchar(10), CAST(pal.CreatedDateTime AS DATE), 23)               AS eventDate,
          SUM(CASE WHEN pal.Type IN (
                'AssessmentResultGenerated', 'AssessmentStatusChanged'
              ) THEN 1 ELSE 0 END)                                                  AS assessmentsScored,
          SUM(CASE WHEN pal.Type = 'ReportAdded'         THEN 1 ELSE 0 END)        AS reportsDrafted,
          SUM(CASE WHEN pal.Type = 'GoalAdded'           THEN 1 ELSE 0 END)        AS goalsAdded,
          SUM(CASE WHEN pal.Type = 'ReportPDFGenerated'  THEN 1 ELSE 0 END)        AS reportsApproved,
          SUM(CASE WHEN pal.Type = 'CaseRegistered'      THEN 1 ELSE 0 END)        AS casesRegistered,
          SUM(CASE WHEN pal.Type = 'CaseAssigned'        THEN 1 ELSE 0 END)        AS assessmentsAssigned,
          SUM(CASE WHEN pal.Type = 'UpdateReport'        THEN 1 ELSE 0 END)        AS reportEdits
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        WHERE pal.AdminUserId IS NOT NULL
          AND ${dateFilterPal}
          AND ${centreExcl}
          AND ${patExcl}
          AND (@centreId IS NULL OR c.Id = @centreId)
        GROUP BY pal.AdminUserId, CAST(pal.CreatedDateTime AS DATE)
      `);

    // ── Q2: Goal approvals per approver per day ────────────────────────────
    // PatientGoalApprovalRequestGoal.UpdatedBy stores the approver's display
    // name ("FirstName LastName") — confirmed by pipelineDetailExprs.js which
    // renders it as "Approved by: [UpdatedBy]".  We JOIN on CONCAT(FirstName,
    // ' ', LastName) to resolve it back to a numeric AdminUser.Id.
    const goalApprovalsResult = await pool.request()
      .input('centreId', sql.BigInt,         centreId)
      .input('dateFrom', sql.DateTimeOffset,  dateFrom)
      .input('dateTo',   sql.DateTimeOffset,  dateTo)
      .query(`
        SELECT
          au.Id                                                                         AS userId,
          CONVERT(varchar(10), CAST(
            DATEADD(minute, 330, pgarg.UpdatedDateTimeUtc)
          AS DATE), 23)                                                                 AS eventDate,
          COUNT(*)                                                                      AS goalsApproved
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap              ON ap.Id   = pgar.AllocatePatientId
        JOIN Patient pt                      ON pt.Id   = ap.PatientId
        JOIN Centre  c                       ON c.Id    = pt.CentreId
        -- Resolve the name string stored in UpdatedBy back to the AdminUser row
        JOIN AdminUser au ON CONCAT(au.FirstName, ' ', au.LastName) = pgarg.UpdatedBy
        WHERE pgarg.Status = 'Approved'
          AND ${dateFilterGoals}
          AND ${buildCentreExclusion('c')}
          AND ${buildPatientExclusion('pt')}
          AND (@centreId IS NULL OR pt.CentreId = @centreId)
          AND au.Email NOT LIKE '%@webority.com'
          AND au.Email NOT LIKE '%@mailinator.com'
        GROUP BY au.Id, CAST(DATEADD(minute, 330, pgarg.UpdatedDateTimeUtc) AS DATE)
      `);

    // ── Q3: Eligible admin users ────────────────────────────────────────────
    const usersResult = await pool.request()
      .input('centreId', sql.BigInt, centreId)
      .query(`
        SELECT DISTINCT
          au.Id                                                         AS userId,
          au.FirstName,
          au.LastName,
          ar.Name                                                       AS roleName,
          c.Id                                                          AS centreId,
          c.CentreName,
          CASE WHEN au.FirstName LIKE '%(Ops)%'
                 OR au.LastName  LIKE '%(Ops)%'
            THEN 1 ELSE 0 END                                          AS isOpsAdmin
        FROM AdminUser au
        JOIN AdminUserRole  aur ON aur.UserId = au.Id
        JOIN AdminRole      ar  ON ar.Id = aur.RoleId
        JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        JOIN Centre          c   ON c.Id = auc.CentreId
        WHERE au.FirstName NOT LIKE '%test%'
          AND au.LastName  NOT LIKE '%test%'
          AND au.Email     NOT LIKE '%@webority.com'
          AND au.Email     NOT LIKE '%@mailinator.com'
          AND ar.Name NOT IN ('SuperAdmin', 'Super Admin')
          AND c.CentreName NOT LIKE '%DELETE%'
          AND ${buildCentreExclusion('c')}
          AND (@centreId IS NULL OR c.Id = @centreId)
      `);

    // ── Build lookup structures ─────────────────────────────────────────────

    // PAL events: userId → date → breakdown
    const palMap = {};
    for (const row of palResult.recordset) {
      const uid  = parseInt(String(row.userId), 10);
      const date = String(row.eventDate).slice(0, 10);
      if (!palMap[uid]) palMap[uid] = {};
      palMap[uid][date] = {
        assessmentsScored:   row.assessmentsScored   || 0,
        reportsDrafted:      row.reportsDrafted      || 0,
        goalsAdded:          row.goalsAdded          || 0,
        reportsApproved:     row.reportsApproved     || 0,
        casesRegistered:     row.casesRegistered     || 0,
        assessmentsAssigned: row.assessmentsAssigned || 0,
        reportEdits:         row.reportEdits         || 0,
        goalsApproved:       0, // filled below
      };
    }

    // Goal approvals: userId → date → count (directly attributed to the approver)
    const goalMap = {};
    for (const row of goalApprovalsResult.recordset) {
      const uid  = parseInt(String(row.userId), 10);
      const date = String(row.eventDate).slice(0, 10);
      if (!goalMap[uid]) goalMap[uid] = {};
      goalMap[uid][date] = (goalMap[uid][date] || 0) + row.goalsApproved;
    }

    // User base: deduplicate by userId (a user can appear in multiple centres)
    // Keep the first entry per userId (arbitrary but consistent)
    const userMap = {};
    for (const row of usersResult.recordset) {
      const uid = parseInt(String(row.userId), 10);
      if (!userMap[uid]) {
        userMap[uid] = {
          userId:      uid,
          firstName:   row.FirstName,
          lastName:    row.LastName,
          roleName:    row.roleName || null,
          centreId:    row.centreId,
          centreName:  abbreviateCentre(row.CentreName) || null,
          isOpsAdmin:  row.isOpsAdmin === 1 || row.isOpsAdmin === true,
        };
      }
    }

    // Merge goal approvals directly into the per-user palMap
    // goalMap is now userId → date → count (attributed to the exact approver)
    for (const [uidStr, datesObj] of Object.entries(goalMap)) {
      const uid = parseInt(uidStr, 10);
      for (const [date, count] of Object.entries(datesObj)) {
        if (!palMap[uid]) palMap[uid] = {};
        if (!palMap[uid][date]) {
          palMap[uid][date] = {
            assessmentsScored:   0,
            reportsDrafted:      0,
            goalsAdded:          0,
            reportsApproved:     0,
            casesRegistered:     0,
            assessmentsAssigned: 0,
            reportEdits:         0,
            goalsApproved:       0,
          };
        }
        palMap[uid][date].goalsApproved += count;
      }
    }

    // ── Compute output score per user ───────────────────────────────────────
    function computeScore(uid, user) {
      const days = palMap[uid] || {};
      const isOps = user.isOpsAdmin;
      const role  = (user.roleName || '').toLowerCase().replace(/\s/g, '');
      const isMgr = role === 'centremanager' || role === 'manager';

      let score = 0;
      for (const d of Object.values(days)) {
        if (isOps) {
          score += d.casesRegistered + d.assessmentsAssigned;
        } else if (isMgr) {
          score += d.reportsApproved + d.goalsApproved;
        } else {
          // Clinician (default for all others with activity)
          score += d.assessmentsScored + d.reportsDrafted + d.goalsAdded;
        }
      }
      return score;
    }

    // ── Apply role filter and build per-user result ─────────────────────────
    let users = Object.values(userMap);

    if (roleParam) {
      const rp = roleParam.toLowerCase();
      users = users.filter((u) => {
        const role = (u.roleName || '').toLowerCase().replace(/\s/g, '');
        if (rp === 'ops') return u.isOpsAdmin;
        if (rp === 'centremanager') return !u.isOpsAdmin && (role === 'centremanager' || role === 'manager');
        if (rp === 'clinician') return !u.isOpsAdmin && role === 'clinician';
        return true;
      });
    }

    // Compute score and build enriched user list
    const enriched = users.map((u) => {
      const totalScore = computeScore(u.userId, u);
      const daysMap    = palMap[u.userId] || {};
      const days       = Object.entries(daysMap).map(([date, b]) => ({
        date,
        total: Object.values(b).reduce((s, v) => s + v, 0) - b.reportEdits, // total = scoring fields
        breakdown: { ...b },
      })).sort((a, b) => a.date.localeCompare(b.date));
      return { ...u, totalScore, days };
    });

    // Sort all by totalScore descending
    enriched.sort((a, b) => b.totalScore - a.totalScore);

    // Remove users with zero activity
    const active = enriched.filter((u) => u.totalScore > 0 || u.days.length > 0);
    const activeWithScore = active.filter((u) => u.totalScore > 0);

    // Apply limit (0 = all)
    const limit  = isNaN(limitRaw) || limitRaw < 0 ? 12 : limitRaw;
    const result = limit === 0 ? activeWithScore : activeWithScore.slice(0, limit);

    // Compute days-in-period for subtitle
    let daysCount = 14; // default
    if (dateFrom && dateTo) {
      const diff = Math.round((dateTo - dateFrom) / (1000 * 60 * 60 * 24)) + 1;
      daysCount = diff > 0 ? diff : 14;
    }

    res.json({ performers: result, daysCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
