'use client';

import { useState } from 'react';
import DrillDownDetailLines from '@/components/shared/DrillDownDetailLines';
import PatientZohoDrawer from '@/components/zoho/PatientZohoDrawer';
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

function waitingDaysColor(hours: number | null): string {
  if (hours == null) return '#9ca3af';
  const days = hours / 24;
  if (days > 7)  return '#A32D2D';
  if (days > 2)  return '#BA7517';
  return 'var(--color-text-primary, #111827)';
}

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

function PatientCell({ item, isUserList, onCodeClick }: { item: DrillDownTableItem; isUserList: boolean; onCodeClick?: (code: string, name: string) => void }) {
  if (isUserList) {
    return <span className="font-medium text-gray-900">{item.patientName}</span>;
  }

  const code = item.patientCode ? `#${item.patientCode}` : `ID ${item.patientId}`;
  return (
    <div className="min-w-0">
      <p className="font-medium text-gray-900 truncate" title={`${item.patientName} (${code})`}>
        {item.patientName}
        {item.patientCode && onCodeClick ? (
          <button
            type="button"
            className="font-normal text-gray-400 ml-1.5 tabular-nums patient-code-link"
            onClick={(e) => { e.stopPropagation(); onCodeClick(item.patientCode!, item.patientName); }}
            title="View Zoho record"
          >
            {code}
          </button>
        ) : (
          <span className="font-normal text-gray-400 ml-1.5 tabular-nums">{code}</span>
        )}
      </p>
    </div>
  );
}

function CompactPipelineTable({
  items,
  isUserList,
  showUnityLinks = false,
  onCodeClick,
}: {
  items: DrillDownTableItem[];
  isUserList: boolean;
  showUnityLinks?: boolean;
  onCodeClick?: (code: string, name: string) => void;
}) {
  const actionHeader = actionColumnHeader(items);
  const showOpen = showUnityLinks && hasUnityPatientLinks();

  return (
    <table className="w-full text-sm" role="table">
      <thead className="sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-100 z-10">
        <tr className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
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
            <tr key={`${item.patientId}-${item.eventAt}-${idx}`} className="hover:bg-gray-50/70 h-[44px]" style={{ verticalAlign: 'middle' }}>
              <td className="pl-4 pr-2 py-0 max-w-[11rem] overflow-hidden" style={{ verticalAlign: 'middle' }}>
                <PatientCell item={item} isUserList={isUserList} onCodeClick={onCodeClick} />
              </td>
              <td className="px-2 py-0 text-gray-700 text-xs whitespace-nowrap overflow-hidden" title={item.centreName} style={{ verticalAlign: 'middle' }}>
                <span className="block truncate">{shortCentreName(item.centreName)}</span>
              </td>
              <td className="px-2 py-0 text-xs font-semibold text-gray-800 whitespace-nowrap" style={{ verticalAlign: 'middle' }}>
                {assessment ?? '—'}
              </td>
              <td className="px-2 py-0 text-xs text-gray-800 whitespace-nowrap overflow-hidden" title={clinician ?? ''} style={{ verticalAlign: 'middle', maxWidth: '120px' }}>
                <span className="block truncate">{clinician ?? '—'}</span>
              </td>
              <td className="px-2 py-0 text-xs text-gray-800 whitespace-nowrap overflow-hidden" title={actionBy ?? ''} style={{ verticalAlign: 'middle', maxWidth: '120px' }}>
                <span className="block truncate">{actionBy ?? '—'}</span>
              </td>
              <td className="pl-2 pr-4 py-0 text-gray-600 text-xs whitespace-nowrap" style={{ verticalAlign: 'middle' }}>
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
        <tr className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
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
  const [drawerCode, setDrawerCode] = useState<string | null>(null);
  const [drawerName, setDrawerName] = useState<string | undefined>(undefined);

  const handleCodeClick = (code: string, name: string) => {
    setDrawerCode(code);
    setDrawerName(name);
  };

  if (isUserList) {
    return (
      <>
        <IdleClinicianTable items={items} />
        <PatientZohoDrawer
          open={drawerCode !== null}
          patientCode={drawerCode}
          patientName={drawerName}
          onClose={() => setDrawerCode(null)}
        />
      </>
    );
  }

  const compact = useCompactPipelineLayout(items);
  if (compact) {
    return (
      <>
        <CompactPipelineTable items={items} isUserList={isUserList} showUnityLinks={showUnityLinks} onCodeClick={handleCodeClick} />
        <PatientZohoDrawer
          open={drawerCode !== null}
          patientCode={drawerCode}
          patientName={drawerName}
          onClose={() => setDrawerCode(null)}
        />
      </>
    );
  }

  const showCategory = showCategoryColumn(items);
  const showWaiting = hasWaitingData(items);
  const showOpen = showUnityLinks && hasUnityPatientLinks();

  return (
    <>
      <table className="w-full text-sm" role="table">
        <thead className="sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-100 z-10">
          <tr className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
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
              <tr key={`${item.patientId}-${item.eventAt}-${idx}`} className="hover:bg-gray-50/70 h-[44px]" style={{ verticalAlign: 'middle' }}>
                <td className="pl-4 pr-2 py-0 max-w-[11rem] overflow-hidden" style={{ verticalAlign: 'middle' }}>
                  <PatientCell item={item} isUserList={false} onCodeClick={handleCodeClick} />
                </td>
                <td className="px-2 py-0 text-gray-700 text-xs whitespace-nowrap overflow-hidden" title={item.centreName} style={{ verticalAlign: 'middle' }}>
                  <span className="block truncate">{shortCentreName(item.centreName)}</span>
                </td>
                {showCategory && (
                  <td className="px-2 py-0 whitespace-nowrap" style={{ verticalAlign: 'middle' }}>
                    <CategoryBadge category={item.category} />
                    {item.status && (
                      <span className="ml-1 text-[11px] text-gray-400">{item.status}</span>
                    )}
                  </td>
                )}
                <td className="px-2 py-0 text-xs text-gray-700 max-w-[160px] overflow-hidden" style={{ verticalAlign: 'middle' }}>
                  <span className="block truncate whitespace-nowrap" title={note ?? item.detail ?? undefined}>
                    {note ? note : (item.detail ? item.detail.split(' · ')[0] : '—')}
                  </span>
                </td>
                <td className="px-2 py-0 text-gray-600 text-xs whitespace-nowrap" style={{ verticalAlign: 'middle' }}>
                  {formatEventAt(item.eventAt)}
                </td>
                {showWaiting && (
                  <td className="px-2 py-0 text-right text-xs" style={{ verticalAlign: 'middle' }}>
                    <span
                      className="tabular-nums font-semibold whitespace-nowrap"
                      style={{ color: waitingDaysColor(item.waitingHours) }}
                    >
                      {formatWaitingHours(item.waitingHours)}
                    </span>
                  </td>
                )}
                {showOpen && (
                  <td className="pl-2 pr-4 py-0 text-right" style={{ verticalAlign: 'middle' }}>
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
      <PatientZohoDrawer
        open={drawerCode !== null}
        patientCode={drawerCode}
        patientName={drawerName}
        onClose={() => setDrawerCode(null)}
      />
    </>
  );
}
