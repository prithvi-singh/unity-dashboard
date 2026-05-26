'use client';

import { useState } from 'react';
import type { RoleCentreRow, OnRoleDrillDown, RoleDrillDownType } from '@/lib/roleDrillDown';
import { centreRowTotal, DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import { shortCentreName } from '@/lib/centreNames';
import { KpiTooltip, type KpiDefinition } from '@/components/shared/KpiTooltip';

interface ColConfig {
  key: 'metric1' | 'metric2' | 'metric3' | 'total';
  label: string;
  colorClass: string;
  drillType?: RoleDrillDownType;
}

interface Props {
  title: string;
  subtitle: string;
  /** Plain-language note on who should act and what the columns mean. */
  actionNote?: string;
  tooltip?: KpiDefinition;
  rows: RoleCentreRow[];
  cols: ColConfig[];
  loading?: boolean;
  onDrillDown?: OnRoleDrillDown;
}

type SortDir = 'asc' | 'desc';
type SortCol = ColConfig['key'] | 'centreName';

function MiniBar({
  value, max, colorClass, clickable, onClick,
}: {
  value: number;
  max: number;
  colorClass: string;
  clickable?: boolean;
  onClick?: () => void;
}) {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const inner = (
    <div className="flex items-center justify-end gap-2">
      <span className="tabular-nums text-gray-700 text-sm">{value.toLocaleString()}</span>
      <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
  if (!clickable || value <= 0) return inner;
  return (
    <button
      type="button"
      onClick={onClick}
      title={DRILL_DOWN_HINT}
      className="w-full rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      {inner}
    </button>
  );
}

function SeverityPill({ row }: { row: RoleCentreRow }) {
  const total = centreRowTotal(row);
  if (total === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Clear
      </span>
    );
  }
  if (row.metric3 > 0 || total >= 10) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />Critical
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Watch
    </span>
  );
}

export default function RoleCentreTable({
  title, subtitle, actionNote, tooltip, rows, cols, loading, onDrillDown,
}: Props) {
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({ col: 'total', dir: 'desc' });

  const cardClass = 'bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden';

  if (loading) {
    return (
      <div className={`${cardClass} p-5 animate-pulse`}>
        <div className="h-4 w-48 bg-gray-100 rounded mb-4" />
        <div className="h-32 bg-gray-50 rounded-xl" />
      </div>
    );
  }

  const maxVals = {
    metric1: Math.max(...rows.map((r) => r.metric1), 1),
    metric2: Math.max(...rows.map((r) => r.metric2), 1),
    metric3: Math.max(...rows.map((r) => r.metric3), 1),
    total: Math.max(...rows.map(centreRowTotal), 1),
  };

  const sorted = [...rows].sort((a, b) => {
    const av = sort.col === 'centreName' ? a.centreName : sort.col === 'total' ? centreRowTotal(a) : a[sort.col];
    const bv = sort.col === 'centreName' ? b.centreName : sort.col === 'total' ? centreRowTotal(b) : b[sort.col];
    if (typeof av === 'string' && typeof bv === 'string') {
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  const toggleSort = (col: SortCol) => {
    setSort((prev) => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: col === 'centreName' ? 'asc' : 'desc' });
  };

  if (rows.length === 0) {
    return (
      <div className={cardClass}>
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            {tooltip && <KpiTooltip {...tooltip} />}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
          {actionNote && (
            <p className="text-xs text-gray-600 mt-2 leading-relaxed">{actionNote}</p>
          )}
        </div>
        <div className="py-12 text-center text-sm text-gray-400">No centres to show</div>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {tooltip && <KpiTooltip {...tooltip} />}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
        {actionNote && (
          <p className="text-xs text-gray-600 mt-2 leading-relaxed max-w-3xl">{actionNote}</p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] border-b border-gray-100">
              <th className="px-5 py-3 text-left cursor-pointer hover:text-gray-700" onClick={() => toggleSort('centreName')}>Centre</th>
              {cols.map((c) => (
                <th key={c.key} className="px-4 py-3 text-right cursor-pointer hover:text-gray-700" onClick={() => toggleSort(c.key)}>
                  {c.label}
                </th>
              ))}
              <th className="px-4 py-3 text-right cursor-pointer hover:text-gray-700" onClick={() => toggleSort('total')}>Total</th>
              <th className="px-5 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.map((row) => (
              <tr key={row.centreId} className="hover:bg-gray-50/70">
                <td className="px-5 py-3.5 font-medium text-gray-900 max-w-[160px] truncate" title={row.centreName}>
                  {shortCentreName(row.centreName)}
                </td>
                {cols.map((c) => {
                  const val = row[c.key as keyof RoleCentreRow] as number;
                  return (
                    <td key={c.key} className="px-4 py-3.5">
                      <MiniBar
                        value={val}
                        max={maxVals[c.key === 'total' ? 'total' : c.key]}
                        colorClass={c.colorClass}
                        clickable={!!onDrillDown && !!c.drillType && val > 0}
                        onClick={() => onDrillDown?.({
                          type: c.drillType!,
                          drillCentreId: row.centreId,
                          label: `${c.label} · ${row.centreName}`,
                        })}
                      />
                    </td>
                  );
                })}
                <td className="px-4 py-3.5 text-right tabular-nums font-semibold text-gray-800">
                  {centreRowTotal(row).toLocaleString()}
                </td>
                <td className="px-5 py-3.5">
                  <SeverityPill row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
