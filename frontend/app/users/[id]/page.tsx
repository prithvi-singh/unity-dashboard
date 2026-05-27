'use client';

import { useMemo, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import TopBar from '@/components/TopBar';
import UserKpiCards from '@/components/users/UserKpiCards';
import UserConsistencyHeatmap from '@/components/users/UserConsistencyHeatmap';
import RecentActionsTable from '@/components/users/RecentActionsTable';
import ActiveCaseloadTable from '@/components/users/ActiveCaseloadTable';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useOverview } from '@/hooks/useOverview';
import { ROLE_LABELS } from '@/lib/userProfile';
import RoleBadge from '@/components/shared/RoleBadge';
import type {
  UserProfileRole,
  ConsistencyStatus,
  ClinicianCoreMetrics,
  ManagerCoreMetrics,
  OpsAdminCoreMetrics,
} from '@/lib/types';

function parseRole(value: string | null): UserProfileRole | null {
  if (value === 'clinician' || value === 'manager' || value === 'centre-admin') return value;
  return null;
}

import { formatDate } from '@/lib/formatDate';

function timeAgo(iso: string | null): string {
  return formatDate(iso);
}

/** Renders the centre display: 1 = name, 2 = both joined by ·, 3+ = first + "+X more" pill with tooltip */
function CentreDisplay({ centres }: { centres: Array<{ id: number; name: string }> }) {
  const [showTooltip, setShowTooltip] = useState(false);
  if (centres.length === 0) return null;
  if (centres.length === 1) {
    return <span className="text-gray-600 font-medium">{centres[0].name}</span>;
  }
  if (centres.length === 2) {
    return (
      <span className="text-gray-600 font-medium">
        {centres[0].name} · {centres[1].name}
      </span>
    );
  }
  const rest = centres.length - 1;
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className="text-gray-600 font-medium">{centres[0].name}</span>
      <span
        className="relative inline-block"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] cursor-default select-none">
          +{rest} more
        </span>
        {showTooltip && (
          <span
            className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-[9999] bg-[#2C2C2A] text-white text-xs rounded px-3 py-2 pointer-events-none shadow-lg"
            style={{ width: '220px', maxHeight: '240px', overflowY: 'auto' }}
            role="tooltip"
            aria-hidden="true"
          >
            {centres.map((c) => (
              <span key={c.id} className="block py-0.5">{c.name}</span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

const CONSISTENCY_BADGE: Record<ConsistencyStatus, { label: string; cls: string }> = {
  consistent: { label: 'Consistent', cls: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200' },
  irregular:  { label: 'Irregular',  cls: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200'       },
  inactive:   { label: 'Inactive',   cls: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200'           },
  silent:     { label: 'Silent',     cls: 'bg-rose-100 text-rose-800 font-bold ring-1 ring-rose-200' },
};

const EMPTY_CLINICIAN_METRICS: ClinicianCoreMetrics = {
  assessmentsScored: 0, reportsDrafted: 0, goalsAdded: 0, caseHistoryCompleted: 0,
  activeCaseload: 0, avgDaysToResult: null, stuckCases: 0,
};
const EMPTY_MANAGER_METRICS: ManagerCoreMetrics = {
  reportsApproved: 0, goalsApproved: 0, casesRegistered: 0,
  avgDaysToApproveReport: null, avgDaysToApproveGoal: null, pendingApprovals: 0,
};
const EMPTY_OPS_METRICS: OpsAdminCoreMetrics = {
  casesRegistered: 0, cliniciansAssigned: 0, avgDaysToAssign: null, stuckOnboarding: 0,
};
const EMPTY_CONSISTENCY = {
  totalWorkingDays: 0, coreJobDays: 0, consistencyPercent: 0, status: 'silent' as ConsistencyStatus,
};

function emptyMetrics(role: UserProfileRole) {
  if (role === 'clinician') return EMPTY_CLINICIAN_METRICS;
  if (role === 'manager')   return EMPTY_MANAGER_METRICS;
  return EMPTY_OPS_METRICS;
}

interface PageProps {
  params: { id: string };
}

export default function UserProfilePage({ params }: PageProps) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading profile…</div>
      </div>
    }>
      <UserProfileContent id={params.id} />
    </Suspense>
  );
}

function UserProfileContent({ id }: { id: string }) {
  const userId = parseInt(id, 10);
  const searchParams = useSearchParams();

  const roleParam = parseRole(searchParams.get('role'));
  const initialCentreId = searchParams.get('centreId')
    ? parseInt(searchParams.get('centreId')!, 10)
    : undefined;
  const initialDateFrom = searchParams.get('dateFrom') ?? '';
  const initialDateTo   = searchParams.get('dateTo') ?? '';

  const [centreId, setCentreId]   = useState<number | undefined>(
    initialCentreId != null && !isNaN(initialCentreId) ? initialCentreId : undefined,
  );
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo]     = useState(initialDateTo);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const role = roleParam ?? 'clinician';

  const profileParams = useMemo(
    () => ({ role, centreId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
    [role, centreId, dateFrom, dateTo],
  );

  const overviewFilters = useMemo(
    () => ({ centreId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
    [centreId, dateFrom, dateTo],
  );

  const profile = useUserProfile(userId, profileParams);
  const overview = useOverview(overviewFilters);

  const handleRefresh = useCallback(() => {
    profile.refetch();
    overview.refetch();
    setLastUpdated(new Date());
  }, [profile, overview]);

  if (isNaN(userId)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Invalid user id</p>
      </div>
    );
  }

  if (!roleParam) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Missing or invalid role parameter</p>
          <Link href="/" className="text-blue-600 hover:underline text-sm">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const user       = profile.data?.user;
  const metrics    = profile.data?.coreMetrics ?? emptyMetrics(role);
  const consistency = profile.data?.consistencyScore ?? EMPTY_CONSISTENCY;
  const coreJobDef = profile.data?.coreJobDefinition ?? '';

  // All centres for TopBar + display — merge API centres with overview
  const allCentres = overview.data?.centres ?? user?.centres.map((c) => ({ id: c.id, name: c.name })) ?? [];

  // Date range label for heatmap title
  const dateRangeLabel = dateFrom || dateTo
    ? [dateFrom, dateTo].filter(Boolean).join(' – ')
    : 'Last 30 days';

  const consistencyBadge = CONSISTENCY_BADGE[consistency.status];

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar
        centres={allCentres}
        centreId={centreId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onCentreChange={setCentreId}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onRefresh={handleRefresh}
        countdown={0}
        lastUpdated={lastUpdated}
      />

      <main className="mx-auto max-w-screen-2xl px-5 py-6 space-y-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to dashboard
        </Link>

        {profile.error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Failed to load profile: {profile.error}
          </div>
        )}

        {/* ── Profile header ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-5">
          {profile.loading && !user ? (
            <div className="animate-pulse space-y-3">
              <div className="h-7 bg-gray-100 rounded w-64" />
              <div className="h-4 bg-gray-100 rounded w-48" />
            </div>
          ) : user ? (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                {/* Name + badges */}
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900">
                    {user.firstName} {user.lastName}
                  </h1>
                  <RoleBadge role={role} />
                  {!profile.loading && (
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs ${consistencyBadge.cls}`}
                      title={`${consistency.coreJobDays} of ${consistency.totalWorkingDays} working days with core job activity in the selected period`}
                    >
                      {consistencyBadge.label}
                    </span>
                  )}
                  {user.roleName && user.roleName !== ROLE_LABELS[role] && (
                    <span className="text-xs text-gray-400">({user.roleName})</span>
                  )}
                </div>

                {/* Core job definition */}
                {coreJobDef && (
                  <p className="text-xs text-gray-400 mt-1.5">
                    Core job: <span className="text-gray-500">{coreJobDef}</span>
                  </p>
                )}

                {/* Email + centre + last login */}
                <p className="text-sm text-gray-500 mt-1.5">{user.email}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-400">
                  {user.centres.length > 0 && (
                    <span className="flex items-center gap-1">
                      Centre:{' '}
                      <CentreDisplay centres={user.centres} />
                    </span>
                  )}
                  <span>
                    Last login: <span className="text-gray-600">{timeAgo(user.lastLoginDate)}</span>
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Core metrics strip ─────────────────────────────────────────── */}
        <UserKpiCards
          role={role}
          coreMetrics={metrics}
          consistencyScore={consistency}
          loading={profile.loading}
        />

        {/* ── Consistency heatmap (replaces Activity Trend + Action Breakdown) ── */}
        <UserConsistencyHeatmap
          activityByDay={profile.data?.activityByDay ?? []}
          consistencyScore={consistency}
          dateRange={dateRangeLabel}
          dateFrom={dateFrom || undefined}
          dateTo={dateTo || undefined}
          loading={profile.loading}
        />

        {/* ── Active caseload (clinicians only) ─────────────────────────── */}
        {role === 'clinician' && (
          <ActiveCaseloadTable
            cases={profile.data?.activeCases ?? []}
            loading={profile.loading}
          />
        )}

        {/* ── Recent actions ─────────────────────────────────────────────── */}
        <RecentActionsTable
          actions={profile.data?.recentActions ?? []}
          loading={profile.loading}
        />
      </main>
    </div>
  );
}
