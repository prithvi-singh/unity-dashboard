'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import type {
  DailyReviewData,
  DailyReviewRole,
  DailyReviewActiveUser,
  DailyReviewIdleUser,
  DailyReviewSilentUser,
  DailyReviewTrendDay,
  CaseAction,
  UserProfileRole,
} from '@/lib/types';
import PersonLink from '@/components/PersonLink';

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time
}

function formatAgo(date: Date, now: Date): string {
  const sec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? '1 min ago' : `${min} min ago`;
  const hr = Math.floor(min / 60);
  return hr === 1 ? '1 hr ago' : `${hr} hr ago`;
}

function offsetDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE');
}

function formatDateLabel(iso: string): string {
  const today = todayISO();
  const yesterday = offsetDate(today, -1);
  if (iso === today) return `Today, ${formatShort(iso)}`;
  if (iso === yesterday) return `Yesterday, ${formatShort(iso)}`;
  return formatFull(iso);
}

function formatShort(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatFull(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(isoStr: string | null): string {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── Export Excel (multi-tab, one sheet per role) ──────────────────────────────

function exportExcel(data: DailyReviewData) {
  const wb = XLSX.utils.book_new();

  for (const role of data.roles) {
    const rows: (string | number)[][] = [];

    if (role.key === 'clinician') {
      rows.push([
        'Status', 'Name', 'Email', 'Centre',
        'Assessments Scored', 'Reports Drafted',
        'Goal Cases (Total Goals)', 'Case History Complete', 'Case History Partial',
        'Last Activity',
      ]);
      for (const u of role.users.active) {
        const m = u.coreMetrics;
        const gc = m.goalCases ?? [];
        rows.push([
          'Did core job',
          `${u.firstName} ${u.lastName}`, u.email, u.centreName || '',
          m.assessmentsScored || 0,
          m.reportsDrafted    || 0,
          gc.length > 0 ? `${gc.length} cases (${m.goalsAdded} goals)` : m.goalsAdded || 0,
          m.caseHistoryComplete || 0,
          m.caseHistoryPartial  || 0,
          data.date,
        ]);
      }
      for (const u of role.users.idle) {
        rows.push([
          'Present but idle — no core output',
          `${u.firstName} ${u.lastName}`, u.email, u.centreName || '',
          '', '', `${u.actionsCount} actions in Unity`,
          u.lastActionDescription || '',
          '',
          formatTime(u.lastActionTime) || data.date,
        ]);
      }
      for (const u of role.users.silent) {
        rows.push([
          'No Unity activity today',
          `${u.firstName} ${u.lastName}`, u.email, u.centreName || '',
          '', '', '', '', '',
          u.lastActivityDate
            ? `${u.lastActivityDaysAgo ?? '?'} days ago (${u.lastActivityDate})`
            : 'Never active',
        ]);
      }
    } else if (role.key === 'manager') {
      rows.push([
        'Status', 'Name', 'Email', 'Centre',
        'Reports Approved', 'Goals Approved', 'Goal Cases', 'Cases Registered',
        'Case History (Complete / Partial)',
        'Last Activity',
      ]);
      for (const u of role.users.active) {
        const m = u.coreMetrics;
        const gc = m.goalsApprovedCases ?? [];
        const chTotal = m.caseHistoryComplete + m.caseHistoryPartial;
        rows.push([
          'Did core job',
          `${u.firstName} ${u.lastName}`, u.email, u.centreName || '',
          m.reportsApproved || 0,
          m.goalsApproved   || 0,
          gc.length > 0 ? `${gc.length} cases` : (m.goalsApproved || 0),
          m.casesRegistered || 0,
          chTotal > 0 ? `${m.caseHistoryComplete} complete, ${m.caseHistoryPartial} partial` : 0,
          data.date,
        ]);
      }
      for (const u of role.users.idle) {
        rows.push([
          'Present but idle — no core output',
          `${u.firstName} ${u.lastName}`, u.email, u.centreName || '',
          '', '', `${u.actionsCount} actions in Unity`,
          u.lastActionDescription || '',
          '',
          formatTime(u.lastActionTime) || data.date,
        ]);
      }
      for (const u of role.users.silent) {
        rows.push([
          'No Unity activity today',
          `${u.firstName} ${u.lastName}`, u.email, u.centreName || '',
          '', '', '', '', '',
          u.lastActivityDate
            ? `${u.lastActivityDaysAgo ?? '?'} days ago (${u.lastActivityDate})`
            : 'Never active',
        ]);
      }
    } else {
      rows.push([
        'Status', 'Name', 'Email', 'Centre',
        'Cases Registered', 'Cases Assigned to Clinician/Manager',
        'Last Activity',
      ]);
      for (const u of role.users.active) {
        const m = u.coreMetrics;
        rows.push([
          'Did core job',
          `${u.firstName} ${u.lastName}`, u.email, u.centreName || '',
          m.casesRegistered    || 0,
          m.cliniciansAssigned || 0,
          data.date,
        ]);
      }
      for (const u of role.users.idle) {
        rows.push([
          'Present but idle — no core output',
          `${u.firstName} ${u.lastName}`, u.email, u.centreName || '',
          `${u.actionsCount} actions in Unity`,
          u.lastActionDescription || '',
          formatTime(u.lastActionTime) || data.date,
        ]);
      }
      for (const u of role.users.silent) {
        rows.push([
          'No Unity activity today',
          `${u.firstName} ${u.lastName}`, u.email, u.centreName || '',
          '', '',
          u.lastActivityDate
            ? `${u.lastActivityDaysAgo ?? '?'} days ago (${u.lastActivityDate})`
            : 'Never active',
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 30 }, { wch: 26 }, { wch: 34 }, { wch: 22 },
      { wch: 22 }, { wch: 28 }, { wch: 28 }, { wch: 18 }, { wch: 24 }, { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, role.roleName);
  }

  XLSX.writeFile(wb, `unity-ops-${data.date}.xlsx`);
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7v5l3 3" />
  </svg>
);

const SilentIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M3 3l18 18" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

const ClinicianIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

const ManagerIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
  </svg>
);

const OpsIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
  </svg>
);

const InfoIcon = () => (
  <svg className="w-3.5 h-3.5 text-gray-400 cursor-help shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
  </svg>
);

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex ml-1" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <InfoIcon />
      {show && (
        <span className="absolute left-5 top-0 z-50 w-56 rounded-lg bg-gray-900 px-3 py-2 text-xs text-gray-100 shadow-xl leading-relaxed whitespace-normal">
          {text}
        </span>
      )}
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-24 bg-gray-100 rounded-xl border border-gray-100 animate-pulse" />
        ))}
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} className="h-32 bg-gray-100 rounded-xl border border-gray-100 animate-pulse" />
      ))}
    </div>
  );
}

