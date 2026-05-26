'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { BottleneckData } from '@/lib/types';
import type { BottleneckDrillDownType, OnBottleneckDrillDown } from '@/lib/bottleneckDrillDown';
import { shortCentreName } from '@/lib/centreNames';
import { bottleneckCentreChartKey } from '@/lib/chartKeys';

interface Props {
  data: BottleneckData | null;
  loading: boolean;
  onDrillDown?: OnBottleneckDrillDown;
}

const DATASET_TYPES: BottleneckDrillDownType[] = [
  'stuck-onboarding',
  'pending-goals',
  'incomplete-assessments',
];

const DATASET_LABELS = ['Stuck >48h', 'Pending goals', 'Incomplete assessments'];

export default function BottleneckByCentre({ data, loading, onDrillDown }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  const onDrillDownRef = useRef(onDrillDown);
  onDrillDownRef.current = onDrillDown;
  const dataRef = useRef(data);
  dataRef.current = data;

  const chartKey = useMemo(
    () => (data ? bottleneckCentreChartKey(data.byCentre) : ''),
    [data],
  );

  useEffect(() => {
    const currentData = dataRef.current;
    if (!canvasRef.current || !currentData?.byCentre) return;

    let timerId: ReturnType<typeof setTimeout>;
    let attempts = 0;

    const tryCreate = () => {
      if (typeof window === 'undefined' || !window.Chart) {
        if (attempts < 40) { attempts++; timerId = setTimeout(tryCreate, 100); }
        return;
      }
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

      const sorted = [...currentData.byCentre]
        .map((c) => ({
          ...c,
          total: c.stuckOnboarding + c.pendingGoals + c.incompleteAssessments,
        }))
        .filter((c) => c.total > 0)
        .sort((a, b) => b.total - a.total || a.centreName.localeCompare(b.centreName))
        .slice(0, 8);

      const shortLabels = sorted.map((c) => shortCentreName(c.centreName));
      const fullNames = sorted.map((c) => c.centreName);

      const ctx = canvasRef.current!.getContext('2d');
      if (!ctx) return;

      chartRef.current = new window.Chart(ctx, {
        type: 'bar',
        data: {
          labels: shortLabels,
          datasets: [
            {
              label: 'Stuck >48h',
              data: sorted.map((c) => c.stuckOnboarding),
              backgroundColor: 'rgba(244,63,94,0.82)',
              borderRadius: 3,
              borderSkipped: false,
            },
            {
              label: 'Pending goals',
              data: sorted.map((c) => c.pendingGoals),
              backgroundColor: 'rgba(245,158,11,0.82)',
              borderRadius: 3,
              borderSkipped: false,
            },
            {
              label: 'Incomplete assessments',
              data: sorted.map((c) => c.incompleteAssessments),
              backgroundColor: 'rgba(124,58,237,0.75)',
              borderRadius: 3,
              borderSkipped: false,
            },
          ],
        },
        options: {
          indexAxis: 'y' as const,
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          onClick: (_event: unknown, elements: { datasetIndex: number; index: number }[]) => {
            if (!elements.length || !onDrillDownRef.current) return;
            const { datasetIndex, index } = elements[0];
            const centre = sorted[index];
            const type = DATASET_TYPES[datasetIndex];
            const count = [centre.stuckOnboarding, centre.pendingGoals, centre.incompleteAssessments][datasetIndex];
            if (count <= 0) return;
            onDrillDownRef.current({
              type,
              drillCentreId: centre.centreId,
              label: `${DATASET_LABELS[datasetIndex]} · ${centre.centreName}`,
            });
          },
          plugins: {
            legend: {
              position: 'top' as const,
              labels: {
                font: { size: 11, family: 'Plus Jakarta Sans, sans-serif', weight: '500' },
                color: '#6B7280',
                boxWidth: 8,
                boxHeight: 8,
                usePointStyle: true,
                pointStyle: 'circle',
                padding: 16,
              },
            },
            tooltip: {
              backgroundColor: 'rgba(17,24,39,0.92)',
              titleColor: '#F9FAFB',
              bodyColor: '#D1D5DB',
              borderColor: 'rgba(255,255,255,0.08)',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 8,
              titleFont: { size: 12, weight: '600' },
              bodyFont: { size: 11 },
              callbacks: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                title: (items: any[]) => {
                  const i = items[0]?.dataIndex ?? 0;
                  return fullNames[i] ?? items[0]?.label ?? '';
                },
                footer: () => onDrillDownRef.current ? 'Click segment to view cases' : '',
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              beginAtZero: true,
              grid: { color: 'rgba(243,244,246,1)' },
              ticks: {
                font: { size: 11, family: 'Plus Jakarta Sans, sans-serif' },
                color: '#9CA3AF',
                maxTicksLimit: 6,
              },
              border: { display: false },
            },
            y: {
              stacked: true,
              grid: { display: false },
              ticks: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                callback: (_val: unknown, index: number) => shortLabels[index] ?? '',
                font: { size: 11, family: 'Plus Jakarta Sans, sans-serif', weight: '500' },
                color: '#374151',
                padding: 6,
              },
              border: { display: false },
            },
          },
        },
      });
    };

    tryCreate();
    return () => {
      clearTimeout(timerId);
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [chartKey]);

  const hasBottlenecks = data?.byCentre.some(
    (c) => c.stuckOnboarding + c.pendingGoals + c.incompleteAssessments > 0
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 flex flex-col">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Bottlenecks by Centre</h2>
        <p className="text-xs text-gray-400 mt-0.5">Top 8 · click a bar to drill in</p>
      </div>
      <div className="relative h-48 sm:h-64 md:h-[300px]">
        {loading && !data ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !hasBottlenecks ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <p className="text-sm font-medium text-gray-700">All centres clear</p>
            <p className="text-xs text-gray-400">No stuck cases or pending work</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            aria-label="Bottlenecks by centre horizontal bar chart"
            role="img"
            className={onDrillDown ? 'cursor-pointer' : undefined}
          />
        )}
      </div>
    </div>
  );
}
