'use client';

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type CSSProperties,
} from 'react';
import type { TopPerformer, TopPerformerBreakdown, Centre } from '@/lib/types';

// ─── Constants ────────────────────────────────────────────────────────────────

// Cell sizes defined here for reference; applied via Tailwind classes (w-7/w-9, h-7/h-9)
const CELL_SIZE_MOBILE = 28;  // px — 28px on mobile (Tailwind: w-7 h-7)

// ─── Role helpers ─────────────────────────────────────────────────────────────

type RoleGroup = 'clinician' | 'manager' | 'ops' | 'other';

function getRoleGroup(p: TopPerformer): RoleGroup {
  if (p.isOpsAdmin) return 'ops';
  const role = (p.roleName ?? '').toLowerCase().replace(/\s/g, '');
  if (role === 'clinician') return 'clinician';
  if (role === 'centremanager' || role === 'manager') return 'manager';
  return 'other';
}

const ROLE_LABELS: Record<RoleGroup, string> = {
  clinician: 'Clinician',
  manager:   'Centre Manager',
  ops:       'Centre Admin — Ops',
  other:     'Other',
};

const ROLE_BADGE_CLASSES: Record<RoleGroup, string> = {
  clinician: 'bg-blue-100 text-blue-700',
  manager:   'bg-green-100 text-green-700',
  ops:       'bg-teal-100 text-teal-700',
  other:     'bg-gray-100 text-gray-500',
};

// ─── Cell colour ──────────────────────────────────────────────────────────────

function cellStyle(count: number): CSSProperties {
  if (count === 0)  return { backgroundColor: '#f3f4f6', color: 'transparent' };
  if (count <= 3)   return { backgroundColor: '#e0f2fe', color: '#0369a1' };
  if (count <= 8)   return { backgroundColor: '#38bdf8', color: '#fff' };
  return               { backgroundColor: '#7c3aed', color: '#fff' };
}

// ─── Date formatting ──────────────────────────────────────────────────────────

/** Day number only: "27". Used as the compact column header. */
function fmtDay(iso: string): string {
  return String(new Date(`${iso}T12:00:00`).getDate());
}

/** Short month label: "Apr". Shown only on the 1st of each month. */
function fmtMonth(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { month: 'short' });
}

/** Returns true if this date is the 1st of its month. */
function isFirstOfMonth(iso: string): boolean {
  return new Date(`${iso}T12:00:00`).getDate() === 1;
}

