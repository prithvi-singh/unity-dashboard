'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { abbreviateCentre } = require('../lib/formatters');

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/monitoring
 * Query params: date (required, YYYY-MM-DD)
 *
 * Returns:
 *   - Per-user action counts, last action, and login status for the given date
 *   - 30-day heatmap of action counts per user
 *   - List of all dates that have any audit log data (for date picker)
 */
router.get('/', async (req, res, next) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'date query param is required (YYYY-MM-DD)' });
    }
    if (!DATE_RE.test(date) || isNaN(new Date(date).getTime())) {
      return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    }

    const pool = await poolPromise;

    const [
      actionsResult,
      usersResult,
      loginsResult,
      heatmapResult,
      datesResult,
      clinicalOutputResult,
    ] = await Promise.all([

      // Q1: per-user action counts for the specific date
      pool.request()
        .input('date', sql.Date, new Date(date))
        .query(`
          SELECT
            pal.AdminUserId          AS userId,
            COUNT(*)                 AS actionCount,
            MAX(pal.CreatedDateTime) AS lastActionTime,
            MAX(pal.Description)     AS lastActionDescription
          FROM PatientAuditLog pal
          WHERE CAST(pal.CreatedDateTime AS DATE) = @date
          GROUP BY pal.AdminUserId
        `),

      // Q2: all admin users with their role and centre
      // Excludes test/webority users by name AND users belonging to test/deleted centres
      pool.request().query(`
        SELECT
          au.Id,
          au.FirstName,
          au.LastName,
          au.Email,
          ar.Name  AS roleName,
          c.CentreName
        FROM AdminUser au
        LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
        LEFT JOIN AdminRole ar      ON ar.Id = aur.RoleId
        LEFT JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        LEFT JOIN Centre c            ON c.Id = auc.CentreId
        WHERE LOWER(au.FirstName) NOT LIKE '%test%'
          AND LOWER(au.LastName)  NOT LIKE '%test%'
          AND LOWER(au.Email)     NOT LIKE '%@webority.com'
          AND (c.CentreName IS NULL OR LOWER(c.CentreName) NOT LIKE '%test%')
          AND (c.CentreName IS NULL OR LOWER(c.CentreName) NOT LIKE '%delete%')
      `),

      // Q3: users who logged in on the given date
      // CreatedDateTimeUtc is UTC; convert to IST (UTC+5:30 = +330 min) before
      // date-casting so that early-morning logins aren't attributed to the wrong day.
      pool.request()
        .input('date', sql.Date, new Date(date))
        .query(`
          SELECT DISTINCT AdminUserId
          FROM AdminUserAudit
          WHERE Type = 'Login'
            AND CAST(DATEADD(minute, 330, CreatedDateTimeUtc) AS DATE) = @date
        `),

      // Q4: heatmap — action counts per user for the last 30 days
      // CreatedDateTime is local IST time; use GETDATE() (also local) for consistency.
      pool.request().query(`
        SELECT
          AdminUserId AS userId,
          CONVERT(varchar(10), CAST(CreatedDateTime AS DATE), 23) AS date,
          COUNT(*)    AS count
        FROM PatientAuditLog
        WHERE CreatedDateTime >= DATEADD(day, -30, GETDATE())
        GROUP BY AdminUserId, CAST(CreatedDateTime AS DATE)
      `),

      // Q5: all distinct dates with audit log data (most recent first)
      pool.request().query(`
        SELECT DISTINCT CONVERT(varchar(10), CAST(CreatedDateTime AS DATE), 23) AS date
        FROM PatientAuditLog
        ORDER BY date DESC
      `),

      // Q6: clinical output counts for the specific date.
      // Filters test patients and test/webority/mailinator users so the counts
      // are consistent with all other metric endpoints.
      pool.request()
        .input('date', sql.Date, new Date(date))
        .query(`
          SELECT
            SUM(CASE WHEN pal.Type = 'CaseRegistered'            THEN 1 ELSE 0 END) AS cases,
            SUM(CASE WHEN pal.Type = 'AssessmentResultGenerated' THEN 1 ELSE 0 END) AS assessmentsScored,
            SUM(CASE WHEN pal.Type = 'ReportPDFGenerated'        THEN 1 ELSE 0 END) AS reports,
            SUM(CASE WHEN pal.Type = 'GoalAdded'                 THEN 1 ELSE 0 END) AS goals
          FROM PatientAuditLog pal
          LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
          LEFT JOIN Patient pt   ON pt.Id = pal.PatientId
          WHERE CAST(pal.CreatedDateTime AS DATE) = @date
            AND (au.Id IS NULL OR (
              LOWER(au.FirstName) NOT LIKE '%test%'
              AND LOWER(au.LastName)  NOT LIKE '%test%'
              AND LOWER(au.Email)     NOT LIKE '%@webority.com'
              AND LOWER(au.Email)     NOT LIKE '%@mailinator.com'
            ))
            AND (pt.Id IS NULL OR (
              pt.FirstName NOT LIKE '%test%'
              AND pt.LastName  NOT LIKE '%test%'
            ))
        `),
    ]);

    // Build lookups
    const actionsMap = {};
    for (const row of actionsResult.recordset) {
      actionsMap[row.userId] = {
        actionCount:           row.actionCount,
        lastActionTime:        row.lastActionTime || null,
        lastActionDescription: row.lastActionDescription || null,
      };
    }

    const loggedInSet = new Set(loginsResult.recordset.map((r) => r.AdminUserId));

    // Build heatmap: { userId → [{ date, count }] }
    const heatmapMap = {};
    for (const row of heatmapResult.recordset) {
      const uid = row.userId;
      if (!heatmapMap[uid]) heatmapMap[uid] = [];
      heatmapMap[uid].push({
        date:  String(row.date).slice(0, 10),
        count: row.count,
      });
    }

    const users = usersResult.recordset.map((u) => {
      const activity = actionsMap[u.Id] || {};
      return {
        id:                    parseInt(String(u.Id), 10),
        firstName:             u.FirstName,
        lastName:              u.LastName,
        email:                 u.Email,
        roleName:              u.roleName || null,
        centreName:            abbreviateCentre(u.CentreName) || null,
        actionCount:           activity.actionCount           || 0,
        lastActionTime:        activity.lastActionTime        || null,
        lastActionDescription: activity.lastActionDescription || null,
        loggedInToday:         loggedInSet.has(u.Id),
        active:                (activity.actionCount || 0) > 0,
      };
    });

    // Only emit heatmap rows for users that passed the filter in Q2
    const filteredUserIds = new Set(users.map((u) => u.id));
    const heatmap = Object.entries(heatmapMap)
      .filter(([userId]) => filteredUserIds.has(parseInt(userId, 10)))
      .map(([userId, days]) => ({
        userId: parseInt(userId, 10),
        days,
      }));

    const availableDates = datesResult.recordset.map((r) => String(r.date).slice(0, 10));

    const outputRow = clinicalOutputResult.recordset[0] ?? {};
    const clinicalOutput = {
      cases:             outputRow.cases             || 0,
      assessmentsScored: outputRow.assessmentsScored || 0,
      reports:           outputRow.reports           || 0,
      goals:             outputRow.goals             || 0,
    };

    res.json({ date, users, heatmap, availableDates, clinicalOutput });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
