'use client';

import type { MonitoringUser, HeatmapEntry } from '@/lib/types';
import { dedupeMonitoringUsers, lastNDays, topUsersByHeatmap } from '@/lib/monitoringStats';

interface Props {
  users: MonitoringUser[];
  heatmap: HeatmapEntry[];
}

const TOP_N = 12;

function cellBg(count: number): string {
  if (count === 0) return 'bg-gray-50 text-gray-300';
  if (count <= 3) return 'bg-sky-100 text-sky-800';
  if (count <= 8) return 'bg-sky-400 text-white';
  return 'bg-violet-600 text-white';
}

function mmdd(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function mmddShort(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric' });
}

export default function ActivityHeatmap({ users, heatmap }: Props) {
  const dates = lastNDays(14);

  const lookup: Record<number, Record<string, number>> = {};
  for (const entry of heatmap) {
    lookup[entry.userId] = {};
    for (const day of entry.days) {
      lookup[entry.userId][day.date] = day.count;
    }
  }

  const topUsers = topUsersByHeatmap(users, heatmap, TOP_N);
  const totalUsers = dedupeMonitoringUsers(users).length;
  void totalUsers;

  if (topUsers.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-8 text-center text-sm text-gray-400">
        No heatmap data available
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Top Performers</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Top {TOP_N} by actions · 14 days
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <span className="px-2 py-0.5 rounded bg-gray-50">Less</span>
          <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-gray-50" />
          <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-sky-100" />
          <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-sky-400" />
          <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-violet-600" />
          <span className="px-2 py-0.5 rounded bg-gray-50">More</span>
        </div>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="text-xs border-separate border-spacing-0.5 p-2 sm:p-3" style={{ minWidth: 'max-content' }} aria-label="Top user activity heatmap">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white pr-2 sm:pr-3 pb-1 text-left font-bold text-[10px] text-gray-400 uppercase tracking-[0.08em] min-w-[100px] sm:min-w-[140px]">
                User
              </th>
              {dates.map((d) => (
                <th key={d} className="text-center font-normal text-gray-400 pb-1 min-w-[1.25rem] sm:min-w-[2.25rem]" title={d}>
                  <span className="hidden sm:inline">{mmdd(d)}</span>
                  <span className="sm:hidden text-[9px]">{mmddShort(d)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topUsers.map((user) => {
              const userCounts = lookup[user.id] ?? {};
              return (
                <tr key={user.id}>
                  <td className="sticky left-0 z-10 bg-white pr-2 sm:pr-3 py-0.5 text-gray-700 font-medium whitespace-nowrap">
                    <span
                      className="block max-w-[100px] sm:max-w-[130px] truncate"
                      title={`${user.firstName} ${user.lastName}`}
                    >
                      {user.firstName} {user.lastName}
                    </span>
                  </td>
                  {dates.map((d) => {
                    const count = userCounts[d] ?? 0;
                    return (
                      <td
                        key={d}
                        title={`${user.firstName} ${user.lastName} · ${d} · ${count} actions`}
                        className={`w-5 h-4 sm:w-9 sm:h-7 text-center rounded align-middle font-medium tabular-nums text-[9px] sm:text-xs ${cellBg(count)}`}
                      >
                        <span className="hidden sm:inline">{count > 0 ? count : ''}</span>
                        <span className="sm:hidden">{count > 0 ? (count > 9 ? '+' : count) : ''}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