// ── Summary cards ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: number;
  subtitle: string;
  valueColor: string;
  tooltip?: string;
}

function SummaryCard({ label, value, subtitle, valueColor, tooltip }: SummaryCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2.5 relative overflow-hidden">
      <div className="flex items-center gap-1.5">
        <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">{label}</p>
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      <p className={`text-[2.75rem] font-bold leading-none tracking-tight tabular-nums ${valueColor}`}>{value}</p>
      <p className="text-[12px] text-gray-500 leading-snug">{subtitle}</p>
    </div>
  );
}

// ── Metric chip with optional case hover ──────────────────────────────────────

interface MetricChipItem { name: string; count?: number; countLabel?: string }

function MetricChip({ label, items }: { label: string; items?: MetricChipItem[] }) {
  const [show, setShow] = useState(false);
  if (!items || items.length === 0) return <span>{label}</span>;
  return (
    <span
      className="relative inline-block cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="underline decoration-dotted decoration-gray-400">{label}</span>
      {show && (
        <span className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[160px] max-w-[260px] rounded-lg bg-gray-900 px-3 py-2 text-[11px] text-gray-100 shadow-xl leading-relaxed whitespace-nowrap">
          {items.map((item, i) => (
            <span key={i} className="block">
              {item.name}
              {item.count != null && (
                <span className="text-gray-400 ml-1">
                  ({item.count} {item.countLabel ?? ''})
                </span>
              )}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function casesToItems(cases: CaseAction[], countLabel?: string): MetricChipItem[] {
  return cases.map(c => ({ name: c.patientName, count: c.count > 1 || !!countLabel ? c.count : undefined, countLabel }));
}

function roleKeyToProfileRole(roleKey: string): UserProfileRole {
  if (roleKey === 'clinician') return 'clinician';
  if (roleKey === 'manager') return 'manager';
  return 'centre-admin';
}

// ── Active user card ──────────────────────────────────────────────────────────

function coreMetricChips(roleKey: string, m: DailyReviewActiveUser['coreMetrics']): React.ReactNode[] {
  const chips: React.ReactNode[] = [];

  if (roleKey === 'clinician') {
    if (m.assessmentsScored > 0) {
      chips.push(
        <MetricChip
          label={`${m.assessmentsScored} scored`}
          items={casesToItems(m.assessmentCases ?? [])}
        />
      );
    }
    if (m.reportsDrafted > 0) {
      chips.push(
        <MetricChip
          label={`${m.reportsDrafted} report${m.reportsDrafted !== 1 ? 's' : ''}`}
          items={casesToItems(m.reportCases ?? [])}
        />
      );
    }
    if (m.goalsAdded > 0) {
      const cases = m.goalCases ?? [];
      const uniqueCases = cases.length;
      const totalGoals = cases.reduce((s, c) => s + c.count, 0) || m.goalsAdded;
      const label = uniqueCases > 0
        ? `${uniqueCases} case${uniqueCases !== 1 ? 's' : ''} (${totalGoals} goal${totalGoals !== 1 ? 's' : ''})`
        : `${m.goalsAdded} case${m.goalsAdded !== 1 ? 's' : ''} with goals`;
      chips.push(
        <MetricChip
          label={label}
          items={cases.map(c => ({ name: c.patientName, count: c.count, countLabel: `goal${c.count !== 1 ? 's' : ''}` }))}
        />
      );
    }
    if (m.caseHistoryComplete > 0 || m.caseHistoryPartial > 0) {
      const total = m.caseHistoryComplete + m.caseHistoryPartial;
      const parts: string[] = [];
      if (m.caseHistoryComplete > 0) parts.push(`${m.caseHistoryComplete} complete`);
      if (m.caseHistoryPartial  > 0) parts.push(`${m.caseHistoryPartial} partial`);
      chips.push(<MetricChip label={`${total} case history (${parts.join(' ')})`} />);
    }

  } else if (roleKey === 'manager') {
    if (m.reportsApproved > 0) {
      chips.push(
        <MetricChip
          label={`${m.reportsApproved} report${m.reportsApproved !== 1 ? 's' : ''} approved`}
          items={casesToItems(m.reportsApprovedCases ?? [])}
        />
      );
    }
    if (m.goalsApproved > 0) {
      const cases = m.goalsApprovedCases ?? [];
      const uniqueCases = cases.length;
      const label = uniqueCases > 0
        ? `${uniqueCases} case${uniqueCases !== 1 ? 's' : ''} (${m.goalsApproved} goal${m.goalsApproved !== 1 ? 's' : ''} approved)`
        : `${m.goalsApproved} goal${m.goalsApproved !== 1 ? 's' : ''} approved`;
      chips.push(
        <MetricChip
          label={label}
          items={cases.map(c => ({ name: c.patientName, count: c.count, countLabel: `goal${c.count !== 1 ? 's' : ''}` }))}
        />
      );
    }
    if (m.casesRegistered > 0) {
      chips.push(
        <MetricChip
          label={`${m.casesRegistered} case${m.casesRegistered !== 1 ? 's' : ''} registered`}
          items={casesToItems(m.casesRegisteredCases ?? [])}
        />
      );
    }
    if (m.caseHistoryComplete > 0 || m.caseHistoryPartial > 0) {
      chips.push(<MetricChip label={`${m.caseHistoryComplete + m.caseHistoryPartial} case history`} />);
    }

  } else { // ops
    if (m.casesRegistered > 0) {
      chips.push(
        <MetricChip
          label={`${m.casesRegistered} case${m.casesRegistered !== 1 ? 's' : ''} registered`}
          items={casesToItems(m.casesRegisteredCases ?? [])}
        />
      );
    }
    if (m.cliniciansAssigned > 0) {
      chips.push(
        <MetricChip
          label={`${m.cliniciansAssigned} assigned`}
          items={casesToItems(m.cliniciansAssignedCases ?? [])}
        />
      );
    }
  }

  return chips;
}

function ActiveUserCard({ user, roleKey }: { user: DailyReviewActiveUser; roleKey: string }) {
  const chips = coreMetricChips(roleKey, user.coreMetrics);
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] border-l-4 border-l-emerald-400 p-4 flex flex-col gap-1">
      <p className="text-[14px] font-medium text-gray-900 leading-tight">
        <PersonLink
          userId={user.id}
          role={roleKeyToProfileRole(roleKey)}
          firstName={user.firstName}
          lastName={user.lastName}
        />
      </p>
      {user.centreName && (
        <p className="text-[12px] text-gray-500 leading-tight">{user.centreName}</p>
      )}
      {chips.length > 0 && (
        <div className="text-xs text-gray-600 mt-1 leading-relaxed flex flex-wrap gap-x-1.5 items-baseline">
          {chips.map((chip, i) => (
            <span key={i} className="inline-flex items-baseline gap-x-1.5">
              {i > 0 && <span className="text-gray-300 select-none">·</span>}
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Idle user card ────────────────────────────────────────────────────────────

function IdleUserCard({ user, roleKey }: { user: DailyReviewIdleUser; roleKey: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] border-l-4 border-l-amber-400 p-4 flex flex-col gap-1">
      <p className="text-[14px] font-medium text-gray-900 leading-tight">
        <PersonLink
          userId={user.id}
          role={roleKeyToProfileRole(roleKey)}
          firstName={user.firstName}
          lastName={user.lastName}
        />
      </p>
      {user.centreName && (
        <p className="text-[12px] text-gray-500 leading-tight">{user.centreName}</p>
      )}
      <p className="text-xs text-gray-600 mt-1">
        {user.actionsCount} action{user.actionsCount !== 1 ? 's' : ''} — no core output
      </p>
      {user.lastActionDescription && (
        <p className="text-[12px] text-gray-500 italic leading-tight">{user.lastActionDescription}</p>
      )}
    </div>
  );
}

// ── Silent user list item ─────────────────────────────────────────────────────

function lastSeenLabel(user: DailyReviewSilentUser): { text: string; red: boolean } {
  if (!user.lastActivityDate) return { text: 'Never active', red: true };
  const days = user.lastActivityDaysAgo ?? 0;
  if (days > 30) return { text: `> 30 days ago`, red: true };
  return { text: `${days} day${days !== 1 ? 's' : ''} ago`, red: false };
}

// ── Role swimlane ─────────────────────────────────────────────────────────────

const ROLE_ICONS: Record<string, React.FC> = {
  clinician: ClinicianIcon,
  manager:   ManagerIcon,
  ops:       OpsIcon,
};

function RoleSwimlane({ role, defaultOpen }: { role: DailyReviewRole; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [silentOpen, setSilentOpen] = useState(false);

  const Icon = ROLE_ICONS[role.key] ?? ClinicianIcon;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

      {/* Header */}
      <button
        type="button"
        className="w-full px-5 py-3.5 flex items-center gap-3 text-left hover:bg-gray-50/70 transition-colors"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className="p-1.5 rounded-lg bg-gray-50 border border-gray-100 text-gray-500 shrink-0">
          <Icon />
        </span>

        <span className="font-semibold text-sm text-gray-900 tracking-tight">{role.roleName}</span>

        <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full tabular-nums shrink-0">
          {role.total}
        </span>

        <span className="text-[11px] text-gray-400 hidden sm:block truncate leading-relaxed">
          {role.coreJobDescription}
        </span>

        <span className="ml-auto flex items-center gap-2.5 text-[11px] shrink-0">
          {role.didCoreJob > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full tabular-nums">
              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg>
              {role.didCoreJob}
            </span>
          )}
          {role.presentButIdle > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full tabular-nums">
              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg>
              {role.presentButIdle}
            </span>
          )}
          {role.silent > 0 && (
            <span className="font-medium text-gray-400 tabular-nums">
              {role.silent} silent
            </span>
          )}
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-50 px-5 py-5 space-y-7">

          {/* Section 1 — Did core job */}
          {role.users.active.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                  Did core job today
                </p>
              </div>
              <p className="section-click-hint mb-2">Click any name to view their full profile</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {role.users.active.map(u => (
                  <ActiveUserCard key={u.id} user={u} roleKey={role.key} />
                ))}
              </div>
            </div>
          )}

          {/* Section 2 — Present but idle */}
          {role.users.idle.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                  Present but idle
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {role.users.idle.map(u => (
                  <IdleUserCard key={u.id} user={u} roleKey={role.key} />
                ))}
              </div>
            </div>
          )}

          {/* Section 3 — No activity */}
          {role.users.silent.length > 0 && (
            <div>
              <button
                type="button"
                className="flex items-center gap-2 text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
                onClick={() => setSilentOpen(v => !v)}
              >
                <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${silentOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span>
                  {silentOpen ? 'Hide' : `Show ${role.users.silent.length}`} no-activity user{role.users.silent.length !== 1 ? 's' : ''}
                </span>
              </button>

              {silentOpen && (
                <div className="mt-3 border border-gray-100 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto_auto] text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] px-4 py-2 bg-gray-50/80 gap-4">
                    <span>Name</span>
                    <span>Centre</span>
                    <span className="text-right">Last seen</span>
                  </div>
                  {role.users.silent.map(u => {
                    const ls = lastSeenLabel(u);
                    return (
                      <div
                        key={u.id}
                        className="grid grid-cols-[1fr_auto_auto] items-center px-4 py-2.5 gap-4 border-t border-gray-50 hover:bg-gray-50/40"
                      >
                        <span className="text-sm text-gray-800 font-medium leading-tight">
                          <PersonLink
                            userId={u.id}
                            role={roleKeyToProfileRole(role.key)}
                            firstName={u.firstName}
                            lastName={u.lastName}
                          />
                        </span>
                        <span className="text-[12px] text-gray-500">{u.centreName || '—'}</span>
                        <span className={`text-xs tabular-nums text-right ${ls.red ? 'text-rose-500' : 'text-gray-500'}`}>
                          {ls.text}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {role.users.active.length === 0 && role.users.idle.length === 0 && role.users.silent.length === 0 && (
            <p className="text-sm text-gray-400 py-2">No users in this role group today.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Trend chart ───────────────────────────────────────────────────────────────

type TrendFilter = 'all' | 'clinician' | 'manager' | 'ops';

function TrendChart({
  days,
  selectedDate,
  onDateClick,
}: {
  days: DailyReviewTrendDay[];
  selectedDate: string;
  onDateClick: (date: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef  = useRef<any>(null);
  const [filter, setFilter] = useState<TrendFilter>('all');

  const buildChart = useCallback(() => {
    if (!canvasRef.current || typeof window === 'undefined' || !window.Chart) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const labels = days.map(d => formatShort(d.date));

    const datasets = [];

    if (filter === 'all' || filter === 'clinician') {
      datasets.push({
        label: 'Clinicians',
        data: days.map(d => d.clinicianCoreActions),
        backgroundColor: days.map(d =>
          d.date === selectedDate ? 'rgba(16,185,129,0.9)' : 'rgba(16,185,129,0.45)'
        ),
        borderRadius: 3,
        borderSkipped: false,
        stack: 'core',
      });
    }
    if (filter === 'all' || filter === 'manager') {
      datasets.push({
        label: 'Managers',
        data: days.map(d => d.managerCoreActions),
        backgroundColor: days.map(d =>
          d.date === selectedDate ? 'rgba(59,130,246,0.9)' : 'rgba(59,130,246,0.45)'
        ),
        borderRadius: 3,
        borderSkipped: false,
        stack: 'core',
      });
    }
    if (filter === 'all' || filter === 'ops') {
      datasets.push({
        label: 'Ops',
        data: days.map(d => d.opsCoreActions),
        backgroundColor: days.map(d =>
          d.date === selectedDate ? 'rgba(139,92,246,0.9)' : 'rgba(139,92,246,0.45)'
        ),
        borderRadius: 3,
        borderSkipped: false,
        stack: 'core',
      });
    }

    chartRef.current = new window.Chart(canvasRef.current.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_e: unknown, elements: unknown[]) => {
          const arr = elements as Array<{ index: number }>;
          if (arr.length > 0) {
            const idx = arr[0].index;
            if (days[idx]) onDateClick(days[idx].date);
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(17,24,39,0.92)',
            titleColor: '#F9FAFB',
            bodyColor: '#D1D5DB',
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              title: (items: any[]) => days[items[0]?.dataIndex ?? 0]?.date ?? '',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              label: (item: any) => ` ${item.dataset.label}: ${item.raw}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: '#9CA3AF', maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
            border: { display: false },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: 'rgba(243,244,246,1)' },
            ticks: { color: '#9CA3AF', maxTicksLimit: 5 },
            border: { display: false },
          },
        },
      },
    });
  }, [days, selectedDate, filter, onDateClick]);

  useEffect(() => {
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tryCreate = () => {
      if (typeof window !== 'undefined' && window.Chart) {
        buildChart();
      } else if (attempts < 40) {
        attempts++;
        timer = setTimeout(tryCreate, 100);
      }
    };
    tryCreate();
    return () => {
      clearTimeout(timer);
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [buildChart]);

  const FILTERS: { key: TrendFilter; label: string; color: string }[] = [
    { key: 'all',       label: 'All',       color: 'text-gray-600' },
    { key: 'clinician', label: 'Clinicians', color: 'text-emerald-600' },
    { key: 'manager',   label: 'Managers',   color: 'text-blue-600' },
    { key: 'ops',       label: 'Ops',        color: 'text-violet-600' },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-[14px] font-medium text-gray-900">14-day core activity trend</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Core role actions only — not all system activity</p>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                filter === f.key
                  ? `bg-gray-100 ${f.color}`
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-44 sm:h-52">
        <canvas ref={canvasRef} aria-label="14 day core activity trend" role="img" />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-emerald-500 opacity-80" />Clinicians
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-blue-500 opacity-80" />Managers
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-violet-500 opacity-80" />Ops
        </span>
        <span className="ml-auto text-gray-400 text-[10px]">Click a bar to navigate to that date</span>
      </div>
    </div>
  );
}

// ── Top bar ───────────────────────────────────────────────────────────────────

function TopBar({
  date,
  loading,
  centreName,
  onPrev,
  onNext,
  onExport,
  lastUpdated,
  onRefresh,
  liveLoading,
}: {
  date: string;
  loading: boolean;
  centreName?: string;
  onPrev: () => void;
  onNext: () => void;
  onExport: () => void;
  lastUpdated: Date | null;
  onRefresh: () => void;
  liveLoading?: boolean;
}) {
  const today = todayISO();
  const canGoForward = date < today;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const ageMs = lastUpdated ? now.getTime() - lastUpdated.getTime() : null;
  const isFresh = ageMs !== null && ageMs < 5 * 60 * 1000;
  const ago = lastUpdated ? formatAgo(lastUpdated, now) : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
      {/* Title block */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-gray-900 tracking-tight">Daily ops review</h2>
          {centreName && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8">
                <circle cx="4" cy="4" r="3" />
              </svg>
              {centreName}
            </span>
          )}
        </div>
        <p className="text-[12px] text-gray-500 mt-0.5">Who performed their core job — not just who was present</p>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2 ml-auto flex-wrap">

        {/* Day navigator + live status combined group */}
        <div className="flex items-center gap-2">
          {/* Date navigation pill */}
          <div className="flex items-center bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={onPrev}
              className="h-9 px-3.5 flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors border-r border-gray-100"
              aria-label="Previous day"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-[14px] font-medium text-gray-900 min-w-[160px] text-center px-4 py-1.5 tabular-nums select-none">
              {loading
                ? <span className="text-gray-300 animate-pulse">— — —</span>
                : formatDateLabel(date)
              }
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={!canGoForward}
              className="h-9 px-3.5 flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors border-l border-gray-100 disabled:opacity-20 disabled:cursor-not-allowed"
              aria-label="Next day"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Live status dot + "Updated X ago" + refresh — tight to the navigator */}
          <div className="flex items-center gap-1 text-xs text-gray-500">
            {isFresh ? (
              <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            ) : (
              <span className="inline-flex rounded-full h-2 w-2 bg-gray-300 flex-shrink-0" aria-hidden="true" />
            )}
            <span className="whitespace-nowrap hidden sm:inline text-[11px]">
              Updated <span className="font-medium text-gray-700">{ago ?? '—'}</span>
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={liveLoading}
              aria-label="Refresh monitoring data"
              className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-40 disabled:pointer-events-none"
            >
              <svg
                className={`h-3.5 w-3.5 ${liveLoading ? 'animate-spin' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Export — icon only, visually separated */}
        <button
          type="button"
          onClick={onExport}
          title="Export to Excel (.xlsx)"
          aria-label="Export to Excel"
          className="h-9 w-9 inline-flex items-center justify-center text-gray-500 border border-gray-200 rounded-xl bg-white shadow-sm hover:bg-gray-50 hover:text-emerald-600 hover:border-emerald-200 transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  data: DailyReviewData | null;
  loading: boolean;
  date: string;
  onDateChange: (date: string) => void;
  centreName?: string;
  lastUpdated: Date | null;
  onRefresh: () => void;
  liveLoading?: boolean;
}

export default function DailyOpsReview({ data, loading, date, onDateChange, centreName, lastUpdated, onRefresh, liveLoading }: Props) {
  const today = todayISO();

  const handleExport = () => {
    if (data) exportExcel(data);
  };

  const handlePrev = () => onDateChange(offsetDate(date, -1));
  const handleNext = () => { if (date < today) onDateChange(offsetDate(date, 1)); };

  return (
    <div className="space-y-4">
      <TopBar
        date={date}
        loading={loading}
        centreName={centreName}
        onPrev={handlePrev}
        onNext={handleNext}
        onExport={handleExport}
        lastUpdated={lastUpdated}
        onRefresh={onRefresh}
        liveLoading={liveLoading}
      />

      {loading && !data && <Skeleton />}

      {!loading && !data && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          No data available for this date.
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryCard
              label="Did core job"
              value={data.summary.didCoreJob}
              subtitle="Performed role-specific actions"
              valueColor="text-emerald-600"
            />
            <SummaryCard
              label="Present but idle"
              value={data.summary.presentButIdle}
              subtitle="In Unity, not doing core work"
              valueColor="text-amber-500"
              tooltip="Had activity in Unity today but did not perform core role responsibilities. Reachable and working — most actionable group for ops to follow up."
            />
            <SummaryCard
              label="No activity"
              value={data.summary.silent}
              subtitle="Zero Unity actions today"
              valueColor={data.summary.silent > 0 ? 'text-rose-500' : 'text-gray-400'}
              tooltip="Based on clinical activity only, not login sessions. A user can be logged in and still show here if they performed no clinical actions."
            />
          </div>

          {/* Role swimlanes */}
          {data.roles.map((role) => (
            <RoleSwimlane
              key={role.key}
              role={role}
              defaultOpen={role.key === 'clinician'}
            />
          ))}

          {/* 14-day trend chart */}
          <TrendChart
            days={data.trend.days}
            selectedDate={date}
            onDateClick={onDateChange}
          />
        </>
      )}
    </div>
  );
}

// ── Global type augmentation for Chart.js (loaded via CDN) ────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Chart: any;
  }
}
