'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter } = require('../lib/queryHelpers');
const { buildClinicalPipelineQuery, mapPipelineRow } = require('../lib/clinicalPipelineQueries');

const router = Router();

/**
 * GET /api/overview
 * Query params: centreId (optional), dateFrom (optional), dateTo (optional)
 *
 * Returns aggregate counts from PatientAuditLog, a per-centre breakdown,
 * and the full list of centres for the filter dropdown.
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

    const dateFilter = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
    const centreFilter = '(@centreId IS NULL OR c.Id = @centreId)';
    // Exclude test/demo and deleted centres regardless of letter case
    const centreExclusion = `LOWER(c.CentreName) NOT LIKE '%test%'
                         AND LOWER(c.CentreName) NOT LIKE '%delete%'`;
    const whereClause = `WHERE ${centreFilter} AND ${centreExclusion} AND ${dateFilter}`;

    function bindParams(request) {
      request
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo);
      return request;
    }

    const filteredCasesCte = `
      WITH filtered_cases AS (
        SELECT DISTINCT pal.PatientId
        FROM PatientAuditLog pal
        JOIN Patient p ON p.Id = pal.PatientId
        JOIN Centre c  ON c.Id = p.CentreId
        WHERE pal.Type = 'CaseRegistered'
          AND ${centreFilter}
          AND ${centreExclusion}
          AND ${dateFilter}
      ),
      multi_patients AS (
        SELECT ap.PatientId
        FROM AllocatePatient ap
        INNER JOIN filtered_cases fc ON fc.PatientId = ap.PatientId
        GROUP BY ap.PatientId
        HAVING COUNT(*) >= 2
      )`;

    // Run all 4 queries in parallel
    const [countsResult, byCentreResult, centresResult, multiAssessmentResult, pipelineResult] = await Promise.all([

      // Query A: total counts grouped by Type
      bindParams(pool.request()).query(`
        SELECT pal.Type, COUNT(*) AS count
        FROM PatientAuditLog pal
        JOIN Patient p ON p.Id = pal.PatientId
        JOIN Centre c  ON c.Id = p.CentreId
        ${whereClause}
        GROUP BY pal.Type
      `),

      // Query B: per-centre pipeline counts (assessment-level where applicable)
      bindParams(pool.request()).query(`
        WITH centre_base AS (
          SELECT c.Id AS centreId, c.CentreName
          FROM Centre c
          WHERE ${centreExclusion}
            AND ${centreFilter.replace(/c\.Id/g, 'c.Id')}
        ),
        reg AS (
          SELECT p.CentreId, COUNT(DISTINCT pal.PatientId) AS cases
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre c ON c.Id = p.CentreId
          WHERE pal.Type = 'CaseRegistered'
            AND ${centreFilter}
            AND ${centreExclusion}
            AND ${dateFilter}
          GROUP BY p.CentreId
        ),
        asgn AS (
          SELECT p.CentreId, COUNT(DISTINCT pal.AllocatePatientId) AS assessments
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre c ON c.Id = p.CentreId
          WHERE pal.Type = 'CaseAssigned'
            AND pal.AllocatePatientId IS NOT NULL
            AND ${centreFilter}
            AND ${centreExclusion}
            AND ${dateFilter}
          GROUP BY p.CentreId
        ),
        scored AS (
          SELECT p.CentreId, COUNT(DISTINCT pal.AllocatePatientId) AS scoringComplete
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre c ON c.Id = p.CentreId
          WHERE pal.Type = 'AssessmentResultGenerated'
            AND pal.AllocatePatientId IS NOT NULL
            AND ${centreFilter}
            AND ${centreExclusion}
            AND ${dateFilter}
          GROUP BY p.CentreId
        ),
        pdf AS (
          SELECT p.CentreId, COUNT(DISTINCT pal.AllocatePatientId) AS reportPdfCreated
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre c ON c.Id = p.CentreId
          WHERE pal.Type = 'ReportPDFGenerated'
            AND pal.AllocatePatientId IS NOT NULL
            AND ${centreFilter}
            AND ${centreExclusion}
            AND ${dateFilter}
          GROUP BY p.CentreId
        ),
        shared AS (
          SELECT pt.CentreId, COUNT(DISTINCT apr.AllocatePatientId) AS reportShared
          FROM AllocatePatientReport apr
          JOIN AllocatePatient ap ON ap.Id = apr.AllocatePatientId
          JOIN Patient pt ON pt.Id = ap.PatientId
          JOIN Centre c ON c.Id = pt.CentreId
          WHERE ${centreFilter}
            AND ${centreExclusion}
            AND (${dateFilter.replace(/pal\.CreatedDateTime/g, 'apr.CreatedDateTimeUtc')})
          GROUP BY pt.CentreId
        ),
        -- Pipeline snapshot: current open caseload per centre (not date-filtered)
        -- Shows where active assessments are right now regardless of when they were assigned
        snap AS (
          SELECT
            c.Id AS centreId,
            COUNT(ap.Id)                                                                              AS snapAssigned,
            SUM(CASE WHEN ap.IsResultGenerate = 1 THEN 1 ELSE 0 END)                                AS snapScored,
            SUM(CASE WHEN pdfEvt.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END)                   AS snapPdf,
            SUM(CASE WHEN sharedEvt.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END)                AS snapShared
          FROM AllocatePatient ap
          JOIN Patient pt ON pt.Id = ap.PatientId
          JOIN Centre c   ON c.Id  = pt.CentreId
          LEFT JOIN (
            SELECT DISTINCT AllocatePatientId
            FROM PatientAuditLog
            WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
          ) pdfEvt ON pdfEvt.AllocatePatientId = ap.Id
          LEFT JOIN (
            SELECT DISTINCT AllocatePatientId
            FROM AllocatePatientReport
          ) sharedEvt ON sharedEvt.AllocatePatientId = ap.Id
          WHERE ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
            AND ${centreExclusion}
            AND ${centreFilter}
          GROUP BY c.Id
        )
        SELECT
          cb.centreId,
          cb.CentreName,
          ISNULL(reg.cases, 0)              AS cases,
          ISNULL(asgn.assessments, 0)       AS assessments,
          ISNULL(scored.scoringComplete, 0) AS scoringComplete,
          ISNULL(pdf.reportPdfCreated, 0)   AS reportPdfCreated,
          ISNULL(shared.reportShared, 0)    AS reportShared,
          ISNULL(snap.snapAssigned, 0)      AS snapAssigned,
          ISNULL(snap.snapScored, 0)        AS snapScored,
          ISNULL(snap.snapPdf, 0)           AS snapPdf,
          ISNULL(snap.snapShared, 0)        AS snapShared
        FROM centre_base cb
        LEFT JOIN reg    ON reg.CentreId    = cb.centreId
        LEFT JOIN asgn   ON asgn.CentreId   = cb.centreId
        LEFT JOIN scored ON scored.CentreId = cb.centreId
        LEFT JOIN pdf    ON pdf.CentreId    = cb.centreId
        LEFT JOIN shared ON shared.CentreId = cb.centreId
        LEFT JOIN snap   ON snap.centreId   = cb.centreId
        ORDER BY cb.CentreName
      `),

      // Query C: all centres for dropdown (test/deleted entries excluded)
      pool.request().query(`
        SELECT Id, CentreName AS name
        FROM Centre
        WHERE LOWER(CentreName) NOT LIKE '%test%'
          AND LOWER(CentreName) NOT LIKE '%delete%'
        ORDER BY CentreName
      `),

      // Query D: patients with 2+ assessment assignments (AllocatePatient)
      bindParams(pool.request()).query(`
        ${filteredCasesCte}
        SELECT
          pt.Id AS patientId,
          pt.PatientID AS patientDisplayId,
          pt.FirstName AS firstName,
          pt.LastName AS lastName,
          c.CentreName AS centreName,
          ap.Id AS allocatePatientId,
          ap.Assessment AS type,
          ap.Status AS status,
          ap.IsResultGenerate AS isResultGenerate,
          ap.CreatedDateTimeUtc AS assignedDate,
          LTRIM(RTRIM(CONCAT(ISNULL(au.FirstName, ''), ' ', ISNULL(au.LastName, '')))) AS clinicianName
        FROM multi_patients mp
        JOIN Patient pt ON pt.Id = mp.PatientId
        JOIN Centre c ON c.Id = pt.CentreId
        JOIN AllocatePatient ap ON ap.PatientId = mp.PatientId
        LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        ORDER BY c.CentreName, pt.LastName, pt.FirstName, ap.CreatedDateTimeUtc
      `),

      // Query E: assessment-level clinical pipeline funnel
      bindParams(pool.request()).query(buildClinicalPipelineQuery()),
    ]);

    // Build type → count lookup
    const typeMap = {};
    for (const row of countsResult.recordset) {
      typeMap[row.Type] = row.count;
    }

    const totalCases = typeMap['CaseRegistered'] || 0;
    const multipleAssessmentCases = buildMultipleAssessmentCases(
      multiAssessmentResult.recordset,
      totalCases,
    );

    const pipeline = mapPipelineRow(pipelineResult.recordset[0] || {});

    res.json({
      totalCases,
      totalAssessments: pipeline.assigned || typeMap['CaseAssigned'] || 0,
      totalScoringComplete: pipeline.scoringComplete,
      totalResults: pipeline.reportPdfCreated,
      totalTransfers:   typeMap['CaseTransfer']    || 0,
      totalStatusChanges: typeMap['CaseStatusChanged'] || 0,
      pipeline,
      multipleAssessmentCases,
      byCentre: byCentreResult.recordset.map((r) => ({
        centreId:    r.centreId,
        centreName:  r.CentreName,
        cases:       r.cases,
        assessments: r.assessments,
        scoringComplete: r.scoringComplete ?? 0,
        reportPdfCreated: r.reportPdfCreated ?? 0,
        reportShared: r.reportShared ?? 0,
        /** @deprecated use reportPdfCreated */
        results:     r.reportPdfCreated ?? 0,
        // Pipeline snapshot — current open caseload (not date-filtered)
        snapAssigned: r.snapAssigned ?? 0,
        snapScored:   r.snapScored   ?? 0,
        snapPdf:      r.snapPdf      ?? 0,
        snapShared:   r.snapShared   ?? 0,
      })),
      centres: centresResult.recordset.map((r) => ({
        id:   r.Id,
        name: r.name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

function buildMultipleAssessmentCases(rows, totalCases) {
  const caseMap = new Map();

  for (const row of rows) {
    if (!caseMap.has(row.patientId)) {
      caseMap.set(row.patientId, {
        patientId: row.patientId,
        patientDisplayId: row.patientDisplayId ?? null,
        firstName: row.firstName ?? '',
        lastName: row.lastName ?? '',
        centreName: row.centreName ?? '',
        assessments: [],
        totalAssessments: 0,
      });
    }

    const entry = caseMap.get(row.patientId);
    entry.assessments.push({
      allocatePatientId: row.allocatePatientId,
      type: row.type ?? null,
      status: row.status ?? null,
      isResultGenerate: !!row.isResultGenerate,
      assignedDate: row.assignedDate ? new Date(row.assignedDate).toISOString() : null,
      clinicianName: (row.clinicianName ?? '').trim() || null,
    });
    entry.totalAssessments = entry.assessments.length;
  }

  const cases = Array.from(caseMap.values());
  const count = cases.length;
  const percentage = totalCases > 0
    ? Math.round((count / totalCases) * 1000) / 10
    : 0;

  return { count, percentage, cases };
}

module.exports = router;
