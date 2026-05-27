'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type {
  IssuesData,
  IssueOverdueAssessment,
  IssueReportNotDrafted,
  IssueReportPendingApproval,
  IssueGoalsNotAdded,
  IssueGoalPendingApproval,
  IssueStuckOnboarding,
  IssueDarkCentre,
  IssueEarlyOverdue,
  IssueLowCompletionClinician,
  IssueLowCompletionCentre,
  IssueTurnaroundWeek,
  IssueByType,
} from '@/lib/types';
import PersonLink from '@/components/PersonLink';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_BADGE: Record<string, string> = {
  SPM:   'bg-blue-50 text-blue-700 ring-1 ring-blue-200/60',
  DP3:   'bg-violet-50 text-violet-700 ring-1 ring-violet-200/60',
  REELS: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100/60',
  ISAA:  'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/60',
};

const TYPE_FULL: Record<string, string> = {
  SPM:   'Sensory Processing Measure',
  DP3:   'Developmental Profile 3',
  REELS: 'Receptive-Expressive Emergent Language Scale',
  ISAA:  'Indian Scale for Assessment of Autism',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function exportCsv(filename: string, headers: string[], rows: string[][]): void {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines  = [headers, ...rows].map((r) => r.map(escape).join(','));
  const blob   = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Build a Gmail compose URL so the email opens in the browser on Google Workspace.
 * Opens via target="_blank" — ops stays on the dashboard.
 */
function buildMailto(
  to: string | string[],
  subject: string,
  body: string,
): string {
  const recipients = Array.isArray(to) ? to.filter(Boolean).join(',') : to;
  const params = new URLSearchParams({
    view: 'cm',
    fs:   '1',
    to:   recipients,
    su:   subject,
    body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/** Extract first name from "First Last" full-name string */
function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName;
}

/** Split a "First Last" string into { first, last } parts */
function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(' ');
  return { first: parts[0] || fullName, last: parts.slice(1).join(' ') || '' };
}

function ClickHint() {
  return (
    <p className="section-click-hint">Click any name to view their full profile</p>
  );
}

// ── Specific email generators per issue type ──────────────────────────────────

function emailOverdue(row: IssueOverdueAssessment): { subject: string; body: string } {
  const subject = `Unity ops: Assessment overdue ${row.daysPending} days — ${row.patientName} (${row.assessmentType})`;
  const body = [
    `Hi ${firstName(row.clinicianName)},`,
    ``,
    `The ${row.assessmentType} assessment assigned to you for ${row.patientName} at ${row.centreName} has been pending for ${row.daysPending} days with no result recorded in Unity.`,
    ``,
    `This is now overdue (threshold: 21 days). Please action one of the following immediately:`,
    ``,
    `  1. Complete the assessment and record the result in Unity.`,
    `  2. If you are unable to complete it, contact your centre manager to arrange reassignment.`,
    ``,
    `Case details:`,
    `  Patient:    ${row.patientName}`,
    `  Assessment: ${row.assessmentType}`,
    `  Assigned:   ${fmtDate(row.assignedDate)}`,
    `  Days open:  ${row.daysPending}`,
    `  Centre:     ${row.centreName}`,
    ``,
    `If this has already been completed and not yet recorded, please update Unity as soon as possible so the case can progress.`,
    ``,
    `Unity Ops Team`,
  ].join('\n');
  return { subject, body };
}

function emailNudge(row: IssueOverdueAssessment): { subject: string; body: string } {
  const subject = `Unity: Assessment reminder — ${row.patientName} (${row.assessmentType}) — ${row.daysPending} days`;
  const body = [
    `Hi ${firstName(row.clinicianName)},`,
    ``,
    `This is a friendly reminder that the ${row.assessmentType} assessment for ${row.patientName} at ${row.centreName} has been open for ${row.daysPending} days.`,
    ``,
    `Assessments become overdue at 21 days. You have ${21 - row.daysPending} day${21 - row.daysPending === 1 ? '' : 's'} to complete this before escalation is required.`,
    ``,
    `Action needed:`,
    `  Complete the assessment and record the result in Unity before the 21-day mark.`,
    ``,
    `Case details:`,
    `  Patient:    ${row.patientName}`,
    `  Assessment: ${row.assessmentType}`,
    `  Assigned:   ${fmtDate(row.assignedDate)}`,
    `  Days open:  ${row.daysPending}`,
    `  Centre:     ${row.centreName}`,
    ``,
    `If you have any concerns about completing this assessment, please speak to your manager today.`,
    ``,
    `Unity Ops Team`,
  ].join('\n');
  return { subject, body };
}

function emailStuckOnboarding(row: IssueStuckOnboarding): { subject: string; body: string } {
  const subject = `Unity ops: Case unassigned ${row.hoursUnassigned} hours — ${row.patientName} at ${row.centreName}`;
  const body = [
    `Hi,`,
    ``,
    `${row.patientName} was registered at ${row.centreName} on ${fmtDate(row.registeredDate)} and has not been assigned to a clinician after ${row.hoursUnassigned} hours.`,
    ``,
    `This child is waiting. A clinician must be assigned in Unity before any assessment work can begin.`,
    ``,
    `Action required:`,
    `  Log in to Unity and assign a clinician to this case immediately.`,
    ``,
    `Case details:`,
    `  Patient:      ${row.patientName}`,
    `  Centre:       ${row.centreName}`,
    `  Registered:   ${fmtDate(row.registeredDate)}`,
    `  Registered by:${row.registeredBy}`,
    `  Hours waiting:${row.hoursUnassigned}`,
    ``,
    `If there is a reason this case cannot be assigned right now (e.g., capacity issue), please reply to this email with the expected assignment date.`,
    ``,
    `Unity Ops Team`,
  ].join('\n');
  return { subject, body };
}

function emailPendingGoal(row: IssueGoalPendingApproval): { subject: string; body: string } {
  const days = row.daysInCurrentState ?? row.daysPending ?? 0;
  const subject = `Unity ops: Goal approval needed — ${row.patientName} — ${days} days waiting`;
  const body = [
    `Hi ${firstName(row.managerName)},`,
    ``,
    `${row.clinicianName} submitted goals for ${row.patientName} at ${row.centreName} on ${fmtDate(row.submittedDate)}.`,
    ``,
    `The goals have been waiting for your approval for ${days} days${days > 7 ? ' — this is now overdue' : ''}.`,
    ``,
    `Action required:`,
    `  Log in to Unity, review the submitted goals, and approve or request changes.`,
    `  The clinician is waiting on your sign-off to progress this case.`,
    ``,
    `Case details:`,
    `  Patient:    ${row.patientName}`,
    `  Assessment: ${row.assessmentType ?? ''}`,
    `  Clinician:  ${row.clinicianName}`,
    `  Submitted:  ${fmtDate(row.submittedDate)}`,
    `  Waiting:    ${days} days`,
    `  Centre:     ${row.centreName}`,
    ``,
    `If you have already approved these goals in Unity, please ignore this message.`,
    ``,
    `Unity Ops Team`,
  ].join('\n');
  return { subject, body };
}

function emailReportNotDrafted(row: IssueReportNotDrafted): { subject: string; body: string } {
  const subject = `Unity ops: Report not drafted — ${row.patientName} (${row.assessmentType}) — ${row.daysInCurrentState} days since scoring`;
  const body = [
    `Hi ${firstName(row.clinicianName)},`,
    ``,
    `The ${row.assessmentType} assessment for ${row.patientName} at ${row.centreName} was scored on ${fmtDate(row.resultGeneratedDate)}.`,
    ``,
    `The report has not yet been drafted — it has been ${row.daysInCurrentState} days since scoring was completed.`,
    ``,
    `Action required:`,
    `  Log in to Unity and draft the report for this case so it can be reviewed and approved.`,
    ``,
    `Case details:`,
    `  Patient:       ${row.patientName}`,
    `  Assessment:    ${row.assessmentType}`,
    `  Scored:        ${fmtDate(row.resultGeneratedDate)} (${row.daysInCurrentState} days ago)`,
    `  Centre:        ${row.centreName}`,
    ``,
    `If you have already started the report in Unity, please check it is saved correctly.`,
    ``,
    `Unity Ops Team`,
  ].join('\n');
  return { subject, body };
}

function emailGoalsNotAdded(row: IssueGoalsNotAdded): { subject: string; body: string } {
  const subject = `Unity ops: Goals not added — ${row.patientName} (${row.assessmentType}) — ${row.daysInCurrentState} days since report approved`;
  const body = [
    `Hi ${firstName(row.clinicianName)},`,
    ``,
    `The report for ${row.patientName}'s ${row.assessmentType} assessment at ${row.centreName} was approved on ${fmtDate(row.pdfGeneratedDate)}.`,
    ``,
    `Intervention goals have not yet been added in Unity — it has been ${row.daysInCurrentState} days since the report was approved.`,
    ``,
    `Action required:`,
    `  Log in to Unity and add the intervention goals for this case.`,
    `  The case cannot be completed until goals are added and approved.`,
    ``,
    `Case details:`,
    `  Patient:         ${row.patientName}`,
    `  Assessment:      ${row.assessmentType}`,
    `  Report approved: ${fmtDate(row.pdfGeneratedDate)} (${row.daysInCurrentState} days ago)`,
    `  Centre:          ${row.centreName}`,
    ``,
    `If you have questions about what goals to set, please speak to your manager.`,
    ``,
    `Unity Ops Team`,
  ].join('\n');
  return { subject, body };
}

function emailPendingReport(row: IssueReportPendingApproval): { subject: string; body: string } {
  const days = row.daysInCurrentState ?? row.daysPending ?? 0;
  const subject = `Unity ops: Report approval needed — ${row.patientName} (${row.assessmentType}) — ${days} days waiting`;
  const body = [
    `Hi ${firstName(row.managerName)},`,
    ``,
    `${row.clinicianName} completed and drafted a report for ${row.patientName}'s ${row.assessmentType} assessment at ${row.centreName} on ${fmtDate(row.draftedDate)}.`,
    ``,
    `The report has been waiting for your approval for ${days} days${days > 7 ? ' — this is now overdue' : ''}.`,
    ``,
    `Action required:`,
    `  Log in to Unity, review the report, and approve or request changes.`,
    `  Without your approval, the report cannot be shared with the family.`,
    ``,
    `Case details:`,
    `  Patient:    ${row.patientName}`,
    `  Assessment: ${row.assessmentType}`,
    `  Clinician:  ${row.clinicianName}`,
    `  Drafted:    ${fmtDate(row.draftedDate)}`,
    `  Waiting:    ${days} days`,
    `  Centre:     ${row.centreName}`,
    ``,
    `If you have already approved this in Unity, please ignore this message.`,
    ``,
    `Unity Ops Team`,
  ].join('\n');
  return { subject, body };
}

// ── Bulk email body — lists every selected case with what to action ────────────

function buildBulkEmailBody(
  items: Array<{ line: string }>,
  recipientCount: number,
  issueType: string,
): string {
  return [
    `Hi,`,
    ``,
    `You are receiving this because ${recipientCount > 1 ? `${recipientCount} items require` : 'an item requires'} your attention in Unity (${issueType}).`,
    ``,
    `Please action each of the following:`,
    ``,
    ...items.map((it, i) => `${i + 1}. ${it.line}`),
    ``,
    `Log in to Unity to complete these actions. If any of these have already been resolved, please ignore the relevant items.`,
    ``,
    `Unity Ops Team`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-t border-gray-100">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 bg-gray-100 rounded animate-pulse" style={{ width: `${60 + (i * 23) % 80}px` }} />
        </td>
      ))}
    </tr>
  );
}

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return <svg className="w-3 h-3 text-gray-300 ml-0.5 inline" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M8 3v10M5 6l3-3 3 3M5 10l3 3 3-3" /></svg>;
  return <svg className={`w-3 h-3 ml-0.5 inline text-blue-500 ${asc ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M8 12V4M5 7l3-3 3 3" /></svg>;
}

function DaysBadge({ days, criticalThreshold = 21, warnThreshold = 14 }: { days: number; criticalThreshold?: number; warnThreshold?: number }) {
  const cls = days > criticalThreshold
    ? 'bg-red-600 text-white'
    : days > warnThreshold
    ? 'bg-amber-500 text-white'
    : 'bg-gray-200 text-gray-700';
  return (
    <span className={`inline-flex items-center font-bold text-sm tabular-nums px-2 py-0.5 rounded ${cls}`}>
      {days}d
    </span>
  );
}

function HoursBadge({ hours }: { hours: number }) {
  const cls = hours > 72
    ? 'bg-red-600 text-white'
    : 'bg-amber-500 text-white';
  return (
    <span className={`inline-flex items-center font-bold text-sm tabular-nums px-2 py-0.5 rounded ${cls}`}>
      {hours}h
    </span>
  );
}

function ActionBanner({ text, variant }: { text: string; variant: 'red' | 'amber' | 'neutral' }) {
  const styles = {
    red:     'bg-red-50/60 border-red-200 text-red-800',
    amber:   'bg-amber-50/60 border-amber-200 text-amber-800',
    neutral: 'bg-gray-50 border-gray-200 text-gray-600',
  };
  return (
    <div className={`mb-3 px-3.5 py-2.5 rounded-lg border text-[12px] leading-relaxed ${styles[variant]}`}>
      {text}
    </div>
  );
}

function SectionChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter bar + row-limit utilities shared by every issue-group table
// ─────────────────────────────────────────────────────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

interface FilterableRow {
  patientName: string;
  centreName: string;
  clinicianName?: string;
  managerName?: string;
  assessmentType?: string;
}

function useGroupFilter<T extends FilterableRow>(rows: T[], sortDaysKey: string) {
  const [search,       setSearch]  = useState('');
  const [typeFilter,   setType]    = useState('all');
  const [centreFilter, setCentre]  = useState('all');
  const [sortOption,   setSort]    = useState('days_desc');
  const q = useDebounced(search, 200);

  const centres = useMemo(
    () => Array.from(new Set(rows.map((r) => r.centreName).filter(Boolean))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    let list = [...rows];
    if (typeFilter !== 'all') list = list.filter((r) => r.assessmentType === typeFilter);
    if (centreFilter !== 'all') list = list.filter((r) => r.centreName === centreFilter);
    if (q) {
      const lq = q.toLowerCase();
      list = list.filter((r) =>
        r.patientName.toLowerCase().includes(lq) ||
        (r.clinicianName ?? '').toLowerCase().includes(lq) ||
        (r.managerName ?? '').toLowerCase().includes(lq) ||
        r.centreName.toLowerCase().includes(lq),
      );
    }
    const getD = (r: T): number => {
      const v = (r as Record<string, unknown>)[sortDaysKey];
      return typeof v === 'number' ? v : 0;
    };
    list.sort((a, b) => {
      switch (sortOption) {
        case 'days_asc':      return getD(a) - getD(b);
        case 'patient_asc':   return a.patientName.localeCompare(b.patientName);
        case 'clinician_asc': return (a.clinicianName ?? '').localeCompare(b.clinicianName ?? '');
        default:              return getD(b) - getD(a);
      }
    });
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, typeFilter, centreFilter, q, sortOption, sortDaysKey]);

  const isFiltered = search !== '' || typeFilter !== 'all' || centreFilter !== 'all' || sortOption !== 'days_desc';
  const clearFilters = useCallback(() => {
    setSearch(''); setType('all'); setCentre('all'); setSort('days_desc');
  }, []);

  return { search, setSearch, typeFilter, setType, centreFilter, setCentre, sortOption, setSort, filtered, centres, isFiltered, clearFilters };
}

function useRowLimit(filteredLen: number, initial = 20) {
  const [limit, setLimit] = useState(initial);
  useEffect(() => { setLimit(initial); }, [filteredLen, initial]);
  const showing    = Math.min(limit, filteredLen);
  const remaining  = filteredLen - showing;
  const isExpanded = filteredLen > initial && limit >= filteredLen;
  return {
    showing,
    remaining,
    isExpanded,
    expand:   () => setLimit(filteredLen),
    collapse: () => setLimit(initial),
  };
}

interface FilterBarProps {
  search: string; onSearch: (v: string) => void;
  typeFilter: string; onType: (v: string) => void;
  centreFilter: string; onCentre: (v: string) => void;
  sortOption: string; onSort: (v: string) => void;
  centres: string[];
  filteredCount: number; totalCount: number;
  isFiltered: boolean; onClear: () => void;
  showTypeFilter?: boolean;
}

function IssueFilterBar({
  search, onSearch, typeFilter, onType, centreFilter, onCentre,
  sortOption, onSort, centres, filteredCount, totalCount, isFiltered, onClear,
  showTypeFilter = true,
}: FilterBarProps) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
          </svg>
          <input
            type="search"
            placeholder="Search patient, clinician, centre…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {showTypeFilter && (
            <select value={typeFilter} onChange={(e) => onType(e.target.value)} className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="all">All types</option>
              {['SPM', 'DP3', 'REELS', 'ISAA'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {centres.length > 1 && (
            <select value={centreFilter} onChange={(e) => onCentre(e.target.value)} className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 max-w-[160px]">
              <option value="all">All centres</option>
              {centres.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select value={sortOption} onChange={(e) => onSort(e.target.value)} className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="days_desc">Days pending ↓</option>
            <option value="days_asc">Days pending ↑</option>
            <option value="patient_asc">Patient A–Z</option>
            <option value="clinician_asc">Clinician A–Z</option>
          </select>
        </div>
      </div>
      {isFiltered && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-500">
          <span>Showing {filteredCount} of {totalCount}</span>
          <button type="button" onClick={onClear} className="text-blue-600 hover:underline">Clear filters</button>
        </div>
      )}
    </div>
  );
}

function ShowMoreFooter({ showing, remaining, isExpanded, onExpand, onCollapse }: {
  showing: number; remaining: number; isExpanded: boolean;
  onExpand: () => void; onCollapse: () => void;
}) {
  if (remaining === 0 && !isExpanded) return null;
  return (
    <div className="mt-2 flex flex-col items-center gap-0.5">
      {remaining > 0 ? (
        <button
          type="button"
          onClick={onExpand}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium py-1 px-3 rounded hover:bg-blue-50 transition-colors"
        >
          Show {remaining} more
        </button>
      ) : (
        <>
          <p className="text-[11px] text-gray-400">↕ Click to scroll · Esc to show less</p>
          <button type="button" onClick={onCollapse} className="text-xs text-gray-400 hover:text-gray-600 mt-0.5">Show less</button>
        </>
      )}
    </div>
  );
}

// ── Bulk Gmail URL (for <= 25 recipients only) ────────────────────────────────
// Uses URLSearchParams — handles encoding correctly, prevents malformed URLs.
// Do NOT include patient names or IDs in the bulk body (privacy).

const BULK_GMAIL_SUBJECT = 'Unity ops: Assessment follow-up required';
const BULK_GMAIL_BODY =
  'Hi,\n\nThis is a follow-up regarding assessments that require your attention in Unity.\n\nPlease action the pending items at your earliest convenience.\n\nUnity Ops Team';
const GMAIL_RECIPIENT_LIMIT = 25;

function buildBulkGmailUrl(emails: string[]): string {
  return buildMailto(emails, BULK_GMAIL_SUBJECT, BULK_GMAIL_BODY);
}

interface BulkBarProps {
  count:         number;
  emails:        string[];
  bulkLines:     string[];   // plain-text summary lines (kept for future use)
  issueType:     string;
  onClear:       () => void;
  onExportCsv?:  () => void; // export only the selected rows
}

function BulkBar({ count, emails, onClear, onExportCsv }: BulkBarProps) {
  const [copied, setCopied] = useState(false);

  if (count === 0) return null;

  const uniqueEmails  = [...new Set(emails.filter(Boolean))];
  const canOpenGmail  = uniqueEmails.length > 0 && uniqueEmails.length <= GMAIL_RECIPIENT_LIMIT;
  const gmailUrl      = canOpenGmail ? buildBulkGmailUrl(uniqueEmails) : null;

  const handleCopy = async () => {
    if (uniqueEmails.length === 0) return;
    try {
      await navigator.clipboard.writeText(uniqueEmails.join(', '));
    } catch {
      // Clipboard API unavailable — fallback: select text from a temp input
      const el = document.createElement('textarea');
      el.value = uniqueEmails.join(', ');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 mb-2">
      <span className="font-semibold shrink-0">{count} selected</span>

      {/* Primary: Copy emails to clipboard (works for any number of recipients) */}
      {uniqueEmails.length > 0 && (
        <button
          type="button"
          onClick={handleCopy}
          className={[
            'inline-flex items-center gap-1 px-2.5 py-1 rounded font-semibold transition-colors shrink-0',
            copied
              ? 'bg-emerald-600 text-white'
              : 'bg-blue-600 text-white hover:bg-blue-700',
          ].join(' ')}
          title={copied ? undefined : `Copy ${uniqueEmails.length} email address${uniqueEmails.length !== 1 ? 'es' : ''} to clipboard`}
        >
          {copied
            ? `✓ Copied ${uniqueEmails.length} email${uniqueEmails.length !== 1 ? 's' : ''}`
            : `Copy emails (${uniqueEmails.length})`}
        </button>
      )}

      {/* Secondary: Open Gmail — only for <= 25 recipients (URL limit) */}
      {gmailUrl && (
        <a
          href={gmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium border border-blue-300 text-blue-700 hover:bg-blue-100 transition-colors shrink-0"
          title={`Open Gmail compose with ${uniqueEmails.length} recipients`}
        >
          Open Gmail
          <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}

      {/* Export selected rows as CSV */}
      {onExportCsv && (
        <button
          type="button"
          onClick={onExportCsv}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium border border-blue-300 text-blue-700 hover:bg-blue-100 transition-colors shrink-0"
        >
          Export CSV
        </button>
      )}

      {/* Clear selection */}
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-blue-600 hover:text-blue-800 font-medium shrink-0"
      >
        Clear
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapsible severity section wrapper
// ─────────────────────────────────────────────────────────────────────────────

interface SeveritySectionProps {
  severity: 'critical' | 'warning' | 'watching';
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const SEVERITY_CONFIG = {
  critical: {
    dot:      'bg-red-500',
    label:    'Critical',
    badge:    'bg-red-100 text-red-700 ring-1 ring-red-300',
    subtitle: 'Needs action today — escalate or reassign',
  },
  warning: {
    dot:      'bg-amber-400',
    label:    'Warning',
    badge:    'bg-amber-100 text-amber-700 ring-1 ring-amber-300',
    subtitle: 'Needs attention this week — nudge or follow up',
  },
  watching: {
    dot:      'bg-gray-400',
    label:    'Watching',
    badge:    'bg-gray-100 text-gray-600 ring-1 ring-gray-300',
    subtitle: 'Monitor — not urgent but trending toward a problem',
  },
};

function SeveritySection({ severity, count, open, onToggle, children }: SeveritySectionProps) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50/70 transition-colors text-left"
        aria-expanded={open}
      >
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className="text-[15px] font-semibold text-gray-900">{cfg.label}</span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.badge}`}>
          {count} {count === 1 ? 'issue' : 'issues'}
        </span>
        <span className="text-[12px] text-gray-400 hidden sm:inline">{cfg.subtitle}</span>
        <span className="ml-auto"><SectionChevron open={open} /></span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-5 py-5 space-y-6">
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue group wrapper (sub-section with header + banner + table)
// ─────────────────────────────────────────────────────────────────────────────

