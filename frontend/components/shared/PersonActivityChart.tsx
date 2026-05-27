'use client';

import { useEffect, useMemo, useRef } from 'react';
import { personChartKey } from '@/lib/chartKeys';

export interface PersonChartSegment {
  label: string;
  value: number;
  backgroundColor: string;
}

export interface PersonChartRow {
  shortLabel: string;
  fullLabel: string;
  segments: PersonChartSegment[];
}

interface Props {
  title: string;
  subtitle: string;
  rows: PersonChartRow[];
  loading: boolean;
  emptyMessage?: string;
  minHeight?: number;
}

export default function PersonActivityChart({
  title,
  subtitle,
  rows,
  loading,
  emptyMessage = 'No data for the selected filters',
  minHeight = 300,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  const sorted = useMemo(() => {
    const total = (r: PersonChartRow) => r.segments.reduce((s, seg) => s + seg.value, 0);
    return [...rows]
      .sort((a, b) => total(b) - total(a) || a.fullLabel.localeCompare(b.fullLabel))
      .slice(0, 8);
  }, [rows]);

  const chartKey = useMemo(() => personChartKey(rows), [rows]);
  const sortedRef = useRef(sorted);
  sortedRef.current = sorted;

  useEffect(() => {
    const currentSorted = sortedRef.current;
    if (!canvasRef.current || currentSorted.length === 0) return;

    let timerId: ReturnType<typeof setTimeout>;
    let attempts = 0;

    const tryCreate = () => {
      if (typeof window === 'undefined' || !window.Chart) {
        if (attempts < 40) { attempts++; timerId = setTimeout(tryCreate, 100); }
        return;
      }
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

      const shortLabels = currentSorted.map((r) => r.shortLabel);
      const fullLabels  = currentSorted.map((r) => r.fullLabel);
      const segmentLabels = currentSorted[0]?.segments.map((s) => s.label) ?? [];

      const datasets = segmentLabels.map((segLabel, segIdx) => ({
        label: segLabel,
        data: currentSorted.map((r) => r.segments[segIdx]?.value ?? 0),
        backgroundColor: currentSorted[0]?.segments[segIdx]?.backgroundColor ?? '#94A3B8',
        borderRadius: 3,
        borderSkipped: false,
      }));

      const ctx = canvasRef.current!.getContext('2d');
      if (!ctx) return;

      chartRef.current = new window.Chart(ctx, {
        type: 'bar',
        data: { labels: shortLabels, datasets },
        options: {
          indexAxis: 'y' as const,
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
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
                  return fullLabels[i] ?? items[0]?.label ?? '';
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              beginAtZero: true,
              grid: { color: 'rgba(243,244,246,1)' },
              ticks: { font: { size: 11 }, color: '#9CA3AF', maxTicksLimit: 6 },
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
    return () => { clearTimeout(timerId); if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [chartKey]);

  const cardClass = 'bg-white rounded-xl border border-gray-200 p-5 flex flex-col';

  if (loading) {
    return (
      <div className={cardClass}>
        <div style={{ minHeight }} className="flex items-center justify-center">
          <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cardClass}>
        <div className="mb-4">
          <h2 className="text-[14px] font-medium text-gray-900">{title}</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        <div style={{ minHeight: minHeight - 60 }} className="flex items-center justify-center text-sm text-gray-400">
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <div className="mb-4">
        <h2 className="text-[14px] font-medium text-gray-900">{title}</h2>
        <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="relative flex-1" style={{ minHeight }}>
        <canvas ref={canvasRef} aria-label={title} role="img" />
      </div>
    </div>
  );
}
