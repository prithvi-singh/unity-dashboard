'use client';

import { useEffect, useMemo, useState } from 'react';
import ExportExcelButton from '@/components/shared/ExportExcelButton';
import type { MultipleAssessmentCase } from '@/lib/types';
import { assessmentBadgeClass, normalizeAssessmentType } from '@/lib/assessmentBadges';
import { shortCentreName } from '@/lib/centreNames';
import { exportMultipleAssessmentCasesToExcel } from '@/lib/exportMultipleAssessmentExcel';

interface Props {
  open: boolean;
  cases: MultipleAssessmentCase[];
  onClose: () => void;
}

type SortDir = 'asc' | 'desc';
type ColKey = 'patientName' | 'patientDisplayId' | 'centreName' | 'totalAssessments';

interface SortState {
  col: ColKey;
  dir: SortDir;
}

const COLS: { col: ColKey; label: string; align: 'left' | 'right'; defaultDir: SortDir }[] = [
  { col: 'patientName', label: 'Patient Name', align: 'left', defaultDir: 'asc' },
  { col: 'patientDisplayId', label: 'Patient ID', align: 'left', defaultDir: 'asc' },
  { col: 'centreName', label: 'Centre', align: 'left', defaultDir: 'asc' },
  { col: 'totalAssessments', label: 'No. of Assessments', align: 'right', defaultDir: 'desc' },
];

function patientName(row: MultipleAssessmentCase): string {
  return `${row.firstName} ${row.lastName}`.trim() || 'Unknown';
}

function getSortValue(row: MultipleAssessmentCase, col: ColKey): string | number {
  switch (col) {
    case 'patientName':
      return patientName(row).toLowerCase();
    case 'patientDisplayId':
      return (row.patientDisplayId ?? '').toLowerCase();
    case 'centreName':
      return (row.centreName ?? '').toLowerCase();
    case 'totalAssessments':
      return row.totalAssessments;
    default:
      return 0;
  }
}

function applySort(rows: MultipleAssessmentCase[], sort: SortState): MultipleAssessmentCase[] {
  return [...rows].sort((a, b) => {
    const av = getSortValue(a, sort.col);
    const bv = getSortValue(b, sort.col);
    if (av === bv) return 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sort.dir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
  });
}

function formatAssignedDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function AssessmentTypeBadge({ type }: { type: string | null }) {
  const label = normalizeAssessmentType(type);
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold ring-1 ring-inset ${assessmentBadgeClass(type)}`}
    >
      {label}
    </span>
  );
}

function ResultStatusBadge({ isResultGenerate }: { isResultGenerate: boolean }) {
  return isResultGenerate ? (
    <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700">
      Result generated
    </span>
  ) : (
    <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 text-gray-600">
      Pending result
    </span>
  );
}

export default function MultipleAssessmentCasesPanel({ open, cases, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ col: 'totalAssessments', dir: 'desc' });
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setExpandedId(null);
      setSort({ col: 'totalAssessments', dir: 'desc' });
    }
  }, [open]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? cases.filter((row) => {
          const name = patientName(row).toLowerCase();
          const displayId = (row.patientDisplayId ?? '').toLowerCase();
          const internalId = String(row.patientId);
          return name.includes(q) || displayId.includes(q) || internalId.includes(q);
        })
      : cases;
    return applySort(base, sort);
  }, [cases, search, sort]);

  if (!open) return null;

  const handleSort = (col: ColKey, defaultDir: SortDir) => {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: defaultDir },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]"
        aria-label="Close panel"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="multiple-assessment-title"
        className="relative w-full sm:max-w-4xl h-[92dvh] sm:h-full bg-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-1">Drill-down</p>
            <h2 id="multiple-assessment-title" className="text-base font-semibold text-gray-900">
              Multi-assessment cases
            </h2>
            <p className="text-[12px] text-gray-500 mt-1">
              {cases.length} with 2+ assignments
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {cases.length > 0 && (
              <ExportExcelButton onClick={() => exportMultipleAssessmentCasesToExcel(cases)} />
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex-shrink-0">
          <label className="sr-only" htmlFor="multiple-assessment-search">Search patients</label>
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
            </svg>
            <input
              id="multiple-assessment-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by patient name or ID…"
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto scrollbar-thin">
          {filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-2">
              <p className="text-sm font-medium text-gray-700">No matching cases</p>
              <p className="text-[12px] text-gray-500">
                {cases.length === 0
                  ? 'No cases with multiple assessments for the current filters.'
                  : 'Try a different search term.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm" role="table">
              <thead className="sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-100 z-10">
                <tr className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                  {COLS.map(({ col, label, align, defaultDir }) => {
                    const active = sort.col === col;
                    return (
                      <th key={col} className={`px-4 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
                        <button
                          type="button"
                          onClick={() => handleSort(col, defaultDir)}
                          className={`inline-flex items-center gap-1 hover:text-gray-600 transition-colors ${
                            align === 'right' ? 'ml-auto' : ''
                          }`}
                        >
                          {label}
                          {active && (
                            <span aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </button>
                      </th>
                    );
                  })}
                  <th className="px-4 py-3 text-left">Assessment Types</th>
                  <th className="px-4 py-3 text-right w-24">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRows.map((row) => {
                  const isExpanded = expandedId === row.patientId;
                  const types = [...new Set(row.assessments.map((a) => normalizeAssessmentType(a.type)))];
                  return (
                    <FragmentRow
                      key={row.patientId}
                      row={row}
                      types={types}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedId(isExpanded ? null : row.patientId)}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function FragmentRow({
  row,
  types,
  isExpanded,
  onToggle,
}: {
  row: MultipleAssessmentCase;
  types: string[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-gray-50/70 transition-colors">
        <td className="px-4 py-3.5">
          <p className="font-medium text-gray-900">{patientName(row)}</p>
        </td>
        <td className="px-4 py-3.5 text-gray-600 tabular-nums">
          {row.patientDisplayId ? `#${row.patientDisplayId}` : `ID ${row.patientId}`}
        </td>
        <td className="px-4 py-3.5 text-gray-700 max-w-[160px] truncate" title={row.centreName}>
          {shortCentreName(row.centreName)}
        </td>
        <td className="px-4 py-3.5 text-right tabular-nums font-semibold text-gray-900">
          {row.totalAssessments}
        </td>
        <td className="px-4 py-3.5">
          <div className="flex flex-wrap gap-1.5">
            {types.map((type) => (
              <AssessmentTypeBadge key={type} type={type} />
            ))}
          </div>
        </td>
        <td className="px-4 py-3.5 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            aria-expanded={isExpanded}
          >
            {isExpanded ? 'Hide' : 'View'}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-gray-50/60">
          <td colSpan={6} className="px-4 py-4">
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                    <th className="px-4 py-2.5 text-left">Type</th>
                    <th className="px-4 py-2.5 text-left">Clinician</th>
                    <th className="px-4 py-2.5 text-left">Status</th>
                    <th className="px-4 py-2.5 text-left">Result</th>
                    <th className="px-4 py-2.5 text-left">Assigned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {row.assessments.map((assessment) => (
                    <tr key={assessment.allocatePatientId} className="hover:bg-gray-50/70">
                      <td className="px-4 py-2.5">
                        <AssessmentTypeBadge type={assessment.type} />
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">
                        {assessment.clinicianName ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{assessment.status ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <ResultStatusBadge isResultGenerate={assessment.isResultGenerate} />
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                        {formatAssignedDate(assessment.assignedDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