interface IssueGroupProps {
  title: string;
  count: number;
  severity: 'critical' | 'warning' | 'watching';
  banner?: string;
  csvFilename?: string;
  onExportCsv?: () => void;
  showClickHint?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function IssueGroup({ title, count, severity, banner, onExportCsv, showClickHint, defaultOpen = true, children }: IssueGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const badge = severity === 'critical'
    ? 'bg-red-100 text-red-700'
    : severity === 'warning'
    ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-600';
  const bannerVariant: 'red' | 'amber' | 'neutral' =
    severity === 'critical' ? 'red' : severity === 'warning' ? 'amber' : 'neutral';

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="flex items-center gap-2 flex-1 text-left min-w-0"
          aria-expanded={open}
        >
          <h3 className="text-[14px] font-medium text-gray-900 truncate">{title}</h3>
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${badge}`}>
            {count}
          </span>
          <SectionChevron open={open} />
        </button>
        {onExportCsv && count > 0 && (
          <button
            type="button"
            onClick={onExportCsv}
            className="text-[11px] text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-0.5 hover:bg-gray-50 transition-colors shrink-0"
          >
            Export CSV
          </button>
        )}
      </div>
      {open && (
        <>
          {showClickHint && count > 0 && <ClickHint />}
          {banner && count > 0 && <ActionBanner text={banner} variant={bannerVariant} />}
          {children}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared table wrapper (sticky head, overflow scroll)
// ─────────────────────────────────────────────────────────────────────────────

function IssueTable({ head, children, empty }: { head: React.ReactNode; children: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 -mx-0.5">
      <table className="w-full text-sm min-w-[640px]" role="table">
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr>{head}</tr>
        </thead>
        <tbody>{children || empty}</tbody>
      </table>
    </div>
  );
}

function Th({ children, onClick, sortKey, activeSortKey, sortAsc }: {
  children: React.ReactNode; onClick?: () => void;
  sortKey?: string; activeSortKey?: string; sortAsc?: boolean;
}) {
  return (
    <th
      scope="col"
      onClick={onClick}
      className={`px-4 py-2.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap ${onClick ? 'cursor-pointer select-none hover:text-gray-700' : ''}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        {onClick && sortKey !== undefined && activeSortKey !== undefined && sortAsc !== undefined && (
          <SortIcon active={activeSortKey === sortKey} asc={sortAsc} />
        )}
      </span>
    </th>
  );
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-sm text-gray-400">{message}</td>
    </tr>
  );
}

