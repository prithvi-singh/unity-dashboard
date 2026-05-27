'use client';

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import type { MonitoringEngagementFilter } from '@/lib/monitoringStats';
import TopBar from '@/components/TopBar';
import TabNav from '@/components/TabNav';
import FilterChips from '@/components/FilterChips';

// Overview
import OverviewTab from '@/components/overview/OverviewTab';
import MultipleAssessmentCasesPanel from '@/components/overview/MultipleAssessmentCasesPanel';
import IdleCentresDrawer from '@/components/overview/IdleCentresDrawer';

// Live (daily monitoring)
import DailyOpsReview from '@/components/monitoring/DailyOpsReview';
import UserStatusTable from '@/components/monitoring/UserStatusTable';
import ActivityHeatmap from '@/components/monitoring/ActivityHeatmap';

// Team (unified role view)
import TeamTab, { type TeamRole } from '@/components/team/TeamTab';

// Issues — redesigned triage view
import IssuesTab from '@/components/issues/IssuesTab';
import BottleneckDrillDownPanel from '@/components/bottlenecks/BottleneckDrillDownPanel';
import RoleDrillDownPanel from '@/components/shared/RoleDrillDownPanel';
import type { BottleneckDrillDownRequest } from '@/lib/bottleneckDrillDown';
import type { RoleDrillDownRequest } from '@/lib/roleDrillDown';
import type { TabBadge } from '@/components/TabNav';

// Metrics context
import { MetricsProvider, useMetrics } from '@/lib/metricsContext';

// Hooks
import { useOverview } from '@/hooks/useOverview';
import { useClinicians } from '@/hooks/useClinicians';
import { useManagers } from '@/hooks/useManagers';
import { useCentreAdmins } from '@/hooks/useCentreAdmins';
import { useMonitoring } from '@/hooks/useMonitoring';
import { useDailyReview } from '@/hooks/useDailyReview';
import { useBottlenecks } from '@/hooks/useBottlenecks';
import { useIssues } from '@/hooks/useIssues';
import { useRoleSummary } from '@/hooks/useRoleSummary';
import { useClinicalPipeline } from '@/hooks/useClinicalPipeline';
import { useUserBreakdown } from '@/hooks/useUserBreakdown';
import { useAssessments } from '@/hooks/useAssessments';
import { useWorkload } from '@/hooks/useWorkload';
import { useTopPerformers } from '@/hooks/useTopPerformers';
import { useCentresOverview } from '@/hooks/useCentresOverview';
import { useActionFocus } from '@/hooks/useActionFocus';
import { useDashboardUrl, readDashboardStateFromUrl } from '@/hooks/useDashboardUrl';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { ActionNavigationTarget, BottleneckActionSortCol } from '@/lib/actionNavigation';
import { DASHBOARD_TABS } from '@/lib/dashboardTabs';
import { defaultDashboardPeriod, todayISO } from '@/lib/datePresets';

const REFRESH_INTERVAL_MS = 3_600_000; // 1 hour

