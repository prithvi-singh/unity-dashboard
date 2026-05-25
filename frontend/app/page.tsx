'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import type { MonitoringEngagementFilter } from '@/lib/monitoringStats';
import TopBar from '@/components/TopBar';
import TabNav from '@/components/TabNav';
import FilterChips from '@/components/FilterChips';

// Overview
import ActionFeed from '@/components/overview/ActionFeed';
import MetricCards from '@/components/overview/MetricCards';
import CentreTable from '@/components/overview/CentreTable';
import MultipleAssessmentCasesPanel from '@/components/overview/MultipleAssessmentCasesPanel';
import ClinicalPipelineCard from '@/components/shared/ClinicalPipelineCard';

// Live (daily monitoring)
import LivePulse from '@/components/monitoring/LivePulse';
import DayPicker from '@/components/monitoring/DayPicker';
import MonitoringCards from '@/components/monitoring/MonitoringCards';
import MonitoringEngagementFunnel from '@/components/monitoring/MonitoringEngagementFunnel';
import MonitoringCentreChart from '@/components/monitoring/MonitoringCentreChart';
import MonitoringTrendChart from '@/components/monitoring/MonitoringTrendChart';
import UserStatusTable from '@/components/monitoring/UserStatusTable';
import ActivityHeatmap from '@/components/monitoring/ActivityHeatmap';

// Team (unified role view)
import TeamTab, { type TeamRole } from '@/components/team/TeamTab';

// Issues (bottlenecks + assessments)
import IssuesTab from '@/components/issues/IssuesTab';
import BottleneckDrillDownPanel from '@/components/bottlenecks/BottleneckDrillDownPanel';
import RoleDrillDownPanel from '@/components/shared/RoleDrillDownPanel';
import type { BottleneckDrillDownRequest } from '@/lib/bottleneckDrillDown';
import type { RoleDrillDownRequest } from '@/lib/roleDrillDown';

// Hooks
import { useOverview } from '@/hooks/useOverview';
import { useClinicians } from '@/hooks/useClinicians';
import { useManagers } from '@/hooks/useManagers';
import { useCentreAdmins } from '@/hooks/useCentreAdmins';
import { useMonitoring } from '@/hooks/useMonitoring';
import { useBottlenecks } from '@/hooks/useBottlenecks';
import { useRoleSummary } from '@/hooks/useRoleSummary';
import { useClinicalPipeline } from '@/hooks/useClinicalPipeline';
import { useUserBreakdown } from '@/hooks/useUserBreakdown';
import { useAssessments } from '@/hooks/useAssessments';
import { useActionFocus } from '@/hooks/useActionFocus';
import { useDashboardUrl, readDashboardStateFromUrl } from '@/hooks/useDashboardUrl';
import type { ActionNavigationTarget, BottleneckActionSortCol } from '@/lib/actionNavigation';
import { DASHBOARD_TABS } from '@/lib/dashboardTabs';
import { defaultDashboardPeriod, todayISO } from '@/lib/datePresets';