// ─── Per-row personalized reminder button ────────────────────────────────────
//
// Opens Gmail compose pre-filled with a fully personalized message — recipient's
// name, patient details, specific action, dates, centre. No bulk email needed.
// Tracks "sent" state in the parent group so ops can see what has been actioned.

function ReminderButton({
  href,
  toName,
  rowKey,
  sentRows,
  onSent,
  noAddress = false,
}: {
  href:        string;
  toName:      string;    // e.g. "Dr. Smith" — shown in tooltip and sent badge
  rowKey:      string;    // stable unique key for this row
  sentRows:    Set<string>;
  onSent:      (key: string) => void;
  noAddress?:  boolean;   // true when Gmail To field will be empty (fill manually)
}) {
  if (sentRows.has(rowKey)) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 whitespace-nowrap"
        title={`Reminder opened for ${toName}`}
      >
        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Opened
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onSent(rowKey)}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      title={
        noAddress
          ? `Open Gmail with personalized message for ${toName} — fill in the To field manually`
          : `Open Gmail with personalized reminder for ${toName}`
      }
    >
      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      {noAddress ? 'Draft reminder' : 'Send reminder'}
    </a>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: Overdue assessments
// ─────────────────────────────────────────────────────────────────────────────

function OverdueAssessmentsGroup({ rows, loading, isNudge = false, defaultOpen = true }: {
  rows: IssueOverdueAssessment[]; loading: boolean; isNudge?: boolean; defaultOpen?: boolean;
}) {
  const { search, setSearch, typeFilter, setType, centreFilter, setCentre, sortOption, setSort, filtered, centres, isFiltered, clearFilters } =
    useGroupFilter(rows, 'daysPending');
  const { showing, remaining, isExpanded, expand, collapse } = useRowLimit(filtered.length);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sentRows, setSentRows] = useState<Set<string>>(new Set());
  const markSent = useCallback((key: string) => setSentRows((p) => new Set([...p, key])), []);

  useEffect(() => { setSelected(new Set()); }, [filtered.length]);
  useEffect(() => {
    if (!isExpanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isExpanded, collapse]);

  const allIds      = filtered.slice(0, showing).map((_, i) => i);
  const allChecked  = allIds.length > 0 && allIds.every((i) => selected.has(i));
  const selectedRows   = [...selected].map((i) => filtered[i]).filter(Boolean) as IssueOverdueAssessment[];
  const selectedEmails = selectedRows.map((r) => r.clinicianEmail).filter(Boolean);
  const selectedBulkLines = selectedRows.map((r) =>
    `${r.assessmentType} for ${r.patientName} (${r.centreName}) — ${r.daysPending} days. Clinician: ${r.clinicianName}. Action: ${isNudge ? 'Complete before 21-day mark' : 'Complete immediately or notify manager for reassignment'}.`
  );

  const title    = isNudge ? 'Nudge required' : 'Overdue assessments';
  const subtitle = isNudge ? '14-21 days pending' : '21+ days, no result';
  const banner   = isNudge
    ? 'These assessments are approaching critical. A prompt to the clinician now prevents escalation next week.'
    : 'These assessments have been sitting for 3+ weeks. Escalate to centre manager or reassign to another clinician.';

  const CSV_HEADERS = ['Patient', 'Assessment', 'Clinician', 'Clinician Email', 'Centre', 'Days Pending', 'Assigned Date'];
  const csvRow = (r: IssueOverdueAssessment) =>
    [r.patientName, r.assessmentType, r.clinicianName, r.clinicianEmail, r.centreName, String(r.daysPending), fmtDate(r.assignedDate)];

  return (
    <IssueGroup
      title={`${title} — ${rows.length} cases · ${subtitle}`}
      count={rows.length}
      severity={isNudge ? 'warning' : 'critical'}
      banner={banner}
      onExportCsv={rows.length > 0 ? () => exportCsv(`${isNudge ? 'nudge' : 'overdue'}-assessments.csv`, CSV_HEADERS, filtered.map(csvRow)) : undefined}
      showClickHint
      defaultOpen={defaultOpen}
    >
      {rows.length > 0 && (
        <IssueFilterBar
          search={search} onSearch={setSearch}
          typeFilter={typeFilter} onType={setType}
          centreFilter={centreFilter} onCentre={setCentre}
          sortOption={sortOption} onSort={setSort}
          centres={centres}
          filteredCount={filtered.length} totalCount={rows.length}
          isFiltered={isFiltered} onClear={clearFilters}
        />
      )}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          emails={selectedEmails}
          bulkLines={selectedBulkLines}
          issueType={isNudge ? 'nudge assessments' : 'overdue assessments'}
          onClear={() => setSelected(new Set())}
          onExportCsv={() => exportCsv(`${isNudge ? 'nudge' : 'overdue'}-assessments-selected.csv`, CSV_HEADERS, selectedRows.map(csvRow))}
        />
      )}
      <IssueTable
        head={<>
          <th scope="col" className="px-4 py-2.5 w-8">
            <input type="checkbox" checked={allChecked} onChange={() => allChecked ? setSelected(new Set()) : setSelected(new Set(allIds))} className="rounded" aria-label="Select all" />
          </th>
          {(['patientName', 'assessmentType', 'clinicianName', 'centreName', 'daysPending', 'assignedDate'] as const).map((k) => (
            <Th key={k}>
              {k === 'patientName' ? 'Patient' : k === 'assessmentType' ? 'Assessment' : k === 'clinicianName' ? 'Clinician' : k === 'centreName' ? 'Centre' : k === 'daysPending' ? 'Days pending' : 'Assigned date'}
            </Th>
          ))}
          <Th>Action</Th>
        </>}
      >
        {loading && !rows.length
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={8} />)
          : filtered.length === 0
          ? <EmptyRow cols={8} message={rows.length === 0 ? (isNudge ? 'No assessments in the 14-21 day range' : 'No assessments overdue 21+ days') : 'No results match your filters'} />
          : filtered.slice(0, showing).map((row, idx) => {
              const isCrit    = row.daysPending > 21;
              const email     = isNudge ? emailNudge(row) : emailOverdue(row);
              const emailHref = buildMailto(row.clinicianEmail, email.subject, email.body);
              const rowKey    = `${row.patientId}-${row.assessmentType}-${idx}`;
              return (
                <tr key={rowKey} className={`border-t transition-colors ${isNudge ? 'border-amber-100 hover:bg-amber-50/30' : isCrit ? 'border-red-100 hover:bg-red-50/30' : 'border-gray-100 hover:bg-gray-50/40'}`}>
                  <td className="px-4 py-2.5">
                    <input type="checkbox" checked={selected.has(idx)} onChange={() => { const s = new Set(selected); s.has(idx) ? s.delete(idx) : s.add(idx); setSelected(s); }} className="rounded" />
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[10rem] truncate" title={row.patientName}>{row.patientName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${TYPE_BADGE[row.assessmentType] ?? 'bg-gray-100 text-gray-700'}`}>{row.assessmentType}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                    {row.clinicianId ? (
                      <PersonLink userId={row.clinicianId} role="clinician" firstName={splitName(row.clinicianName).first} lastName={splitName(row.clinicianName).last} />
                    ) : row.clinicianName}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[140px] truncate" title={row.centreName}>{row.centreName}</td>
                  <td className="px-4 py-2.5">
                    <DaysBadge days={row.daysPending} criticalThreshold={21} warnThreshold={14} />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(row.assignedDate)}</td>
                  <td className="px-4 py-2.5">
                    {row.clinicianEmail ? (
                      <ReminderButton href={emailHref} toName={row.clinicianName} rowKey={rowKey} sentRows={sentRows} onSent={markSent} />
                    ) : (
                      <span className="text-[11px] text-gray-300">No email</span>
                    )}
                  </td>
                </tr>
              );
            })}
      </IssueTable>
      <ShowMoreFooter showing={showing} remaining={remaining} isExpanded={isExpanded} onExpand={expand} onCollapse={collapse} />
    </IssueGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: Stuck onboarding
// ─────────────────────────────────────────────────────────────────────────────

