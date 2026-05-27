'use client';

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type CSSProperties,
} from 'react';
import type { TopPerformer, TopPerformerBreakdown, Centre } from '@/lib/types';
import PersonLink from '@/components/PersonLink';
import { inferProfileRole } from '@/lib/userProfile';
import { isSunday, isSaturday, generateDateRange, toLocalISO } from '@/lib/formatDate';

// ─── Column width constants (used for sticky offset calculation) ───────────────

const RANK_COL_W = 40;  // px – the "#" column
const NAME_COL_W = 220; // px – the "User" column

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

const ROLE_BADGE_STYLES: Record<RoleGroup, { bg: string; fg: string }> = {
  clinician: { bg: '#E6F1FB', fg: '#0C447C' },
  manager:   { bg: '#EAF3DE', fg: '#3B6D11' },
  ops:       { bg: '#E1F5EE', fg: '#0F6E56' },
  other:     { bg: '#F3F4F6', fg: '#6B7280' },
};

// ─── Cell colour (4-level gradient + Sunday override) ─────────────────────────
//
//  Level 0 – no activity  → secondary bg, no number
//  Level 1 – 1–3 actions  → #B5D4F4  text #0C447C
//  Level 2 – 4–8 actions  → #378ADD  text white
//  Level 3 – 9+ actions   → #7F77DD  text white
//  Sunday + activity      → keep intensity bg, date text #C0545A (header-level)
//  Sunday + no activity   → #FFF5F5  no number

function intensityStyle(count: number): { bg: string; fg: string } {
  if (count <= 0) return { bg: 'var(--color-background-secondary)', fg: 'transparent' };
  if (count <= 3) return { bg: '#B5D4F4', fg: '#0C447C' };
  if (count <= 8) return { bg: '#378ADD', fg: '#fff' };
  return              { bg: '#7F77DD',  fg: '#fff' };
}

function cellStyle(count: number, date: string): CSSProperties {
  if (isSunday(date)) {
    if (count > 0) {
      const { bg } = intensityStyle(count);
      // Keep intensity background, override text to Sunday red
      return { backgroundColor: bg, color: '#C0545A' };
    }
    return { backgroundColor: '#FFF5F5', color: 'transparent' };
  }
  if (isSaturday(date)) {
    return { backgroundColor: 'var(--color-background-tertiary)', color: 'transparent' };
  }
  const { bg, fg } = intensityStyle(count);
  return { backgroundColor: bg, color: fg };
}

// ─── Date formatting ──────────────────────────────────────────────────────────

function fmtDay(iso: string): string {
  return String(new Date(`${iso}T12:00:00`).getDate());
}

function fmtMonth(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { month: 'short' });
}

function isFirstOfMonth(iso: string): boolean {
  return new Date(`${iso}T12:00:00`).getDate() === 1;
}

function sundayHeaderStyle(iso: string): CSSProperties {
  return isSunday(iso) ? { color: '#C0545A' } : {};
}

function fmtDateFull(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

// ─── Legend swatch ────────────────────────────────────────────────────────────

function LegendSwatch({
  bg, fg, border, label, labelColor,
}: {
  bg: string; fg?: string; border?: string; label: string; labelColor?: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="block w-3 h-3 rounded-sm shrink-0"
        style={{
          backgroundColor: bg,
          border: border ? `1px solid ${border}` : undefined,
        }}
      />
      <span style={{ color: labelColor ?? 'inherit' }}>{label}</span>
    </span>
  );
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
      { label: 'Cases with goals',    value: b.goalsAdded          },
    );
  } else if (roleGroup === 'manager') {
    rows.push(
      { label: 'Reports approved', value: b.reportsApproved },
      { label: 'Goals approved',   value: b.goalsApproved   },
    );
  } else {
    rows.push(
      { label: 'Cases registered',            value: b.casesRegistered     },
      { label: 'Clinicians/managers assigned', value: b.assessmentsAssigned },
    );
  }

  const showEdits = b.reportEdits > 0 && (roleGroup === 'clinician' || roleGroup === 'manager');

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden', position: 'fixed', zIndex: 9999 });

  useEffect(() => {
    if (!ref.current || !containerRef.current) return;
    const tip    = ref.current.getBoundingClientRect();
    const anchor = info.anchorRect;
    const vp     = { w: window.innerWidth, h: window.innerHeight };

    let top  = anchor.top - tip.height - 8;
    let left = anchor.left + anchor.width / 2 - tip.width / 2;

    if (top < 8)  top  = anchor.bottom + 8;
    if (left < 8) left = 8;
    if (left + tip.width > vp.w - 8) left = vp.w - tip.width - 8;
    if (top + tip.height > vp.h - 8) top  = vp.h - tip.height - 8;

    setPos({ position: 'fixed', zIndex: 9999, top, left });
  }, [info.anchorRect, containerRef]);

  return (
    <div
      ref={ref}
      style={pos}
      className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.14),0_1px_4px_rgba(0,0,0,0.08)] border border-gray-100 p-3 min-w-[180px] max-w-[240px] pointer-events-none select-none"
      role="tooltip"
    >
      <p className="text-[11px] font-bold text-gray-900 leading-tight">
        {name} — {fmtDateFull(date)}
      </p>
      <span
        className="inline-block mt-1 mb-2 text-[10px] font-medium px-1.5 py-0.5 rounded"
        style={{ backgroundColor: ROLE_BADGE_STYLES[roleGroup].bg, color: ROLE_BADGE_STYLES[roleGroup].fg }}
      >
        {ROLE_LABELS[roleGroup]}
      </span>
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
    <span
      className="inline-block text-[9px] font-bold px-1 py-0.5 rounded leading-tight"
      style={{ backgroundColor: ROLE_BADGE_STYLES[roleGroup].bg, color: ROLE_BADGE_STYLES[roleGroup].fg }}
    >
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
  dateFrom?:  string; // YYYY-MM-DD — used to generate full date range
  dateTo?:    string; // YYYY-MM-DD — used to generate full date range
}

