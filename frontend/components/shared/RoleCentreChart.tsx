'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { RoleCentreRow, OnRoleDrillDown, RoleDrillDownType } from '@/lib/roleDrillDown';
import { shortCentreName } from '@/lib/centreNames';
import { roleCentreChartKey } from '@/lib/chartKeys';

interface DatasetConfig {
  label: string;
  color: string;
  metricKey: 'metric1' | 'metric2' | 'metric3';
  drillType: RoleDrillDownType;
}

interface Props {
  title: string;
  subtitle: string;
  rows: RoleCentreRow[];
  datasets: DatasetConfig[];
  loading?: boolean;
  onDrillDown?: OnRoleDrillDown;
}

export default function RoleCentreChart({
  title, subtitle, rows, datasets, loading, onDrillDown,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  const onDrillDownRef = useRef(onDrillDown);
  onDrillDownRef.current = onDrillDown;

  const chartKey = useMemo(
    () => roleCentreChartKey(rows, datasets),
    [rows, datasets],
  );
  const rowsRef = useRef(rows);
  const datasetsRef = useRef(datasets);
  rowsRef.current = rows;
  datasetsRef.current = datasets;

  useEffect(() => {
    const currentRows = rowsRef.current;
    const currentDatasets = datasetsRef.current;
    if (!canvasRef.current || currentRows.length === 0) return;

    let timerId: ReturnType<typeof setTimeout>;
    let attempts = 0;

    const tryCreate = () => {
      if (typeof window === 'undefined' || !window.Chart) {
        if (attempts < 40) { attempts++; timerId = setTimeout(tryCreate, 100); }
        return;
      }
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

      const sorted = [...currentRows]
        .map((c) => ({
          ...c,
          total: c.metric1 + c.metric2 + c.metric3,
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
          datasets: currentDatasets.map((ds) => ({
            label: ds.label,
            data: sorted.map((c) => c[ds.metricKey]),
            backgroundColor: ds.color,
            borderRadius: 3,
            borderSkipped: false,
          })),
        },
        options: {
          indexAxis: 'y' as const,
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          onClick: (_event, elements) => {
            if (!elements.length || !onDrillDownRef.current) return;
            const { datasetIndex, index } = elements[0];
            const centre = sorted[index];
            const ds = currentDatasets[datasetIndex];
            const count = centre[ds.metricKey];
            if (count <= 0) return;
            onDrillDownRef.current({
              type: ds.drillType,
              drillCentreId: centre.centreId,
              label: `${ds.label} · ${centre.centreName}`,
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
              padding: 10,
              cornerRadius: 8,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              title: (items: any[]) => fullNames[items[0]?.dataIndex ?? 0] ?? '',
            },
          },
          scales: {
            x: {
              stacked: true,
              beginAtZero: true,
              grid: { color: 'rgba(243,244,246,1)' },
              ticks: { color: '#9CA3AF', maxTicksLimit: 5 },
              border: { display: false },
            },
            y: {
              stacked: true,
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
  }, [chartKey]);

  const cardClass = 'bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5';

  if (loading) {
    return (
      <div className={cardClass}>
        <div className="h-[280px] flex items-center justify-center">
          <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cardClass}>
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="h-40 flex items-center justify-center text-sm text-gray-400">
          No centre data for the selected filters
        </div>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{subtitle} · click to drill in</p>
      </div>
      <div className="h-[280px]">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