function StuckOnboardingGroup({ rows, loading, defaultOpen = true }: { rows: IssueStuckOnboarding[]; loading: boolean; defaultOpen?: boolean }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sentRows, setSentRows] = useState<Set<string>>(new Set());
  const markSent = useCallback((key: string) => setSentRows((p) => new Set([...p, key])), []);
  const { showing, remaining, isExpanded, expand, collapse } = useRowLimit(rows.length);

  useEffect(() => {
    if (!isExpanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isExpanded, collapse]);

  const allIds      = rows.slice(0, showing).map((_, i) => i);
  const allChecked  = allIds.length > 0 && allIds.every((i) => selected.has(i));
  const selectedBulkLines = [...selected].map((i) => rows[i]).filter(Boolean).map((r) =>
    `${r.patientName} at ${r.centreName} — waiting ${r.hoursUnassigned}h since ${fmtDate(r.registeredDate)} (registered by ${r.registeredBy}). Action: assign a clinician in Unity immediately.`
  );

  return (
    <IssueGroup
      title={`Stuck onboarding — ${rows.length} cases · registered but never assigned after 48h`}
      count={rows.length}
      severity="critical"
      banner="These cases have no clinician assigned. Children are waiting. Contact the ops admin or manager for the centre."
      onExportCsv={rows.length > 0 ? () => exportCsv('stuck-onboarding.csv',
        ['Patient', 'Centre', 'Registered by', 'Hours waiting', 'Registration date'],
        rows.map((r) => [r.patientName, r.centreName, r.registeredBy, String(r.hoursUnassigned), fmtDate(r.registeredDate)]),
      ) : undefined}
      defaultOpen={defaultOpen}
    >
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          emails={[]}
          bulkLines={selectedBulkLines}
          issueType="unassigned cases"
          onClear={() => setSelected(new Set())}
        />
      )}
      <IssueTable
        head={<>
          <th scope="col" className="px-4 py-2.5 w-8">
            <input type="checkbox" checked={allChecked} onChange={() => allChecked ? setSelected(new Set()) : setSelected(new Set(allIds))} className="rounded" aria-label="Select all" />
          </th>
          {['Patient', 'Centre', 'Registered by', 'Hours waiting', 'Registration date', 'Action'].map((h) => <Th key={h}>{h}</Th>)}
        </>}
      >
        {loading && !rows.length
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
          : rows.length === 0
          ? <EmptyRow cols={7} message="No cases stuck in onboarding" />
          : rows.slice(0, showing).map((row, idx) => {
              const email     = emailStuckOnboarding(row);
              const emailHref = buildMailto('', email.subject, email.body);
              const rowKey    = `${row.patientId}-${idx}`;
              return (
                <tr key={rowKey} className="border-t border-red-100 hover:bg-red-50/30 transition-colors">
                  <td className="px-4 py-2.5"><input type="checkbox" checked={selected.has(idx)} onChange={() => { const s = new Set(selected); s.has(idx) ? s.delete(idx) : s.add(idx); setSelected(s); }} className="rounded" /></td>
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[10rem] truncate" title={row.patientName}>{row.patientName}</td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[140px] truncate">{row.centreName}</td>
                  <td className="px-4 py-2.5 text-gray-600">{row.registeredBy}</td>
                  <td className="px-4 py-2.5"><HoursBadge hours={row.hoursUnassigned} /></td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(row.registeredDate)}</td>
                  <td className="px-4 py-2.5">
                    <ReminderButton href={emailHref} toName={row.centreName} rowKey={rowKey} sentRows={sentRows} onSent={markSent} noAddress />
                  </td>
                </tr>
              );
            })}
      </IssueTable>
      <ShowMoreFooter showing={showing} remaining={remaining} isExpanded={isExpanded} onExpand={expand} onCollapse={collapse} />
    </IssueGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: Dark centres
// ─────────────────────────────────────────────────────────────────────────────

function DarkCentresGroup({ rows, loading, defaultOpen = true }: { rows: IssueDarkCentre[]; loading: boolean; defaultOpen?: boolean }) {
  const { showing, remaining, isExpanded, expand, collapse } = useRowLimit(rows.length);
  useEffect(() => {
    if (!isExpanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isExpanded, collapse]);

  return (
    <IssueGroup
      title={`Silent centres — ${rows.length} centres · no activity in 7+ days`}
      count={rows.length}
      severity="critical"
      banner="These centres have gone dark. No staff activity recorded. Call the centre manager directly."
      onExportCsv={rows.length > 0 ? () => exportCsv('silent-centres.csv',
        ['Centre', 'Last activity', 'Days inactive', 'Active caseload', 'Staff count'],
        rows.map((r) => [r.centreName, fmtDate(r.lastActivityDate), String(r.daysInactive), String(r.activeCaseload), String(r.staffCount)]),
      ) : undefined}
      defaultOpen={defaultOpen}
    >
      <IssueTable
        head={<>
          {['Centre', 'Last activity', 'Days inactive', 'Active caseload', 'Staff count'].map((h) => <Th key={h}>{h}</Th>)}
        </>}
      >
        {loading && !rows.length
          ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} cols={5} />)
          : rows.length === 0
          ? <EmptyRow cols={5} message="No centres have gone dark" />
          : rows.slice(0, showing).map((row, idx) => {
              const daysCls = row.daysInactive > 14 ? 'bg-red-600 text-white' : 'bg-amber-500 text-white';
              return (
                <tr key={`${row.centreName}-${idx}`} className="border-t border-red-100 hover:bg-red-50/30 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{row.centreName}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(row.lastActivityDate)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center font-bold text-sm tabular-nums px-2 py-0.5 rounded ${daysCls}`}>{row.daysInactive}d</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`font-bold text-sm ${row.activeCaseload > 0 ? 'text-red-600' : 'text-gray-400'}`}>{row.activeCaseload}</span>
                    {row.activeCaseload > 0 && <span className="text-xs text-red-400 ml-1">open</span>}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-600">{row.staffCount}</td>
                </tr>
              );
            })}
      </IssueTable>
      <ShowMoreFooter showing={showing} remaining={remaining} isExpanded={isExpanded} onExpand={expand} onCollapse={collapse} />
    </IssueGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WARNING: Pending report approvals (legacy — kept for watching section compat)
// ─────────────────────────────────────────────────────────────────────────────

function PendingReportApprovalsGroup({ rows, loading }: { rows: IssueReportPendingApproval[]; loading: boolean }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sentRows, setSentRows] = useState<Set<string>>(new Set());
  const markSent = useCallback((key: string) => setSentRows((p) => new Set([...p, key])), []);
  const allChecked = rows.length > 0 && rows.every((_, i) => selected.has(i));
  const selectedRows = [...selected].map((i) => rows[i]).filter(Boolean) as IssueReportPendingApproval[];
  const selectedEmails   = selectedRows.map((r) => r.managerEmail).filter(Boolean);
  const selectedBulkLines = selectedRows.map((r) => {
    const days = r.daysInCurrentState ?? r.daysPending ?? 0;
    return `${r.patientName} — ${r.assessmentType} report by ${r.clinicianName}, drafted ${fmtDate(r.draftedDate)} (${days}d ago). Action: approve in Unity.`;
  });

  const RPT_HEADERS = ['Patient', 'Assessment', 'Clinician', 'Manager', 'Manager Email', 'Centre', 'Days waiting', 'Drafted date'];
  const rptRow = (r: IssueReportPendingApproval) => {
    const days = r.daysInCurrentState ?? r.daysPending ?? 0;
    return [r.patientName, r.assessmentType, r.clinicianName, r.managerName, r.managerEmail, r.centreName, String(days), fmtDate(r.draftedDate)];
  };

  function doExport() {
    exportCsv('pending-report-approvals.csv', RPT_HEADERS, rows.map(rptRow));
  }

  function doExportSelected() {
    exportCsv('report-approvals-selected.csv', RPT_HEADERS, selectedRows.map(rptRow));
  }

  return (
    <IssueGroup
      title={`Reports awaiting approval — ${rows.length} reports · drafted 5+ days ago, manager has not approved`}
      count={rows.length}
      severity="warning"
      banner="Clinicians have done their work. These reports are waiting on manager sign-off. Follow up with the manager."
      onExportCsv={doExport}
      showClickHint
    >
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          emails={selectedEmails}
          bulkLines={selectedBulkLines}
          issueType="report approvals"
          onClear={() => setSelected(new Set())}
          onExportCsv={doExportSelected}
        />
      )}
      <IssueTable
        head={<>
          <th scope="col" className="px-4 py-2.5 w-8">
            <input type="checkbox" checked={allChecked} onChange={() => allChecked ? setSelected(new Set()) : setSelected(new Set(rows.map((_, i) => i)))} className="rounded" aria-label="Select all" />
          </th>
          {['Patient', 'Assessment', 'Clinician', 'Manager', 'Centre', 'Days waiting', 'Drafted date', 'Action'].map((h) => <Th key={h}>{h}</Th>)}
        </>}
      >
        {loading && !rows.length
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={9} />)
          : rows.length === 0
          ? <EmptyRow cols={9} message="No reports awaiting approval" />
          : rows.map((row, idx) => {
              const days2     = row.daysInCurrentState ?? row.daysPending ?? 0;
              const daysCls   = days2 > 7 ? 'bg-red-600 text-white' : 'bg-amber-500 text-white';
              const email     = emailPendingReport(row);
              const emailHref = buildMailto(row.managerEmail, email.subject, email.body);
              const rowKey    = `${row.patientId}-${row.assessmentType}-${idx}`;
              return (
                <tr key={rowKey} className="border-t border-amber-100 hover:bg-amber-50/30 transition-colors">
                  <td className="px-4 py-2.5"><input type="checkbox" checked={selected.has(idx)} onChange={() => { const s = new Set(selected); s.has(idx) ? s.delete(idx) : s.add(idx); setSelected(s); }} className="rounded" /></td>
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[9rem] truncate" title={row.patientName}>{row.patientName}</td>
                  <td className="px-4 py-2.5"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${TYPE_BADGE[row.assessmentType] ?? 'bg-gray-100 text-gray-700'}`}>{row.assessmentType}</span></td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                    {row.clinicianId ? (
                      <PersonLink userId={row.clinicianId} role="clinician" firstName={splitName(row.clinicianName).first} lastName={splitName(row.clinicianName).last} />
                    ) : row.clinicianName}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                    {row.managerId ? (
                      <PersonLink userId={row.managerId} role="manager" firstName={splitName(row.managerName).first} lastName={splitName(row.managerName).last} />
                    ) : row.managerName}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[130px] truncate">{row.centreName}</td>
                  <td className="px-4 py-2.5"><span className={`inline-flex items-center font-bold text-sm px-2 py-0.5 rounded ${daysCls}`}>{days2}d</span></td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(row.draftedDate)}</td>
                  <td className="px-4 py-2.5">
                    {row.managerEmail ? (
                      <ReminderButton
                        href={emailHref}
                        toName={row.managerName}
                        rowKey={rowKey}
                        sentRows={sentRows}
                        onSent={markSent}
                      />
                    ) : (
                      <span className="text-[11px] text-gray-300">No email</span>
                    )}
                  </td>
                </tr>
              );
            })}
      </IssueTable>
    </IssueGroup>
  );
}

// (PendingGoalApprovalsGroup removed — use GoalsPendingApprovalGroup instead)

// ─────────────────────────────────────────────────────────────────────────────
// Reports not drafted group (clinician responsible)
// ─────────────────────────────────────────────────────────────────────────────

function ReportsNotDraftedGroup({ rows, loading, isWarning = false, defaultOpen = true }: {
  rows: IssueReportNotDrafted[]; loading: boolean; isWarning?: boolean; defaultOpen?: boolean;
}) {
  const { search, setSearch, typeFilter, setType, centreFilter, setCentre, sortOption, setSort, filtered, centres, isFiltered, clearFilters } =
    useGroupFilter(rows, 'daysInCurrentState');
  const { showing, remaining, isExpanded, expand, collapse } = useRowLimit(filtered.length);
  const [sentRows, setSentRows] = useState<Set<string>>(new Set());
  const markSent = useCallback((key: string) => setSentRows((p) => new Set([...p, key])), []);

  useEffect(() => {
    if (!isExpanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isExpanded, collapse]);

  const severity   = isWarning ? 'warning' : 'critical';
  const threshold  = isWarning ? '7-14' : '14+';
  const bannerText = isWarning
    ? 'Scoring is complete. These clinicians have not started drafting the report. Nudge them now before this becomes critical.'
    : 'Scoring is done. These reports are significantly overdue. Clinician must draft the report immediately.';

  const CSV_HEADERS = ['Patient', 'Assessment', 'Clinician', 'Clinician Email', 'Centre', 'Days since scoring', 'Scored date', 'Assigned date'];
  const csvRow = (r: IssueReportNotDrafted) =>
    [r.patientName, r.assessmentType, r.clinicianName, r.clinicianEmail, r.centreName,
     String(r.daysInCurrentState), fmtDate(r.resultGeneratedDate), fmtDate(r.assignedDate)];

  return (
    <IssueGroup
      title={`Reports not drafted — ${rows.length} cases · scored but report not started ${threshold} days ago`}
      count={rows.length}
      severity={severity}
      banner={bannerText}
      onExportCsv={rows.length > 0 ? () => exportCsv(`reports-not-drafted${isWarning ? '-warning' : ''}.csv`, CSV_HEADERS, filtered.map(csvRow)) : undefined}
      showClickHint
      defaultOpen={defaultOpen}
    >
      {rows.length > 0 && (
        <IssueFilterBar
          search={search} onSearch={setSearch}
          typeFilter={typeFilter} onType={setType}
          centreFilter={centreFilter} onCentre={setCentre}
          sortOption={sortOption} onSort={setSort}
          centres={centres}
          filteredCount={filtered.length} totalCount={rows.length}
          isFiltered={isFiltered} onClear={clearFilters}
        />
      )}
      <IssueTable
        head={<>{['Patient', 'Assessment', 'Clinician', 'Centre', 'Days since scoring', 'Scored date', 'Action'].map((h) => <Th key={h}>{h}</Th>)}</>}
      >
        {loading && !rows.length
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
          : filtered.length === 0
          ? <EmptyRow cols={7} message={rows.length === 0 ? `No reports overdue ${threshold} days after scoring` : 'No results match your filters'} />
          : filtered.slice(0, showing).map((row, idx) => {
              const email     = emailReportNotDrafted(row);
              const emailHref = buildMailto(row.clinicianEmail, email.subject, email.body);
              const rowKey    = `rnd-${row.patientId}-${row.assessmentType}-${idx}`;
              const daysCls   = row.daysInCurrentState > 14 ? 'bg-red-600 text-white' : 'bg-amber-500 text-white';
              return (
                <tr key={rowKey} className={`border-t transition-colors ${isWarning ? 'border-amber-100 hover:bg-amber-50/30' : 'border-red-100 hover:bg-red-50/30'}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[10rem] truncate" title={row.patientName}>{row.patientName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${TYPE_BADGE[row.assessmentType] ?? 'bg-gray-100 text-gray-700'}`}>{row.assessmentType}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                    {row.clinicianId ? (
                      <PersonLink userId={row.clinicianId} role="clinician" firstName={splitName(row.clinicianName).first} lastName={splitName(row.clinicianName).last} />
                    ) : row.clinicianName}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[140px] truncate" title={row.centreName}>{row.centreName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center font-bold text-sm tabular-nums px-2 py-0.5 rounded ${daysCls}`}>{row.daysInCurrentState}d</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(row.resultGeneratedDate)}</td>
                  <td className="px-4 py-2.5">
                    {row.clinicianEmail ? (
                      <ReminderButton href={emailHref} toName={row.clinicianName} rowKey={rowKey} sentRows={sentRows} onSent={markSent} />
                    ) : (
                      <span className="text-[11px] text-gray-300">No email</span>
                    )}
                  </td>
                </tr>
              );
            })}
      </IssueTable>
      <ShowMoreFooter showing={showing} remaining={remaining} isExpanded={isExpanded} onExpand={expand} onCollapse={collapse} />
    </IssueGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports pending approval group (manager responsible)
