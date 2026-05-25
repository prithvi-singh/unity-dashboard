'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion } = require('../lib/queryHelpers');

const router = Router();

/**
 * GET /api/managers
 * One row per manager × centre assignment.
 * Audit metrics are scoped to patients at that centre.
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

    const result = await pool.request()
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
          SUM(CASE WHEN pal.Type = 'CaseRegistered' AND p.CentreId = c.Id THEN 1 ELSE 0 END) AS casesRegistered,
          SUM(CASE WHEN pal.Type = 'CaseAssigned'   AND p.CentreId = c.Id THEN 1 ELSE 0 END) AS assessmentsAssigned,
          SUM(CASE WHEN p.CentreId = c.Id THEN 1 ELSE 0 END) AS totalActions,
          MAX(CASE WHEN p.CentreId = c.Id THEN pal.CreatedDateTime END) AS lastActivityDate
        FROM AdminUser au
        JOIN AdminUserRole aur ON aur.UserId = au.Id
        JOIN AdminRole ar      ON ar.Id = aur.RoleId AND ar.Name NOT IN ('Clinician', 'Super Admin')
        JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        JOIN Centre c            ON c.Id = auc.CentreId
        LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
          AND ${dateFilter}
        LEFT JOIN Patient p ON p.Id = pal.PatientId
        WHERE au.FirstName NOT LIKE '%(Ops)%'
          AND au.LastName  NOT LIKE '%(Ops)%'
          AND au.Email     NOT LIKE '%(Ops)%'
          AND (@centreId IS NULL OR c.Id = @centreId)
          AND ${centreExclusion}
          AND LOWER(au.FirstName) NOT LIKE '%test%'
          AND LOWER(au.LastName)  NOT LIKE '%test%'
          AND LOWER(au.Email)     NOT LIKE '%@webority.com'
        GROUP BY
          au.Id, au.FirstName, au.LastName, au.Email,
          au.LastLoginDateTimeUtc, ar.Name, c.Id, c.CentreName
        ORDER BY ar.Name, au.LastName, au.FirstName, c.CentreName
      `);

    const managers = result.recordset.map((r) => ({
      id:                  r.Id,
      firstName:           r.FirstName,
      lastName:            r.LastName,
      email:               r.Email,
      roleName:            r.roleName || null,
      centreId:            r.centreId,
      centreName:          r.CentreName || null,
      casesRegistered:     r.casesRegistered ?? 0,
      assessmentsAssigned: r.assessmentsAssigned ?? 0,
      totalActions:        r.totalActions ?? 0,
      lastActivityDate:    r.lastActivityDate || null,
      lastLoginDate:       r.LastLoginDateTimeUtc || null,
    }));

    res.json(managers);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