// Small bridge: lives inside MetricsProvider so it can read sync state
type TopBarWithSyncProps = Parameters<typeof TopBar>[0] & { isDailyTab?: boolean };
function TopBarWithSync(props: TopBarWithSyncProps) {
  const { loading: metricsLoading, metrics } = useMetrics();
  return (
    <TopBar
      {...props}
      metricsSynced={!!metrics && !metricsLoading}
      metricsLoading={metricsLoading}
      isDailyTab={props.isDailyTab}
    />
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">
          Loading…
        </div>
      }
    >
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const searchParams = useSearchParams();
  const urlInit = readDashboardStateFromUrl(searchParams);
  const defaultPeriod = defaultDashboardPeriod();

  // ── Global filter state ───────────────────────────────────────────────────
  const [centreId, setCentreId] = useState<number | undefined>(urlInit.centreId);
  const [dateFrom, setDateFrom] = useState(urlInit.dateFrom);
  const [dateTo, setDateTo] = useState(urlInit.dateTo);

  const filters = useMemo(
    () => ({
      centreId,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [centreId, dateFrom, dateTo]
  );

  // Debounce filter changes — prevents multiple API calls when a user quickly
  // selects a date range (dateFrom then dateTo fires two rapid state changes).
  // 300ms delay: imperceptible to users, prevents ~80% of redundant requests.
  const debouncedFilters = useDebouncedValue(filters, 300);

  const profileLinkParams = useMemo(
    () => ({ centreId, dateFrom, dateTo }),
    [centreId, dateFrom, dateTo],
  );

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(urlInit.activeTab);

  useDashboardUrl({ activeTab, centreId, dateFrom, dateTo });

  // ── Team tab: which role sub-view is active ───────────────────────────────
  const [teamRole, setTeamRole] = useState<TeamRole>('clinicians');

  // ── Tab prefetch state ────────────────────────────────────────────────────
  // Tracks tabs whose data should start loading due to hover intent (300ms hover).
  // Once a tab index enters this Set it stays — fetched data is cached anyway.
  const [prefetchedTabs, setPrefetchedTabs] = useState<ReadonlySet<number>>(new Set());

  const handleTabHoverIntent = (index: number) => {
    setPrefetchedTabs(prev => {
      if (prev.has(index)) return prev; // already prefetched
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  };

  // ── Data-fetch gates (lazy per-tab + per-role) ────────────────────────────
  // A tab is "needed" if it is active OR if the user has hovered it for 300ms.
  const tabActive  = (i: number) => activeTab === i || prefetchedTabs.has(i);
  const needClinicians    = tabActive(0) || (tabActive(2) && teamRole === 'clinicians');
  const needManagers      = tabActive(2) && teamRole === 'managers';
  const needCentreAdmins  = tabActive(2) && teamRole === 'admins';
  const needCentres       = tabActive(2) && teamRole === 'centres';
  const needBottlenecks   = tabActive(0);
  const needMonitoring    = tabActive(1);
  const needUsers         = tabActive(2) && teamRole === 'roster';
  const needAssessments   = tabActive(0);
  const needIssues        = tabActive(3);
  const needClinicianExtras = tabActive(2) && teamRole === 'clinicians';
  const needManagerExtras   = tabActive(2) && teamRole === 'managers';
  const needAdminExtras     = tabActive(2) && teamRole === 'admins';
  const needWorkload        = tabActive(2) && teamRole === 'clinicians';

  // ── Action feed navigation ────────────────────────────────────────────────
  const [pendingActionFocus, setPendingActionFocus] = useState<ActionNavigationTarget | null>(null);
  const [bottleneckTableSortFocus, setBottleneckTableSortFocus] = useState<BottleneckActionSortCol | null>(null);

  const handleActionNavigate = (target: ActionNavigationTarget) => {
    setActiveTab(target.tab);
    // When navigating to Team tab from ActionFeed the signal is always clinician-related
    if (target.tab === 2) setTeamRole('clinicians');
    setPendingActionFocus(target);
  };

  // ── Drill-down panels ─────────────────────────────────────────────────────
  const [bottleneckDrillDown, setBottleneckDrillDown] = useState<BottleneckDrillDownRequest | null>(null);
  const [roleDrillDown, setRoleDrillDown] = useState<RoleDrillDownRequest | null>(null);

  useActionFocus({
    pending: pendingActionFocus,
    activeTab,
    onClear: () => setPendingActionFocus(null),
    onBottleneckDrillDown: setBottleneckDrillDown,
    onRoleDrillDown: setRoleDrillDown,
    onBottleneckSort: setBottleneckTableSortFocus,
  });

  // ── Multiple-assessment drill-down (Overview) ─────────────────────────────
  const [multipleAssessmentsOpen, setMultipleAssessmentsOpen] = useState(false);

  // ── Idle centres drill-down (Overview) ───────────────────────────────────
  const [idleCentresOpen, setIdleCentresOpen] = useState(false);

  // ── Monitoring date ───────────────────────────────────────────────────────
  const [monitoringDate, setMonitoringDate] = useState(todayISO);
  const [monitoringEngagementFilter, setMonitoringEngagementFilter] = useState<MonitoringEngagementFilter>({ kind: 'all' });
  const userStatusTableRef = useRef<HTMLDivElement>(null);

  // ── Refresh / countdown ───────────────────────────────────────────────────
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_MS / 1000);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // ── MetricsContext refetch registration ───────────────────────────────────
  const metricsRefetchRef = useRef<(() => void) | null>(null);
  const handleRegisterMetricsRefetch = useCallback((refetch: () => void) => {
    metricsRefetchRef.current = refetch;
  }, []);

  // ── Data hooks ────────────────────────────────────────────────────────────
  // Use debouncedFilters so rapid date/centre changes don't flood the backend.
  const overview         = useOverview(debouncedFilters);
  const clinicians       = useClinicians(debouncedFilters, needClinicians);
  const managers         = useManagers(debouncedFilters, needManagers);
  const centreAdmins     = useCentreAdmins(debouncedFilters, needCentreAdmins);
  const monitoring       = useMonitoring(monitoringDate, needMonitoring);
  const dailyReview      = useDailyReview(monitoringDate, centreId, needMonitoring);
  const bottlenecks      = useBottlenecks(debouncedFilters, needBottlenecks);
  const clinicianSummary = useRoleSummary('clinician', debouncedFilters, needClinicianExtras);
  const clinicalPipeline = useClinicalPipeline(debouncedFilters, needClinicianExtras);
  const managerSummary   = useRoleSummary('manager', debouncedFilters, needManagerExtras);
  const adminSummary     = useRoleSummary('admin', debouncedFilters, needAdminExtras);
  const userBreakdown    = useUserBreakdown(debouncedFilters, needUsers);
  const assessments      = useAssessments(debouncedFilters, needAssessments);
  const workload         = useWorkload(debouncedFilters, needWorkload);
  const issues           = useIssues(needIssues);
  const topPerformers    = useTopPerformers({ ...debouncedFilters, limit: 0 }, needMonitoring);
  const centresOverview  = useCentresOverview(debouncedFilters, needCentres);

  // Refs to avoid stale closures in the refresh interval
  const metricsRefInRefresh = useRef(metricsRefetchRef);
  const overviewRef      = useRef(overview);
  const cliniciansRef    = useRef(clinicians);
  const managersRef      = useRef(managers);
  const centreAdminsRef  = useRef(centreAdmins);
  const monitoringRef    = useRef(monitoring);
  const dailyReviewRef   = useRef(dailyReview);
  const bottlenecksRef   = useRef(bottlenecks);
  const userBreakdownRef = useRef(userBreakdown);
  const assessmentsRef   = useRef(assessments);
  const workloadRef      = useRef(workload);
  const centresOverviewRef = useRef(centresOverview);
  const issuesRef          = useRef(issues);
  const activeTabRef     = useRef(activeTab);
  const teamRoleRef      = useRef(teamRole);

  overviewRef.current      = overview;
  cliniciansRef.current    = clinicians;
  managersRef.current      = managers;
  centreAdminsRef.current  = centreAdmins;
  monitoringRef.current    = monitoring;
  dailyReviewRef.current   = dailyReview;
  bottlenecksRef.current   = bottlenecks;
  userBreakdownRef.current = userBreakdown;
  assessmentsRef.current   = assessments;
  workloadRef.current        = workload;
  centresOverviewRef.current = centresOverview;
  issuesRef.current          = issues;
  activeTabRef.current       = activeTab;
  teamRoleRef.current        = teamRole;

  useEffect(() => {
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    setMonitoringEngagementFilter({ kind: 'all' });
  }, [monitoringDate]);

  useEffect(() => {
    if (activeTab !== 3) setBottleneckTableSortFocus(null);
  }, [activeTab]);

  // ── Auto-refresh ──────────────────────────────────────────────────────────
  useEffect(() => {
    const refreshAll = () => {
      const tab  = activeTabRef.current;
      const role = teamRoleRef.current;

      metricsRefInRefresh.current.current?.();
      overviewRef.current.refetch();

      if (tab === 1) { monitoringRef.current.refetch(); dailyReviewRef.current.refetch(); }
      if (tab === 0) {
        bottlenecksRef.current.refetch();
        assessmentsRef.current.refetch();
      }
      if (tab === 3) issuesRef.current.refetch();
      if (tab === 2) {
        if (role === 'clinicians') { cliniciansRef.current.refetch(); workloadRef.current.refetch(); }
        if (role === 'managers')   managersRef.current.refetch();
        if (role === 'admins')     centreAdminsRef.current.refetch();
        if (role === 'centres')    centresOverviewRef.current.refetch();
        if (role === 'roster')     userBreakdownRef.current.refetch();
      }

      setLastUpdated(new Date());
      setCountdown(REFRESH_INTERVAL_MS / 1000);
    };

    const refreshTimer   = setInterval(refreshAll, REFRESH_INTERVAL_MS);
    const countdownTimer = setInterval(() => {
      setCountdown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);

    return () => {
      clearInterval(refreshTimer);
      clearInterval(countdownTimer);
    };
  }, []);

  // ── Manual refresh ────────────────────────────────────────────────────────
  const handleRefresh = () => {
    metricsRefetchRef.current?.();
    overview.refetch();
    if (needMonitoring)   { monitoring.refetch(); dailyReview.refetch(); }
    if (needBottlenecks)  bottlenecks.refetch();
    if (needAssessments)  assessments.refetch();
    if (needIssues)       issues.refetch();
    if (needClinicians)   clinicians.refetch();
    if (needManagers)     managers.refetch();
    if (needCentreAdmins) centreAdmins.refetch();
    if (needCentres)      centresOverview.refetch();
    if (needUsers)        userBreakdown.refetch();
    if (needWorkload)     workload.refetch();
    setLastUpdated(new Date());
    setCountdown(REFRESH_INTERVAL_MS / 1000);
  };

  const handleMonitoringRefresh = () => {
    monitoring.refetch();
    dailyReview.refetch();
    setLastUpdated(new Date());
    setCountdown(REFRESH_INTERVAL_MS / 1000);
  };

  const centres = overview.data?.centres ?? [];
  const overdueCount = assessments.data?.slowAssessments?.length ?? 0;

  // ── Issues tab badge ──────────────────────────────────────────────────────
  const issuesCritical = issues.data?.critical.total ?? 0;
  const issuesWarning  = issues.data?.warning.total  ?? 0;
  const tabBadges = useMemo(() => {
    const m = new Map<number, TabBadge>();
    if (issuesCritical > 0) {
      m.set(3, { count: issuesCritical + issuesWarning, variant: 'red' });
    } else if (issuesWarning > 0) {
      m.set(3, { count: issuesWarning, variant: 'amber' });
    }
    return m;
  }, [issuesCritical, issuesWarning]);

  return (
    <MetricsProvider filters={filters} onRegisterRefetch={handleRegisterMetricsRefetch}>
    <div className="min-h-screen bg-gray-50">
      <TopBarWithSync
        centres={centres}
        centreId={centreId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onCentreChange={setCentreId}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onRefresh={handleRefresh}
        countdown={countdown}
        lastUpdated={lastUpdated}
        isDailyTab={activeTab === 1}
      />

      <TabNav
        tabs={[...DASHBOARD_TABS]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        badges={tabBadges}
        onTabHoverIntent={handleTabHoverIntent}
      />

      <main className="mx-auto max-w-screen-2xl px-3 sm:px-4 pt-3 sm:pt-4 pb-5 sm:pb-8">

        <FilterChips
          centres={centres}
          centreId={centreId}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onClearCentre={() => setCentreId(undefined)}
          onClearDates={() => {
            setDateFrom(defaultPeriod.from);
            setDateTo(defaultPeriod.to);
          }}
          onClearAll={() => {
            setCentreId(undefined);
            setDateFrom(defaultPeriod.from);
            setDateTo(defaultPeriod.to);
          }}
          hidePeriod={activeTab === 3}
        />

        {/* ── Overview ─────────────────────────────────────────────────── */}
        {activeTab === 0 && (
          <div
            id="tabpanel-0"
            role="tabpanel"
            aria-labelledby="tab-0"
            tabIndex={-1}
            className="mt-3 sm:mt-5"
          >
            <OverviewTab
              overview={overview.data}
              overviewLoading={overview.loading}
              bottlenecks={bottlenecks.data}
              bottlenecksLoading={bottlenecks.loading}
              clinicians={clinicians.data ?? []}
              cliniciansLoading={clinicians.loading}
              overdueCount={overdueCount}
              onNavigate={handleActionNavigate}
              onOpenMultipleAssessments={() => setMultipleAssessmentsOpen(true)}
              onOpenIdleCentres={() => setIdleCentresOpen(true)}
              dateFrom={dateFrom || undefined}
              dateTo={dateTo || undefined}
              asOf={lastUpdated}
            />
          </div>
        )}

        {/* ── Live (daily monitoring) ───────────────────────────────── */}
        {activeTab === 1 && (
          <div
            id="tabpanel-1"
            role="tabpanel"
            aria-labelledby="tab-1"
            className="mt-3 sm:mt-5 space-y-3 sm:space-y-5"
          >
            {/* Daily-view info banner */}
            <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-gray-50 border border-gray-100 text-[12px] text-gray-500 leading-relaxed">
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                This tab always shows a single day&apos;s activity.
                Use the date picker above to change the day.{' '}
                <span className="text-gray-400">The global period filter does not apply here.</span>
              </span>
            </div>
            {/* Daily Ops Review — live pulse + day nav + export all inline in header */}
            <DailyOpsReview
              data={dailyReview.data}
              loading={dailyReview.loading}
              date={monitoringDate}
              onDateChange={setMonitoringDate}
              centreName={centreId ? (overview.data?.centres ?? []).find(c => c.id === centreId)?.name : undefined}
              lastUpdated={lastUpdated}
              onRefresh={handleMonitoringRefresh}
              liveLoading={monitoring.loading || dailyReview.loading}
            />

            {/* Top Performers calendar */}
            <ActivityHeatmap
              performers={topPerformers.data?.performers ?? []}
              daysCount={topPerformers.data?.daysCount ?? 14}
              loading={topPerformers.loading}
              centres={overview.data?.centres ?? []}
              dateFrom={dateFrom || undefined}
              dateTo={dateTo || undefined}
            />

            {/* User Status table — DO NOT TOUCH */}
            <div ref={userStatusTableRef}>
              <UserStatusTable
                users={monitoring.data?.users ?? []}
                loading={monitoring.loading}
                error={monitoring.error}
                engagementFilter={monitoringEngagementFilter}
                onClearEngagementFilter={() => setMonitoringEngagementFilter({ kind: 'all' })}
              />
            </div>
          </div>
        )}

        {/* ── Team ─────────────────────────────────────────────────────── */}
        {activeTab === 2 && (
          <TeamTab
            role={teamRole}
            onRoleChange={setTeamRole}
            clinicians={clinicians.data ?? []}
            cliniciansLoading={clinicians.loading}
            cliniciansError={clinicians.error}
            clinicianSummary={clinicianSummary.data}
            clinicianSummaryLoading={clinicianSummary.loading}
            clinicalPipeline={clinicalPipeline.data}
            clinicalPipelineLoading={clinicalPipeline.loading}
            workload={workload.data}
            workloadLoading={workload.loading}
            managers={managers.data ?? []}
            managersLoading={managers.loading}
            managersError={managers.error}
            managerSummary={managerSummary.data}
            managerSummaryLoading={managerSummary.loading}
            admins={centreAdmins.data ?? []}
            adminsLoading={centreAdmins.loading}
            adminsError={centreAdmins.error}
            adminSummary={adminSummary.data}
            adminSummaryLoading={adminSummary.loading}
            centresData={centresOverview.data}
            centresLoading={centresOverview.loading}
            centresError={centresOverview.error}
            userBreakdown={userBreakdown.data}
            userBreakdownLoading={userBreakdown.loading}
            userBreakdownError={userBreakdown.error}
            linkParams={profileLinkParams}
            filters={filters}
            onDrillDown={setRoleDrillDown}
          />
        )}

        {/* ── Issues ───────────────────────────────────────────────────── */}
        {activeTab === 3 && (
          <IssuesTab
            data={issues.data}
            loading={issues.loading}
            error={issues.error}
          />
        )}

        {/* ── Shared slide-over panels ──────────────────────────────────── */}
        <BottleneckDrillDownPanel
          request={bottleneckDrillDown}
          filters={filters}
          centres={centres}
          onClose={() => setBottleneckDrillDown(null)}
        />

        <RoleDrillDownPanel
          request={[0, 2].includes(activeTab) ? roleDrillDown : null}
          filters={filters}
          centres={centres}
          onClose={() => setRoleDrillDown(null)}
        />

        <MultipleAssessmentCasesPanel
          open={activeTab === 0 && multipleAssessmentsOpen}
          cases={overview.data?.multipleAssessmentCases?.cases ?? []}
          onClose={() => setMultipleAssessmentsOpen(false)}
        />

        <IdleCentresDrawer
          open={activeTab === 0 && idleCentresOpen}
          idleCentres={overview.data?.idleCentreDetails ?? []}
          dateFrom={dateFrom || undefined}
          dateTo={dateTo || undefined}
          onClose={() => setIdleCentresOpen(false)}
        />
      </main>
    </div>
    </MetricsProvider>
  );
}
