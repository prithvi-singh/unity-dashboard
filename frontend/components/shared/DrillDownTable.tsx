'use client';

import DrillDownDetailLines from '@/components/shared/DrillDownDetailLines';
import {
  actionColumnHeader,
  hasWaitingData,
  parseDrillDownDetail,
  parseStructuredDetail,
  showCategoryColumn,
  useCompactPipelineLayout,
  waitingColumnLabel,
} from '@/lib/drillDownDisplay';
import { formatEventAt, formatWaitingHours } from '@/lib/bottleneckDrillDown';
import { shortCentreName } from '@/lib/centreNames';
import { hasUnityPatientLinks, unityPatientUrl } from '@/lib/unityLinks';

export interface DrillDownTableItem {
  category: string | null;
  patientId: number;
  patientCode: string | null;
  patientName: string;
  centreName: string;
  eventAt: string | null;
  waitingHours: number | null;
  status: string | null;
  detail: string | null;
}

interface Props {
  items: DrillDownTableItem[];
  isUserList?: boolean;
  showUnityLinks?: boolean;
}

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  const styles =
    category.includes('Stuck') || category.includes('Inactive') || category.includes('Slow')
      ? 'bg-rose-50 text-rose-700'
      : category.includes('Awaiting') || category.includes('Unassigned') || category.includes('Pending')
        ? 'bg-amber-50 text-amber-700'
        : category.includes('Incomplete') || category.includes('goal') || category.includes('Goal')
          ? 'bg-violet-50 text-violet-700'
          : category.includes('Transfer')
            ? 'bg-amber-50 text-amber-700'
            : 'bg-blue-50 text-blue-700';

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold ${styles}`}>
      {category}
    </span>
  );
}

function PatientCell({ item, isUserList }: { item: DrillDownTableItem; isUserList: boolean }) {
  if (isUserList) {
    return <span className="font-medium text-gray-900">{item.patientName}</span>;
  }

  const code = item.patientCode ? `#${item.patientCode}` : `ID ${item.patientId}`;
  return (
    <div className="min-w-0">
      <p className="font-medium text-gray-900 truncate" title={`${item.patientName} (${code})`}>
        {item.patientName}
        <span className="font-normal text-gray-400 ml-1.5 tabular-nums">{code}</span>
      </p>
    </div>
  );
}