// ─────────────────────────────────────────────────────────────────────────────

function ReportsPendingApprovalGroup({ rows, loading, isWarning = false, defaultOpen = true }: {
  rows: IssueReportPendingApproval[]; loading: boolean; isWarning?: boolean; defaultOpen?: boolean;
}) {
  const { search, setSearch, typeFilter, setType, centreFilter, setCentre, sortOption, setSort, filtered, centres, isFiltered, clearFilters } =
    useGroupFilter(rows, 'daysInCurrentState');
  const { showing, remaining, isExpanded, expand, collapse } = useRowLimit(filtered.length);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sentRows, setSentRows] = useState<Set<string>>(new Set());
  const markSent = useCallback((key: string) => setSentRows((p) => new Set([...p, key])), []);

  useEffect(() => { setSelected(new Set()); }, [filtered.length]);
  useEffect(() => {
    if (!isExpanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isExpanded, collapse]);

  const allIds      = filtered.slice(0, showing).map((_, i) => i);
  const allChecked  = allIds.length > 0 && allIds.every((i) => selected.has(i));
  const selectedRows   = [...selected].map((i) => filtered[i]).filter(Boolean) as IssueReportPendingApproval[];
  const selectedEmails = selectedRows.map((r) => r.managerEmail).filter(Boolean);

  const severity   = isWarning ? 'warning' : 'critical';
  const threshold  = isWarning ? '3-7' : '7+';
  const bannerText = isWarning
    ? 'Clinician has drafted the report. Manager needs to review and approve — nudge before this escalates.'
    : 'Clinician has drafted the report. Manager sign-off is overdue. Follow up with the manager directly.';

  const RPT_HEADERS = ['Patient', 'Assessment', 'Clinician', 'Manager', 'Manager Email', 'Centre', 'Days waiting', 'Drafted date'];
  const rptRow = (r: IssueReportPendingApproval) => {
    const days = r.daysInCurrentState ?? r.daysPending ?? 0;
    return [r.patientName, r.assessmentType, r.clinicianName, r.managerName, r.managerEmail, r.centreName, String(days), fmtDate(r.draftedDate)];
  };

  return (
    <IssueGroup
      title={`Reports awaiting approval — ${rows.length} reports · drafted ${threshold} days ago, manager has not approved`}
      count={rows.length}
      severity={severity}
      banner={bannerText}
      onExportCsv={rows.length > 0 ? () => exportCsv(`report-approvals${isWarning ? '-warning' : ''}.csv`, RPT_HEADERS, filtered.map(rptRow)) : undefined}
      showClickHint
      defaultOpen={defaultOpen}
    >
      {rows.length > 0 && (
        <IssueFilterBar
          search={search} onSearch={setSearch}
          typeFilter={typeFilter} onType={setType}
          centreFilter={centreFilter} onCentre={setCentre}
          sortOption={sortOption} onSort={setSort}
          centres={centres}
          filteredCount={filtered.length} totalCount={rows.length}
          isFiltered={isFiltered} onClear={clearFilters}
        />
      )}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          emails={selectedEmails}
          bulkLines={selectedRows.map((r) => {
            const days = r.daysInCurrentState ?? r.daysPending ?? 0;
            return `${r.patientName} — ${r.assessmentType} report by ${r.clinicianName}, drafted ${fmtDate(r.draftedDate)} (${days}d ago). Action: approve in Unity.`;
          })}
          issueType="report approvals"
          onClear={() => setSelected(new Set())}
          onExportCsv={() => exportCsv('report-approvals-selected.csv', RPT_HEADERS, selectedRows.map(rptRow))}
        />
      )}
      <IssueTable
        head={<>
          <th scope="col" className="px-4 py-2.5 w-8">
            <input type="checkbox" checked={allChecked} onChange={() => allChecked ? setSelected(new Set()) : setSelected(new Set(allIds))} className="rounded" aria-label="Select all" />
          </th>
          {['Patient', 'Assessment', 'Clinician', 'Manager', 'Centre', 'Days waiting', 'Drafted date', 'Action'].map((h) => <Th key={h}>{h}</Th>)}
        </>}
      >
        {loading && !rows.length
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={9} />)
          : filtered.length === 0
          ? <EmptyRow cols={9} message={rows.length === 0 ? 'No reports awaiting approval' : 'No results match your filters'} />
          : filtered.slice(0, showing).map((row, idx) => {
              const days      = row.daysInCurrentState ?? row.daysPending ?? 0;
              const daysCls   = days > 7 ? 'bg-red-600 text-white' : 'bg-amber-500 text-white';
              const email     = emailPendingReport(row);
              const emailHref = buildMailto(row.managerEmail, email.subject, email.body);
              const rowKey    = `rpa-${row.patientId}-${row.assessmentType}-${idx}`;
              return (
                <tr key={rowKey} className={`border-t transition-colors ${isWarning ? 'border-amber-100 hover:bg-amber-50/30' : 'border-red-100 hover:bg-red-50/30'}`}>
                  <td className="px-4 py-2.5"><input type="checkbox" checked={selected.has(idx)} onChange={() => { const s = new Set(selected); s.has(idx) ? s.delete(idx) : s.add(idx); setSelected(s); }} className="rounded" /></td>
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[9rem] truncate" title={row.patientName}>{row.patientName}</td>
                  <td className="px-4 py-2.5"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${TYPE_BADGE[row.assessmentType] ?? 'bg-gray-100 text-gray-700'}`}>{row.assessmentType}</span></td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                    {row.clinicianId ? (<PersonLink userId={row.clinicianId} role="clinician" firstName={splitName(row.clinicianName).first} lastName={splitName(row.clinicianName).last} />) : row.clinicianName}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                    {row.managerId ? (<PersonLink userId={row.managerId} role="manager" firstName={splitName(row.managerName).first} lastName={splitName(row.managerName).last} />) : row.managerName}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[130px] truncate">{row.centreName}</td>
                  <td className="px-4 py-2.5"><span className={`inline-flex items-center font-bold text-sm px-2 py-0.5 rounded ${daysCls}`}>{days}d</span></td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(row.draftedDate)}</td>
                  <td className="px-4 py-2.5">
                    {row.managerEmail ? (
                      <ReminderButton href={emailHref} toName={row.managerName} rowKey={rowKey} sentRows={sentRows} onSent={markSent} />
                    ) : (<span className="text-[11px] text-gray-300">No email</span>)}
                  </td>
                </tr>
              );
            })}
      </IssueTable>
      <ShowMoreFooter showing={showing} remaining={remaining} isExpanded={isExpanded} onExpand={expand} onCollapse={collapse} />
    </IssueGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Goals not added group (clinician responsible) — Leo Arya's correct state
// ─────────────────────────────────────────────────────────────────────────────

function GoalsNotAddedGroup({ rows, loading, isWarning = false, defaultOpen = true }: {
  rows: IssueGoalsNotAdded[]; loading: boolean; isWarning?: boolean; defaultOpen?: boolean;
}) {
  const { search, setSearch, typeFilter, setType, centreFilter, setCentre, sortOption, setSort, filtered, centres, isFiltered, clearFilters } =
    useGroupFilter(rows, 'daysInCurrentState');
  const { showing, remaining, isExpanded, expand, collapse } = useRowLimit(filtered.length);
  const [sentRows, setSentRows] = useState<Set<string>>(new Set());
  const markSent = useCallback((key: string) => setSentRows((p) => new Set([...p, key])), []);

  useEffect(() => {
    if (!isExpanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isExpanded, collapse]);

  const severity   = isWarning ? 'warning' : 'critical';
  const threshold  = isWarning ? '7-14' : '14+';
  const bannerText = isWarning
    ? 'Report is approved. These clinicians need to add intervention goals — nudge them to action this week.'
    : 'Report is approved. Goals have not been added for 14+ days. Clinician must add intervention goals immediately.';

  const CSV_HEADERS = ['Patient', 'Assessment', 'Clinician', 'Clinician Email', 'Centre', 'Days since approval', 'Report approved date', 'Assigned date'];
  const csvRow = (r: IssueGoalsNotAdded) =>
    [r.patientName, r.assessmentType, r.clinicianName, r.clinicianEmail, r.centreName,
     String(r.daysInCurrentState), fmtDate(r.pdfGeneratedDate), fmtDate(r.assignedDate)];

  return (
    <IssueGroup
      title={`Goals not added — ${rows.length} cases · report approved ${threshold} days ago, goals not yet added`}
      count={rows.length}
      severity={severity}
      banner={bannerText}
      onExportCsv={rows.length > 0 ? () => exportCsv(`goals-not-added${isWarning ? '-warning' : ''}.csv`, CSV_HEADERS, filtered.map(csvRow)) : undefined}
      showClickHint
      defaultOpen={defaultOpen}
    >
      {rows.length > 0 && (
        <IssueFilterBar
          search={search} onSearch={setSearch}
          typeFilter={typeFilter} onType={setType}
          centreFilter={centreFilter} onCentre={setCentre}
          sortOption={sortOption} onSort={setSort}
          centres={centres}
          filteredCount={filtered.length} totalCount={rows.length}
          isFiltered={isFiltered} onClear={clearFilters}
        />
      )}
      <IssueTable
        head={<>{['Patient', 'Assessment', 'Clinician', 'Centre', 'Days since approval', 'Report approved', 'Action'].map((h) => <Th key={h}>{h}</Th>)}</>}
      >
        {loading && !rows.length
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
          : filtered.length === 0
          ? <EmptyRow cols={7} message={rows.length === 0 ? `No cases with goals overdue ${threshold} days after report approval` : 'No results match your filters'} />
          : filtered.slice(0, showing).map((row, idx) => {
              const email     = emailGoalsNotAdded(row);
              const emailHref = buildMailto(row.clinicianEmail, email.subject, email.body);
              const rowKey    = `gna-${row.patientId}-${row.assessmentType}-${idx}`;
              const daysCls   = row.daysInCurrentState > 14 ? 'bg-red-600 text-white' : 'bg-amber-500 text-white';
              return (
                <tr key={rowKey} className={`border-t transition-colors ${isWarning ? 'border-amber-100 hover:bg-amber-50/30' : 'border-red-100 hover:bg-red-50/30'}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[10rem] truncate" title={row.patientName}>{row.patientName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${TYPE_BADGE[row.assessmentType] ?? 'bg-gray-100 text-gray-700'}`}>{row.assessmentType}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                    {row.clinicianId ? (
                      <PersonLink userId={row.clinicianId} role="clinician" firstName={splitName(row.clinicianName).first} lastName={splitName(row.clinicianName).last} />
                    ) : row.clinicianName}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[140px] truncate" title={row.centreName}>{row.centreName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center font-bold text-sm tabular-nums px-2 py-0.5 rounded ${daysCls}`}>{row.daysInCurrentState}d</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(row.pdfGeneratedDate)}</td>
                  <td className="px-4 py-2.5">
                    {row.clinicianEmail ? (
                      <ReminderButton href={emailHref} toName={row.clinicianName} rowKey={rowKey} sentRows={sentRows} onSent={markSent} />
                    ) : (
                      <span className="text-[11px] text-gray-300">No email</span>
                    )}
                  </td>
                </tr>
              );
            })}
      </IssueTable>
      <ShowMoreFooter showing={showing} remaining={remaining} isExpanded={isExpanded} onExpand={expand} onCollapse={collapse} />
    </IssueGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Goals pending approval group (manager responsible)
