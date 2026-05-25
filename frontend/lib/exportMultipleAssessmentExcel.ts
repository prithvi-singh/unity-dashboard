import type { MultipleAssessmentCase } from './types';
import { normalizeAssessmentType } from './assessmentBadges';
import { downloadExcelWorkbook } from './exportExcel';

function patientName(row: MultipleAssessmentCase): string {
  return `${row.firstName} ${row.lastName}`.trim() || 'Unknown';
}

function formatAssignedDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function exportMultipleAssessmentCasesToExcel(cases: MultipleAssessmentCase[]): void {
  const headers = [
    'Patient Name',
    'Patient ID',
    'Centre',
    'Assessment Type',
    'Clinician',
    'Status',
    'Result',
    'Assigned',
  ];

  const rows = cases.flatMap((row) =>
    row.assessments.map((assessment) => [
      patientName(row),
      row.patientDisplayId ? `#${row.patientDisplayId}` : String(row.patientId),
      row.centreName,
      normalizeAssessmentType(assessment.type),
      assessment.clinicianName ?? '—',
      assessment.status ?? '—',
      assessment.isResultGenerate ? 'Result generated' : 'Pending result',
      formatAssignedDate(assessment.assignedDate),
    ]),
  );

  downloadExcelWorkbook('Multi-assessment cases', headers, rows, 'multi-assessment-cases');
}