// ─── Component ────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

function ActivityHeatmapInner({
  performers,
  daysCount,
  loading,
  centres,
  dateFrom,
  dateTo,
}: Props) {
  // ── Filter state ────────────────────────────────────────────────────────────
  const [nameFilter,   setNameFilter]   = useState('');
  const [roleFilter,   setRoleFilter]   = useState<'' | RoleGroup>('');
  const [centreFilter, setCentreFilter] = useState<number | ''>('');
  const [topN,         setTopN]         = useState<12 | 25 | 50 | 'all'>(12);

  // ── Sort state ──────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState<string>('total');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // ── Scroll-capture state (for "All" mode vertical scroll) ────────────────
  const [scrollCaptured, setScrollCaptured] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef   = useRef<HTMLDivElement>(null);

  // ── Horizontal scroll hint ──────────────────────────────────────────────
  const [showScrollHint, setShowScrollHint] = useState(false);

  // ── Tooltip state ───────────────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  // ── Today key ──────────────────────────────────────────────────────────────
  const todayKey = useMemo(() => toLocalISO(new Date()), []);

  // ── Generate ALL dates in the selected period ─────────────────────────────
  // Priority: explicit dateFrom/dateTo from filters → fallback to data min/max.
  // This ensures every day in the range has a column, regardless of activity.
  const allDates = useMemo(() => {
    if (dateFrom && dateTo) {
      return generateDateRange(
        new Date(`${dateFrom}T00:00:00`),
        new Date(`${dateTo}T00:00:00`),
      ).map(toLocalISO);
    }
    // Fallback: derive range from data
    let minDate = '';
    let maxDate = '';
    for (const p of performers) {
      for (const d of p.days) {
        if (!minDate || d.date < minDate) minDate = d.date;
        if (!maxDate || d.date > maxDate) maxDate = d.date;
      }
    }
    if (!minDate) return [];
    return generateDateRange(
      new Date(`${minDate}T00:00:00`),
      new Date(`${maxDate}T00:00:00`),
    ).map(toLocalISO);
  }, [performers, dateFrom, dateTo]);

  // ── Weekends toggle (default: hide when range > 30 days) ─────────────────
  const [showWeekends, setShowWeekends] = useState(true);

  useEffect(() => {
    // Auto-set default: hide weekends for large ranges
    setShowWeekends(allDates.length <= 30);
  }, [allDates.length]);

  // ── Display dates (filtered by weekends toggle) ───────────────────────────
  const displayDates = useMemo(() => {
    if (showWeekends) return allDates;
    return allDates.filter((d) => !isSunday(d) && !isSaturday(d));
  }, [allDates, showWeekends]);

  // ── Dynamic cell width based on number of columns ────────────────────────
  const cellWidth = displayDates.length < 20 ? 36 : displayDates.length < 40 ? 30 : 26;

  // ── Detect horizontal overflow and show scroll hint ───────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const check = () => setShowScrollHint(el.scrollWidth > el.clientWidth + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [displayDates]);

  // Hide hint once user scrolls
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !showScrollHint) return;
    const onScroll = () => setShowScrollHint(false);
    el.addEventListener('scroll', onScroll, { once: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [showScrollHint]);

  // ── Esc handler ─────────────────────────────────────────────────────────────
  const collapseAll = useCallback(() => {
    setTopN(12);
    setScrollCaptured(false);
  }, []);

  useEffect(() => {
    if (topN !== 'all') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') collapseAll(); };
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

  // ── Apply filters ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...performers];
    if (nameFilter.trim()) {
      const q = nameFilter.trim().toLowerCase();
      list = list.filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q));
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
        const ad = a.days.find((d) => d.date === sortCol);
        const bd = b.days.find((d) => d.date === sortCol);
        av = ad?.total ?? 0;
        bv = bd?.total ?? 0;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [filtered, sortCol, sortDir]);

  const visible    = topN === 'all' ? sorted : sorted.slice(0, topN);
  const totalCount = sorted.length;

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
    if (total === 0) { setTooltip(null); return; }
    setTooltip({ performer, date, breakdown: dayData, total, anchorRect: e.currentTarget.getBoundingClientRect() });
  }, []);

  const handleCellLeave = useCallback(() => setTooltip(null), []);

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
      return { performer, date, breakdown: dayData, total, anchorRect: e.currentTarget.getBoundingClientRect() };
    });
    e.stopPropagation();
  }, []);

  // ── Empty/loading states ────────────────────────────────────────────────────
  if (loading && performers.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
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
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        No top performer data available for this period.
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="bg-white rounded-xl border border-gray-200 overflow-hidden"
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[14px] font-medium text-gray-900">Top Performers</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Top {topN === 'all' ? totalCount : topN} by clinical output
              {daysCount > 0 && ` · ${daysCount} day${daysCount !== 1 ? 's' : ''}`}
            </p>
          </div>

          {/* Gradient legend top-right */}
          <div className="flex items-center gap-2.5 shrink-0 flex-wrap text-[11px] text-gray-500">
            <span className="font-semibold text-gray-600 tracking-wide">ACTIONS/DAY</span>
            <LegendSwatch bg="var(--color-background-secondary)" label="0" />
            <LegendSwatch bg="#B5D4F4" fg="#0C447C" label="1–3" labelColor="#0C447C" />
            <LegendSwatch bg="#378ADD" fg="#fff" label="4–8" />
            <LegendSwatch bg="#7F77DD" fg="#fff" label="9+" />
            <LegendSwatch bg="#FFF5F5" border="#fecaca" label="Sunday" labelColor="#C0545A" />
          </div>
        </div>

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        <div className="mt-3 flex flex-wrap gap-2 items-center">
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

          {/* Show weekends toggle — only visible when range > 30 days */}
          {allDates.length > 30 && (
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none ml-1">
              <input
                type="checkbox"
                checked={showWeekends}
                onChange={(e) => setShowWeekends(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-blue-500"
              />
              Show weekends
            </label>
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

      {/* ── Table scroll container ───────────────────────────────────────── */}
      <div
        id="top-performers-scroll"
        ref={containerRef}
        className="scrollbar-thin"
        style={{
          overflowX: 'auto',
          overflowY: topN === 'all' && scrollCaptured ? 'auto' : 'visible',
          maxHeight: topN === 'all' && scrollCaptured ? 560 : undefined,
          width: '100%',
          cursor: topN === 'all' && !scrollCaptured ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (topN === 'all' && !scrollCaptured) setScrollCaptured(true);
        }}
        aria-label="Top Performers activity calendar"
      >
        {visible.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            No users match the current filters.
          </div>
        ) : (
          <HeatmapTable
            performers={visible}
            dates={displayDates}
            sortCol={sortCol}
            sortDir={sortDir}
            cellWidth={cellWidth}
            todayKey={todayKey}
            onToggleSort={toggleSort}
            onCellEnter={handleCellEnter}
            onCellLeave={handleCellLeave}
            onCellTap={handleCellTap}
          />
        )}
      </div>

      {/* ── Horizontal scroll hint ──────────────────────────────────────── */}
      {showScrollHint && (
        <p
          className="text-center py-1 border-t border-gray-50 select-none"
          style={{ fontSize: 11, color: 'var(--color-text-tertiary, #9ca3af)' }}
        >
          ← Scroll to see all dates →
        </p>
      )}

      {/* ── Footer (vertical scroll hint for "All" mode) ─────────────────── */}
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

      {/* ── Tooltip portal ───────────────────────────────────────────────── */}
      {tooltip && (
        <Tooltip info={tooltip} containerRef={containerRef} />
      )}
    </div>
  );
}

// ─── Inner table ──────────────────────────────────────────────────────────────

interface TableProps {
  performers:   TopPerformer[];
  dates:        string[];
  sortCol:      string;
  sortDir:      SortDir;
  cellWidth:    number;
  todayKey:     string;
  onToggleSort: (col: string) => void;
  onCellEnter:  (
    e:          React.MouseEvent<HTMLTableCellElement>,
    performer:  TopPerformer,
    date:       string,
    breakdown:  TopPerformerBreakdown,
    total:      number,
  ) => void;
  onCellLeave:  () => void;
  onCellTap:    (
    e:          React.MouseEvent<HTMLTableCellElement>,
    performer:  TopPerformer,
    date:       string,
    breakdown:  TopPerformerBreakdown,
    total:      number,
  ) => void;
}

// Sticky styles — reused across th and td for # column
const stickyRankTh: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  background: 'var(--color-background-primary, #fff)',
  minWidth: RANK_COL_W,
  width: RANK_COL_W,
};

// For striped tbody rows we use bg-inherit so we must not override bg here
const stickyRankTd: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  minWidth: RANK_COL_W,
  width: RANK_COL_W,
};