// ─────────────────────────────────────────────────────────────────────────────

function GoalsPendingApprovalGroup({ rows, loading, isWarning = false, defaultOpen = true }: {
  rows: IssueGoalPendingApproval[]; loading: boolean; isWarning?: boolean; defaultOpen?: boolean;
}) {
  const { search, setSearch, typeFilter, setType, centreFilter, setCentre, sortOption, setSort, filtered, centres, isFiltered, clearFilters } =
    useGroupFilter(rows, 'daysInCurrentState');
  const { showing, remaining, isExpanded, expand, collapse } = useRowLimit(filtered.length);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sentRows, setSentRows] = useState<Set<string>>(new Set());
  const markSent = useCallback((key: string) => setSentRows((p) => new Set([...p, key])), []);

  useEffect(() => { setSelected(new Set()); }, [filtered.length]);
  useEffect(() => {
    if (!isExpanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isExpanded, collapse]);

  const allIds      = filtered.slice(0, showing).map((_, i) => i);
  const allChecked  = allIds.length > 0 && allIds.every((i) => selected.has(i));
  const selectedRows   = [...selected].map((i) => filtered[i]).filter(Boolean) as IssueGoalPendingApproval[];
  const selectedEmails = selectedRows.map((r) => r.managerEmail).filter(Boolean);

  const severity   = isWarning ? 'warning' : 'critical';
  const threshold  = isWarning ? '3-7' : '7+';
  const bannerText = isWarning
    ? 'Clinician has submitted goals. Manager needs to review and approve — nudge before this escalates.'
    : 'Clinician has submitted goals. Manager sign-off is overdue. Follow up with the manager directly.';

  const GOAL_HEADERS = ['Patient', 'Assessment', 'Clinician', 'Manager', 'Manager Email', 'Centre', 'Days waiting', 'Submitted date'];
  const goalRow = (r: IssueGoalPendingApproval) => {
    const days = r.daysInCurrentState ?? r.daysPending ?? 0;
    return [r.patientName, r.assessmentType ?? '', r.clinicianName, r.managerName, r.managerEmail, r.centreName, String(days), fmtDate(r.submittedDate)];
  };

  return (
    <IssueGroup
      title={`Goals awaiting approval — ${rows.length} goals · submitted ${threshold} days ago, manager has not approved`}
      count={rows.length}
      severity={severity}
      banner={bannerText}
      onExportCsv={rows.length > 0 ? () => exportCsv(`goal-approvals${isWarning ? '-warning' : ''}.csv`, GOAL_HEADERS, filtered.map(goalRow)) : undefined}
      showClickHint
      defaultOpen={defaultOpen}
    >
      {rows.length > 0 && (
        <IssueFilterBar
          search={search} onSearch={setSearch}
          typeFilter={typeFilter} onType={setType}
          centreFilter={centreFilter} onCentre={setCentre}
          sortOption={sortOption} onSort={setSort}
          centres={centres}
          filteredCount={filtered.length} totalCount={rows.length}
          isFiltered={isFiltered} onClear={clearFilters}
        />
      )}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          emails={selectedEmails}
          bulkLines={selectedRows.map((r) => {
            const days = r.daysInCurrentState ?? r.daysPending ?? 0;
            return `${r.patientName} — goals by ${r.clinicianName}, submitted ${fmtDate(r.submittedDate)} (${days}d ago). Action: approve in Unity.`;
          })}
          issueType="goal approvals"
          onClear={() => setSelected(new Set())}
          onExportCsv={() => exportCsv('goal-approvals-selected.csv', GOAL_HEADERS, selectedRows.map(goalRow))}
        />
      )}
      <IssueTable
        head={<>
          <th scope="col" className="px-4 py-2.5 w-8">
            <input type="checkbox" checked={allChecked} onChange={() => allChecked ? setSelected(new Set()) : setSelected(new Set(allIds))} className="rounded" aria-label="Select all" />
          </th>
          {['Patient', 'Assessment', 'Clinician', 'Manager', 'Centre', 'Days waiting', 'Submitted date', 'Action'].map((h) => <Th key={h}>{h}</Th>)}
        </>}
      >
        {loading && !rows.length
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={9} />)
          : filtered.length === 0
          ? <EmptyRow cols={9} message={rows.length === 0 ? 'No goals awaiting approval' : 'No results match your filters'} />
          : filtered.slice(0, showing).map((row, idx) => {
              const days      = row.daysInCurrentState ?? row.daysPending ?? 0;
              const daysCls   = days > 7 ? 'bg-red-600 text-white' : 'bg-amber-500 text-white';
              const email     = emailPendingGoal(row);
              const emailHref = buildMailto(row.managerEmail, email.subject, email.body);
              const rowKey    = `gpa-${row.patientId}-${idx}`;
              return (
                <tr key={rowKey} className={`border-t transition-colors ${isWarning ? 'border-amber-100 hover:bg-amber-50/30' : 'border-red-100 hover:bg-red-50/30'}`}>
                  <td className="px-4 py-2.5"><input type="checkbox" checked={selected.has(idx)} onChange={() => { const s = new Set(selected); s.has(idx) ? s.delete(idx) : s.add(idx); setSelected(s); }} className="rounded" /></td>
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[9rem] truncate">{row.patientName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${TYPE_BADGE[row.assessmentType ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>{row.assessmentType ?? '—'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                    {row.clinicianId ? (<PersonLink userId={row.clinicianId} role="clinician" firstName={splitName(row.clinicianName).first} lastName={splitName(row.clinicianName).last} />) : row.clinicianName}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                    {row.managerId ? (<PersonLink userId={row.managerId} role="manager" firstName={splitName(row.managerName).first} lastName={splitName(row.managerName).last} />) : row.managerName}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[130px] truncate">{row.centreName}</td>
                  <td className="px-4 py-2.5"><DaysBadge days={days} criticalThreshold={14} warnThreshold={7} /></td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(row.submittedDate)}</td>
                  <td className="px-4 py-2.5">
                    {row.managerEmail ? (
                      <ReminderButton href={emailHref} toName={row.managerName} rowKey={rowKey} sentRows={sentRows} onSent={markSent} />
                    ) : (<span className="text-[11px] text-gray-300">No email</span>)}
                  </td>
                </tr>
              );
            })}
      </IssueTable>
      <ShowMoreFooter showing={showing} remaining={remaining} isExpanded={isExpanded} onExpand={expand} onCollapse={collapse} />
    </IssueGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCHING: Early overdue
// ─────────────────────────────────────────────────────────────────────────────