function fmtDateFull(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipInfo {
  performer:  TopPerformer;
  date:       string;
  breakdown:  TopPerformerBreakdown;
  total:      number;
  anchorRect: DOMRect;
}

function Tooltip({ info, containerRef }: {
  info:          TooltipInfo;
  containerRef:  React.RefObject<HTMLDivElement | null>;
}) {
  const { performer, date, breakdown: b, total } = info;
  const roleGroup = getRoleGroup(performer);
  const name = `${performer.firstName} ${performer.lastName}`;

  const rows: { label: string; value: number }[] = [];
  if (roleGroup === 'clinician') {
    rows.push(
      { label: 'Assessments scored', value: b.assessmentsScored   },
      { label: 'Reports drafted',    value: b.reportsDrafted      },
      { label: 'Goals added',        value: b.goalsAdded          },
    );
  } else if (roleGroup === 'manager') {
    rows.push(
      { label: 'Reports approved', value: b.reportsApproved },
      { label: 'Goals approved',   value: b.goalsApproved   },
    );
  } else {
    // ops / other
    rows.push(
      { label: 'Cases registered',            value: b.casesRegistered     },
      { label: 'Clinicians/managers assigned', value: b.assessmentsAssigned },
    );
  }

  // If report edits exist, show as secondary info
  const showEdits = b.reportEdits > 0 && (roleGroup === 'clinician' || roleGroup === 'manager');

  // Position: above anchor, clamp to container
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden', position: 'fixed', zIndex: 9999 });

  useEffect(() => {
    if (!ref.current || !containerRef.current) return;
    const tip    = ref.current.getBoundingClientRect();
    const anchor = info.anchorRect;
    const vp     = { w: window.innerWidth, h: window.innerHeight };

    let top = anchor.top - tip.height - 8;
    let left = anchor.left + anchor.width / 2 - tip.width / 2;

    // Flip below if too close to top
    if (top < 8) top = anchor.bottom + 8;
    // Clamp horizontally
    if (left < 8) left = 8;
    if (left + tip.width > vp.w - 8) left = vp.w - tip.width - 8;
    // Clamp vertically
    if (top + tip.height > vp.h - 8) top = vp.h - tip.height - 8;

    setPos({ position: 'fixed', zIndex: 9999, top, left });
  }, [info.anchorRect, containerRef]);

  return (
    <div
      ref={ref}
      style={pos}
      className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.14),0_1px_4px_rgba(0,0,0,0.08)] border border-gray-100 p-3 min-w-[180px] max-w-[240px] pointer-events-none select-none"
      role="tooltip"
    >
      {/* Header */}
      <p className="text-[11px] font-bold text-gray-900 leading-tight">
        {name} — {fmtDateFull(date)}
      </p>
      {/* Role badge */}
      <span className={`inline-block mt-1 mb-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${ROLE_BADGE_CLASSES[roleGroup]}`}>
        {ROLE_LABELS[roleGroup]}
      </span>
      {/* Breakdown rows */}
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-gray-500">{r.label}</span>
            <span className="text-[11px] font-bold text-gray-800 tabular-nums">{r.value}</span>
          </div>
        ))}
        {showEdits && (
          <div className="flex items-center justify-between gap-3 opacity-60">
            <span className="text-[11px] text-gray-400 italic">Report edits</span>
            <span className="text-[11px] text-gray-400 tabular-nums">{b.reportEdits}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-1 mt-1">
          <span className="text-[11px] font-bold text-gray-700">Total</span>
          <span className="text-[11px] font-bold text-gray-900 tabular-nums">{total}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Role badge (inline) ──────────────────────────────────────────────────────

function RoleBadge({ roleGroup }: { roleGroup: RoleGroup }) {
  const short: Record<RoleGroup, string> = {
    clinician: 'Clin',
    manager:   'Mgr',
    ops:       'Ops',
    other:     '—',
  };
  return (
    <span className={`inline-block text-[9px] font-bold px-1 py-0.5 rounded leading-tight ${ROLE_BADGE_CLASSES[roleGroup]}`}>
      {short[roleGroup]}
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  performers: TopPerformer[];
  daysCount:  number;
  loading:    boolean;
  centres:    Centre[];
}

// ─── Component ────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

export default function ActivityHeatmap({
  performers,
  daysCount,
  loading,
  centres,
}: Props) {
  // ── Filter state ────────────────────────────────────────────────────────────
  const [nameFilter,    setNameFilter]    = useState('');
  const [roleFilter,    setRoleFilter]    = useState<'' | RoleGroup>('');
  const [centreFilter,  setCentreFilter]  = useState<number | ''>('');
  const [topN,          setTopN]          = useState<12 | 25 | 50 | 'all'>(12);

  // ── Sort state ──────────────────────────────────────────────────────────────
  const [sortCol,  setSortCol]  = useState<string>('total');
  const [sortDir,  setSortDir]  = useState<SortDir>('desc');

  // ── Scroll-capture state (for "All" mode) ───────────────────────────────────
  const [scrollCaptured, setScrollCaptured] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef   = useRef<HTMLDivElement>(null);

  // ── Tooltip state ───────────────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  // ── Esc handler ─────────────────────────────────────────────────────────────
  const collapseAll = useCallback(() => {
    setTopN(12);
    setScrollCaptured(false);
  }, []);

  useEffect(() => {
    if (topN !== 'all') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') collapseAll();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [topN, collapseAll]);

  // ── Click-outside tooltip dismiss ───────────────────────────────────────────
  useEffect(() => {
    if (!tooltip) return;
    const dismiss = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setTooltip(null);
      }
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [tooltip]);

  // ── Derive all dates from performers ────────────────────────────────────────
  const allDates = useMemo(() => {
    const dateSet = new Set<string>();
    for (const p of performers) {
      for (const d of p.days) dateSet.add(d.date);
    }
    return [...dateSet].sort();
  }, [performers]);

  // ── Apply filters ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...performers];

    if (nameFilter.trim()) {
      const q = nameFilter.trim().toLowerCase();
      list = list.filter((p) =>
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(q),
      );
    }

    if (roleFilter) {
      list = list.filter((p) => getRoleGroup(p) === roleFilter);
    }

    if (centreFilter !== '') {
      list = list.filter((p) => p.centreId === centreFilter);
    }

    return list;
  }, [performers, nameFilter, roleFilter, centreFilter]);

  // ── Sort ────────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: number;
      let bv: number;
      if (sortCol === 'total') {
        av = a.totalScore;
        bv = b.totalScore;
      } else {
        // sortCol is a date string
        const ad = a.days.find((d) => d.date === sortCol);
        const bd = b.days.find((d) => d.date === sortCol);
        av = ad?.total ?? 0;
        bv = bd?.total ?? 0;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [filtered, sortCol, sortDir]);

  // ── Apply top-N slicing ──────────────────────────────────────────────────────
  const visible = topN === 'all' ? sorted : sorted.slice(0, topN);

  // ── Sort toggle ─────────────────────────────────────────────────────────────
  const toggleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return col;
      }
      setSortDir('desc');
      return col;
    });
  }, []);

  // ── Cell hover ──────────────────────────────────────────────────────────────
  const handleCellEnter = useCallback((
    e: React.MouseEvent<HTMLTableCellElement>,
    performer: TopPerformer,
    date: string,
    dayData: TopPerformerBreakdown,
    total: number,
  ) => {
    if (total === 0) {
      setTooltip(null);
      return;
    }
    setTooltip({
      performer,
      date,
      breakdown: dayData,
      total,
      anchorRect: e.currentTarget.getBoundingClientRect(),
    });
  }, []);

  const handleCellLeave = useCallback(() => setTooltip(null), []);

  // ── Mobile tap: show tooltip on tap, dismiss on tap elsewhere ───────────────
  const handleCellTap = useCallback((
    e: React.MouseEvent<HTMLTableCellElement>,
    performer: TopPerformer,
    date: string,
    dayData: TopPerformerBreakdown,
    total: number,
  ) => {
    if (total === 0) { setTooltip(null); return; }
    setTooltip((prev) => {
      if (prev?.performer.userId === performer.userId && prev?.date === date) return null;
      return {
        performer,
        date,
        breakdown: dayData,
        total,
        anchorRect: e.currentTarget.getBoundingClientRect(),
      };
    });
    e.stopPropagation();
  }, []);

  // ── Empty/loading states ────────────────────────────────────────────────────
  if (loading && performers.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-100 rounded w-48" />
          <div className="h-3 bg-gray-100 rounded w-32" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-gray-50 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!loading && performers.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-8 text-center text-sm text-gray-400">
        No top performer data available for this period.
      </div>
    );
  }

  const totalCount = sorted.length;

  return (
    <div
      ref={wrapperRef}
      className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden"
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Top Performers</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Top {topN === 'all' ? totalCount : topN} by clinical output
              {daysCount > 0 && ` · ${daysCount} day${daysCount !== 1 ? 's' : ''}`}
            </p>
          </div>

          {/* Colour legend */}
          <div className="flex items-center gap-2 text-[10px] text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: '#f3f4f6', color: '#9ca3af' }}>—</span>
              <span className="text-gray-400">0</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: '#e0f2fe', color: '#0369a1' }}>2</span>
              <span>1–3</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: '#38bdf8', color: '#fff' }}>6</span>
              <span>4–8</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: '#7c3aed', color: '#fff' }}>12</span>
              <span>9+</span>
            </span>
          </div>
        </div>

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Name search */}
          <input
            type="text"
            placeholder="Search name…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 placeholder-gray-300 min-w-[120px]"
            aria-label="Filter by name"
          />

          {/* Role filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as '' | RoleGroup)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white text-gray-700"
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            <option value="clinician">Clinician</option>
            <option value="manager">Centre Manager</option>
            <option value="ops">Centre Admin (Ops)</option>
          </select>

          {/* Centre filter */}
          {centres.length > 0 && (
            <select
              value={centreFilter}
              onChange={(e) => setCentreFilter(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white text-gray-700 max-w-[160px]"
              aria-label="Filter by centre"
            >
              <option value="">All centres</option>
              {centres.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          {/* Top N selector */}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[10px] text-gray-400 font-medium">Show:</span>
            {([12, 25, 50, 'all'] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setTopN(n);
                  if (n !== 'all') setScrollCaptured(false);
                }}
                className={[
                  'text-[10px] font-semibold px-2 py-1 rounded-md transition-colors',
                  topN === n
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                ].join(' ')}
                aria-pressed={topN === n}
              >
                {n === 'all' ? 'All' : n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Table wrapper ───────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className={[
          'overflow-x-auto scrollbar-thin',
          topN === 'all' && scrollCaptured ? 'overflow-y-auto' : '',
        ].join(' ')}
        style={{
          maxHeight: topN === 'all' && scrollCaptured ? '560px' : undefined,
          cursor:    topN === 'all' && !scrollCaptured ? 'pointer' : undefined,
        }}
        onClick={() => {
          if (topN === 'all' && !scrollCaptured) setScrollCaptured(true);
        }}
        aria-label="Top Performers activity heatmap"
      >
        {visible.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            No users match the current filters.
          </div>
        ) : (
          <HeatmapTable
            performers={visible}
            dates={allDates}
            sortCol={sortCol}
            sortDir={sortDir}
            onToggleSort={toggleSort}
            onCellEnter={handleCellEnter}
            onCellLeave={handleCellLeave}
            onCellTap={handleCellTap}
          />
        )}
      </div>

      {/* ── Footer (scroll hint) ──────────────────────────────────────────── */}
      {topN === 'all' && (
        <div className="px-5 py-2.5 border-t border-gray-50 flex items-center justify-between gap-4">
          <p className="text-[11px] text-gray-400">
            {scrollCaptured
              ? '↕ Scrolling active · Esc to collapse'
              : '↕ Click table to scroll · Esc to collapse'}
          </p>
          <button
            type="button"
            onClick={collapseAll}
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            Collapse ↑
          </button>
        </div>
      )}

      {/* ── Tooltip portal ───────────────────────────────────────────────────── */}
      {tooltip && (
        <Tooltip info={tooltip} containerRef={containerRef} />
      )}
    </div>
  );
}

// ─── Inner table ──────────────────────────────────────────────────────────────

interface TableProps {
  performers:    TopPerformer[];
  dates:         string[];
  sortCol:       string;
  sortDir:       SortDir;
  onToggleSort:  (col: string) => void;
  onCellEnter:   (
    e:          React.MouseEvent<HTMLTableCellElement>,
    performer:  TopPerformer,
    date:       string,
    breakdown:  TopPerformerBreakdown,
    total:      number,
  ) => void;
  onCellLeave:   () => void;
  onCellTap:     (
    e:          React.MouseEvent<HTMLTableCellElement>,
    performer:  TopPerformer,
    date:       string,
    breakdown:  TopPerformerBreakdown,
    total:      number,
  ) => void;
}

function HeatmapTable({
  performers,
  dates,
  sortCol,
  sortDir,
  onToggleSort,
  onCellEnter,
  onCellLeave,
  onCellTap,
}: TableProps) {
  // Suppress unused-variable warnings; values are used in className strings below
  void CELL_SIZE_MOBILE;

  // Build per-user day lookup
  const dayLookup = useMemo(() => {
    const map: Record<number, Record<string, { total: number; breakdown: TopPerformerBreakdown }>> = {};
    for (const p of performers) {
      map[p.userId] = {};
      for (const d of p.days) {
        map[p.userId][d.date] = { total: d.total, breakdown: d.breakdown };
      }
    }
    return map;
  }, [performers]);

  const sortIndicator = (col: string) => {
    if (sortCol !== col) return <span className="text-gray-300 text-[9px]">⇅</span>;
    return <span className="text-gray-600 text-[9px]">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const thClass = (col: string) =>
    `text-center text-[10px] font-bold text-gray-400 uppercase tracking-[0.06em] cursor-pointer select-none hover:text-gray-600 transition-colors whitespace-nowrap ${sortCol === col ? 'text-gray-700' : ''}`;

  return (
    <table
      className="border-separate w-full"
      style={{ minWidth: 'max-content', borderSpacing: '2px 2px' }}
      role="table"
      aria-label="Top Performers heatmap"
    >
      <thead>
        <tr>
          {/* Rank */}
          <th className="sticky left-0 z-20 bg-white pl-4 pr-2 pb-2 text-left text-[10px] font-bold text-gray-300 uppercase tracking-[0.08em]">
            #
          </th>
          {/* User name */}
          <th className="sticky left-8 z-20 bg-white pr-4 pb-2 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] min-w-[150px] sm:min-w-[180px]">
            User
          </th>

          {/* Date columns — day number only, month label only on 1st */}
          {dates.map((d) => (
            <th
              key={d}
              className={thClass(d) + ' w-7 sm:w-9 min-w-[28px] sm:min-w-[36px] px-0'}
              onClick={() => onToggleSort(d)}
              title={d}
            >
              <div className="flex flex-col items-center leading-none pb-1">
                {isFirstOfMonth(d) && (
                  <span className="text-[8px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                    {fmtMonth(d)}
                  </span>
                )}
                <span className="text-[10px] sm:text-[11px] font-bold tabular-nums">
                  {fmtDay(d)}
                </span>
                {sortIndicator(d)}
              </div>
            </th>
          ))}

          {/* Total */}
          <th
            className={thClass('total') + ' pl-3 pr-4'}
            onClick={() => onToggleSort('total')}
          >
            <span className="inline-flex items-center gap-1">
              Total {sortIndicator('total')}
            </span>
          </th>
        </tr>
      </thead>

      <tbody>
        {performers.map((p, idx) => {
          const roleGroup  = getRoleGroup(p);
          const userDays   = dayLookup[p.userId] ?? {};

          return (
            <tr key={p.userId} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
              {/* Rank */}
              <td className="sticky left-0 z-10 bg-inherit pl-4 pr-2 py-1 text-[11px] font-bold text-gray-300 tabular-nums align-middle">
                {idx + 1}
              </td>

              {/* Name + role badge */}
              <td className="sticky left-8 z-10 bg-inherit pr-4 py-1 align-middle">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="text-xs font-medium text-gray-800 truncate max-w-[120px] sm:max-w-[160px]"
                    title={`${p.firstName} ${p.lastName}${p.centreName ? ` · ${p.centreName}` : ''}`}
                  >
                    {p.firstName} {p.lastName}
                  </span>
                  <RoleBadge roleGroup={roleGroup} />
                </div>
              </td>

              {/* Day cells */}
              {dates.map((d) => {
                const day  = userDays[d];
                const tot  = day?.total ?? 0;
                const brk  = day?.breakdown ?? {
                  assessmentsScored:   0, reportsDrafted:      0, goalsAdded:          0,
                  reportsApproved:     0, goalsApproved:       0, casesRegistered:     0,
                  assessmentsAssigned: 0, reportEdits:         0,
                };
                const style = cellStyle(tot);

                return (
                  <td
                    key={d}
                    className="w-7 h-7 sm:w-9 sm:h-9 min-w-[28px] sm:min-w-[36px] rounded-[6px] text-center align-middle font-bold tabular-nums text-[10px] sm:text-[12px] select-none p-0"
                    style={style}
                    onMouseEnter={(e) => onCellEnter(e, p, d, brk, tot)}
                    onMouseLeave={onCellLeave}
                    onClick={(e) => onCellTap(e, p, d, brk, tot)}
                    aria-label={tot > 0 ? `${p.firstName} ${p.lastName} on ${d}: ${tot}` : undefined}
                  >
                    {tot > 0 ? (
                      <>
                        <span className="hidden sm:inline">{tot}</span>
                        <span className="sm:hidden">{tot > 9 ? '9+' : tot}</span>
                      </>
                    ) : null}
                  </td>
                );
              })}

              {/* Total */}
              <td className="pl-3 pr-4 py-1 text-right tabular-nums font-bold text-gray-900 text-xs align-middle">
                {p.totalScore}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
