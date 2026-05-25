'use client';

import { useMemo, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import TopBar from '@/components/TopBar';
import UserKpiCards from '@/components/users/UserKpiCards';
import UserTrendChart from '@/components/users/UserTrendChart';
import UserActionBreakdown from '@/components/users/UserActionBreakdown';
import RecentActionsTable from '@/components/users/RecentActionsTable';
import ActiveCaseloadTable from '@/components/users/ActiveCaseloadTable';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useOverview } from '@/hooks/useOverview';
import { ROLE_LABELS } from '@/lib/userProfile';
import { shortCentreName } from '@/lib/centreNames';
import type { UserProfileRole } from '@/lib/types';

function parseRole(value: string | null): UserProfileRole | null {
  if (value === 'clinician' || value === 'manager' || value === 'centre-admin') return value;
  return null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function RoleBadge({ role }: { role: UserProfileRole }) {
  const styles: Record<UserProfileRole, string> = {
    clinician: 'bg-blue-100 text-blue-700',
    manager: 'bg-green-100 text-green-700',
    'centre-admin': 'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[role]}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

// Next.js 14: params is a plain object, not a Promise
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
  const initialDateTo = searchParams.get('dateTo') ?? '';

  const [centreId, setCentreId] = useState<number | undefined>(
    initialCentreId != null && !isNaN(initialCentreId) ? initialCentreId : undefined,
  );
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const role = roleParam ?? 'clinician';

  const profileParams = useMemo(
    () => ({
      role,
      centreId,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
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
          <Link href="/" className="text-blue-600 hover:underline text-sm">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const user = profile.data?.user;
  const centreLabel = centreId
    ? shortCentreName(
        overview.data?.centres.find((c) => c.id === centreId)?.name ??
        user?.centres.find((c) => c.id === centreId)?.name,
      )
    : user && user.centres.length === 1
    ? shortCentreName(user.centres[0].name)
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar
        centres={overview.data?.centres ?? user?.centres.map((c) => ({ id: c.id, name: c.name })) ?? []}
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

        {/* Profile header */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-6 py-5">
          {profile.loading && !user ? (
            <div className="animate-pulse space-y-3">
              <div className="h-7 bg-gray-100 rounded w-64" />
              <div className="h-4 bg-gray-100 rounded w-48" />
            </div>
          ) : user ? (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900">
                    {user.firstName} {user.lastName}
                  </h1>
                  <RoleBadge role={role} />
                  {user.roleName && user.roleName !== ROLE_LABELS[role] && (
                    <span className="text-xs text-gray-400">({user.roleName})</span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">{user.email}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-400">
                  {centreLabel && (
                    <span>
                      Centre: <span className="text-gray-600 font-medium">{centreLabel}</span>
                    </span>
                  )}
                  {user.centres.length > 1 && !centreId && (
                    <span>{user.centres.length} centre assignments</span>
                  )}
                  <span>
                    Last login: <span className="text-gray-600">{timeAgo(user.lastLoginDate)}</span>
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <UserKpiCards
          role={role}
          summary={profile.data?.summary ?? {} as never}
          loading={profile.loading}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <UserTrendChart trend={profile.data?.trend ?? []} loading={profile.loading} />
          <UserActionBreakdown breakdown={profile.data?.actionBreakdown ?? []} loading={profile.loading} />
        </div>

        {role === 'clinician' && (
          <ActiveCaseloadTable cases={profile.data?.activeCases ?? []} loading={profile.loading} />
        )}

        <RecentActionsTable actions={profile.data?.recentActions ?? []} loading={profile.loading} />
      </main>
    </div>
  );
}
