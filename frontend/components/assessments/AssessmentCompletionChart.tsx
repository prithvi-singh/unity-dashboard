'use client';

import { useEffect, useRef } from 'react';
import type { AssessmentOverviewData } from '@/lib/types';

interface Props {
  data: AssessmentOverviewData | null;
  loading: boolean;
}

const TYPE_COLORS: Record<string, { total: string; completed: string }> = {
  SPM:   { total: 'rgba(59,130,246,0.22)', completed: 'rgba(59,130,246,0.88)' },
  DP3:   { total: 'rgba(124,58,237,0.22)', completed: 'rgba(124,58,237,0.88)' },
  REELS: { total: 'rgba(14,165,233,0.22)', completed: 'rgba(14,165,233,0.88)' },
  ISAA:  { total: 'rgba(99,102,241,0.22)', completed: 'rgba(99,102,241,0.88)' },
};

export default function AssessmentCompletionChart({ data, loading }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current || !data?.byType) return;

    let timerId: ReturnType<typeof setTimeout>;
    let attempts = 0;

    const tryCreate = () => {
      if (typeof window === 'undefined' || !window.Chart) {
        if (attempts < 40) { attempts++; timerId = setTimeout(tryCreate, 100); }
        return;
      }
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

      const types = data.byType;
      const labels = types.map((t) => t.type);

      const ctx = canvasRef.current!.getContext('2d');
      if (!ctx) return;

      chartRef.current = new window.Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Total Assigned',
              data: types.map((t) => t.total),
              backgroundColor: labels.map((l) => TYPE_COLORS[l]?.total ?? 'rgba(156,163,175,0.25)'),
              borderColor: labels.map((l) => TYPE_COLORS[l]?.completed ?? 'rgba(156,163,175,0.6)'),
              borderWidth: 1.5,
              borderRadius: 6,
              borderSkipped: false,
            },
            {
              label: 'Completed',
              data: types.map((t) => t.completed),
              backgroundColor: labels.map((l) => TYPE_COLORS[l]?.completed ?? 'rgba(156,163,175,0.7)'),
              borderRadius: 6,
              borderSkipped: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top' as const,
              align: 'end' as const,
              labels: {
                font: { size: 11, family: 'Plus Jakarta Sans, sans-serif', weight: '500' },
                color: '#6B7280',
                boxWidth: 8,
                boxHeight: 8,
                usePointStyle: true,
                pointStyle: 'rectRounded',
                padding: 16,
              },
            },
            tooltip: {
              backgroundColor: 'rgba(17,24,39,0.93)',
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
                afterBody: (items: any[]) => {
                  const idx = items[0]?.dataIndex ?? 0;
                  const t = types[idx];
                  if (!t) return [];
                  return [`Completion rate: ${t.completionRate.toFixed(1)}%`];
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                font: { size: 12, family: 'Plus Jakarta Sans, sans-serif', weight: '600' },
                color: '#374151',
              },
              border: { display: false },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(243,244,246,1)' },
              ticks: {
                font: { size: 11, family: 'Plus Jakarta Sans, sans-serif' },
                color: '#9CA3AF',
                maxTicksLimit: 6,
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
  }, [data]);

  const isEmpty = data?.byType.every((t) => t.total === 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 flex flex-col">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Completion Rate Comparison</h2>
        <p className="text-xs text-gray-400 mt-0.5">Assigned vs completed</p>
      </div>
      <div className="relative h-48 sm:h-64 md:h-[260px]">
        {loading && !data ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isEmpty ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <p className="text-sm font-medium text-gray-600">No assessment data in this range</p>
            <p className="text-xs text-gray-400">Adjust the date filter or centre selection</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            aria-label="Assessment completion grouped bar chart"
            role="img"
          />
        )}
      </div>
    </div>
  );
}
