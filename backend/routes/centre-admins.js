'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');

const router = Router();

const OPS_CORE_EVENTS = `'CaseRegistered','CaseAssigned'`;

function countWorkingDays(from, to) {
  const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const end   = to   ? new Date(to)   : new Date();
  let count = 0;
  const d = new Date(start);
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

function consistencyStatus(pct) {
  if (pct === 0) return 'silent';
  if (pct < 30)  return 'inactive';
  if (pct < 70)  return 'irregular';
  return 'consistent';
}

/**
 * GET /api/centre-admins
 * One row per ops admin × centre assignment.
 */
router.get('/', async (req, res, next) => {
  try {
    const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
    const dateFrom = parseDateParam(req.query.dateFrom);
    const dateTo   = parseDateParam(req.query.dateTo);

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
    const dateFilter = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

    const [rosterResult, consistencyResult] = await Promise.all([
      pool.request()
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo)
        .query(`
          SELECT
            au.Id,
            au.FirstName,
            au.LastName,
            au.Email,
            au.LastLoginDateTimeUtc,
            ar.Name      AS roleName,
            c.Id         AS centreId,
            c.CentreName,
            COUNT(DISTINCT CASE WHEN pal.Type = 'CaseRegistered' AND p.CentreId = c.Id THEN p.Id END) AS casesRegistered,
            COUNT(DISTINCT CASE WHEN pal.Type = 'CaseAssigned'   AND p.CentreId = c.Id THEN p.Id END) AS casesAssignedToClinical,
            SUM(CASE WHEN p.CentreId = c.Id THEN 1 ELSE 0 END) AS totalActions,
            MAX(CASE WHEN p.CentreId = c.Id THEN pal.CreatedDateTime END) AS lastActivityDate
          FROM AdminUser au
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id = aur.RoleId AND ar.Name != 'Clinician'
          JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
          JOIN Centre c            ON c.Id = auc.CentreId
          LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
            AND ${dateFilter}
          LEFT JOIN Patient p ON p.Id = pal.PatientId
          WHERE (
              au.FirstName LIKE '%(Ops)%'
              OR au.LastName  LIKE '%(Ops)%'
              OR au.Email     LIKE '%(Ops)%'
            )
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND ${centreExclusion}
            AND LOWER(au.FirstName) NOT LIKE '%test%'
            AND LOWER(au.LastName)  NOT LIKE '%test%'
            AND LOWER(au.Email)     NOT LIKE '%@webority.com'
          GROUP BY
            au.Id, au.FirstName, au.LastName, au.Email,
            au.LastLoginDateTimeUtc, ar.Name, c.Id, c.CentreName
          ORDER BY ar.Name, au.LastName, au.FirstName, c.CentreName
        `),

      // Per-ops-admin core-job day counts
      pool.request()
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo)
        .query(`
          SELECT
            au.Id AS userId,
            COUNT(DISTINCT
              CASE WHEN pal.Type IN (${OPS_CORE_EVENTS})
              THEN CAST(pal.CreatedDateTime AS DATE) END
            ) AS coreJobDays,
            COUNT(DISTINCT CASE WHEN pal.Type = 'CaseRegistered' THEN pal.PatientId END) AS casesRegistered,
            COUNT(DISTINCT CASE WHEN pal.Type = 'CaseAssigned'   THEN pal.PatientId END) AS cliniciansAssigned,
            MAX(pal.CreatedDateTime) AS lastActiveDate
          FROM AdminUser au
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id = aur.RoleId AND ar.Name != 'Clinician'
          JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
          JOIN Centre c            ON c.Id = auc.CentreId
          LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
            AND ${dateFilter}
          WHERE (
              au.FirstName LIKE '%(Ops)%'
              OR au.LastName  LIKE '%(Ops)%'
              OR au.Email     LIKE '%(Ops)%'
            )
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND ${centreExclusion}
            AND LOWER(au.FirstName) NOT LIKE '%test%'
            AND LOWER(au.LastName)  NOT LIKE '%test%'
            AND LOWER(au.Email)     NOT LIKE '%@webority.com'
          GROUP BY au.Id
        `),
    ]);

    const consistencyMap = new Map(consistencyResult.recordset.map((r) => [r.userId, r]));
    const totalWorkingDays = countWorkingDays(dateFrom, dateTo);

    const admins = rosterResult.recordset.map((r) => {
      const cons    = consistencyMap.get(r.Id) || {};
      const coreJobDays        = cons.coreJobDays ?? 0;
      const consistencyPercent = totalWorkingDays > 0
        ? Math.round((coreJobDays / totalWorkingDays) * 100)
        : 0;
      const lastActiveDate = cons.lastActiveDate || null;
      const lastActiveDaysAgo = lastActiveDate
        ? Math.max(0, Math.floor((Date.now() - new Date(lastActiveDate).getTime()) / 86400000))
        : null;

      return {
        id:                      r.Id,
        firstName:               r.FirstName,
        lastName:                r.LastName,
        email:                   r.Email,
        roleName:                r.roleName || null,
        centreId:                r.centreId,
        centreName:              abbreviateCentre(r.CentreName) || null,
        casesRegistered:         r.casesRegistered ?? 0,
        casesAssignedToClinical: r.casesAssignedToClinical ?? 0,
        totalActions:            r.totalActions ?? 0,
        lastActivityDate:        r.lastActivityDate || null,
        lastLoginDate:           r.LastLoginDateTimeUtc || null,
        // ── Consistency data ────────────────────────────────────────────────
        consistencyPercent,
        consistencyStatus: consistencyStatus(consistencyPercent),
        coreJobDays,
        totalWorkingDays,
        coreOutput: {
          casesRegistered:    cons.casesRegistered    ?? 0,
          cliniciansAssigned: cons.cliniciansAssigned ?? 0,
        },
        lastActiveDate,
        lastActiveDaysAgo,
      };
    });

    res.json(admins);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
