'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Centre } from '@/lib/types';
import { shortCentreName } from '@/lib/centreNames';

// ── Date helpers ─────────────────────────────────────────────────────────────

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr(): string { return toISO(new Date()); }

function shiftDays(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return toISO(d);
}

function startOfMonth(year: number, month: number): string {
  return toISO(new Date(year, month, 1));
}

function endOfMonth(year: number, month: number): string {
  return toISO(new Date(year, month + 1, 0));
}

const PRESETS: { label: string; getRange: () => { from: string; to: string } }[] = [
  { label: 'Today',        getRange: () => ({ from: todayStr(),     to: todayStr() }) },
  { label: 'Yesterday',    getRange: () => ({ from: shiftDays(-1),  to: shiftDays(-1) }) },
  { label: 'Last 7 days',  getRange: () => ({ from: shiftDays(-6),  to: todayStr() }) },
  { label: 'Last 30 days', getRange: () => ({ from: shiftDays(-29), to: todayStr() }) },
  {
    label: 'This month',
    getRange: () => {
      const n = new Date();
      return { from: startOfMonth(n.getFullYear(), n.getMonth()), to: todayStr() };
    },
  },
  {
    label: 'Last month',
    getRange: () => {
      const n = new Date();
      const y = n.getMonth() === 0 ? n.getFullYear() - 1 : n.getFullYear();
      const mo = n.getMonth() === 0 ? 11 : n.getMonth() - 1;
      return { from: startOfMonth(y, mo), to: endOfMonth(y, mo) };
    },
  },
];

function formatDisplayRange(from: string, to: string): string {
  if (!from && !to) return 'All time';
  const fmt = (s: string) => {
    const [y, , d] = s.split('-');
    const label = new Date(`${s}T00:00`).toLocaleString('en', { month: 'short' });
    return `${parseInt(d, 10)} ${label} ${y}`;
  };
  if (from && to && from === to) return fmt(from);
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (from) return `From ${fmt(from)}`;
  return `Until ${fmt(to)}`;
}

// ── Calendar ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_NAMES = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function buildCells(year: number, month: number): (string | null)[] {
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const total    = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= total; d++) cells.push(toISO(new Date(year, month, d)));
  return cells;
}

