'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion } = require('../lib/queryHelpers');

const router = Router();

const ASSESSMENT_TYPES = ['SPM', 'DP3', 'REELS', 'ISAA'];

/**
 * GET /api/assessments/overview
 * Query params: centreId (optional), dateFrom (optional), dateTo (optional)
 *
 * Returns assessment analytics across all four types: SPM, DP3, REELS, ISAA.
 * Source table: AllocatePatient (ap.Assessment column).
 */
router.get('/overview', async (req, res, next) => {
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

    // Shared filter fragments
    const centreFilter    = '(@centreId IS NULL OR c.Id = @centreId)';
    const centreExclusion = buildCentreExclusion('c');
    const dateFilter = buildDateFilter('ap.CreatedDateTimeUtc', '@dateFrom', '@dateTo');

    function bindAll(req) {
      return req
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo);
    }

    const [
      byTypeResult,
      byCentreResult,
      byClinicianResult,
      slowResult,
    ] = await Promise.all([

      // Q1: per-assessment-type summary
      bindAll(pool.request()).query(`
        SELECT
          ap.Assessment                                                        AS type,
          COUNT(*)                                                             AS total,
          SUM(CASE WHEN ap.IsResultGenerate = 1 THEN 1 ELSE 0 END)            AS completed,
          SUM(CASE WHEN ap.IsResultGenerate = 0 THEN 1 ELSE 0 END)            AS pending,
          AVG(
            CASE
              WHEN ap.IsResultGenerate = 1
                AND ap.UpdatedDateTimeUtc > ap.CreatedDateTimeUtc
              THEN CAST(DATEDIFF(day, ap.CreatedDateTimeUtc, ap.UpdatedDateTimeUtc) AS FLOAT)
              ELSE NULL
            END
          ) AS avgDaysToComplete,
          SUM(
            CASE
              WHEN ap.IsGoalApprovalRequested = 1 AND ap.IsResultGenerate = 0
              THEN 1 ELSE 0
            END
          ) AS goalApprovalPending
        FROM AllocatePatient ap
        LEFT JOIN Patient pt ON pt.Id = ap.PatientId
        LEFT JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${centreFilter}
          AND ${centreExclusion}
          AND ${dateFilter}
        GROUP BY ap.Assessment
      `),

      // Q2: per-centre pivot (one row per centre, columns per assessment type)
      bindAll(pool.request()).query(`
        SELECT
          c.Id           AS centreId,
          c.CentreName   AS centreName,
          SUM(CASE WHEN ap.Assessment = 'SPM'   THEN 1 ELSE 0 END)                       AS SPM_total,
          SUM(CASE WHEN ap.Assessment = 'SPM'   AND ap.IsResultGenerate = 1 THEN 1 ELSE 0 END) AS SPM_completed,
          SUM(CASE WHEN ap.Assessment = 'DP3'   THEN 1 ELSE 0 END)                       AS DP3_total,
          SUM(CASE WHEN ap.Assessment = 'DP3'   AND ap.IsResultGenerate = 1 THEN 1 ELSE 0 END) AS DP3_completed,
          SUM(CASE WHEN ap.Assessment = 'REELS' THEN 1 ELSE 0 END)                       AS REELS_total,
          SUM(CASE WHEN ap.Assessment = 'REELS' AND ap.IsResultGenerate = 1 THEN 1 ELSE 0 END) AS REELS_completed,
          SUM(CASE WHEN ap.Assessment = 'ISAA'  THEN 1 ELSE 0 END)                       AS ISAA_total,
          SUM(CASE WHEN ap.Assessment = 'ISAA'  AND ap.IsResultGenerate = 1 THEN 1 ELSE 0 END) AS ISAA_completed
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${centreFilter}
          AND ${centreExclusion}
          AND ${dateFilter}
        GROUP BY c.Id, c.CentreName
        ORDER BY c.CentreName
      `),

      // Q3: per-clinician capability matrix
      bindAll(pool.request()).query(`
        SELECT
          au.Id          AS clinicianId,
          au.FirstName   AS firstName,
          au.LastName    AS lastName,
          MAX(c.CentreName) AS centreName,
          SUM(CASE WHEN ap.Assessment = 'SPM'   THEN 1 ELSE 0 END)                       AS SPM_assigned,
          SUM(CASE WHEN ap.Assessment = 'SPM'   AND ap.IsResultGenerate = 1 THEN 1 ELSE 0 END) AS SPM_completed,
          SUM(CASE WHEN ap.Assessment = 'DP3'   THEN 1 ELSE 0 END)                       AS DP3_assigned,
          SUM(CASE WHEN ap.Assessment = 'DP3'   AND ap.IsResultGenerate = 1 THEN 1 ELSE 0 END) AS DP3_completed,
          SUM(CASE WHEN ap.Assessment = 'REELS' THEN 1 ELSE 0 END)                       AS REELS_assigned,
          SUM(CASE WHEN ap.Assessment = 'REELS' AND ap.IsResultGenerate = 1 THEN 1 ELSE 0 END) AS REELS_completed,
          SUM(CASE WHEN ap.Assessment = 'ISAA'  THEN 1 ELSE 0 END)                       AS ISAA_assigned,
          SUM(CASE WHEN ap.Assessment = 'ISAA'  AND ap.IsResultGenerate = 1 THEN 1 ELSE 0 END) AS ISAA_completed
        FROM AllocatePatient ap
        JOIN AdminUser au  ON au.Id  = ap.ClinicianUserId
        JOIN Patient pt    ON pt.Id  = ap.PatientId
        JOIN Centre c      ON c.Id   = pt.CentreId
        WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND ${centreFilter}
          AND ${centreExclusion}
          AND ${dateFilter}
          AND LOWER(au.FirstName) NOT LIKE '%test%'
          AND LOWER(au.LastName)  NOT LIKE '%test%'
          AND LOWER(au.Email)     NOT LIKE '%@webority.com'
        GROUP BY au.Id, au.FirstName, au.LastName
        ORDER BY au.LastName, au.FirstName
      `),

      // Q4: slow / overdue assessments — pending more than 14 days
      bindAll(pool.request()).query(`
        SELECT TOP 500
          ap.Id             AS allocatePatientId,
          ap.PatientId      AS patientId,
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''), ' ', ISNULL(pt.LastName,'')))) AS patientName,
          ap.Assessment     AS assessmentType,
          ISNULL(au.FirstName + ' ' + au.LastName, 'Unassigned') AS clinicianName,
          c.CentreName      AS centreName,
          ap.CreatedDateTimeUtc AS assignedDate,
          DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS daysPending
        FROM AllocatePatient ap
        JOIN Patient pt   ON pt.Id = ap.PatientId
        JOIN Centre c     ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        WHERE ap.IsResultGenerate = 0
          AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
          AND DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 14
          AND ${centreFilter}
          AND ${centreExclusion}
        ORDER BY daysPending DESC
      `),
    ]);

    // ── Shape byType (fill in zeros for any type with no rows) ───────────────
    const typeMap = new Map();
    for (const t of ASSESSMENT_TYPES) {
      typeMap.set(t, {
        type: t,
        total: 0,
        completed: 0,
        pending: 0,
        completionRate: 0,
        avgDaysToComplete: null,
        goalApprovalPending: 0,
      });
    }
    for (const row of byTypeResult.recordset) {
      const t = row.type;
      if (!ASSESSMENT_TYPES.includes(t)) continue;
      const total     = row.total ?? 0;
      const completed = row.completed ?? 0;
      typeMap.set(t, {
        type: t,
        total,
        completed,
        pending: row.pending ?? 0,
        completionRate: total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0,
        avgDaysToComplete: row.avgDaysToComplete != null
          ? parseFloat(Number(row.avgDaysToComplete).toFixed(1))
          : null,
        goalApprovalPending: row.goalApprovalPending ?? 0,
      });
    }
    const byType = [...typeMap.values()];

    // ── Shape byCentre ────────────────────────────────────────────────────────
    const byCentre = byCentreResult.recordset.map((r) => {
      function typeBlock(prefix) {
        const total     = r[`${prefix}_total`] ?? 0;
        const completed = r[`${prefix}_completed`] ?? 0;
        return {
          total,
          completed,
          completionRate: total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0,
        };
      }
      return {
        centreId:   r.centreId,
        centreName: r.centreName,
        SPM:   typeBlock('SPM'),
        DP3:   typeBlock('DP3'),
        REELS: typeBlock('REELS'),
        ISAA:  typeBlock('ISAA'),
      };
    });

    // ── Shape byClinician ─────────────────────────────────────────────────────
    const byClinician = byClinicianResult.recordset.map((r) => ({
      clinicianId: r.clinicianId,
      firstName:   r.firstName,
      lastName:    r.lastName,
      centreName:  r.centreName || null,
      SPM:   { assigned: r.SPM_assigned   ?? 0, completed: r.SPM_completed   ?? 0 },
      DP3:   { assigned: r.DP3_assigned   ?? 0, completed: r.DP3_completed   ?? 0 },
      REELS: { assigned: r.REELS_assigned ?? 0, completed: r.REELS_completed ?? 0 },
      ISAA:  { assigned: r.ISAA_assigned  ?? 0, completed: r.ISAA_completed  ?? 0 },
    }));

    // ── Shape slowAssessments ─────────────────────────────────────────────────
    const slowAssessments = slowResult.recordset.map((r) => ({
      allocatePatientId: r.allocatePatientId,
      patientId:         r.patientId,
      patientName:       (r.patientName ?? '').trim() || 'Unknown',
      assessmentType:    r.assessmentType,
      clinicianName:     r.clinicianName,
      centreName:        r.centreName,
      assignedDate:      r.assignedDate,
      daysPending:       r.daysPending ?? 0,
    }));

    res.json({ byType, byCentre, byClinician, slowAssessments });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
