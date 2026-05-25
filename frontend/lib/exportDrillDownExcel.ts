import { formatEventAt, formatWaitingHours } from './bottleneckDrillDown';
import { parseDrillDownDetail } from './drillDownDisplay';
import { downloadExcelWorkbook } from './exportExcel';

export interface DrillDownExportItem {
  patientName: string;
  patientCode: string | null;
  patientId: number;
  centreName: string;
  category: string | null;
  status: string | null;
  eventAt: string | null;
  waitingHours: number | null;
  detail: string | null;
}

function parseIdleDetailForExport(detail: string | null): { caseName: string; assessment: string; email: string } {
  const lines = parseDrillDownDetail(detail);
  let caseName = '';
  let assessment = '';
  let email = '';
  for (const line of lines) {
    if (line.label === 'Case') caseName = line.value;
    else if (line.label === 'Assessment') assessment = line.value;
    else if (line.label === 'Email') email = line.value;
  }
  return { caseName, assessment, email };
}

export function exportDrillDownToExcel(
  title: string,
  items: DrillDownExportItem[],
  options?: { isUserList?: boolean },
): void {
  const isUserList = options?.isUserList ?? false;

  if (isUserList) {
    const headers = ['Clinician', 'Centre', 'Case', 'Assessment', 'Last Activity', 'Status', 'Days Idle'];
    const rows = items.map((item) => {
      const { caseName, assessment } = parseIdleDetailForExport(item.detail);
      return [
        item.patientName,
        item.centreName,
        caseName,
        assessment,
        formatEventAt(item.eventAt),
        item.status ?? '',
        item.waitingHours != null ? Math.round(item.waitingHours / 24) : '',
      ];
    });
    downloadExcelWorkbook('Details', headers, rows, title);
    return;
  }

  const headers = [
    'Patient Name',
    'Patient Code',
    'Patient ID',
    'Centre',
    'Category',
    'Status',
    'Event At',
    'Waiting (hours/days)',
    'Detail',
  ];

  const rows = items.map((item) => [
    item.patientName,
    item.patientCode ?? '',
    item.patientId,
    item.centreName,
    item.category ?? '',
    item.status ?? '',
    formatEventAt(item.eventAt),
    formatWaitingHours(item.waitingHours),
    item.detail ?? '',
  ]);

  downloadExcelWorkbook('Details', headers, rows, title);
}