function EarlyOverdueGroup({ rows, loading, defaultOpen = false }: { rows: IssueEarlyOverdue[]; loading: boolean; defaultOpen?: boolean }) {
  const { search, setSearch, typeFilter, setType, centreFilter, setCentre, sortOption, setSort, filtered, centres, isFiltered, clearFilters } =
    useGroupFilter(rows, 'daysPending');
  const { showing, remaining, isExpanded, expand, collapse } = useRowLimit(filtered.length);

  useEffect(() => {
    if (!isExpanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isExpanded, collapse]);

  return (
    <IssueGroup
      title={`Early overdue — ${rows.length} assessments · 7-14 days, monitor`}
      count={rows.length}
      severity="watching"
      showClickHint
      defaultOpen={defaultOpen}
    >
      {rows.length > 0 && (
        <IssueFilterBar
          search={search} onSearch={setSearch}
          typeFilter={typeFilter} onType={setType}
          centreFilter={centreFilter} onCentre={setCentre}
          sortOption={sortOption} onSort={setSort}
          centres={centres}
          filteredCount={filtered.length} totalCount={rows.length}
          isFiltered={isFiltered} onClear={clearFilters}
        />
      )}
      <IssueTable
        head={<>{['Patient', 'Assessment', 'Clinician', 'Centre', 'Days pending'].map((h) => <Th key={h}>{h}</Th>)}</>}
      >
        {loading && !rows.length
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={5} />)
          : filtered.length === 0
          ? <EmptyRow cols={5} message={rows.length === 0 ? 'No assessments in the 7-14 day range' : 'No results match your filters'} />
          : filtered.slice(0, showing).map((row, idx) => (
              <tr key={`${row.patientId}-${row.assessmentType}-${idx}`} className="border-t border-gray-100 hover:bg-gray-50/40 transition-colors">
                <td className="px-4 py-2.5 font-medium text-gray-700 max-w-[10rem] truncate">{row.patientName}</td>
                <td className="px-4 py-2.5"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${TYPE_BADGE[row.assessmentType] ?? 'bg-gray-100 text-gray-700'}`}>{row.assessmentType}</span></td>
                <td className="px-4 py-2.5 text-gray-600">
                  {row.clinicianId ? (
                    <PersonLink userId={row.clinicianId} role="clinician" firstName={splitName(row.clinicianName).first} lastName={splitName(row.clinicianName).last} />
                  ) : row.clinicianName}
                </td>
                <td className="px-4 py-2.5 text-gray-600 max-w-[140px] truncate">{row.centreName}</td>
                <td className="px-4 py-2.5"><span className="inline-flex items-center font-semibold text-sm px-2 py-0.5 rounded bg-gray-200 text-gray-700">{row.daysPending}d</span></td>
              </tr>
            ))}
      </IssueTable>
      <ShowMoreFooter showing={showing} remaining={remaining} isExpanded={isExpanded} onExpand={expand} onCollapse={collapse} />
    </IssueGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCHING: Low completion clinicians
// ─────────────────────────────────────────────────────────────────────────────

function LowCompletionCliniciansGroup({ rows, loading, defaultOpen = false }: { rows: IssueLowCompletionClinician[]; loading: boolean; defaultOpen?: boolean }) {
  const { showing, remaining, isExpanded, expand, collapse } = useRowLimit(rows.length);
  useEffect(() => {
    if (!isExpanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isExpanded, collapse]);

  return (
    <IssueGroup
      title={`Low completion clinicians — ${rows.length} clinicians · below 30% on at least one assessment type`}
      count={rows.length}
      severity="watching"
      onExportCsv={rows.length > 0 ? () => exportCsv('low-completion-clinicians.csv',
        ['Clinician', 'Email', 'Centre', 'Assessment type', 'Assigned', 'Completed', 'Completion %'],
        rows.map((r) => [r.clinicianName, r.clinicianEmail, r.centreName, r.assessmentType, String(r.assigned), String(r.completed), `${r.completionRate}%`]),
      ) : undefined}
      showClickHint
      defaultOpen={defaultOpen}
    >
      <IssueTable
        head={<>{['Clinician', 'Centre', 'Assessment type', 'Assigned', 'Completed', 'Completion %'].map((h) => <Th key={h}>{h}</Th>)}</>}
      >
        {loading && !rows.length
          ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} cols={6} />)
          : rows.length === 0
          ? <EmptyRow cols={6} message="No clinicians below 30% completion (min 3 assigned)" />
          : rows.slice(0, showing).map((row, idx) => {
              const pct    = row.completionRate;
              const pctCls = pct < 30 ? 'text-red-600 font-bold' : pct < 50 ? 'text-amber-600 font-semibold' : 'text-gray-700';
              return (
                <tr key={`${row.clinicianName}-${row.assessmentType}-${idx}`} className="border-t border-gray-100 hover:bg-gray-50/40 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-gray-700">
                    <PersonLink userId={row.clinicianId} role="clinician" firstName={splitName(row.clinicianName).first} lastName={splitName(row.clinicianName).last} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[130px] truncate">{row.centreName}</td>
                  <td className="px-4 py-2.5"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${TYPE_BADGE[row.assessmentType] ?? 'bg-gray-100 text-gray-700'}`}>{row.assessmentType}</span></td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">{row.assigned}</td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">{row.completed}</td>
                  <td className={`px-4 py-2.5 tabular-nums ${pctCls}`}>{pct}%</td>
                </tr>
              );
            })}
      </IssueTable>
      <ShowMoreFooter showing={showing} remaining={remaining} isExpanded={isExpanded} onExpand={expand} onCollapse={collapse} />
    </IssueGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCHING: Low completion centres
// ─────────────────────────────────────────────────────────────────────────────

function LowCompletionCentresGroup({ rows, loading, defaultOpen = false }: { rows: IssueLowCompletionCentre[]; loading: boolean; defaultOpen?: boolean }) {
  const { showing, remaining, isExpanded, expand, collapse } = useRowLimit(rows.length);
  useEffect(() => {
    if (!isExpanded) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isExpanded, collapse]);

  return (
    <IssueGroup
      title={`Low completion centres — ${rows.length} centres · below 30% overall completion`}
      count={rows.length}
      severity="watching"
      onExportCsv={rows.length > 0 ? () => exportCsv('low-completion-centres.csv',
        ['Centre', 'Assigned', 'Completed', 'Completion %'],
        rows.map((r) => [r.centreName, String(r.assigned), String(r.completed), `${r.completionRate}%`]),
      ) : undefined}
      defaultOpen={defaultOpen}
    >
      <IssueTable
        head={<>{['Centre', 'Assigned', 'Completed', 'Completion %'].map((h) => <Th key={h}>{h}</Th>)}</>}
      >
        {loading && !rows.length
          ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} cols={4} />)
          : rows.length === 0
          ? <EmptyRow cols={4} message="No centres below 30% completion (min 5 assigned)" />
          : rows.slice(0, showing).map((row, idx) => {
              const pct    = row.completionRate;
              const pctCls = pct < 30 ? 'text-red-600 font-bold' : pct < 50 ? 'text-amber-600 font-semibold' : 'text-gray-700';
              return (
                <tr key={`${row.centreName}-${idx}`} className="border-t border-gray-100 hover:bg-gray-50/40 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-gray-700">{row.centreName}</td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">{row.assigned}</td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">{row.completed}</td>
                  <td className={`px-4 py-2.5 tabular-nums ${pctCls}`}>{pct}%</td>
                </tr>
              );
            })}
      </IssueTable>
      <ShowMoreFooter showing={showing} remaining={remaining} isExpanded={isExpanded} onExpand={expand} onCollapse={collapse} />
    </IssueGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Assessment type health cards
// ─────────────────────────────────────────────────────────────────────────────

