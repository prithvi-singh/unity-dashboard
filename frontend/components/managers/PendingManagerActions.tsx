'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { FilterParams } from '@/lib/types';
import type { OnRoleDrillDown, RoleDrillDownItem } from '@/lib/roleDrillDown';
import { fetchRoleDrillDown } from '@/lib/api';
import { shortCentreName } from '@/lib/centreNames';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

function exportCsv(filename: string, headers: string[], rows: string[][]): void {
  const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers, ...rows].map((r) => r.map(escape).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Convert hours to displayable days string */
function fmtDays(hours: number | null): string {
  if (hours == null) return '—';
  const d = hours / 24;
  if (d < 1) return '<1d';
  return `${Math.round(d)}d`;
}

/** CSS color for days waiting */
function daysColor(hours: number | null): string {
  if (hours == null) return 'var(--color-text-secondary, #6b7280)';
  const d = hours / 24;
  if (d > 7)  return '#A32D2D';
  if (d > 3)  return '#BA7517';
  return 'var(--color-text-secondary, #6b7280)';
}

function daysWeight(hours: number | null): number {
  if (hours == null) return 400;
  return hours / 24 > 7 ? 700 : 600;
}

/** Parse clinician name from detail string "SPM · Clinician: Jane Doe" */
function parseClinician(detail: string | null): string {
  if (!detail) return '—';
  const m = detail.match(/Clinician:\s*(.+)$/);
  return m ? m[1].trim() || '—' : '—';
}

// ── Assessment type badge ─────────────────────────────────────────────────────
const ASSESSMENT_STYLE: Record<string, { bg: string; color: string }> = {
  SPM:   { bg: '#E6F1FB', color: '#0C447C' },
  ISAA:  { bg: '#EAF3DE', color: '#3B6D11' },
  REELS: { bg: '#FEF3C7', color: '#92400E' },
  DP3:   { bg: '#F3E8FF', color: '#6B21A8' },
};

function AssessmentBadge({ type }: { type: string | null }) {
  if (!type) return <span style={{ color: 'var(--color-text-secondary, #6b7280)' }}>—</span>;
  const s = ASSESSMENT_STYLE[type.toUpperCase()] ?? { bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 11, padding: '2px 7px', borderRadius: 99, fontWeight: 600,
      whiteSpace: 'nowrap', display: 'inline-block',
    }}>
      {type}
    </span>
  );
}

// ── Sub-section shell ─────────────────────────────────────────────────────────
const DEFAULT_VISIBLE = 5;

