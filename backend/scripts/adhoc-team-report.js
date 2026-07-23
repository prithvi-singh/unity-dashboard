'use strict';

/**
 * adhoc-team-report.js — One-off team report (June 1 – July 16 2026).
 *
 * Output: backend/scripts/output/team-report-<YYYY-MM-DD>.xlsx
 *
 * All queries apply the four DATA INTEGRITY FILTERS from filters.js:
 *   1. Test patients   — FirstName/LastName LIKE '%test%'
 *   2. Test users      — name/email pattern, webority, mailinator,
 *                         parivahealth, gmail
 *   3. Super Admin     — ar.Name NOT IN ('SuperAdmin','Super Admin')
 *   4. Deleted centres — CentreName LIKE '%test%' or '%delete%'
 *
 * Usage:  node backend/scripts/adhoc-team-report.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path   = require('path');
const fs     = require('fs');
const ExcelJS = require('exceljs');
const { sql, poolPromise } = require('../db');
const { FILTERS, EVENT_TYPES } = require('../utils/filters');
const { abbreviateCentre } = require('../lib/formatters');
// buildDateFilter from queryHelpers exists for non-CAST-to-DATE queries;
// this report uses CAST-to-DATE exclusively per the standard date filter spec.

// ── Constants ────────────────────────────────────────────────────────────────

const REPORT_FROM = '2026-06-01';
const REPORT_TO   = '2026-07-16';
const STALE_DAYS  = 30;

const OUTPUT_DIR = path.resolve(__dirname, 'output');

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtName(first, last) {
  return `${first ?? ''} ${last ?? ''}`.trim();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * CAST-to-DATE inclusive date filter.
 * Binds @from and @to as DATE-type parameters so every comparison is
 * CAST(column AS DATE) >= @from AND CAST(column AS DATE) <= @to.
 */
