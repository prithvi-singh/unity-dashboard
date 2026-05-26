'use client';

import type { BottleneckData, AssessmentOverviewData, WorkloadCentreRow } from '@/lib/types';
import type { BottleneckDrillDownRequest } from '@/lib/bottleneckDrillDown';
import type { BottleneckActionSortCol } from '@/lib/actionNavigation';
import BottleneckCards from '@/components/bottlenecks/BottleneckCards';
import BottleneckFunnel from '@/components/bottlenecks/BottleneckFunnel';
import CentreActivitySummary from '@/components/bottlenecks/BottleneckByCentre';
import BottleneckTrendChart from '@/components/bottlenecks/BottleneckTrendChart';
import BottleneckActionTable from '@/components/bottlenecks/BottleneckActionTable';
import OverdueAssessmentsTable from '@/components/assessments/OverdueAssessmentsTable';
import AssessmentTypeCards from '@/components/assessments/AssessmentTypeCards';
import AssessmentCompletionChart from '@/components/assessments/AssessmentCompletionChart';
import AssessmentByCentreTable from '@/components/assessments/AssessmentByCentreTable';
import AssessmentClinicianMatrix from '@/components/assessments/AssessmentClinicianMatrix';

interface Props {
  bottlenecks: BottleneckData | null;
  bottlenecksLoading: boolean;
  bottlenecksError: string | null;
  assessments: AssessmentOverviewData | null;
  assessmentsLoading: boolean;
  assessmentsError: string | null;
  workload: WorkloadCentreRow[] | null;
  workloadLoading: boolean;
  onDrillDown: (req: BottleneckDrillDownRequest) => void;
  sortFocus: BottleneckActionSortCol | null;
}

export default function IssuesTab({
  bottlenecks,
  bottlenecksLoading,
  bottlenecksError,
  assessments,
  assessmentsLoading,
  assessmentsError,
  workload,
  workloadLoading,
  onDrillDown,
  sortFocus,
}: Props) {
  const overdueCount = assessments?.slowAssessments?.length ?? 0;

  return (
    <div
      id="tabpanel-3"
      role="tabpanel"
      aria-labelledby="tab-3"
      className="mt-3 sm:mt-5 space-y-4 sm:space-y-6"
    >
      {/* ── Overdue assessments — surface at the top when present ─── */}
      {overdueCount > 0 && (
        <section data-focus-target="assess-overdue" aria-labelledby="assess-overdue-heading">
          <div className="mb-3">
            <h2 id="assess-overdue-heading" className="text-base font-semibold text-gray-900">
              Overdue Assessments
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              No result after 14 days.{' '}
              <span className="text-amber-600 font-medium">14–21d: nudge clinician.</span>{' '}
              <span className="text-rose-600 font-medium">&gt;21d: escalate or reassign.</span>
            </p>
          </div>
          <OverdueAssessmentsTable data={assessments} loading={assessmentsLoading} />
        </section>
      )}

      {/* ── Bottleneck KPI summary cards ──────────────────────────── */}
      <BottleneckCards
        data={bottlenecks}
        loading={bottlenecksLoading}
        error={bottlenecksError}
        onDrillDown={onDrillDown}
      />

      {/* ── Workflow funnel ───────────────────────────────────────── */}
      <BottleneckFunnel
        data={bottlenecks}
        loading={bottlenecksLoading}
        onDrillDown={onDrillDown}
      />

      {/* ── Centre Activity Summary table (full width) ────────────── */}
      <CentreActivitySummary
        rows={workload}
        loading={workloadLoading}
      />

      {/* ── Weekly SLA trend ──────────────────────────────────────── */}
      <BottleneckTrendChart
        data={bottlenecks}
        loading={bottlenecksLoading}
        onDrillDown={onDrillDown}
      />

      {/* ── Action queue ──────────────────────────────────────────── */}
      <BottleneckActionTable
        data={bottlenecks}
        loading={bottlenecksLoading}
        error={bottlenecksError}
        onDrillDown={onDrillDown}
        sortFocus={sortFocus}
      />

      {/* ── Assessment analytics divider ──────────────────────────── */}
      <div className="flex items-center gap-3 pt-2">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400 flex-shrink-0">
          Assessment Analytics
        </span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      {/* ── Assessment type summary ───────────────────────────────── */}
      <section aria-labelledby="assess-types-heading">
        <div className="mb-3">
          <h2 id="assess-types-heading" className="text-base font-semibold text-gray-900">By Type</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            SPM · DP3 · REELS · ISAA — assigned, completed, pending goals.
          </p>
        </div>
        <AssessmentTypeCards
          data={assessments}
          loading={assessmentsLoading}
          error={assessmentsError}
        />
      </section>

      {/* ── Completion rate chart ─────────────────────────────────── */}
      <section aria-labelledby="assess-chart-heading">
        <div className="mb-3">
          <h2 id="assess-chart-heading" className="text-base font-semibold text-gray-900">Completion by Type</h2>
          <p className="text-xs text-gray-400 mt-0.5">Assigned vs completed — the gap is still-open work.</p>
        </div>
        <AssessmentCompletionChart data={assessments} loading={assessmentsLoading} />
      </section>

      {/* ── Clinician capability matrix ───────────────────────────── */}
      <section aria-labelledby="assess-clinician-heading">
        <div className="mb-3">
          <h2 id="assess-clinician-heading" className="text-base font-semibold text-gray-900">Clinician Matrix</h2>
          <p className="text-xs text-gray-400 mt-0.5">Assigned / completed per clinician. Grey = none. Red = low completion.</p>
        </div>
        <AssessmentClinicianMatrix data={assessments} loading={assessmentsLoading} />
      </section>

      {/* ── By centre ────────────────────────────────────────────────*/}
      <section aria-labelledby="assess-centre-heading">
        <div className="mb-3">
          <h2 id="assess-centre-heading" className="text-base font-semibold text-gray-900">By Centre</h2>
          <p className="text-xs text-gray-400 mt-0.5">Completion % per type. Red = manager should follow up.</p>
        </div>
        <AssessmentByCentreTable data={assessments} loading={assessmentsLoading} />
      </section>

      {/* Show overdue at bottom too if nothing was overdue at load (keeps position stable) */}
      {overdueCount === 0 && (
        <section data-focus-target="assess-overdue" aria-labelledby="assess-overdue-heading-2">
          <div className="mb-3">
            <h2 id="assess-overdue-heading-2" className="text-base font-semibold text-gray-900">
              Overdue Assessments
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              No result after 14 days.{' '}
              <span className="text-amber-600 font-medium">14–21d: nudge clinician.</span>{' '}
              <span className="text-rose-600 font-medium">&gt;21d: escalate or reassign.</span>
            </p>
          </div>
          <OverdueAssessmentsTable data={assessments} loading={assessmentsLoading} />
        </section>
      )}
    </div>
  );
}
