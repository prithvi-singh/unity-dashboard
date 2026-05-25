'use client';

import { useEffect, useRef, useMemo } from 'react';
import type { UserProfileActionBreakdown } from '@/lib/types';
import { labelAuditEvent } from '@/lib/auditEventLabels';

const COLORS = [
  'rgba(59,130,246,0.85)',
  'rgba(124,58,237,0.8)',
  'rgba(5,150,105,0.78)',
  'rgba(245,158,11,0.85)',
  'rgba(239,68,68,0.8)',
  'rgba(107,114,128,0.75)',
];

interface Props {
  breakdown: UserProfileActionBreakdown[];
  loading: boolean;
}

export default function UserActionBreakdown({ breakdown, loading }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  const top = useMemo(() => breakdown.slice(0, 8), [breakdown]);

  useEffect(() => {
    if (!canvasRef.current || loading || top.length === 0) return;

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
        type: 'doughnut',
        data: {
          labels: top.map((b) => labelAuditEvent(b.type)),
          datasets: [{
            data: top.map((b) => b.count),
            backgroundColor: top.map((_, i) => COLORS[i % COLORS.length]),
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: {
              position: 'right' as const,
              labels: {
                font: { size: 10 },
                color: '#6B7280',
                boxWidth: 8,
                padding: 8,
              },
            },
            tooltip: {
              backgroundColor: 'rgba(17,24,39,0.92)',
              padding: 10,
              cornerRadius: 8,
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
  }, [top, loading]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Action Breakdown</h2>
        <p className="text-xs text-gray-400 mt-0.5">By audit log type</p>
      </div>
      <div className="p-4 h-52">
        {loading ? (
          <div className="h-full bg-gray-50 rounded-xl animate-pulse" />
        ) : top.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            No actions in the selected period
          </div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
    </div>
  );
}