function castDateFilter(column, fromParam, toParam) {
  return `CAST(${column} AS DATE) >= ${fromParam} AND CAST(${column} AS DATE) <= ${toParam}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// SHEET 1 — Inactive Clinicians
// ──────────────────────────────────────────────────────────────────────────────

async function fetchInactiveClinicians(pool) {
  const UE = FILTERS.userExclusionStrict('au');
  const SA = FILTERS.superAdminExclusion('ar');

  const result = await pool.request().query(`
    SELECT
      au.Id,
      au.FirstName,
      au.LastName,
      au.Email,
      STUFF((
        SELECT ', ' + CentreName
        FROM (
          SELECT DISTINCT c2.CentreName
          FROM AdminUserCentre auc2
          JOIN Centre c2 ON c2.Id = auc2.CentreId
          WHERE auc2.AdminUserId = au.Id
            AND LOWER(c2.CentreName) NOT LIKE '%test%'
            AND LOWER(c2.CentreName) NOT LIKE '%delete%'
        ) dc
        ORDER BY CentreName
        FOR XML PATH(''), TYPE
      ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS centres,
      MAX(pal.CreatedDateTime) AS lastActivityDate,
      DATEDIFF(day, MAX(pal.CreatedDateTime), SYSDATETIMEOFFSET()) AS daysSinceActivity
    FROM AdminUser au
    JOIN AdminUserRole aur ON aur.UserId = au.Id
    JOIN AdminRole ar      ON ar.Id = aur.RoleId
      AND ar.Name = 'Clinician'
    LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
    WHERE ${UE}
      AND ${SA}
      AND EXISTS (
        SELECT 1 FROM AdminUserCentre auc3
        JOIN Centre c3 ON c3.Id = auc3.CentreId
        WHERE auc3.AdminUserId = au.Id
          AND LOWER(c3.CentreName) NOT LIKE '%test%'
          AND LOWER(c3.CentreName) NOT LIKE '%delete%'
      )
    GROUP BY au.Id, au.FirstName, au.LastName, au.Email
    HAVING MAX(pal.CreatedDateTime) IS NULL
      OR DATEDIFF(day, MAX(pal.CreatedDateTime), SYSDATETIMEOFFSET()) > ${STALE_DAYS}
    ORDER BY
      CASE WHEN MAX(pal.CreatedDateTime) IS NULL THEN 0 ELSE 1 END,
      daysSinceActivity DESC,
      au.LastName,
      au.FirstName
  `);

  return result.recordset.map((r) => ({
    name:             fmtName(r.FirstName, r.LastName),
    email:            r.Email,
    centres:          (r.centres || '')
      .split(', ')
      .filter(Boolean)
      .map(abbreviateCentre)
      .join(', '),
    lastActivityDate: r.lastActivityDate
      ? new Date(r.lastActivityDate).toISOString().slice(0, 10)
      : null,
    daysSince:        r.lastActivityDate != null ? r.daysSinceActivity : null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// SHEET 2 — Case Detail
// ──────────────────────────────────────────────────────────────────────────────

async function fetchCaseDetail(pool) {
  const CE = FILTERS.centreExclusion('c');
  const PE = FILTERS.patientExclusion('pt');
  const UE = FILTERS.userExclusion('au');

  const result = await pool.request()
    .input('dateFrom', sql.Date, REPORT_FROM)
    .input('dateTo',   sql.Date, REPORT_TO)
    .query(`
      -- Patients registered in the period (via CaseRegistered PAL event)
      WITH reg AS (
        SELECT DISTINCT pal.PatientId
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
        WHERE pal.Type = '${EVENT_TYPES.CASE_REGISTERED}'
          AND ${castDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo')}
          AND ${CE}
          AND ${PE}
          AND ${UE}
      ),

      -- Earliest registration date for each patient in the period
      reg_date AS (
        SELECT
          pal.PatientId,
          MIN(CAST(pal.CreatedDateTime AS DATE)) AS registeredDate
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
        WHERE pal.Type = '${EVENT_TYPES.CASE_REGISTERED}'
          AND ${castDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo')}
          AND ${CE}
          AND ${PE}
          AND ${UE}
          AND pal.PatientId IN (SELECT PatientId FROM reg)
        GROUP BY pal.PatientId
      ),

      -- All assessment assignments for registered patients
      assess AS (
        SELECT
          ap.PatientId,
          ap.Id              AS allocId,
          ap.Assessment,
          ap.ClinicianUserId,
          ap.Status,
          ap.UpdatedDateTimeUtc,
          CAST(ap.CreatedDateTimeUtc AS DATE) AS assignedDate,
          au_assigned.FirstName + ' ' + au_assigned.LastName AS assignedByName
        FROM AllocatePatient ap
        OUTER APPLY (
          SELECT TOP 1 pal3.AdminUserId
          FROM PatientAuditLog pal3
          WHERE pal3.AllocatePatientId = ap.Id
            AND pal3.Type = '${EVENT_TYPES.CASE_ASSIGNED}'
          ORDER BY pal3.CreatedDateTime
        ) firstAssign
        LEFT JOIN AdminUser au_assigned ON au_assigned.Id = firstAssign.AdminUserId
        WHERE ap.PatientId IN (SELECT PatientId FROM reg)
      ),

      -- Goal-approved assessments (Path 2 completion)
      goal_approved AS (
        SELECT DISTINCT ap.PatientId, ap.Id AS allocId
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest    pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient               ap   ON ap.Id   = pgar.AllocatePatientId
        WHERE pgarg.Status = 'Approved'
          AND ap.PatientId IN (SELECT PatientId FROM reg)
      ),

      -- Completed assessments: status terminal OR goals approved
      completed AS (
        SELECT PatientId, allocId FROM assess WHERE Status IN ('Completed', 'Closed')
        UNION
        SELECT ga.PatientId, ga.allocId
        FROM goal_approved ga
        LEFT JOIN assess a ON a.allocId = ga.allocId AND a.Status IN ('Completed', 'Closed')
        WHERE a.allocId IS NULL
      ),

      -- Completion date: earliest of CaseStatusChanged, goal approval, or UpdatedDateTimeUtc
      -- CaseStatusChanged events are rare (only 8 total); for direct status = Completed
      -- the UpdatedDateTimeUtc on AllocatePatient is the authoritative completion timestamp.
      comp_date AS (
        SELECT
          c.PatientId,
          MIN(dt.completedDate) AS completedDate
        FROM completed c
        CROSS APPLY (
          -- Path 3: CaseStatusChanged audit event (rare)
          SELECT MIN(CAST(pal2.CreatedDateTime AS DATE)) AS completedDate
          FROM PatientAuditLog pal2
          WHERE pal2.AllocatePatientId = c.allocId
            AND pal2.Type = '${EVENT_TYPES.CASE_STATUS_CHANGED}'
          UNION ALL
          -- Path 2: goal approval date
          SELECT MIN(CAST(pgarg.UpdatedDateTimeUtc AS DATE))
          FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          WHERE pgar.AllocatePatientId = c.allocId
            AND pgarg.Status = 'Approved'
          UNION ALL
          -- Path 1 & 3: AllocatePatient.UpdatedDateTimeUtc for status-based completions
          SELECT CAST(a_upd.UpdatedDateTimeUtc AS DATE)
          FROM assess a_upd
          WHERE a_upd.allocId = c.allocId
            AND a_upd.Status IN ('Completed', 'Closed')
        ) dt
        GROUP BY c.PatientId
      ),

      -- Aggregated assessment details per patient
      assess_agg AS (
        SELECT
          PatientId,
          STUFF((
            SELECT ', ' + Assessment
            FROM (SELECT DISTINCT a2.Assessment FROM assess a2 WHERE a2.PatientId = a.PatientId) da
            ORDER BY Assessment
            FOR XML PATH(''), TYPE
          ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS assessmentList,
          STUFF((
            SELECT ', ' + assignedDateStr
            FROM (
              SELECT DISTINCT
                a2.Assessment,
                CONVERT(varchar, a2.assignedDate, 23) AS assignedDateStr
              FROM assess a2 WHERE a2.PatientId = a.PatientId
            ) dd
            ORDER BY Assessment
            FOR XML PATH(''), TYPE
          ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS assignedDateList,
          STUFF((
            SELECT ', ' + assignedByName
            FROM (
              SELECT DISTINCT
                a2.Assessment,
                ISNULL(a2.assignedByName, '') AS assignedByName
              FROM assess a2 WHERE a2.PatientId = a.PatientId
            ) db
            ORDER BY Assessment
            FOR XML PATH(''), TYPE
          ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS assignedByList
        FROM assess a
        GROUP BY PatientId
      ),

      -- Aggregated clinician per patient
      clinician_agg AS (
        SELECT DISTINCT
          a.PatientId,
          au.FirstName + ' ' + au.LastName                    AS clinicianName,
          au.Email                                            AS clinicianEmail
        FROM assess a
        JOIN AdminUser au ON au.Id = a.ClinicianUserId
        JOIN AdminUserRole aur ON aur.UserId = au.Id
        JOIN AdminRole ar ON ar.Id = aur.RoleId AND ar.Name = 'Clinician'
        WHERE ${FILTERS.userExclusionStrict('au')}
          AND ${FILTERS.superAdminExclusion('ar')}
      ),

      -- Patient parent contact (first parent with email or phone)
      parent_contact AS (
        SELECT
          pp.PatientId,
          pp.Email       AS parentEmail,
          pp.PhoneNumber AS parentPhone
        FROM (
          SELECT
            pp2.PatientId,
            pp2.Email,
            pp2.PhoneNumber,
            ROW_NUMBER() OVER (PARTITION BY pp2.PatientId ORDER BY pp2.Id) AS rn
          FROM PatientParent pp2
          WHERE pp2.PatientId IN (SELECT PatientId FROM reg)
        ) pp
        WHERE pp.rn = 1
      )

      SELECT
        c.CentreName,
        pt.PatientID,
        pt.FirstName + ' ' + pt.LastName AS patientName,
        ISNULL(pc.parentEmail, '')        AS patientEmail,
        ISNULL(pc.parentPhone, '')        AS patientPhone,
        rd.registeredDate,
        ISNULL(aa.assessmentList, '')     AS assessmentList,
        ISNULL(aa.assignedDateList, '')   AS assignedDateList,
        ISNULL(aa.assignedByList, '')     AS assignedByList,
        STUFF((
          SELECT DISTINCT ', ' + cl2.clinicianName + ' (' + cl2.clinicianEmail + ')'
          FROM clinician_agg cl2
          WHERE cl2.PatientId = pt.Id
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS assignedClinicians,
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM assess a3 WHERE a3.PatientId = pt.Id)
            THEN 'Registered only'
          WHEN EXISTS (SELECT 1 FROM completed co WHERE co.PatientId = pt.Id)
            THEN 'Completed'
          ELSE 'Assigned, not completed'
        END AS caseStatus,
        cd.completedDate
      FROM Patient pt
      JOIN reg_date  rd ON rd.PatientId = pt.Id
      JOIN Centre     c ON c.Id         = pt.CentreId
      LEFT JOIN assess_agg    aa ON aa.PatientId = pt.Id
      LEFT JOIN comp_date     cd ON cd.PatientId = pt.Id
      LEFT JOIN parent_contact pc ON pc.PatientId = pt.Id
      WHERE ${CE}
        AND ${PE}
      ORDER BY c.CentreName, pt.PatientID
    `);

  return result.recordset.map((r) => ({
    centreName:           abbreviateCentre(r.CentreName),
    patientID:            r.PatientID,
    patientName:          r.patientName,
    email:                r.patientEmail,
    phone:                r.patientPhone,
    registeredDate:       r.registeredDate
      ? new Date(r.registeredDate).toISOString().slice(0, 10)
      : null,
    assessmentsAssigned:  r.assessmentList,
    assessmentAssignedDate: r.assignedDateList,
    assessmentAssignedBy:   r.assignedByList,
    assignedClinician:    r.assignedClinicians,
    status:               r.caseStatus,
    completedDate:        r.completedDate
      ? new Date(r.completedDate).toISOString().slice(0, 10)
      : null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// SHEET 3 — Centre Summary
// ──────────────────────────────────────────────────────────────────────────────

async function fetchCentreSummary(pool) {
  const CE = FILTERS.centreExclusion('c');
  const PE = FILTERS.patientExclusion('pt');
  const UE = FILTERS.userExclusion('au');

  const result = await pool.request()
    .input('dateFrom', sql.Date, REPORT_FROM)
    .input('dateTo',   sql.Date, REPORT_TO)
    .query(`
      -- Cases registered per centre (distinct patients)
      WITH registered AS (
        SELECT
          pt.CentreId,
          COUNT(DISTINCT pal.PatientId) AS registered
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
        WHERE pal.Type = '${EVENT_TYPES.CASE_REGISTERED}'
          AND ${castDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo')}
          AND ${CE}
          AND ${PE}
          AND ${UE}
        GROUP BY pt.CentreId
      ),

      -- Assessments assigned per centre
      assigned AS (
        SELECT
          pt.CentreId,
          COUNT(DISTINCT ap.Id) AS assigned
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        WHERE ${castDateFilter('ap.CreatedDateTimeUtc', '@dateFrom', '@dateTo')}
          AND ${CE}
          AND ${PE}
          AND ${UE}
        GROUP BY pt.CentreId
      ),

      -- Completed via status (Path 1 & 3)
      completed_status AS (
        SELECT
          pt.CentreId,
          COUNT(DISTINCT ap.Id) AS completed
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        JOIN PatientAuditLog pal ON pal.AllocatePatientId = ap.Id
          AND pal.Type = '${EVENT_TYPES.CASE_STATUS_CHANGED}'
          AND ${castDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo')}
        LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
        WHERE ap.Status IN ('Completed', 'Closed')
          AND ${CE}
          AND ${PE}
          AND ${UE}
        GROUP BY pt.CentreId
      ),

      -- Completed via goals (Path 2)
      completed_goals AS (
        SELECT
          pt.CentreId,
          COUNT(DISTINCT ap.Id) AS completed
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        WHERE pgarg.Status = 'Approved'
          AND ${castDateFilter('pgarg.UpdatedDateTimeUtc', '@dateFrom', '@dateTo')}
          AND ${CE}
          AND ${PE}
          AND ${UE}
          AND ap.Status NOT IN ('Completed', 'Closed')
        GROUP BY pt.CentreId
      ),

      -- Merged completed (deduplicated across both paths)
      completed_merged AS (
        SELECT CentreId, SUM(completed) AS completed
        FROM (
          SELECT CentreId, completed FROM completed_status
          UNION ALL
          SELECT CentreId, completed FROM completed_goals
        ) u
        GROUP BY CentreId
      ),

      -- Managers at each centre
      managers AS (
        SELECT
          auc.CentreId,
          STUFF((
            SELECT ', ' + au2.FirstName + ' ' + au2.LastName + ' (' + au2.Email + ')'
            FROM AdminUserCentre auc2
            JOIN AdminUser au2 ON au2.Id = auc2.AdminUserId
            JOIN AdminUserRole aur2 ON aur2.UserId = au2.Id
            JOIN AdminRole ar2 ON ar2.Id = aur2.RoleId
              AND ar2.Name = 'CentreManager'
            WHERE auc2.CentreId = auc.CentreId
              AND ${FILTERS.userExclusionStrict('au2')}
              AND ${FILTERS.superAdminExclusion('ar2')}
            ORDER BY au2.FirstName, au2.LastName
            FOR XML PATH(''), TYPE
          ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS managerList
        FROM AdminUserCentre auc
        WHERE EXISTS (
          SELECT 1 FROM AdminUser au3
          JOIN AdminUserRole aur3 ON aur3.UserId = au3.Id
          JOIN AdminRole ar3 ON ar3.Id = aur3.RoleId
          WHERE au3.Id = auc.AdminUserId
            AND ar3.Name = 'CentreManager'
            AND ${FILTERS.superAdminExclusion('ar3')}
            AND ${FILTERS.userExclusionStrict('au3')}
        )
        GROUP BY auc.CentreId
      )

      SELECT
        c.CentreName,
        ISNULL(r.registered, 0)   AS registered,
        ISNULL(a.assigned,   0)   AS assigned,
        ISNULL(cm.completed,  0)  AS completed,
        ISNULL(m.managerList, '') AS managers
      FROM Centre c
      LEFT JOIN registered        r  ON r.CentreId  = c.Id
      LEFT JOIN assigned          a  ON a.CentreId  = c.Id
      LEFT JOIN completed_merged  cm ON cm.CentreId = c.Id
      LEFT JOIN managers          m  ON m.CentreId  = c.Id
      WHERE ${CE}
        AND (r.CentreId IS NOT NULL OR a.CentreId IS NOT NULL OR cm.CentreId IS NOT NULL)
      ORDER BY
        (ISNULL(a.assigned, 0) - ISNULL(cm.completed, 0)) DESC,
        c.CentreName
    `);

  const rows = result.recordset.map((r) => ({
    centreName:                abbreviateCentre(r.CentreName),
    casesRegistered:           r.registered,
    assessmentsAssigned:       r.assigned,
    notYetAssigned:            r.registered - r.assigned,
    assessmentsCompleted:      r.completed,
    assignedButNotCompleted:   r.assigned - r.completed,
    managers:                  r.managers,
  }));

  const totals = {
    casesRegistered:         rows.reduce((s, r) => s + r.casesRegistered, 0),
    assessmentsAssigned:     rows.reduce((s, r) => s + r.assessmentsAssigned, 0),
    notYetAssigned:          rows.reduce((s, r) => s + r.notYetAssigned, 0),
    assessmentsCompleted:    rows.reduce((s, r) => s + r.assessmentsCompleted, 0),
    assignedButNotCompleted: rows.reduce((s, r) => s + r.assignedButNotCompleted, 0),
  };

  return { rows, totals };
}

// ──────────────────────────────────────────────────────────────────────────────
// Excel generator
// ──────────────────────────────────────────────────────────────────────────────

const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
const AMBER_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBA7517' } };

function styleHeaderRow(ws, rowNum, columnCount) {
  const row = ws.getRow(rowNum);
  for (let i = 1; i <= columnCount; i++) {
    const cell = row.getCell(i);
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  row.height = 22;
}

function addTitleRow(ws, text, colCount) {
  const range = String.fromCharCode(64 + colCount); // A–Z
  ws.insertRow(1, [text]);
  ws.mergeCells(`A1:${range}1`);
  const row = ws.getRow(1);
  row.font = { bold: true, size: 12, color: { argb: 'FF2F5496' } };
  row.height = 24;
  row.alignment = { horizontal: 'left', vertical: 'middle' };
}

function buildWorkbook(inactiveClinicians, caseDetailRows, centreSummaryRows, centreSummaryTotals) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Unity Dashboard (adhoc-team-report)';
  wb.created = new Date();

  // ── Sheet 1: Inactive Clinicians ──────────────────────────────────────────
  const ws1 = wb.addWorksheet('Inactive Clinicians');

  ws1.columns = [
    { header: 'Name',              key: 'name',             width: 28 },
    { header: 'Email',             key: 'email',            width: 36 },
    { header: 'Centres',           key: 'centres',          width: 44 },
    { header: 'Last Activity Date', key: 'lastActivityDate', width: 20 },
    { header: 'Days Since',        key: 'daysSince',        width: 14 },
  ];

  styleHeaderRow(ws1, 1, 5);

  if (inactiveClinicians.length === 0) {
    ws1.addRow({ name: '(none)', email: '', centres: '', lastActivityDate: '', daysSince: '' });
  } else {
    for (const r of inactiveClinicians) ws1.addRow(r);
  }

  ws1.getColumn(5).alignment = { horizontal: 'center' };
  for (let i = 2; i <= ws1.rowCount; i++) {
    const cell = ws1.getRow(i).getCell(5);
    if (cell.value == null) cell.value = '';
  }

  // Light fill for clinicians with zero activity ever
  for (let i = 2; i <= ws1.rowCount; i++) {
    const row = ws1.getRow(i);
    const daysCell = row.getCell(5);
    if (daysCell.value === '' || daysCell.value == null) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
      });
    }
  }

  // ── Sheet 2: Case Detail ──────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Case Detail');

  ws2.columns = [
    { header: 'Centre',               key: 'centreName',           width: 28 },
    { header: 'Patient ID',           key: 'patientID',            width: 16 },
    { header: 'Patient Name',         key: 'patientName',          width: 26 },
    { header: 'Email',                key: 'email',                width: 34 },
    { header: 'Phone',                key: 'phone',                width: 18 },
    { header: 'Case Registered Date', key: 'registeredDate',       width: 20 },
    { header: 'Assessment(s) Assigned', key: 'assessmentsAssigned', width: 36 },
    { header: 'Assessment Assigned Date', key: 'assessmentAssignedDate', width: 22 },
    { header: 'Assessment Assigned By',   key: 'assessmentAssignedBy',   width: 28 },
    { header: 'Assigned Clinician',   key: 'assignedClinician',    width: 38 },
    { header: 'Status',               key: 'status',               width: 24 },
    { header: 'Completed Date',       key: 'completedDate',        width: 18 },
  ];

  addTitleRow(ws2, `Period: ${REPORT_FROM} to ${REPORT_TO}`, 12);
  styleHeaderRow(ws2, 2, 12);

  for (const r of caseDetailRows) {
    const row = ws2.addRow(r);
    row.getCell(2).alignment  = { horizontal: 'center' };
    row.getCell(6).alignment  = { horizontal: 'center' };
    row.getCell(11).alignment = { horizontal: 'center' };
    row.getCell(12).alignment = { horizontal: 'center' };
  }

  // ── Sheet 3: Centre Summary ───────────────────────────────────────────────
  const ws3 = wb.addWorksheet('Centre Summary');

  ws3.columns = [
    { header: 'Centre',                    key: 'centreName',              width: 28 },
    { header: 'Cases Registered',          key: 'casesRegistered',         width: 18 },
    { header: 'Assessments Assigned',      key: 'assessmentsAssigned',     width: 22 },
    { header: 'Not Yet Assigned',          key: 'notYetAssigned',          width: 18 },
    { header: 'Assessments Completed',     key: 'assessmentsCompleted',    width: 22 },
    { header: 'Assigned But Not Completed', key: 'assignedButNotCompleted', width: 26 },
    { header: 'Managers at Centre',        key: 'managers',                width: 44 },
  ];

  addTitleRow(ws3, `Period: ${REPORT_FROM} to ${REPORT_TO}`, 7);
  styleHeaderRow(ws3, 2, 7);

  for (const r of centreSummaryRows) {
    const row = ws3.addRow(r);
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'center' };
    row.getCell(6).alignment = { horizontal: 'center' };

    // Conditional formatting: amber fill on "Not Yet Assigned" (col 4)
    // and "Assigned But Not Completed" (col 6) when value > 0
    if (r.notYetAssigned > 0) {
      row.getCell(4).fill = AMBER_FILL;
    }
    if (r.assignedButNotCompleted > 0) {
      row.getCell(6).fill = AMBER_FILL;
    }
  }

  // TOTAL row
  if (centreSummaryRows.length > 0) {
    const totalRow = ws3.addRow({
      centreName:              'TOTAL',
      casesRegistered:         centreSummaryTotals.casesRegistered,
      assessmentsAssigned:     centreSummaryTotals.assessmentsAssigned,
      notYetAssigned:          centreSummaryTotals.notYetAssigned,
      assessmentsCompleted:    centreSummaryTotals.assessmentsCompleted,
      assignedButNotCompleted: centreSummaryTotals.assignedButNotCompleted,
      managers:                '',
    });
    totalRow.font = { bold: true };
    totalRow.getCell(1).alignment = { horizontal: 'right' };
    for (let i = 2; i <= 6; i++) {
      totalRow.getCell(i).alignment = { horizontal: 'center' };
    }
    totalRow.eachCell((cell) => {
      cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    });

    // Amber on totals too
    if (centreSummaryTotals.notYetAssigned > 0) {
      totalRow.getCell(4).fill = AMBER_FILL;
    }
    if (centreSummaryTotals.assignedButNotCompleted > 0) {
      totalRow.getCell(6).fill = AMBER_FILL;
    }
  }

  return wb;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('[adhoc-team-report] Connecting...');
  const pool = await poolPromise;

  const [inactiveClinicians, caseDetailRows, centreSummaryData] = await Promise.all([
    fetchInactiveClinicians(pool),
    fetchCaseDetail(pool),
    fetchCentreSummary(pool),
  ]);
  await pool.close();

  // ── Build and write Excel ─────────────────────────────────────────────────
  const wb = buildWorkbook(inactiveClinicians, caseDetailRows, centreSummaryData.rows, centreSummaryData.totals);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const nameBase  = `team-report-${todayStr()}`;
  const nameStamp = `team-report-${todayStr()}-${String(Date.now() % 86400000).padStart(5, '0')}`;
  let filepath = null;

  for (const name of [nameBase, nameStamp]) {
    const candidate = path.join(OUTPUT_DIR, `${name}.xlsx`);
    try {
      await wb.xlsx.writeFile(candidate);
      filepath = candidate;
      break;
    } catch (e) {
      if (e.code !== 'EBUSY') throw e;
    }
  }
  if (!filepath) throw new Error('Could not write — output file is locked. Close the previous report and retry.');

  // ── Headline counts only (no PII) ─────────────────────────────────────────
  const { totals: t } = centreSummaryData;

  console.log(`\nInactive clinicians:     ${inactiveClinicians.length}`);
  console.log(`Cases registered:         ${t.casesRegistered}`);
  console.log(`Assessments assigned:     ${t.assessmentsAssigned}`);
  console.log(`Assessments completed:    ${t.assessmentsCompleted}`);
  console.log(`Assigned but not completed: ${t.assignedButNotCompleted}`);
  console.log(`\nWrote: ${filepath}`);
}

run().catch((err) => {
  console.error('[adhoc-team-report] ERROR:', err);
  process.exit(1);
});
