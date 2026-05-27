'use client';

import { useEffect, useRef } from 'react';
import type { UserProfileTrendPoint } from '@/lib/types';

interface Props {
  trend: UserProfileTrendPoint[];
  loading: boolean;
}

export default function UserTrendChart({ trend, loading }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current || loading || trend.length === 0) return;

    let timerId: ReturnType<typeof setTimeout>;
    let attempts = 0;

    const tryCreate = () => {
      if (typeof window === 'undefined' || !window.Chart) {
        if (attempts < 40) { attempts++; timerId = setTimeout(tryCreate, 100); }
        return;
      }
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

      const ctx = canvasRef.current!.getContext('2d');
      if (!ctx) return;

      chartRef.current = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels: trend.map((t) => {
            const d = new Date(`${t.date}T00:00`);
            return d.toLocaleDateString('en', { day: 'numeric', month: 'short' });
          }),
          datasets: [{
            label: 'Actions',
            data: trend.map((t) => t.count),
            borderColor: 'rgba(59,130,246,0.9)',
            backgroundColor: 'rgba(59,130,246,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: trend.length <= 14 ? 3 : 0,
            pointHoverRadius: 4,
            borderWidth: 2,
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
              borderColor: 'rgba(255,255,255,0.08)',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 8,
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 10 }, color: '#9CA3AF', maxRotation: 0 },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(0,0,0,0.04)' },
              ticks: { font: { size: 10 }, color: '#9CA3AF', precision: 0 },
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
  }, [trend, loading]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-[14px] font-medium text-gray-900">Activity Trend</h2>
        <p className="text-[12px] text-gray-500 mt-0.5">Daily audit log actions</p>
      </div>
      <div className="p-4 h-52">
        {loading ? (
          <div className="h-full bg-gray-50 rounded-xl animate-pulse" />
        ) : trend.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            No activity in the selected period
          </div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
    </div>
  );
}
