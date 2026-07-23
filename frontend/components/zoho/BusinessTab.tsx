'use client';

// Business tab — Zoho Creator data (leads, appointments, invoices, receipts,
// patients, cycles). Fully self-contained: fetches its own data via
// lib/zoho/*, renders its own fallbacks. A Zoho outage degrades this tab
// only, never the rest of the dashboard.

import { useMemo, useState } from 'react';
import { useZohoSummary, useZohoModule } from '@/lib/zoho/useZoho';
import { ZOHO_MODULES, type ZohoModuleKey, type ZohoRecord } from '@/lib/zoho/types';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

const PAGE_SIZE = 50;
const MAX_TABLE_COLUMNS = 6;

// Zoho internal/system fields hidden from the table (still shown in drawer)
const HIDDEN_FIELDS = new Set(['id', 'ID', 'zc_display_value']);

function formatAsOf(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function cellText(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value || '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const dv = (value as Record<string, unknown>).display_value;
    if (typeof dv === 'string') return dv;
    return JSON.stringify(value);
  }
  return String(value);
}

// ── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards({
  active,
  onSelect,
}: {
  active: ZohoModuleKey;
  onSelect: (key: ZohoModuleKey) => void;
}) {
  const { data, loading, error } = useZohoSummary();

  if (error && !data) {
    return (
      <div className="px-3.5 py-2.5 rounded-xl bg-gray-50 border border-gray-100 text-[12px] text-gray-500">
        Zoho data unavailable — retrying automatically.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
      {ZOHO_MODULES.map(({ key, label }) => {
        const entry = data?.summary?.[key];
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            className={`text-left rounded-lg p-4 transition-colors ${
              isActive ? 'bg-gray-900 text-white' : 'bg-gray-50 hover:bg-gray-100 text-gray-900'
            }`}
            aria-pressed={isActive}
          >
            <div className={`text-[11px] uppercase tracking-[0.03em] ${isActive ? 'text-gray-300' : 'text-gray-500'}`}>
              {label}
            </div>
            <div className="text-xl font-semibold mt-1 tabular-nums">
              {loading && !data ? '…' : entry?.count != null ? entry.count.toLocaleString('en-IN') : '…'}
            </div>
            {entry?.warming && (
              <div className={`text-[11px] mt-0.5 ${isActive ? 'text-gray-400' : 'text-gray-400'}`}>loading</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Detail drawer (640px standard) ───────────────────────────────────────────

function RecordDrawer({
  moduleLabel,
  record,
  onClose,
}: {
  moduleLabel: string;
  record: ZohoRecord | null;
  onClose: () => void;
}) {
  if (!record) return null;
  const entries = Object.entries(record).filter(([k]) => k !== 'id');

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} aria-hidden="true" />
      <aside className="fixed right-0 top-0 h-full w-full sm:w-[640px] bg-white z-50 shadow-xl flex flex-col">
        <header className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3.5 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.03em] text-gray-500">{moduleLabel}</div>
            <h2 className="text-[15px] font-medium text-gray-900">Record detail</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="overflow-y-auto flex-1 px-5 py-3">
          <table className="w-full" style={{ tableLayout: 'fixed' }}>
            <tbody>
              {entries.map(([field, value]) => (
                <tr key={field} className="border-b border-gray-50">
                  <td className="py-2 pr-3 text-[12px] text-gray-500 align-top" style={{ width: '40%' }}>
                    {field.replace(/_/g, ' ')}
                  </td>
                  <td
                    className="py-2 text-[13px] text-gray-900 overflow-hidden text-ellipsis whitespace-nowrap"
                    title={cellText(value)}
                  >
                    {cellText(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </aside>
    </>
  );
}

// ── Module table ─────────────────────────────────────────────────────────────

function ModuleTable({ module }: { module: ZohoModuleKey }) {
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<ZohoRecord | null>(null);
  const search = useDebouncedValue(searchInput, 300);

  const { data, loading, error, refetch } = useZohoModule(module, search, offset, PAGE_SIZE);
  const moduleLabel = ZOHO_MODULES.find((m) => m.key === module)?.label ?? module;

  // Columns derived from data until backend mappers define explicit shapes.
  const columns = useMemo(() => {
    const first = data?.data?.[0];
    if (!first) return [];
    return Object.keys(first)
      .filter((k) => !HIDDEN_FIELDS.has(k))
      .slice(0, MAX_TABLE_COLUMNS);
  }, [data]);

  const rows = useMemo(() => {
    const list = data?.data ?? [];
    if (!sortCol) return list;
    return [...list].sort((a, b) => {
      const av = cellText(a[sortCol]);
      const bv = cellText(b[sortCol]);
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [data, sortCol, sortAsc]);

  const exportCsv = () => {
    if (!rows.length) return;
    const cols = columns.length ? columns : Object.keys(rows[0]);
    const lines = [
      cols.join(','),
      ...rows.map((r) => cols.map((c) => `"${cellText(r[c]).replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zoho-${module}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const total = data?.total ?? 0;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-medium text-gray-900">{moduleLabel}</h2>
          {data && (
            <p className="text-[12px] text-gray-500 mt-0.5">
              {total.toLocaleString('en-IN')} records
              {data.stale ? ` · as of ${formatAsOf(data.asOf)}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setOffset(0);
            }}
            placeholder="Search…"
            className="text-[13px] border border-gray-200 rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:border-gray-400"
          />
          <button
            type="button"
            onClick={exportCsv}
            className="text-[12px] text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && !data && (
        <div className="px-5 py-8 text-center text-[13px] text-gray-500">
          Zoho data unavailable.{' '}
          <button type="button" onClick={refetch} className="underline hover:text-gray-700">
            Retry
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="px-5 py-8 animate-pulse text-[13px] text-gray-400 text-center">Loading…</div>
      )}

      {data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ tableLayout: 'fixed', minWidth: 720 }}>
              <thead>
                <tr className="border-b border-gray-100">
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="text-left px-4 py-2.5 text-[11px] uppercase tracking-[0.03em] text-gray-500 font-medium cursor-pointer select-none hover:text-gray-700"
                      onClick={() => {
                        if (sortCol === col) setSortAsc(!sortAsc);
                        else {
                          setSortCol(col);
                          setSortAsc(true);
                        }
                      }}
                    >
                      {col.replace(/_/g, ' ')}
                      {sortCol === col ? (sortAsc ? ' ↑' : ' ↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((rec, i) => (
                  <tr
                    key={rec.id ?? i}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                    style={{ height: 44 }}
                    onClick={() => setSelected(rec)}
                  >
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="px-4 text-[13px] text-gray-900 overflow-hidden text-ellipsis whitespace-nowrap"
                        title={cellText(rec[col])}
                      >
                        {cellText(rec[col])}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(columns.length, 1)} className="px-4 py-8 text-center text-[13px] text-gray-500">
                      No records{search ? ` matching “${search}”` : ''}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-[12px] text-gray-500">
            <span>
              {total === 0 ? '0' : `${offset + 1}–${pageEnd}`} of {total.toLocaleString('en-IN')}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="border border-gray-200 rounded-lg px-3 py-1 disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={pageEnd >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="border border-gray-200 rounded-lg px-3 py-1 disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <RecordDrawer moduleLabel={moduleLabel} record={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ── Tab root ─────────────────────────────────────────────────────────────────

export default function BusinessTab() {
  const [activeModule, setActiveModule] = useState<ZohoModuleKey>('leads');

  return (
    <div className="mt-3 sm:mt-5 space-y-3 sm:space-y-5">
      <SummaryCards active={activeModule} onSelect={setActiveModule} />
      {/* key= forces clean state (search/page/sort) when switching modules */}
      <ModuleTable key={activeModule} module={activeModule} />
    </div>
  );
}