// Sticky USER column th/td
const stickyNameTh: CSSProperties = {
  position: 'sticky',
  left: RANK_COL_W,
  zIndex: 2,
  background: 'var(--color-background-primary, #fff)',
  minWidth: NAME_COL_W,
  boxShadow: '2px 0 4px rgba(0,0,0,0.06)',
};

const stickyNameTd: CSSProperties = {
  position: 'sticky',
  left: RANK_COL_W,
  zIndex: 1,
  minWidth: NAME_COL_W,
  boxShadow: '2px 0 4px rgba(0,0,0,0.06)',
};

// Sticky TOTAL column — right edge
const stickyTotalTh: CSSProperties = {
  position: 'sticky',
  right: 0,
  zIndex: 2,
  background: 'var(--color-background-primary, #fff)',
  minWidth: 64,
  boxShadow: '-2px 0 4px rgba(0,0,0,0.06)',
};

const stickyTotalTd: CSSProperties = {
  position: 'sticky',
  right: 0,
  zIndex: 1,
  minWidth: 64,
  boxShadow: '-2px 0 4px rgba(0,0,0,0.06)',
};

function HeatmapTable({
  performers,
  dates,
  sortCol,
  sortDir,
  cellWidth,
  todayKey,
  onToggleSort,
  onCellEnter,
  onCellLeave,
  onCellTap,
}: TableProps) {
  // Build per-user day lookup for O(1) access
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

  const thDateClass = (col: string) =>
    `text-center text-[10px] sm:text-[11px] font-medium cursor-pointer select-none hover:text-gray-600 transition-colors px-0 ${
      sortCol === col ? 'text-gray-700 font-bold' : 'text-gray-500'
    }`;

  return (
    <table
      className="border-separate"
      style={{ minWidth: 'max-content', width: '100%', borderSpacing: '2px 2px' }}
      role="table"
      aria-label="Top Performers heatmap"
    >
      <thead>
        <tr>
          {/* # column — sticky left */}
          <th
            style={stickyRankTh}
            className="pl-3 pr-1 pb-2 text-left text-[10px] font-bold text-gray-300 uppercase tracking-[0.08em]"
          >
            #
          </th>

          {/* User column — sticky left (offset by rank width) */}
          <th
            style={stickyNameTh}
            className="pr-4 pb-2 text-left text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] bg-white"
          >
            User
          </th>

          {/* Date columns — one per day in the selected range */}
          {dates.map((d) => {
            const isToday   = d === todayKey;
            const isSun     = isSunday(d);
            return (
              <th
                key={d}
                className={thDateClass(d)}
                style={{
                  width: cellWidth,
                  minWidth: cellWidth,
                  backgroundColor: isSun ? '#FFF5F5' : undefined,
                  ...sundayHeaderStyle(d),
                }}
                onClick={() => onToggleSort(d)}
                title={
                  isToday
                    ? `Today — ${d}${isSun ? ' (Sunday)' : ''}`
                    : isSun ? `${d} — Sunday` : d
                }
              >
                <div className="flex flex-col items-center leading-none pb-1">
                  {/* Month label — at range start and each 1st of month */}
                  {isFirstOfMonth(d) && (
                    <span
                      className="text-[8px] font-semibold uppercase tracking-wide mb-0.5"
                      style={isSun ? { color: '#C0545A' } : { color: '#9ca3af' }}
                    >
                      {fmtMonth(d)}
                    </span>
                  )}
                  {/* Day number */}
                  <span className={`font-bold tabular-nums ${isToday ? 'text-blue-600' : ''}`}>
                    {fmtDay(d)}
                  </span>
                  {/* Today indicator dot */}
                  {isToday && (
                    <span
                      className="block w-1 h-1 rounded-full bg-blue-500 mt-0.5"
                      title="Today"
                    />
                  )}
                  {!isToday && sortIndicator(d)}
                </div>
              </th>
            );
          })}

          {/* Total column — sticky right */}
          <th
            style={stickyTotalTh}
            className={`pl-3 pr-4 pb-2 bg-white text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] cursor-pointer select-none hover:text-gray-600 transition-colors whitespace-nowrap ${sortCol === 'total' ? 'text-gray-700 font-bold' : ''}`}
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
          const roleGroup = getRoleGroup(p);
          const userDays  = dayLookup[p.userId] ?? {};
          const rowBg     = idx % 2 === 0 ? '#ffffff' : 'rgba(249,250,251,0.4)';

          return (
            <tr key={p.userId}>
              {/* Rank — sticky left */}
              <td
                style={{ ...stickyRankTd, background: rowBg }}
                className="pl-3 pr-1 py-1 text-[11px] font-bold text-gray-300 tabular-nums align-middle"
              >
                {idx + 1}
              </td>

              {/* Name + role badge — sticky left (offset) */}
              <td
                style={{ ...stickyNameTd, background: rowBg }}
                className="pr-4 py-1 align-middle"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {(() => {
                    const profileRole = inferProfileRole(p.roleName);
                    return profileRole ? (
                      <PersonLink
                        userId={p.userId}
                        role={profileRole}
                        firstName={p.firstName}
                        lastName={p.lastName}
                        className="text-xs font-medium truncate max-w-[120px] sm:max-w-[160px]"
                      />
                    ) : (
                      <span
                        className="text-xs font-medium text-gray-800 truncate max-w-[120px] sm:max-w-[160px]"
                        title={`${p.firstName} ${p.lastName}${p.centreName ? ` · ${p.centreName}` : ''}`}
                      >
                        {p.firstName} {p.lastName}
                      </span>
                    );
                  })()}
                  <RoleBadge roleGroup={roleGroup} />
                </div>
              </td>

              {/* Day cells — one per date in full range (defaults to 0 if no data) */}
              {dates.map((d) => {
                const day = userDays[d];
                const tot = day?.total ?? 0;
                const brk = day?.breakdown ?? {
                  assessmentsScored: 0, reportsDrafted: 0, goalsAdded: 0,
                  reportsApproved:   0, goalsApproved:  0, casesRegistered: 0,
                  assessmentsAssigned: 0, reportEdits:  0,
                };

                return (
                  <td
                    key={d}
                    className="rounded-[6px] text-center align-middle font-bold tabular-nums text-[10px] sm:text-[12px] select-none p-0"
                    style={{
                      width: cellWidth,
                      minWidth: cellWidth,
                      height: cellWidth,
                      ...cellStyle(tot, d),
                    }}
                    onMouseEnter={(e) => onCellEnter(e, p, d, brk, tot)}
                    onMouseLeave={onCellLeave}
                    onClick={(e) => onCellTap(e, p, d, brk, tot)}
                    aria-label={tot > 0 ? `${p.firstName} ${p.lastName} on ${d}: ${tot}` : undefined}
                  >
                    {tot > 0 && (
                      <>
                        <span className="hidden sm:inline">{tot}</span>
                        <span className="sm:hidden">{tot > 9 ? '9+' : tot}</span>
                      </>
                    )}
                  </td>
                );
              })}

              {/* Total — sticky right */}
              <td
                style={{ ...stickyTotalTd, background: rowBg }}
                className="pl-3 pr-4 py-1 text-right tabular-nums font-bold text-gray-900 text-xs align-middle"
              >
                {p.totalScore}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Memoized export — prevents re-render unless performers/dates/loading change.
// This component renders a table with up to 60+ rows × 92 date columns.
// Without memo, every parent state change (active tab, scroll, etc.) causes
// a full re-render of ~5,500 cells.
const ActivityHeatmap = React.memo(ActivityHeatmapInner, (prev, next) => {
  return (
    prev.performers === next.performers &&
    prev.daysCount  === next.daysCount  &&
    prev.loading    === next.loading    &&
    prev.centres    === next.centres    &&
    prev.dateFrom   === next.dateFrom   &&
    prev.dateTo     === next.dateTo
  );
});

export default ActivityHeatmap;
