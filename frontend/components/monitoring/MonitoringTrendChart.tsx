'use client';

import { useEffect, useRef } from 'react';
import type { MonitoringData } from '@/lib/types';
import { aggregateHeatmapByDate, lastNDays, localDateISO } from '@/lib/monitoringStats';

interface Props {
  data: MonitoringData | null;
  loading: boolean;
  selectedDate: string;
}

function formatLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function MonitoringTrendChart({ data, loading, selectedDate }: Props) {
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

      const days = lastNDays(14);
      const series = aggregateHeatmapByDate(data.heatmap, days);
      const labels = days.map(formatLabel);
      const today = localDateISO();

      const ctx = canvasRef.current!.getContext('2d');
      if (!ctx) return;

      chartRef.current = new window.Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Total actions',
            data: series.map((d) => d.count),
            backgroundColor: series.map((d) =>
              d.date === selectedDate
                ? 'rgba(124,58,237,0.9)'
                : d.date === today
                  ? 'rgba(14,165,233,0.75)'
                  : 'rgba(148,163,184,0.45)',
            ),
            borderRadius: 4,
            borderSkipped: false,
          }],
        },
        options: {
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
                title: (items: any[]) => series[items[0]?.dataIndex ?? 0]?.date ?? '',
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: '#9CA3AF', maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
              border: { display: false },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(243,244,246,1)' },
              ticks: { color: '#9CA3AF', maxTicksLimit: 5 },
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
  }, [data, selectedDate]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">14-Day Activity Trend</h2>
          <p className="text-xs text-gray-400 mt-0.5">Actions per day</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-violet-500" /> Selected day
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-sky-500" /> Today
          </span>
        </div>
      </div>
      <div className="relative" style={{ height: 200 }}>
        {loading && !data ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <canvas ref={canvasRef} aria-label="14 day activity trend chart" role="img" />
        )}
      </div>
    </div>
  );
}
