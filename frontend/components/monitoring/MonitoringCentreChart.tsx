'use client';

import { useEffect, useRef } from 'react';
import type { MonitoringData } from '@/lib/types';
import { shortCentreName } from '@/lib/centreNames';
import { aggregateByCentre, computeDayStats } from '@/lib/monitoringStats';

interface Props {
  data: MonitoringData | null;
  loading: boolean;
}

export default function MonitoringCentreChart({ data, loading }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current || !data) return;

    let timerId: ReturnType<typeof setTimeout>;
    let attempts = 0;

    const tryCreate = () => {
      if (typeof window === 'undefined' || !window.Chart) {
        if (attempts < 40) { attempts++; timerId = setTimeout(tryCreate, 100); }
        return;
      }
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

      const stats = computeDayStats(data);
      if (!stats) return;

      const sorted = aggregateByCentre(stats.users).slice(0, 8);
      const shortLabels = sorted.map((c) => shortCentreName(c.centreName));
      const fullNames = sorted.map((c) => c.centreName);

      const ctx = canvasRef.current!.getContext('2d');
      if (!ctx) return;

      chartRef.current = new window.Chart(ctx, {
        type: 'bar',
        data: {
          labels: shortLabels,
          datasets: [{
            label: 'Actions today',
            data: sorted.map((c) => c.actions),
            backgroundColor: 'rgba(14,165,233,0.85)',
            borderRadius: 6,
            borderSkipped: false,
          }],
        },
        options: {
          indexAxis: 'y' as const,
          responsive: true,
          maintainAspectRatio: false,
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
                title: (items: any[]) => fullNames[items[0]?.dataIndex ?? 0] ?? '',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                afterLabel: (item: any) => {
                  const row = sorted[item.dataIndex];
                  return row ? `${row.activeUsers} active user${row.activeUsers !== 1 ? 's' : ''}` : '';
                },
              },
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: 'rgba(243,244,246,1)' },
              ticks: { color: '#9CA3AF', maxTicksLimit: 5 },
              border: { display: false },
            },
            y: {
              grid: { display: false },
              ticks: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                callback: (_v: unknown, i: number) => shortLabels[i] ?? '',
                color: '#374151',
                font: { weight: '500' },
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

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 flex flex-col h-full">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Centre Activity Today</h2>
        <p className="text-xs text-gray-400 mt-0.5">Top 8 by actions</p>
      </div>
      <div className="relative h-48 sm:h-64 md:h-[280px]">
        {loading && !data ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <canvas ref={canvasRef} aria-label="Centre activity chart for selected day" role="img" />
        )}
      </div>
    </div>
  );
}
