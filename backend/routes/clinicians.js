'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion } = require('../lib/queryHelpers');

const router = Router();

/**
 * GET /api/clinicians
 * One row per clinician × centre assignment.
 * Metrics are scoped to patients at that centre.
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
    const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
    const dateFilterRes = buildDateFilter('pal2.CreatedDateTime', '@dateFrom', '@dateTo');

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
          c.Id         AS centreId,
          c.CentreName,
          SUM(CASE WHEN p.Id IS NOT NULL THEN 1 ELSE 0 END) AS totalAuditActions,
          ISNULL(rs.scoringComplete, 0) AS scoringComplete,
          ISNULL(rs.reportPdfCreated, 0) AS reportPdfCreated,
          ISNULL(rs.reportPdfCreated, 0) AS resultsGenerated,
          ISNULL(cs.activeCaseload, 0)   AS activeCaseload,
          MAX(CASE WHEN p.Id IS NOT NULL THEN pal.CreatedDateTime END) AS lastActivityDate
        FROM AdminUser au
        JOIN AdminUserRole aur ON aur.UserId = au.Id
        JOIN AdminRole ar      ON ar.Id = aur.RoleId AND ar.Name = 'Clinician'
        JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        JOIN Centre c            ON c.Id = auc.CentreId
        LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
          AND ${dateFilterPal}
        LEFT JOIN Patient p ON p.Id = pal.PatientId
        LEFT JOIN (
          SELECT
            ap.ClinicianUserId,
            COUNT(DISTINCT CASE WHEN pal2.Type = 'AssessmentResultGenerated' THEN pal2.AllocatePatientId END) AS scoringComplete,
            COUNT(DISTINCT CASE WHEN pal2.Type = 'ReportPDFGenerated' THEN pal2.AllocatePatientId END) AS reportPdfCreated
          FROM PatientAuditLog pal2
          JOIN AllocatePatient ap ON ap.Id = pal2.AllocatePatientId
          JOIN Patient pt         ON pt.Id = ap.PatientId
          JOIN Centre rc          ON rc.Id = pt.CentreId
          WHERE pal2.Type IN ('ReportPDFGenerated', 'AssessmentResultGenerated')
            AND pal2.AllocatePatientId IS NOT NULL
            AND ${dateFilterRes}
            AND ${buildCentreExclusion('rc')}
          GROUP BY ap.ClinicianUserId
        ) rs ON rs.ClinicianUserId = au.Id
        LEFT JOIN (
          SELECT
            ap.ClinicianUserId,
            COUNT(*) AS activeCaseload
          FROM AllocatePatient ap
          JOIN Patient pt ON pt.Id = ap.PatientId
          JOIN Centre cc ON cc.Id = pt.CentreId
          WHERE ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
            AND ${buildCentreExclusion('cc')}
          GROUP BY ap.ClinicianUserId
        ) cs ON cs.ClinicianUserId = au.Id
        WHERE (@centreId IS NULL OR c.Id = @centreId)
          AND ${centreExclusion}
          AND LOWER(au.FirstName) NOT LIKE '%test%'
          AND LOWER(au.LastName)  NOT LIKE '%test%'
          AND LOWER(au.Email)     NOT LIKE '%@webority.com'
        GROUP BY
          au.Id, au.FirstName, au.LastName, au.Email,
          au.LastLoginDateTimeUtc, c.Id, c.CentreName,
          rs.scoringComplete, rs.reportPdfCreated, cs.activeCaseload
        ORDER BY au.LastName, au.FirstName, c.CentreName
      `);

    const clinicians = result.recordset.map((r) => ({
      id:                r.Id,
      firstName:         r.FirstName,
      lastName:          r.LastName,
      email:             r.Email,
      centreId:          r.centreId,
      centreName:        r.CentreName || null,
      scoringComplete:   r.scoringComplete ?? 0,
      reportPdfCreated:  r.reportPdfCreated ?? 0,
      resultsGenerated:  r.reportPdfCreated ?? 0,
      activeCaseload:    r.activeCaseload ?? 0,
      totalAuditActions: r.totalAuditActions ?? 0,
      lastActivityDate:  r.lastActivityDate || null,
      lastLoginDate:     r.LastLoginDateTimeUtc || null,
    }));

    res.json(clinicians);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
