'use client';

import { useEffect, useRef } from 'react';
import type { BottleneckData } from '@/lib/types';
import type { OnBottleneckDrillDown } from '@/lib/bottleneckDrillDown';
import { formatWeekLabel, weekEndFromStart } from '@/lib/bottleneckDrillDown';

interface Props {
  data: BottleneckData | null;
  loading: boolean;
  onDrillDown?: OnBottleneckDrillDown;
}

const ONBOARDING_SLA = 24;
const GOAL_SLA = 48;

export default function BottleneckTrendChart({ data, loading, onDrillDown }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  const onDrillDownRef = useRef(onDrillDown);
  const trendRef = useRef(data?.weeklyTrend ?? []);
  onDrillDownRef.current = onDrillDown;
  trendRef.current = data?.weeklyTrend ?? [];

  useEffect(() => {
    if (!canvasRef.current || !data?.weeklyTrend?.length) return;

    let timerId: ReturnType<typeof setTimeout>;
    let attempts = 0;

    const tryCreate = () => {
      if (typeof window === 'undefined' || !window.Chart) {
        if (attempts < 40) { attempts++; timerId = setTimeout(tryCreate, 100); }
        return;
      }
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

      const trend = trendRef.current;
      const labels = trend.map((w) => formatWeekLabel(w.weekStart));

      const ctx = canvasRef.current!.getContext('2d');
      if (!ctx) return;

      chartRef.current = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Onboarding avg (h)',
              data: trend.map((w) => w.avgOnboardingHours),
              borderColor: '#0284C7',
              backgroundColor: 'rgba(2,132,199,0.12)',
              pointBackgroundColor: '#0284C7',
              pointRadius: 5,
              pointHoverRadius: 7,
              tension: 0.35,
              fill: true,
              spanGaps: true,
            },
            {
              label: 'Goal approval avg (h)',
              data: trend.map((w) => w.avgGoalApprovalHours),
              borderColor: '#7C3AED',
              backgroundColor: 'rgba(124,58,237,0.08)',
              pointBackgroundColor: '#7C3AED',
              pointRadius: 5,
              pointHoverRadius: 7,
              tension: 0.35,
              fill: true,
              spanGaps: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (_event: unknown, elements: any[]) => {
            if (!elements.length || !onDrillDownRef.current) return;
            const { datasetIndex, index } = elements[0];
            const week = trendRef.current[index];
            if (!week) return;

            const weekEnd = weekEndFromStart(week.weekStart);
            const isOnboarding = datasetIndex === 0;
            const count = isOnboarding ? week.onboardingCount : week.goalApprovalCount;
            if (count <= 0) return;

            onDrillDownRef.current({
              type: isOnboarding ? 'weekly-onboarding' : 'weekly-goal-approval',
              weekStart: week.weekStart,
              weekEnd,
              label: `${isOnboarding ? 'Onboarding' : 'Goal approval'} · week of ${formatWeekLabel(week.weekStart)}`,
            });
          },
          plugins: {
            legend: {
              position: 'top' as const,
              labels: {
                font: { size: 11, family: 'Plus Jakarta Sans, sans-serif', weight: '500' },
                color: '#6B7280',
                boxWidth: 8,
                usePointStyle: true,
                pointStyle: 'circle',
              },
            },
            tooltip: {
              backgroundColor: 'rgba(17,24,39,0.92)',
              titleColor: '#F9FAFB',
              bodyColor: '#D1D5DB',
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                afterBody: (items: any[]) => {
                  const idx = items[0]?.dataIndex ?? 0;
                  const week = trendRef.current[idx];
                  if (!week) return '';
                  const lines = [
                    `Onboarding: ${week.onboardingCount} cases`,
                    `Goal approvals: ${week.goalApprovalCount} cases`,
                  ];
                  if (onDrillDownRef.current) lines.push('Click a point to view cases');
                  return lines;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 11 }, color: '#9CA3AF' },
              border: { display: false },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(243,244,246,1)' },
              ticks: {
                font: { size: 11 },
                color: '#9CA3AF',
                callback: (v: unknown) => `${v}h`,
              },
              border: { display: false },
            },
          },
        },
        plugins: [{
          id: 'slaLines',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          afterDraw: (chart: any) => {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales.y) return;
            const drawLine = (value: number, color: string, label: string) => {
              const y = scales.y.getPixelForValue(value);
              if (y < chartArea.top || y > chartArea.bottom) return;
              ctx.save();
              ctx.strokeStyle = color;
              ctx.setLineDash([4, 4]);
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(chartArea.left, y);
              ctx.lineTo(chartArea.right, y);
              ctx.stroke();
              ctx.fillStyle = color;
              ctx.font = '10px Plus Jakarta Sans, sans-serif';
              ctx.fillText(label, chartArea.left + 4, y - 4);
              ctx.restore();
            };
            drawLine(ONBOARDING_SLA, 'rgba(2,132,199,0.5)', `${ONBOARDING_SLA}h onboarding SLA`);
            drawLine(GOAL_SLA, 'rgba(124,58,237,0.5)', `${GOAL_SLA}h goal SLA`);
          },
        }],
      });
    };

    tryCreate();
    return () => {
      clearTimeout(timerId);
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [data]);

  const hasTrend = (data?.weeklyTrend?.length ?? 0) > 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 flex flex-col">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Turnaround Trend</h2>
        <p className="text-xs text-gray-400 mt-0.5">Weekly avg hours · dashed = SLA · click to drill in</p>
      </div>
      <div className="relative flex-1" style={{ minHeight: 260 }}>
        {loading && !data ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !hasTrend ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <p className="text-sm text-gray-500">Not enough weekly data for the selected filters</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            aria-label="Weekly turnaround trend line chart"
            role="img"
            className={onDrillDown ? 'cursor-pointer' : undefined}
          />
        )}
      </div>
    </div>
  );
}