function SubSection({
  title,
  count,
  noun = 'item',
  loading,
  onExport,
  children,
}: {
  title: string;
  count: number;
  noun?: string;
  loading: boolean;
  onExport?: () => void;
  children: React.ReactNode;
}) {
  const hasItems = count > 0;
  return (
    <div style={{
      border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
    }}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #111827)' }}>
            {title}
          </span>
          {loading ? (
            <span className="inline-block h-5 w-14 bg-gray-100 rounded-full animate-pulse" />
          ) : (
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
              background: hasItems ? '#FEE2E2' : '#f3f4f6',
              color: hasItems ? '#A32D2D' : '#9ca3af',
              whiteSpace: 'nowrap',
            }}>
              {count.toLocaleString()} {count === 1 ? noun : `${noun}s`}
            </span>
          )}
        </div>
        {onExport && !loading && count > 0 && (
          <button
            type="button"
            onClick={onExport}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors shrink-0"
          >
            ↓ Export CSV
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────
function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <tr key={i} className="animate-pulse border-b border-gray-50">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="px-3 py-2.5">
              <div className="h-3.5 bg-gray-100 rounded" style={{ width: j === 0 ? 120 : 60 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── SUB-SECTION 1 — Cases awaiting assignment ─────────────────────────────────

interface AwaitingRow {
  centreId: number;
  centreName: string;
  unassigned: number;
  totalWaitingHours: number;
}

function buildAwaitingRows(items: RoleDrillDownItem[]): AwaitingRow[] {
  const map = new Map<number, AwaitingRow>();
  for (const item of items) {
    const ex = map.get(item.centreId);
    if (ex) {
      ex.unassigned++;
      ex.totalWaitingHours += item.waitingHours ?? 0;
    } else {
      map.set(item.centreId, {
        centreId: item.centreId,
        centreName: item.centreName,
        unassigned: 1,
        totalWaitingHours: item.waitingHours ?? 0,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.unassigned - a.unassigned);
}

function AwaitingSection({
  items,
  loading,
  onDrillDown,
}: {
  items: RoleDrillDownItem[];
  loading: boolean;
  onDrillDown?: OnRoleDrillDown;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = buildAwaitingRows(items);
  const visible = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE);
  const count = rows.reduce((s, r) => s + r.unassigned, 0);

  const handleExport = useCallback(() => {
    exportCsv(`unity-awaiting-routing-${todayStr()}.csv`,
      ['Centre', 'Unassigned', 'Avg Days Waiting'],
      rows.map((r) => [
        r.centreName,
        String(r.unassigned),
        r.unassigned > 0 ? fmtDays(r.totalWaitingHours / r.unassigned) : '—',
      ]),
    );
  }, [rows]);

  return (
    <SubSection title="Awaiting routing" count={count} noun="case" loading={loading} onExport={handleExport}>
      {loading ? (
        <table className="w-full text-sm">
          <tbody><SkeletonRows cols={3} /></tbody>
        </table>
      ) : rows.length === 0 ? (
        <p className="text-center py-10 text-sm" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>
          No items pending
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[360px]" role="table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-secondary, #f3f4f6)' }}>
                  {['Centre', 'Unassigned', 'Avg Days Waiting'].map((h, i) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.03em]"
                      style={{
                        color: 'var(--color-text-secondary, #6b7280)',
                        textAlign: i === 0 ? 'left' : 'right',
                        position: 'sticky', top: 0,
                        background: 'var(--color-background-primary, #ffffff)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const avgHours = row.unassigned > 0 ? row.totalWaitingHours / row.unassigned : null;
                  return (
                    <tr
                      key={row.centreId}
                      className="border-b border-gray-50 last:border-0 transition-colors"
                      style={{ minHeight: 44 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-background-secondary, #f9fafb)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                    >
                      <td
                        className="px-3 py-2.5 font-medium max-w-[200px] truncate"
                        style={{ color: 'var(--color-text-primary, #111827)' }}
                        title={row.centreName}
                      >
                        {shortCentreName(row.centreName)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {onDrillDown ? (
                          <button
                            type="button"
                            onClick={() => onDrillDown({
                              type: 'manager-stuck-onboarding',
                              drillCentreId: row.centreId,
                              label: `Awaiting routing · ${row.centreName}`,
                            })}
                            className="tabular-nums font-bold rounded hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                            style={{ color: '#A32D2D' }}
                          >
                            {row.unassigned}
                          </button>
                        ) : (
                          <span className="tabular-nums font-bold" style={{ color: '#A32D2D' }}>
                            {row.unassigned}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums"
                        style={{ color: daysColor(avgHours), fontWeight: daysWeight(avgHours) }}
                      >
                        {fmtDays(avgHours)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > DEFAULT_VISIBLE && (
            <div className="mt-2 px-1">
              <button
                type="button"
                onClick={() => setExpanded((p) => !p)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
              >
                {expanded ? 'Show fewer ↑' : `Show all ${rows.length} centres ↓`}
              </button>
            </div>
          )}
        </>
      )}
    </SubSection>
  );
}

// ── SUB-SECTIONS 2 & 3 — Reports / Goals awaiting approval ───────────────────

function ApprovalTable({
  items,
  loading,
  expanded,
  onToggleExpand,
  totalRows,
}: {
  items: RoleDrillDownItem[];
  loading: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  totalRows: number;
}) {
  const cols = 5; // Patient · Assessment · Clinician · Centre · Days Waiting

  if (loading) {
    return (
      <table className="w-full text-sm">
        <tbody><SkeletonRows cols={cols} /></tbody>
      </table>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-center py-10 text-sm" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>
        No items pending
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[540px]" role="table">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border-secondary, #f3f4f6)' }}>
              {[
                { label: 'Patient', align: 'left' as const },
                { label: 'Assessment', align: 'left' as const },
                { label: 'Clinician', align: 'left' as const },
                { label: 'Centre', align: 'left' as const },
                { label: 'Days Waiting', align: 'right' as const },
              ].map(({ label, align }) => (
                <th
                  key={label}
                  className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.03em]"
                  style={{
                    color: 'var(--color-text-secondary, #6b7280)',
                    textAlign: align,
                    position: 'sticky', top: 0,
                    background: 'var(--color-background-primary, #ffffff)',
                  }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const clinician = parseClinician(item.detail);
              const code = item.patientCode ? `#${item.patientCode}` : `ID ${item.patientId}`;
              return (
                <tr
                  key={`${item.patientId}-${item.eventAt}-${idx}`}
                  className="border-b border-gray-50 last:border-0 transition-colors"
                  style={{ minHeight: 44 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-background-secondary, #f9fafb)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  {/* Patient */}
                  <td className="px-3 py-2.5 max-w-[180px]" style={{ verticalAlign: 'middle' }}>
                    <p
                      className="font-medium truncate"
                      style={{ color: 'var(--color-text-primary, #111827)', fontSize: 13 }}
                      title={`${item.patientName} (${code})`}
                    >
                      {item.patientName}
                      <span
                        className="ml-1.5 tabular-nums"
                        style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)', fontWeight: 400 }}
                      >
                        {code}
                      </span>
                    </p>
                  </td>

                  {/* Assessment */}
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ verticalAlign: 'middle' }}>
                    <AssessmentBadge type={item.status} />
                  </td>

                  {/* Clinician */}
                  <td
                    className="px-3 py-2.5 text-xs max-w-[140px] truncate"
                    style={{ color: 'var(--color-text-primary, #111827)', verticalAlign: 'middle' }}
                    title={clinician}
                  >
                    {clinician}
                  </td>

                  {/* Centre */}
                  <td
                    className="px-3 py-2.5 text-xs max-w-[120px] truncate"
                    style={{ color: 'var(--color-text-secondary, #6b7280)', verticalAlign: 'middle' }}
                    title={item.centreName}
                  >
                    {shortCentreName(item.centreName)}
                  </td>

                  {/* Days Waiting */}
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap" style={{ verticalAlign: 'middle' }}>
                    <span style={{ color: daysColor(item.waitingHours), fontWeight: daysWeight(item.waitingHours) }}>
                      {fmtDays(item.waitingHours)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalRows > DEFAULT_VISIBLE && (
        <div className="mt-2 px-1">
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            {expanded ? 'Show fewer ↑' : `Show all ${totalRows} items ↓`}
          </button>
        </div>
      )}
    </>
  );
}

function ReportsSection({
  items,
  loading,
}: {
  items: RoleDrillDownItem[];
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, DEFAULT_VISIBLE);

  const handleExport = useCallback(() => {
    exportCsv(`unity-reports-to-approve-${todayStr()}.csv`,
      ['Patient', 'Patient ID', 'Assessment', 'Clinician', 'Centre', 'Days Waiting'],
      items.map((item) => [
        item.patientName,
        item.patientCode ?? '',
        item.status ?? '',
        parseClinician(item.detail),
        item.centreName,
        fmtDays(item.waitingHours),
      ]),
    );
  }, [items]);

  return (
    <SubSection
      title="Reports to approve"
      count={items.length}
      noun="report"
      loading={loading}
      onExport={handleExport}
    >
      <ApprovalTable
        items={visible}
        loading={loading}
        expanded={expanded}
        onToggleExpand={() => setExpanded((p) => !p)}
        totalRows={items.length}
      />
    </SubSection>
  );
}

function GoalsSection({
  items,
  loading,
}: {
  items: RoleDrillDownItem[];
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, DEFAULT_VISIBLE);

  const handleExport = useCallback(() => {
    exportCsv(`unity-goals-to-approve-${todayStr()}.csv`,
      ['Patient', 'Patient ID', 'Assessment', 'Clinician', 'Centre', 'Days Waiting'],
      items.map((item) => [
        item.patientName,
        item.patientCode ?? '',
        item.status ?? '',
        parseClinician(item.detail),
        item.centreName,
        fmtDays(item.waitingHours),
      ]),
    );
  }, [items]);

  return (
    <SubSection
      title="Goals to approve"
      count={items.length}
      noun="goal"
      loading={loading}
      onExport={handleExport}
    >
      <ApprovalTable
        items={visible}
        loading={loading}
        expanded={expanded}
        onToggleExpand={() => setExpanded((p) => !p)}
        totalRows={items.length}
      />
    </SubSection>
  );
}

// ── Custom hook — fetches one drill-down type ─────────────────────────────────
function usePendingData(
  type: 'manager-stuck-onboarding' | 'manager-pending-reports' | 'manager-pending-goals',
  filters: FilterParams,
  active: boolean,
) {
  const [items, setItems] = useState<RoleDrillDownItem[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    fetchRoleDrillDown({
      type,
      centreId: filters.centreId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    })
      .then((res) => { if (!ctrl.signal.aborted) setItems(res.items); })
      .catch(() => { if (!ctrl.signal.aborted) setItems([]); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });

    return () => ctrl.abort();
  }, [type, active, filters.centreId, filters.dateFrom, filters.dateTo]);

  return { items, loading };
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  filters:      FilterParams;
  onDrillDown?: OnRoleDrillDown;
}

export default function PendingManagerActions({ filters, onDrillDown }: Props) {
  const awaiting  = usePendingData('manager-stuck-onboarding',  filters, true);
  const reports   = usePendingData('manager-pending-reports',   filters, true);
  const goals     = usePendingData('manager-pending-goals',     filters, true);

  const totalPending = awaiting.items.length + reports.items.length + goals.items.length;
  const anyLoading   = awaiting.loading || reports.loading || goals.loading;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Section header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-medium text-gray-900">Pending manager actions</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Items requiring manager attention</p>
        </div>
        {!anyLoading && totalPending > 0 && (
          <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full bg-rose-50 text-[#A32D2D]">
            {totalPending} total
          </span>
        )}
      </div>

      {/* Sub-sections */}
      <div className="px-5 py-4">
        <AwaitingSection
          items={awaiting.items}
          loading={awaiting.loading}
          onDrillDown={onDrillDown}
        />
        <ReportsSection
          items={reports.items}
          loading={reports.loading}
        />
        <GoalsSection
          items={goals.items}
          loading={goals.loading}
        />
      </div>
    </div>
  );
}