function CompactPipelineTable({
  items,
  isUserList,
  showUnityLinks = false,
}: {
  items: DrillDownTableItem[];
  isUserList: boolean;
  showUnityLinks?: boolean;
}) {
  const actionHeader = actionColumnHeader(items);
  const showOpen = showUnityLinks && hasUnityPatientLinks();

  return (
    <table className="w-full text-sm" role="table">
      <thead className="sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-100 z-10">
        <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
          <th className="pl-4 pr-2 py-2.5 text-left">Patient</th>
          <th className="px-2 py-2.5 text-left">Centre</th>
          <th className="px-2 py-2.5 text-left">Type</th>
          <th className="px-2 py-2.5 text-left">Clinician</th>
          <th className="px-2 py-2.5 text-left">{actionHeader}</th>
          <th className="px-2 py-2.5 text-left whitespace-nowrap">When</th>
          {showOpen && <th className="pl-2 pr-4 py-2.5 text-right">Open</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {items.map((item, idx) => {
          const { assessment, clinician, actionBy } = parseStructuredDetail(item.detail);
          const unityUrl = unityPatientUrl(item.patientId);
          return (
            <tr key={`${item.patientId}-${item.eventAt}-${idx}`} className="hover:bg-gray-50/70">
              <td className="pl-4 pr-2 py-2 max-w-[11rem]">
                <PatientCell item={item} isUserList={isUserList} />
              </td>
              <td className="px-2 py-2 text-gray-700 text-xs whitespace-nowrap" title={item.centreName}>
                {shortCentreName(item.centreName)}
              </td>
              <td className="px-2 py-2 text-xs font-semibold text-gray-800 whitespace-nowrap">
                {assessment ?? '—'}
              </td>
              <td className="px-2 py-2 text-xs text-gray-800 whitespace-nowrap" title={clinician ?? ''}>
                {clinician ?? '—'}
              </td>
              <td className="px-2 py-2 text-xs text-gray-800 whitespace-nowrap" title={actionBy ?? ''}>
                {actionBy ?? '—'}
              </td>
              <td className="pl-2 pr-4 py-2 text-gray-600 text-xs whitespace-nowrap">
                {formatEventAt(item.eventAt)}
              </td>
              {showOpen && (
                <td className="pl-2 pr-4 py-2 text-right">
                  {unityUrl ? (
                    <a
                      href={unityUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Unity
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function parseIdleDetail(detail: string | null): {
  caseName: string | null;
  assessment: string | null;
  email: string | null;
} {
  const lines = parseDrillDownDetail(detail);
  let caseName: string | null = null;
  let assessment: string | null = null;
  let email: string | null = null;
  for (const line of lines) {
    if (line.label === 'Case') caseName = line.value;
    else if (line.label === 'Assessment') assessment = line.value;
    else if (line.label === 'Email') email = line.value;
  }
  return { caseName, assessment, email };
}

function IdleClinicianTable({ items }: { items: DrillDownTableItem[] }) {
  return (
    <table className="w-full text-sm" role="table">
      <thead className="sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-100 z-10">
        <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
          <th className="pl-4 pr-2 py-2.5 text-left">Person</th>
          <th className="px-2 py-2.5 text-left w-24">Centre</th>
          <th className="px-2 py-2.5 text-left">Case</th>
          <th className="px-2 py-2.5 text-left">Assessment</th>
          <th className="px-2 py-2.5 text-left whitespace-nowrap">When</th>
          <th className="pl-2 pr-4 py-2.5 text-left">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {items.map((item, idx) => {
          const { caseName, assessment } = parseIdleDetail(item.detail);
          return (
            <tr key={`${item.patientId}-${idx}`} className="hover:bg-gray-50/70">
              <td className="pl-4 pr-2 py-2 max-w-[10rem]">
                <span className="font-medium text-gray-900 block truncate" title={item.patientName}>
                  {item.patientName}
                </span>
              </td>
              <td className="px-2 py-2 w-24 max-w-[6rem]">
                <span
                  className="block truncate text-gray-700 text-xs"
                  title={item.centreName}
                >
                  {shortCentreName(item.centreName)}
                </span>
              </td>
              <td className="px-2 py-2 max-w-[10rem]">
                <span
                  className="block truncate text-xs text-gray-800"
                  title={caseName ?? ''}
                >
                  {caseName ?? '—'}
                </span>
              </td>
              <td className="px-2 py-2 text-xs font-semibold text-gray-800 whitespace-nowrap">
                {assessment ?? '—'}
              </td>
              <td className="px-2 py-2 text-gray-600 text-xs whitespace-nowrap">
                {formatEventAt(item.eventAt)}
              </td>
              <td className="pl-2 pr-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                {item.status ?? '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function DrillDownTable({ items, isUserList = false, showUnityLinks = false }: Props) {
  if (isUserList) {
    return <IdleClinicianTable items={items} />;
  }

  const compact = useCompactPipelineLayout(items);
  if (compact) {
    return <CompactPipelineTable items={items} isUserList={isUserList} showUnityLinks={showUnityLinks} />;
  }

  const showCategory = showCategoryColumn(items);
  const showWaiting = hasWaitingData(items);
  const showOpen = showUnityLinks && hasUnityPatientLinks();

  return (
    <table className="w-full text-sm" role="table">
      <thead className="sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-100 z-10">
        <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
          <th className="pl-4 pr-2 py-2.5 text-left">Patient</th>
          <th className="px-2 py-2.5 text-left">Centre</th>
          {showCategory && <th className="px-2 py-2.5 text-left">Category</th>}
          <th className="px-2 py-2.5 text-left">Details</th>
          <th className="px-2 py-2.5 text-left whitespace-nowrap">When</th>
          {showWaiting && (
            <th className="px-2 py-2.5 text-right whitespace-nowrap">{waitingColumnLabel(false)}</th>
          )}
          {showOpen && <th className="pl-2 pr-4 py-2.5 text-right">Open</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {items.map((item, idx) => {
          const unityUrl = unityPatientUrl(item.patientId);
          const { note } = parseStructuredDetail(item.detail);
          return (
            <tr key={`${item.patientId}-${item.eventAt}-${idx}`} className="hover:bg-gray-50/70 align-top">
              <td className="pl-4 pr-2 py-2 max-w-[11rem]">
                <PatientCell item={item} isUserList={false} />
              </td>
              <td className="px-2 py-2 text-gray-700 text-xs whitespace-nowrap" title={item.centreName}>
                {shortCentreName(item.centreName)}
              </td>
              {showCategory && (
                <td className="px-2 py-2">
                  <CategoryBadge category={item.category} />
                  {item.status && (
                    <p className="text-[11px] text-gray-400 mt-1">{item.status}</p>
                  )}
                </td>
              )}
              <td className="px-2 py-2 text-xs text-gray-700">
                {note ? note : <DrillDownDetailLines detail={item.detail} />}
              </td>
              <td className="px-2 py-2 text-gray-600 text-xs whitespace-nowrap">
                {formatEventAt(item.eventAt)}
              </td>
              {showWaiting && (
                <td className="px-2 py-2 text-right text-xs">
                  <span className="tabular-nums font-semibold text-gray-800 whitespace-nowrap">{formatWaitingHours(item.waitingHours)}</span>
                </td>
              )}
              {showOpen && (
                <td className="pl-2 pr-4 py-2 text-right">
                  {unityUrl ? (
                    <a
                      href={unityUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Unity
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
