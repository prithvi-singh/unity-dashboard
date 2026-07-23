'use strict';

/**
 * pending-approvals.js — Ad-hoc: reports submitted but PDF not yet generated.
 *
 * Output: backend/scripts/output/pending-approvals-<YYYY-MM-DD>.xlsx
 *
 * Usage:  node backend/scripts/pending-approvals.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path   = require('path');
const fs     = require('fs');
const ExcelJS = require('exceljs');
const { sql, poolPromise } = require('../db');

const REPORT_FROM = '2026-06-01';

const OUTPUT_DIR = path.resolve(__dirname, 'output');

// ── Excel helpers ─────────────────────────────────────────────────────────────

const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
const AMBER_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBA7517' } };

function styleHeaderRow(ws, rowNum, colCount) {
  const row = ws.getRow(rowNum);
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i);
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  row.height = 22;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDaysWaiting(submittedDate) {
  const submitted = new Date(submittedDate);
  const today = new Date();
  const diff = Math.floor((today - submitted) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff : 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('[pending-approvals] Connecting...');
  const pool = await poolPromise;

  const result = await pool.request()
    .input('from', sql.Date, REPORT_FROM)
    .input('to',   sql.Date, todayStr())
    .query(`
      WITH ReportEvents AS (
          SELECT
              pal.AllocatePatientId,
              MAX(CASE WHEN pal.Type = 'ReportAdded' THEN pal.CreatedDateTime END) AS ReportSubmittedDate,
              MAX(CASE WHEN pal.Type = 'ReportPDFGenerated' THEN pal.CreatedDateTime END) AS ReportApprovedDate
          FROM PatientAuditLog pal
          WHERE pal.Type IN ('ReportAdded', 'ReportPDFGenerated')
          GROUP BY pal.AllocatePatientId
      )
      SELECT
          p.PatientID                                AS [Child ID],
          p.FirstName + ' ' + p.LastName              AS [Child Name],
          c.CentreName                                AS [Centre Name],
          au.FirstName + ' ' + au.LastName            AS [Clinician Name],
          ap.Assessment                               AS [Type of Assessment],
          CAST(ap.CreatedDateTimeUtc AS DATE)         AS [Assigned Date],
          'Pending Approval'                          AS [Status],
          CAST(re.ReportSubmittedDate AS DATE)        AS [Date Report Submitted for Approval]
      FROM AllocatePatient ap
      JOIN Patient p    ON p.Id = ap.PatientId
      JOIN Centre c     ON c.Id = p.CentreId
      JOIN AdminUser au ON au.Id = ap.ClinicianUserId
      JOIN ReportEvents re ON re.AllocatePatientId = ap.Id
      WHERE re.ReportSubmittedDate IS NOT NULL
        AND re.ReportApprovedDate IS NULL
        AND p.FirstName NOT LIKE '%test%'
        AND p.LastName  NOT LIKE '%test%'
        AND au.Email NOT LIKE '%@webority.com'
        AND au.Email NOT LIKE '%@mailinator.com'
        AND c.CentreName NOT LIKE '%DELETE%'
        AND CAST(ap.CreatedDateTimeUtc AS DATE) >= @from
        AND CAST(ap.CreatedDateTimeUtc AS DATE) <= @to
      ORDER BY ap.CreatedDateTimeUtc
    `);

  const rows = result.recordset;

  console.log(`\n─── Pending Approvals (${rows.length} rows) ───\n`);
  if (rows.length === 0) {
    console.log('  (none)');
  } else {
    console.table(rows);
  }

  await pool.close();

  // ── Build Excel workbook ──────────────────────────────────────────────────

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Unity Dashboard (pending-approvals)';
  wb.created = new Date();

  const ws = wb.addWorksheet('Pending Approvals');

  ws.columns = [
    { header: 'Child ID',                             key: 'childId',          width: 14 },
    { header: 'Child Name',                           key: 'childName',        width: 26 },
    { header: 'Centre Name',                          key: 'centreName',       width: 46 },
    { header: 'Clinician Name',                       key: 'clinicianName',    width: 30 },
    { header: 'Type of Assessment',                   key: 'assessment',       width: 20 },
    { header: 'Assigned Date',                        key: 'assignedDate',     width: 16 },
    { header: 'Status',                               key: 'status',           width: 18 },
    { header: 'Date Report Submitted for Approval',   key: 'reportSubmitted',  width: 34 },
    { header: 'Days Waiting',                         key: 'daysWaiting',      width: 15 },
  ];

  styleHeaderRow(ws, 1, 9);

  // Data rows
  for (const r of rows) {
    const submittedDate = r['Date Report Submitted for Approval'];
    const days = fmtDaysWaiting(submittedDate);

    const row = ws.addRow({
      childId:        r['Child ID'],
      childName:      r['Child Name'],
      centreName:     r['Centre Name'],
      clinicianName:  r['Clinician Name'],
      assessment:     r['Type of Assessment'],
      assignedDate:   r['Assigned Date'] ? new Date(r['Assigned Date']).toISOString().slice(0, 10) : '',
      status:         r['Status'],
      reportSubmitted: submittedDate ? new Date(submittedDate).toISOString().slice(0, 10) : '',
      daysWaiting:    days,
    });

    // Center-align numeric/date columns
    row.getCell(1).alignment  = { horizontal: 'center' };
    row.getCell(6).alignment  = { horizontal: 'center' };
    row.getCell(7).alignment  = { horizontal: 'center' };
    row.getCell(8).alignment  = { horizontal: 'center' };
    row.getCell(9).alignment  = { horizontal: 'center' };

    // Amber highlight for anything waiting > 7 days
    if (days > 7) {
      row.getCell(9).fill = AMBER_FILL;
    }
  }

  // ── Summary sheet ─────────────────────────────────────────────────────────

  const ws2 = wb.addWorksheet('Summary');

  // Count by centre
  const centreMap = new Map();
  for (const r of rows) {
    const name = r['Centre Name'];
    centreMap.set(name, (centreMap.get(name) || 0) + 1);
  }
  const centreCounts = [...centreMap.entries()].sort((a, b) => b[1] - a[1]);

  // Count by assessment type
  const assessMap = new Map();
  for (const r of rows) {
    const type = r['Type of Assessment'];
    assessMap.set(type, (assessMap.get(type) || 0) + 1);
  }

  ws2.columns = [
    { header: 'Metric',  key: 'metric',  width: 36 },
    { header: 'Value',   key: 'value',   width: 20 },
  ];
  styleHeaderRow(ws2, 1, 2);

  ws2.addRow({ metric: 'Total Reports Pending Approval', value: rows.length }).font = { bold: true };
  ws2.addRow({ metric: '', value: '' });
  ws2.addRow({ metric: '─── By Assessment Type ───', value: '' }).font = { bold: true };
  for (const [type, count] of assessMap) {
    ws2.addRow({ metric: `  ${type}`, value: count });
  }
  ws2.addRow({ metric: '', value: '' });
  ws2.addRow({ metric: '─── By Centre ───', value: '' }).font = { bold: true };
  for (const [name, count] of centreCounts) {
    ws2.addRow({ metric: `  ${name}`, value: count });
  }

  ws2.getColumn(2).alignment = { horizontal: 'center' };

  // ── Write file ────────────────────────────────────────────────────────────

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `pending-approvals-${todayStr()}.xlsx`);
  await wb.xlsx.writeFile(outPath);

  console.log(`\nWrote: ${outPath}`);
  console.log(`  • ${rows.length} reports pending approval`);
  console.log(`  • ${centreCounts.length} centres affected`);
  console.log(`  • Assessment types: ${[...assessMap.keys()].join(', ')}`);
}

run().catch((err) => {
  console.error('[pending-approvals] ERROR:', err);
  process.exit(1);
});