function TypeHealthCards({ types, loading }: { types: IssueByType[]; loading: boolean }) {
  const TYPES_ORDER = ['SPM', 'DP3', 'REELS', 'ISAA'];
  const ordered = TYPES_ORDER.map((t) => types.find((x) => x.type === t)).filter(Boolean) as IssueByType[];

  return (
    <section aria-labelledby="assess-health-heading">
      <h2 id="assess-health-heading" className="text-[14px] font-semibold text-gray-900 mb-3">Assessment type health</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading && ordered.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                {[60, 40, 80].map((w, j) => <div key={j} className="h-3 bg-gray-100 rounded animate-pulse" style={{ width: w }} />)}
              </div>
            ))
          : ordered.map((t) => {
              const rate = t.completionRate;
              const rateCls = rate >= 80 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-600' : 'text-red-600';
              return (
                <div key={t.type} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${TYPE_BADGE[t.type] ?? 'bg-gray-100 text-gray-700'}`}>{t.type}</span>
                    <span className="text-[11px] text-gray-400 truncate">{TYPE_FULL[t.type]}</span>
                  </div>
                  <div className={`text-3xl font-bold tabular-nums mt-2 ${rateCls}`}>{rate}%</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">completion rate</div>
                  <div className="text-[11px] text-gray-500 mt-2">{t.responsibleRole}</div>
                  <div className="grid grid-cols-3 gap-1 mt-3 pt-3 border-t border-gray-100">
                    <div className="text-center">
                      <div className="text-[13px] font-semibold text-gray-800 tabular-nums">{t.total}</div>
                      <div className="text-[10px] text-gray-400">assigned</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[13px] font-semibold text-gray-800 tabular-nums">{t.pending}</div>
                      <div className="text-[10px] text-gray-400">pending</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[13px] font-semibold text-gray-800 tabular-nums">{t.avgDays != null ? `${t.avgDays}d` : '—'}</div>
                      <div className="text-[10px] text-gray-400">avg days</div>
                    </div>
                  </div>
                </div>
              );
            })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Turnaround trend chart
// ─────────────────────────────────────────────────────────────────────────────

// SLA targets (in days)
const SLA_ONBOARDING_HOURS  = 24;   // hours
const SLA_REPORT_DAYS       = 5;    // days
const SLA_GOAL_DAYS         = 7;    // days

function TurnaroundTrendSection({ weeks, loading }: { weeks: IssueTurnaroundWeek[]; loading: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef  = useRef<any>(null);
  const weeksRef  = useRef(weeks);
  weeksRef.current = weeks;

  useEffect(() => {
    if (!canvasRef.current || !weeks.length) return;

    let timerId: ReturnType<typeof setTimeout>;
    let attempts = 0;

    const tryCreate = () => {
      if (typeof window === 'undefined' || !window.Chart) {
        if (attempts < 40) { attempts++; timerId = setTimeout(tryCreate, 100); }
        return;
      }
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

      const data = weeksRef.current;
      const labels = data.map((w) => {
        const d = new Date(w.weekStart);
        return isNaN(d.getTime()) ? w.weekStart : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      });

      const ctx = canvasRef.current!.getContext('2d');
      if (!ctx) return;

      // Convert onboarding hours → days for same-scale comparison
      const onboardingDays = data.map((w) => w.avgOnboardingHours != null ? parseFloat((w.avgOnboardingHours / 24).toFixed(2)) : null);

      chartRef.current = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Onboarding (reg → assign)',
              data: onboardingDays,
              borderColor: '#0284C7',
              backgroundColor: 'rgba(2,132,199,0.08)',
              pointBackgroundColor: '#0284C7',
              pointRadius: 4, pointHoverRadius: 6,
              tension: 0.35, fill: true, spanGaps: true,
            },
            {
              label: 'Report approval (draft → approved)',
              data: data.map((w) => w.avgReportApprovalHours),
              borderColor: '#059669',
              backgroundColor: 'rgba(5,150,105,0.08)',
              pointBackgroundColor: '#059669',
              pointRadius: 4, pointHoverRadius: 6,
              tension: 0.35, fill: true, spanGaps: true,
            },
            {
              label: 'Goal approval (submit → approved)',
              data: data.map((w) => w.avgGoalApprovalHours),
              borderColor: '#7C3AED',
              backgroundColor: 'rgba(124,58,237,0.06)',
              pointBackgroundColor: '#7C3AED',
              pointRadius: 4, pointHoverRadius: 6,
              tension: 0.35, fill: true, spanGaps: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top' as const,
              labels: { font: { size: 11, family: 'inherit', weight: '500' }, color: '#6B7280', boxWidth: 8, usePointStyle: true, pointStyle: 'circle' },
            },
            tooltip: {
              backgroundColor: 'rgba(17,24,39,0.92)',
              titleColor: '#F9FAFB', bodyColor: '#D1D5DB',
              padding: 10, cornerRadius: 8,
              callbacks: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                label: (item: any) => {
                  const v = item.raw;
                  if (v == null) return `${item.dataset.label}: —`;
                  return `${item.dataset.label}: ${v}d`;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#9CA3AF' }, border: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(243,244,246,1)' },
              ticks: { font: { size: 11 }, color: '#9CA3AF', callback: (v: unknown) => `${v}d` },
              border: { display: false },
            },
          },
        },
        plugins: [{
          id: 'slaLines',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          afterDraw: (chart: any) => {
            const { ctx: c, chartArea, scales } = chart;
            if (!chartArea || !scales.y) return;
            const draw = (val: number, color: string, label: string) => {
              const y = scales.y.getPixelForValue(val);
              if (y < chartArea.top || y > chartArea.bottom) return;
              c.save();
              c.strokeStyle = color; c.setLineDash([4, 4]); c.lineWidth = 1.5;
              c.beginPath(); c.moveTo(chartArea.left, y); c.lineTo(chartArea.right, y); c.stroke();
              c.fillStyle = color; c.font = '10px inherit';
              c.fillText(label, chartArea.left + 4, y - 4);
              c.restore();
            };
            draw(SLA_ONBOARDING_HOURS / 24, 'rgba(2,132,199,0.6)', `Onboarding SLA ${SLA_ONBOARDING_HOURS}h`);
            draw(SLA_REPORT_DAYS, 'rgba(5,150,105,0.6)', `Report SLA ${SLA_REPORT_DAYS}d`);
            draw(SLA_GOAL_DAYS, 'rgba(124,58,237,0.6)', `Goal SLA ${SLA_GOAL_DAYS}d`);
          },
        }],
      });
    };

    tryCreate();
    return () => {
      clearTimeout(timerId);
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [weeks]);

  return (
    <section aria-labelledby="trend-heading" className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="mb-4">
        <h2 id="trend-heading" className="text-[14px] font-semibold text-gray-900">Turnaround trend — weekly averages</h2>
        <p className="text-[12px] text-gray-500 mt-0.5">How long things are taking across the pipeline · dashed = SLA target</p>
      </div>
      <div className="relative h-56 sm:h-72">
        {loading && !weeks.length ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !weeks.length ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <p className="text-sm text-gray-400">Not enough data for weekly trend</p>
          </div>
        ) : (
          <canvas ref={canvasRef} aria-label="Weekly turnaround trend" role="img" />
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Global export all
// ─────────────────────────────────────────────────────────────────────────────

function exportAll(data: IssuesData) {
  const rows: string[][] = [];

  // Critical — five pipeline states
  for (const r of data.critical.overdueAssessments) {
    rows.push(['Critical', 'Overdue assessment (scoring incomplete)', r.patientName, r.assessmentType, r.clinicianName, r.clinicianEmail, r.centreName, `${r.daysAssigned ?? r.daysPending}d`, fmtDate(r.assignedDate)]);
  }
  for (const r of data.critical.reportsNotDrafted ?? []) {
    rows.push(['Critical', 'Report not drafted', r.patientName, r.assessmentType, r.clinicianName, r.clinicianEmail, r.centreName, `${r.daysInCurrentState}d since scoring`, fmtDate(r.resultGeneratedDate)]);
  }
  for (const r of data.critical.reportsPendingApproval ?? []) {
    const days = r.daysInCurrentState ?? r.daysPending ?? 0;
    rows.push(['Critical', 'Report pending approval', r.patientName, r.assessmentType, r.managerName, r.managerEmail, r.centreName, `${days}d`, fmtDate(r.draftedDate)]);
  }
  for (const r of data.critical.goalsNotAdded ?? []) {
    rows.push(['Critical', 'Goals not added', r.patientName, r.assessmentType, r.clinicianName, r.clinicianEmail, r.centreName, `${r.daysInCurrentState}d since approval`, fmtDate(r.pdfGeneratedDate)]);
  }
  for (const r of data.critical.goalsPendingApproval ?? []) {
    const days = r.daysInCurrentState ?? r.daysPending ?? 0;
    rows.push(['Critical', 'Goals pending approval', r.patientName, r.assessmentType ?? '', r.managerName, r.managerEmail, r.centreName, `${days}d`, fmtDate(r.submittedDate)]);
  }
  for (const r of data.critical.stuckOnboarding) {
    rows.push(['Critical', 'Stuck onboarding', r.patientName, '', r.registeredBy, '', r.centreName, `${r.hoursUnassigned}h`, fmtDate(r.registeredDate)]);
  }
  for (const r of data.critical.darkCentres) {
    rows.push(['Critical', 'Silent centre', r.centreName, '', '', '', r.centreName, `${r.daysInactive}d`, fmtDate(r.lastActivityDate)]);
  }

  // Warning — five pipeline states
  for (const r of data.warning.overdueAssessments ?? []) {
    rows.push(['Warning', 'Overdue assessment (14-21d)', r.patientName, r.assessmentType, r.clinicianName, r.clinicianEmail, r.centreName, `${r.daysAssigned ?? r.daysPending}d`, fmtDate(r.assignedDate)]);
  }
  for (const r of data.warning.reportsNotDrafted ?? []) {
    rows.push(['Warning', 'Report not drafted (7-14d)', r.patientName, r.assessmentType, r.clinicianName, r.clinicianEmail, r.centreName, `${r.daysInCurrentState}d since scoring`, fmtDate(r.resultGeneratedDate)]);
  }
  for (const r of data.warning.reportsPendingApproval ?? []) {
    const days = r.daysInCurrentState ?? r.daysPending ?? 0;
    rows.push(['Warning', 'Report pending approval (3-7d)', r.patientName, r.assessmentType, r.managerName, r.managerEmail, r.centreName, `${days}d`, fmtDate(r.draftedDate)]);
  }
  for (const r of data.warning.goalsNotAdded ?? []) {
    rows.push(['Warning', 'Goals not added (7-14d)', r.patientName, r.assessmentType, r.clinicianName, r.clinicianEmail, r.centreName, `${r.daysInCurrentState}d since approval`, fmtDate(r.pdfGeneratedDate)]);
  }
  for (const r of data.warning.goalsPendingApproval ?? []) {
    const days = r.daysInCurrentState ?? r.daysPending ?? 0;
    rows.push(['Warning', 'Goals pending approval (3-7d)', r.patientName, r.assessmentType ?? '', r.managerName, r.managerEmail, r.centreName, `${days}d`, fmtDate(r.submittedDate)]);
  }

  exportCsv('unity-issues.csv',
    ['Severity', 'Issue type', 'Patient/Centre', 'Assessment', 'Responsible', 'Email', 'Centre', 'Days', 'Date'],
    rows,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main IssuesTab component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  data: IssuesData | null;
  loading: boolean;
  error: string | null;
}

export default function IssuesTab({ data, loading, error }: Props) {
  const [criticalOpen, setCriticalOpen] = useState(true);
  const [warningOpen,  setWarningOpen]  = useState(true);
  const [watchingOpen, setWatchingOpen] = useState(false);

  const criticalTotal = data?.critical.total ?? 0;
  const warningTotal  = data?.warning.total  ?? 0;
  const watchingTotal = data?.watching.total ?? 0;
  const totalIssues   = criticalTotal + warningTotal + watchingTotal;

  const generatedAt = data?.generatedAt;
  const timeLabel = generatedAt ? fmtTime(generatedAt) : null;

  const isAllClear = !loading && data && totalIssues === 0;

  if (error) {
    return (
      <div className="mt-8 flex flex-col items-center gap-3 text-center">
        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
          <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <p className="text-sm text-gray-600">{error}</p>
      </div>
    );
  }

  return (
    <div
      id="tabpanel-3"
      role="tabpanel"
      aria-labelledby="tab-3"
      className="mt-3 sm:mt-5 space-y-4 sm:space-y-5"
    >
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3" style={{ minHeight: '48px' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <h1 className="text-[20px] font-medium text-gray-900 shrink-0">Issues</h1>
          <button
            title="Issues show current open problems regardless of the global date range filter."
            className="text-gray-400 hover:text-gray-500 transition-colors shrink-0"
            aria-label="Issues scope explanation"
          >
            <svg className="w-[14px] h-[14px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
          <span className="text-[13px] text-gray-400 truncate">
            {loading && !data
              ? '· Loading…'
              : `· ${criticalTotal + warningTotal} open issues · last updated ${timeLabel ?? '—'}`}
          </span>
        </div>
        {data && (
          <button
            onClick={() => exportAll(data)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Export all to CSV
          </button>
        )}
      </div>

      {/* ── Global empty state ───────────────────────────────────────────── */}
      {isAllClear && (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          </div>
          <div>
            <p className="text-[18px] font-semibold text-gray-900">No open issues</p>
            <p className="text-[13px] text-gray-500 mt-1">All pipelines are healthy. Check back tomorrow.</p>
          </div>
        </div>
      )}

      {/* ── Severity sections ─────────────────────────────────────────────── */}
      {!isAllClear && (
        <>
          {/* Critical — 5 pipeline state groups + onboarding/dark centre */}
          <SeveritySection
            severity="critical"
            count={criticalTotal}
            open={criticalOpen}
            onToggle={() => setCriticalOpen((p) => !p)}
          >
            {/* Group 1: Scoring still incomplete > 21 days */}
            <OverdueAssessmentsGroup
              rows={data?.critical.overdueAssessments ?? []}
              loading={loading}
              defaultOpen
            />
            {/* Group 2: Scoring done, report not started > 14 days */}
            <ReportsNotDraftedGroup
              rows={data?.critical.reportsNotDrafted ?? []}
              loading={loading}
              defaultOpen
            />
            {/* Group 3: Report drafted, manager hasn't approved > 7 days */}
            <ReportsPendingApprovalGroup
              rows={data?.critical.reportsPendingApproval ?? []}
              loading={loading}
              defaultOpen
            />
            {/* Group 4: Report approved, goals not added > 14 days (Leo Arya's state) */}
            <GoalsNotAddedGroup
              rows={data?.critical.goalsNotAdded ?? []}
              loading={loading}
              defaultOpen
            />
            {/* Group 5: Goals submitted, manager hasn't approved > 7 days */}
            <GoalsPendingApprovalGroup
              rows={data?.critical.goalsPendingApproval ?? []}
              loading={loading}
              defaultOpen
            />
            <StuckOnboardingGroup
              rows={data?.critical.stuckOnboarding ?? []}
              loading={loading}
              defaultOpen
            />
            <DarkCentresGroup
              rows={data?.critical.darkCentres ?? []}
              loading={loading}
              defaultOpen
            />
          </SeveritySection>

          {/* Warning — same 5 pipeline state groups at lower thresholds */}
          <SeveritySection
            severity="warning"
            count={warningTotal}
            open={warningOpen}
            onToggle={() => setWarningOpen((p) => !p)}
          >
            <OverdueAssessmentsGroup
              rows={data?.warning.overdueAssessments ?? data?.warning.nudgeAssessments ?? []}
              loading={loading}
              isNudge
              defaultOpen={false}
            />
            <ReportsNotDraftedGroup
              rows={data?.warning.reportsNotDrafted ?? []}
              loading={loading}
              isWarning
              defaultOpen={false}
            />
            <ReportsPendingApprovalGroup
              rows={data?.warning.reportsPendingApproval ?? data?.warning.pendingReportApprovals ?? []}
              loading={loading}
              isWarning
              defaultOpen={false}
            />
            <GoalsNotAddedGroup
              rows={data?.warning.goalsNotAdded ?? []}
              loading={loading}
              isWarning
              defaultOpen={false}
            />
            <GoalsPendingApprovalGroup
              rows={data?.warning.goalsPendingApproval ?? data?.warning.pendingGoalApprovals ?? []}
              loading={loading}
              isWarning
              defaultOpen={false}
            />
          </SeveritySection>

          {/* Watching — early stage monitoring */}
          <SeveritySection
            severity="watching"
            count={watchingTotal}
            open={watchingOpen}
            onToggle={() => setWatchingOpen((p) => !p)}
          >
            <EarlyOverdueGroup
              rows={data?.watching.earlyOverdue ?? []}
              loading={loading}
              defaultOpen={false}
            />
            <LowCompletionCliniciansGroup
              rows={data?.watching.lowCompletionClinicians ?? []}
              loading={loading}
              defaultOpen={false}
            />
            <LowCompletionCentresGroup
              rows={data?.watching.lowCompletionCentres ?? []}
              loading={loading}
              defaultOpen={false}
            />
          </SeveritySection>
        </>
      )}

      {/* ── Supporting sections ───────────────────────────────────────────── */}
      {(data || loading) && (
        <>
          <div className="flex items-center gap-3 pt-2">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 flex-shrink-0">Analytics</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <TypeHealthCards
            types={data?.byType ?? []}
            loading={loading}
          />

          <TurnaroundTrendSection
            weeks={data?.turnaroundTrend.weeks ?? []}
            loading={loading}
          />
        </>
      )}
    </div>
  );
}
