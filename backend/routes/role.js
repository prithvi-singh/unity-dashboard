'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildCentreExclusion } = require('../lib/queryHelpers');
const { buildClinicalPipelineQuery, mapPipelineRow } = require('../lib/clinicalPipelineQueries');

const router = Router();

router.use('/drill-down', require('./roleDrillDown'));

/**
 * GET /api/role/clinical-pipeline
 * Assessment-level funnel counts (one row per AllocatePatient assignment).
 */
router.get('/clinical-pipeline', async (req, res, next) => {
  try {
    const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
    const dateFrom = parseDateParam(req.query.dateFrom);
    const dateTo = parseDateParam(req.query.dateTo);

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
    const result = await pool.request()
      .input('centreId', sql.BigInt, centreId)
      .input('dateFrom', sql.DateTimeOffset, dateFrom)
      .input('dateTo', sql.DateTimeOffset, dateTo)
      .query(buildClinicalPipelineQuery());

    res.json(mapPipelineRow(result.recordset[0] || {}));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/role/summary?role=clinician|manager|admin
 * Org-level alert counts for role tabs (respects centre filter).
 */
router.get('/summary', async (req, res, next) => {
  try {
    const role = req.query.role;
    if (!['clinician', 'manager', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'role must be clinician, manager, or admin' });
    }

    const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
    if (req.query.centreId && isNaN(centreId)) {
      return res.status(400).json({ error: 'centreId must be a number' });
    }

    const pool = await poolPromise;
    const centreExclusion = buildCentreExclusion('c');

    if (role === 'clinician') {
      const result = await pool.request()
        .input('centreId', sql.BigInt, centreId)
        .query(`
          SELECT
            (
              SELECT COUNT(*)
              FROM AllocatePatient ap
              JOIN Patient pt ON pt.Id = ap.PatientId
              JOIN Centre c ON c.Id = pt.CentreId
              WHERE ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
                AND ap.CreatedDateTimeUtc < DATEADD(day, -14, SYSDATETIMEOFFSET())
                AND NOT EXISTS (
                  SELECT 1 FROM PatientAuditLog pal3
                  WHERE pal3.AllocatePatientId = ap.Id
                    AND pal3.Type IN ('ReportPDFGenerated', 'AssessmentResultGenerated')
                )
                AND (@centreId IS NULL OR c.Id = @centreId)
                AND ${centreExclusion}
            ) AS stuckCases,
            (
              SELECT COUNT(*) FROM (
                SELECT au.Id
                FROM AdminUser au
                JOIN AdminUserRole aur ON aur.UserId = au.Id
                JOIN AdminRole ar ON ar.Id = aur.RoleId AND ar.Name = 'Clinician'
                JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
                JOIN Centre c ON c.Id = auc.CentreId
                LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
                WHERE (@centreId IS NULL OR c.Id = @centreId)
                  AND ${centreExclusion}
                  AND LOWER(au.FirstName) NOT LIKE '%test%'
                  AND LOWER(au.LastName) NOT LIKE '%test%'
                  AND LOWER(au.Email) NOT LIKE '%@webority.com'
                  AND EXISTS (
                    SELECT 1 FROM AllocatePatient ap
                    JOIN Patient pt ON pt.Id = ap.PatientId
                    WHERE ap.ClinicianUserId = au.Id
                      AND ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
                      AND (@centreId IS NULL OR pt.CentreId = @centreId)
                  )
                GROUP BY au.Id
                HAVING MAX(pal.CreatedDateTime) IS NULL
                  OR CAST(MAX(pal.CreatedDateTime) AS DATE) < CAST(SYSDATETIMEOFFSET() AS DATE)
              ) inactive
            ) AS inactiveCount
        `);
      const row = result.recordset[0] || {};
      return res.json({
        role,
        stuckCases: row.stuckCases ?? 0,
        inactiveCount: row.inactiveCount ?? 0,
      });
    }

    if (role === 'manager') {
      const result = await pool.request()
        .input('centreId', sql.BigInt, centreId)
        .query(`
          SELECT COUNT(DISTINCT reg.PatientId) AS stuckOnboarding
          FROM (
            SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
            FROM PatientAuditLog pal
            JOIN Patient pt ON pt.Id = pal.PatientId
            JOIN Centre c ON c.Id = pt.CentreId
            JOIN AdminUser au ON au.Id = pal.AdminUserId
            WHERE pal.Type = 'CaseRegistered'
              AND (@centreId IS NULL OR c.Id = @centreId)
              AND ${centreExclusion}
              AND au.FirstName NOT LIKE '%(Ops)%'
              AND au.LastName NOT LIKE '%(Ops)%'
              AND au.Email NOT LIKE '%(Ops)%'
            GROUP BY pal.PatientId
          ) reg
          WHERE reg.registeredAt < DATEADD(hour, -48, SYSDATETIMEOFFSET())
            AND NOT EXISTS (
              SELECT 1 FROM PatientAuditLog p2
              WHERE p2.PatientId = reg.PatientId AND p2.Type = 'CaseAssigned'
            )
        `);
      return res.json({
        role,
        stuckOnboarding: result.recordset[0]?.stuckOnboarding ?? 0,
      });
    }

    // admin
    const result = await pool.request()
      .input('centreId', sql.BigInt, centreId)
      .query(`
        SELECT COUNT(DISTINCT reg.PatientId) AS unassignedCases
        FROM (
          SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
          FROM PatientAuditLog pal
          JOIN Patient pt ON pt.Id = pal.PatientId
          JOIN Centre c ON c.Id = pt.CentreId
          JOIN AdminUser au ON au.Id = pal.AdminUserId
          WHERE pal.Type = 'CaseRegistered'
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND ${centreExclusion}
            AND (au.FirstName LIKE '%(Ops)%' OR au.LastName LIKE '%(Ops)%' OR au.Email LIKE '%(Ops)%')
          GROUP BY pal.PatientId
        ) reg
        WHERE NOT EXISTS (
          SELECT 1 FROM PatientAuditLog p2
          WHERE p2.PatientId = reg.PatientId AND p2.Type = 'CaseAssigned'
        )
      `);
    res.json({
      role,
      unassignedCases: result.recordset[0]?.unassignedCases ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