function Calendar({
  year, month, from, to, hover,
  onDay, onHover, onPrev, onNext,
}: {
  year: number; month: number;
  from: string | null; to: string | null; hover: string | null;
  onDay: (d: string) => void;
  onHover: (d: string | null) => void;
  onPrev: () => void; onNext: () => void;
}) {
  const cells    = buildCells(year, month);
  const today    = todayStr();
  const rangeEnd = to ?? hover;

  function classify(day: string) {
    const isStart = day === from;
    const isEnd   = rangeEnd !== null && day === rangeEnd && rangeEnd !== from;
    const inRange = !!(from && rangeEnd && (
      from <= rangeEnd ? day > from && day < rangeEnd : day < from && day > rangeEnd
    ));
    return { isStart, isEnd, inRange };
  }

  return (
    <div className="w-[268px] select-none">
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={onPrev} aria-label="Previous month"
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs font-bold text-gray-700 tracking-wide">
          {MONTH_NAMES[month]} {year}
        </span>
        <button type="button" onClick={onNext} aria-label="Next month"
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 mb-0.5">
        {DAY_NAMES.map((d) => (
          <div key={d} className="text-center text-[9px] font-bold text-gray-400 py-1 uppercase tracking-wider">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, idx) => {
          if (!day) return <div key={`e${idx}`} />;
          const { isStart, isEnd, inRange } = classify(day);
          const isToday = day === today;
          return (
            <button
              key={day} type="button"
              onClick={() => onDay(day)}
              onMouseEnter={() => onHover(day)}
              onMouseLeave={() => onHover(null)}
              className={[
                'relative flex items-center justify-center h-7 w-full text-[11px] font-medium transition-colors',
                isStart || isEnd
                  ? 'bg-blue-600 text-white rounded-full z-10 font-semibold'
                  : inRange
                  ? 'bg-blue-100 text-blue-800 rounded-sm'
                  : isToday
                  ? 'text-blue-600 font-bold hover:bg-gray-100 rounded-full'
                  : 'text-gray-700 hover:bg-gray-100 rounded-full',
              ].join(' ')}
            >
              {parseInt(day.slice(-2), 10)}
              {isToday && !isStart && !isEnd && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-400" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── DateRangePicker ───────────────────────────────────────────────────────────

function DateRangePicker({ dateFrom, dateTo, onChange }: {
  dateFrom: string; dateTo: string;
  onChange: (from: string, to: string) => void;
}) {
  const [open,      setOpen]      = useState(false);
  const [draftFrom, setDraftFrom] = useState<string | null>(null);
  const [draftTo,   setDraftTo]   = useState<string | null>(null);
  const [hover,     setHover]     = useState<string | null>(null);
  const [viewYear,  setViewYear]  = useState(() =>
    dateTo ? new Date(dateTo + 'T00:00').getFullYear() : new Date().getFullYear()
  );
  const [viewMonth, setViewMonth] = useState(() =>
    dateTo ? new Date(dateTo + 'T00:00').getMonth() : new Date().getMonth()
  );

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  function openPicker() {
    setDraftFrom(dateFrom || null);
    setDraftTo(dateTo || null);
    const b = dateTo ? new Date(dateTo + 'T00:00') : new Date();
    setViewYear(b.getFullYear()); setViewMonth(b.getMonth());
    setOpen(true);
  }

  function handlePreset(from: string, to: string) { onChange(from, to); setOpen(false); }

  function handleDay(day: string) {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(day); setDraftTo(null);
    } else if (day < draftFrom) {
      setDraftTo(draftFrom); setDraftFrom(day);
    } else {
      setDraftTo(day);
    }
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  const canApply  = !!(draftFrom && draftTo);
  const selecting = !!(draftFrom && !draftTo);

  function activePreset() {
    if (!dateFrom && !dateTo) return 'All time';
    for (const p of PRESETS) {
      const r = p.getRange();
      if (r.from === dateFrom && r.to === dateTo) return p.label;
    }
    return null;
  }
  const active = activePreset();

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={openPicker}
        className={[
          'flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] transition-all min-h-[40px]',
          'focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-slate-900',
          open
            ? 'bg-slate-700 border border-slate-600 text-white'
            : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white',
        ].join(' ')}
      >
        <svg className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="max-w-[160px] truncate">{formatDisplayRange(dateFrom, dateTo)}</span>
        <svg
          className={`h-3 w-3 text-slate-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 bg-white rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.22)] border border-gray-100 flex overflow-hidden max-w-[calc(100vw-2rem)]">
          {/* Presets */}
          <div className="w-36 border-r border-gray-100 py-2 flex flex-col">
            <p className="px-3.5 pb-1.5 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
              Quick select
            </p>
            {PRESETS.map(({ label, getRange }) => (
              <button key={label} type="button"
                onClick={() => { const r = getRange(); handlePreset(r.from, r.to); }}
                className={[
                  'w-full text-left px-3.5 py-1.5 text-xs font-medium transition-colors',
                  active === label
                    ? 'text-blue-700 bg-blue-50'
                    : 'text-gray-600 hover:text-blue-700 hover:bg-blue-50',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
            <div className="mx-3 my-1.5 border-t border-gray-100" />
            <button type="button" onClick={() => handlePreset('', '')}
              className={[
                'w-full text-left px-3.5 py-1.5 text-xs font-medium transition-colors',
                active === 'All time'
                  ? 'text-blue-700 bg-blue-50'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              All time
            </button>
          </div>

          {/* Calendar */}
          <div className="p-4 flex flex-col gap-3">
            <Calendar
              year={viewYear} month={viewMonth}
              from={draftFrom} to={draftTo}
              hover={selecting ? hover : null}
              onDay={handleDay} onHover={setHover}
              onPrev={prevMonth} onNext={nextMonth}
            />
            <div className="flex items-center justify-between pt-2.5 border-t border-gray-100">
              <span className="text-[11px] text-gray-400 min-w-0 truncate max-w-[140px]">
                {!draftFrom ? 'Select start date'
                  : !draftTo ? 'Select end date'
                  : formatDisplayRange(draftFrom, draftTo)}
              </span>
              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                <button type="button" onClick={() => setOpen(false)}
                  className="px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button type="button"
                  onClick={() => { onChange(draftFrom ?? '', draftTo ?? ''); setOpen(false); }}
                  disabled={!canApply}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CentreCombobox ────────────────────────────────────────────────────────────

function CentreCombobox({ centres, centreId, onChange }: {
  centres: Centre[]; centreId: number | undefined;
  onChange: (id: number | undefined) => void;
}) {
  const [open,  setOpen]  = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  const selected     = centreId ? centres.find((c) => c.id === centreId) : null;
  const displayValue = selected ? shortCentreName(selected.name) : 'All Centres';
  const filtered     = query.trim()
    ? centres.filter((c) => {
        const q = query.trim().toLowerCase();
        return c.name.toLowerCase().includes(q) || shortCentreName(c.name).toLowerCase().includes(q);
      })
    : centres;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery('');
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function select(id: number | undefined) { onChange(id); setOpen(false); setQuery(''); }
  function handleOpen() { setOpen(true); setQuery(''); setTimeout(() => inputRef.current?.focus(), 0); }

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={handleOpen}
        className={[
          'flex items-center justify-between gap-2 min-w-[140px] sm:min-w-[155px] max-w-[200px] sm:max-w-[230px] text-[13px]',
          'px-3 py-2 rounded-lg transition-all min-h-[40px]',
          'focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-slate-900',
          open
            ? 'bg-slate-700 border border-slate-600 text-white'
            : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white',
        ].join(' ')}
      >
        <span className="truncate" title={selected?.name}>{displayValue}</span>
        <svg
          className={`h-3 w-3 text-slate-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 w-72 bg-white border border-gray-100 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.22)] overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input ref={inputRef} type="search" placeholder="Search centres…"
                value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
            </div>
          </div>
          <ul className="max-h-60 overflow-y-auto py-1.5 scrollbar-thin">
            <li>
              <button type="button" onClick={() => select(undefined)}
                className={`w-full text-left px-3.5 py-2 text-xs transition-colors ${!centreId ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-700'}`}
              >
                All Centres
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3.5 py-4 text-xs text-center text-gray-400">
                No centres match &quot;{query}&quot;
              </li>
            ) : (
              filtered.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => select(c.id)}
                    className={`w-full text-left px-3.5 py-2 text-xs transition-colors ${centreId === c.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-700'}`}
                    title={c.name}
                  >
                    {shortCentreName(c.name)}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── LogoutButton ──────────────────────────────────────────────────────────────

function LogoutButton() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'GET' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className="text-[11px] text-slate-500 font-medium hidden sm:inline select-none">
        admin
      </span>
      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        aria-label="Sign out"
        className="flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] min-w-[44px] rounded-lg text-[12px] font-medium text-slate-400 hover:text-white hover:bg-slate-700 active:bg-slate-600 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-40"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        <span className="hidden sm:inline">{loggingOut ? 'Signing out…' : 'Sign out'}</span>
      </button>
    </div>
  );
}

// ── TopBar ────────────────────────────────────────────────────────────────────

interface TopBarProps {
  centres: Centre[];
  centreId: number | undefined;
  dateFrom: string;
  dateTo: string;
  onCentreChange: (id: number | undefined) => void;
  onDateFromChange: (date: string) => void;
  onDateToChange: (date: string) => void;
  onRefresh: () => void;
  countdown: number;
  lastUpdated: Date | null;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function TopBar({
  centres, centreId, dateFrom, dateTo,
  onCentreChange, onDateFromChange, onDateToChange,
  onRefresh, countdown, lastUpdated,
}: TopBarProps) {

  const handleDateChange = useCallback(
    (from: string, to: string) => { onDateFromChange(from); onDateToChange(to); },
    [onDateFromChange, onDateToChange]
  );

  return (
    <header className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-5">

        {/* ── Desktop layout (sm+): single row ── */}
        <div className="hidden sm:flex items-center gap-3 py-2.5 min-h-[52px]">

          {/* Brand */}
          <div className="flex items-center gap-2.5 mr-1 flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Mom's Belief"
              className="h-8 w-auto flex-shrink-0 object-contain"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="text-[13px] font-semibold text-slate-400 tracking-wide hidden md:inline">
              Unity Ops
            </span>
          </div>

          <div className="hidden md:block h-5 w-px bg-slate-700 flex-shrink-0" />

          {/* Centre */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden lg:inline">
              Centre
            </span>
            <CentreCombobox centres={centres} centreId={centreId} onChange={onCentreChange} />
          </div>

          {/* Period */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden lg:inline">
              Period
            </span>
            <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onChange={handleDateChange} />
          </div>

          <div className="flex-1" />

          {/* Last updated */}
          {lastUpdated && (
            <span className="text-[11px] text-slate-500 whitespace-nowrap hidden lg:inline">
              Updated{' '}
              <span className="font-semibold text-slate-300">{formatTime(lastUpdated)}</span>
            </span>
          )}

          {/* Refresh */}
          <div className="relative group">
            <button
              type="button"
              onClick={onRefresh}
              aria-label="Refresh data now"
              className="flex items-center justify-center w-10 h-10 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 active:bg-slate-600 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              <svg
                className="h-4 w-4 transition-transform duration-500 group-hover:rotate-180"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute right-0 top-full mt-2 z-50 whitespace-nowrap rounded-lg bg-slate-800 border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-200 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            >
              Auto-refresh{' '}
              <span className="font-semibold text-white">
                {countdown >= 60 ? `${Math.floor(countdown / 60)}m ${countdown % 60}s` : `${countdown}s`}
              </span>
              <span className="absolute -top-1 right-2.5 h-2 w-2 rotate-45 bg-slate-800 border-l border-t border-slate-700" />
            </div>
          </div>

          {/* Divider */}
          <div className="h-5 w-px bg-slate-700 flex-shrink-0" />

          <LogoutButton />
        </div>

        {/* ── Mobile layout: 3 stacked rows ── */}
        <div className="flex sm:hidden flex-col py-2 gap-1.5">

          {/* Row 1: Brand + logout */}
          <div className="flex items-center justify-between gap-2 min-h-[40px]">
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="Mom's Belief"
                className="h-7 w-auto flex-shrink-0 object-contain"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              <span className="text-[12px] font-semibold text-slate-400 tracking-wide">
                Unity Ops
              </span>
            </div>
            <LogoutButton />
          </div>

          {/* Row 2: Centre + Date range */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <CentreCombobox centres={centres} centreId={centreId} onChange={onCentreChange} />
            </div>
            <div className="flex-1 min-w-0">
              <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onChange={handleDateChange} />
            </div>
          </div>

          {/* Row 3: Last updated + refresh + countdown */}
          <div className="flex items-center justify-between gap-2 min-h-[36px]">
            {lastUpdated ? (
              <span className="text-[10px] text-slate-500">
                Updated <span className="text-slate-300 font-medium">{formatTime(lastUpdated)}</span>
              </span>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-600">
                {countdown >= 60 ? `${Math.floor(countdown / 60)}m ${countdown % 60}s` : `${countdown}s`}
              </span>
              <button
                type="button"
                onClick={onRefresh}
                aria-label="Refresh data now"
                className="flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 active:bg-slate-600 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
          </div>

        </div>

      </div>
    </header>
  );
}
