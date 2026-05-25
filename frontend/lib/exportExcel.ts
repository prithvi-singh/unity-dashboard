import * as XLSX from 'xlsx';

export type ExcelCell = string | number | null | undefined;

export function safeExportFilename(title: string, fallback = 'export'): string {
  return title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || fallback;
}

export function downloadExcelWorkbook(
  sheetName: string,
  headers: string[],
  rows: ExcelCell[][],
  filename: string,
): void {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, `${safeExportFilename(filename)}.xlsx`);
}