const REFRESH_INTERVAL_MS = 3_600_000; // 1 hour

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

  const profileLinkParams = useMemo(
    () => ({ centreId, dateFrom, dateTo }),
    [centreId, dateFrom, dateTo],
  );

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(urlInit.activeTab);

  useDashboardUrl({ activeTab, centreId, dateFrom, dateTo });

  // ── Team tab: which role sub-view is active ───────────────────────────────
  const [teamRole, setTeamRole] = useState<TeamRole>('clinicians');

  // ── Data-fetch gates (lazy per-tab + per-role) ────────────────────────────
  const needClinicians    = activeTab === 0 || (activeTab === 2 && teamRole === 'clinicians');
  const needManagers      = activeTab === 2 && teamRole === 'managers';
  const needCentreAdmins  = activeTab === 2 && teamRole === 'admins';
  const needBottlenecks   = activeTab === 0 || activeTab === 3;
  const needMonitoring    = activeTab === 1;
  const needUsers         = activeTab === 2 && teamRole === 'roster';
  const needAssessments   = activeTab === 0 || activeTab === 3;
  const needClinicianExtras = activeTab === 2 && teamRole === 'clinicians';
  const needManagerExtras   = activeTab === 2 && teamRole === 'managers';
  const needAdminExtras     = activeTab === 2 && teamRole === 'admins';

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

  // ── Monitoring date ───────────────────────────────────────────────────────
  const [monitoringDate, setMonitoringDate] = useState(todayISO);
  const [monitoringEngagementFilter, setMonitoringEngagementFilter] = useState<MonitoringEngagementFilter>({ kind: 'all' });
  const userStatusTableRef = useRef<HTMLDivElement>(null);

  // ── Refresh / countdown ───────────────────────────────────────────────────
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_MS / 1000);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // ── Data hooks ────────────────────────────────────────────────────────────
  const overview         = useOverview(filters);
  const clinicians       = useClinicians(filters, needClinicians);
  const managers         = useManagers(filters, needManagers);
  const centreAdmins     = useCentreAdmins(filters, needCentreAdmins);
  const monitoring       = useMonitoring(monitoringDate, needMonitoring);
  const bottlenecks      = useBottlenecks(filters, needBottlenecks);
  const clinicianSummary = useRoleSummary('clinician', filters, needClinicianExtras);
  const clinicalPipeline = useClinicalPipeline(filters, needClinicianExtras);
  const managerSummary   = useRoleSummary('manager', filters, needManagerExtras);
  const adminSummary     = useRoleSummary('admin', filters, needAdminExtras);
  const userBreakdown    = useUserBreakdown(filters, needUsers);
  const assessments      = useAssessments(filters, needAssessments);

  // Refs to avoid stale closures in the refresh interval
  const overviewRef      = useRef(overview);
  const cliniciansRef    = useRef(clinicians);
  const managersRef      = useRef(managers);
  const centreAdminsRef  = useRef(centreAdmins);
  const monitoringRef    = useRef(monitoring);
  const bottlenecksRef   = useRef(bottlenecks);
  const userBreakdownRef = useRef(userBreakdown);
  const assessmentsRef   = useRef(assessments);
  const activeTabRef     = useRef(activeTab);
  const teamRoleRef      = useRef(teamRole);

  overviewRef.current     = overview;
  cliniciansRef.current   = clinicians;
  managersRef.current     = managers;
  centreAdminsRef.current = centreAdmins;
  monitoringRef.current   = monitoring;
  bottlenecksRef.current  = bottlenecks;
  userBreakdownRef.current = userBreakdown;
  assessmentsRef.current  = assessments;
  activeTabRef.current    = activeTab;
  teamRoleRef.current     = teamRole;

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

      overviewRef.current.refetch();

      if (tab === 1) monitoringRef.current.refetch();
      if (tab === 0 || tab === 3) {
        bottlenecksRef.current.refetch();
        assessmentsRef.current.refetch();
      }
      if (tab === 2) {
        if (role === 'clinicians') cliniciansRef.current.refetch();
        if (role === 'managers')   managersRef.current.refetch();
        if (role === 'admins')     centreAdminsRef.current.refetch();
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
    overview.refetch();
    if (needMonitoring)   monitoring.refetch();
    if (needBottlenecks)  bottlenecks.refetch();
    if (needAssessments)  assessments.refetch();
    if (needClinicians)   clinicians.refetch();
    if (needManagers)     managers.refetch();
    if (needCentreAdmins) centreAdmins.refetch();
    if (needUsers)        userBreakdown.refetch();
    setLastUpdated(new Date());
    setCountdown(REFRESH_INTERVAL_MS / 1000);
  };

  const handleMonitoringRefresh = () => {
    monitoring.refetch();
    setLastUpdated(new Date());
    setCountdown(REFRESH_INTERVAL_MS / 1000);
  };

  const centres = overview.data?.centres ?? [];
  const overdueCount = assessments.data?.slowAssessments?.length ?? 0;

  const handleOverviewOperationalDrill = (type: 'status-changes' | 'transfers') => {
    setActiveTab(3);
    setBottleneckDrillDown({
      type,
      label: type === 'status-changes' ? 'Status changes (resets)' : 'Case transfers',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar
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
      />

      <main className="mx-auto max-w-screen-2xl px-4 py-5">
        <TabNav
          tabs={[...DASHBOARD_TABS]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

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
        />

        {/* ── Overview ─────────────────────────────────────────────────── */}
        {activeTab === 0 && (
          <div
            id="tabpanel-0"
            role="tabpanel"
            aria-labelledby="tab-0"
            tabIndex={-1}
            className="mt-5 space-y-5"
          >
            <ActionFeed
              bottlenecks={bottlenecks.data}
              clinicians={clinicians.data ?? []}
              overviewCentres={overview.data?.byCentre ?? []}
              overdueCount={overdueCount}
              loading={bottlenecks.loading || clinicians.loading || (needAssessments && assessments.loading)}
              onNavigate={handleActionNavigate}
            />
            <MetricCards
              data={overview.data}
              loading={overview.loading}
              error={overview.error}
              onOpenMultipleAssessments={() => setMultipleAssessmentsOpen(true)}
              onOperationalDrill={handleOverviewOperationalDrill}
            />
            <ClinicalPipelineCard
              pipeline={overview.data?.pipeline}
              loading={overview.loading}
              onDrillDown={setRoleDrillDown}
            />
            <CentreTable data={overview.data} loading={overview.loading} />
          </div>
        )}

        {/* ── Live (daily monitoring) ───────────────────────────────── */}
        {activeTab === 1 && (
          <div
            id="tabpanel-1"
            role="tabpanel"
            aria-labelledby="tab-1"
            className="mt-5 space-y-5"
          >
            <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-xs text-sky-900">
              Live uses the selected day below — not the global date range in the top bar.
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <DayPicker
                availableDates={monitoring.data?.availableDates ?? []}
                selectedDate={monitoringDate}
                onDateChange={setMonitoringDate}
              />
              <LivePulse
                lastUpdated={lastUpdated}
                onRefresh={handleMonitoringRefresh}
                loading={monitoring.loading}
              />
            </div>

            <MonitoringCards data={monitoring.data} loading={monitoring.loading} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <MonitoringEngagementFunnel
                data={monitoring.data}
                loading={monitoring.loading}
                selectedDate={monitoringDate}
                activeFilter={monitoringEngagementFilter}
                onFilterChange={setMonitoringEngagementFilter}
                onScrollToTable={() => {
                  userStatusTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              />
              <MonitoringCentreChart data={monitoring.data} loading={monitoring.loading} />
            </div>

            <MonitoringTrendChart
              data={monitoring.data}
              loading={monitoring.loading}
              selectedDate={monitoringDate}
            />

            <div ref={userStatusTableRef}>
              <UserStatusTable
                users={monitoring.data?.users ?? []}
                loading={monitoring.loading}
                error={monitoring.error}
                engagementFilter={monitoringEngagementFilter}
                onClearEngagementFilter={() => setMonitoringEngagementFilter({ kind: 'all' })}
              />
            </div>

            <ActivityHeatmap
              users={monitoring.data?.users ?? []}
              heatmap={monitoring.data?.heatmap ?? []}
            />
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
            userBreakdown={userBreakdown.data}
            userBreakdownLoading={userBreakdown.loading}
            userBreakdownError={userBreakdown.error}
            linkParams={profileLinkParams}
            onDrillDown={setRoleDrillDown}
          />
        )}

        {/* ── Issues ───────────────────────────────────────────────────── */}
        {activeTab === 3 && (
          <IssuesTab
            bottlenecks={bottlenecks.data}
            bottlenecksLoading={bottlenecks.loading}
            bottlenecksError={bottlenecks.error}
            assessments={assessments.data}
            assessmentsLoading={assessments.loading}
            assessmentsError={assessments.error}
            onDrillDown={setBottleneckDrillDown}
            sortFocus={bottleneckTableSortFocus}
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
      </main>
    </div>
  );
}
