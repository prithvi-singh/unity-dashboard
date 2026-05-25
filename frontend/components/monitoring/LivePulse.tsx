'use client';

import { useEffect, useState } from 'react';

const FRESH_MS = 5 * 60 * 1000;

interface Props {
  lastUpdated: Date | null;
  onRefresh: () => void;
  loading?: boolean;
}

function formatAgo(date: Date, now: Date): string {
  const sec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? '1 min ago' : `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? '1 hr ago' : `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export default function LivePulse({ lastUpdated, onRefresh, loading = false }: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const ageMs = lastUpdated ? now.getTime() - lastUpdated.getTime() : null;
  const isFresh = ageMs !== null && ageMs < FRESH_MS;
  const ago = lastUpdated ? formatAgo(lastUpdated, now) : null;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        {isFresh ? (
          <>
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <span className="text-xs text-gray-600">
              Updated <span className="font-medium text-gray-800">{ago}</span>
            </span>
          </>
        ) : (
          <>
            <span className="inline-flex rounded-full h-2.5 w-2.5 bg-gray-300" aria-hidden="true" />
            <span className="text-xs text-gray-500">
              Refreshed{' '}
              <span className="font-medium text-gray-700">{ago ?? '—'}</span>
            </span>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        aria-label="Refresh monitoring data"
        className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 active:bg-gray-200 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none"
      >
        <svg
          className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
    </div>
  );
}
