'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { defaultDashboardPeriod } from '@/lib/datePresets';
import { tabIndexFromSlug, tabSlugFromIndex } from '@/lib/dashboardTabs';

export interface DashboardUrlState {
  activeTab: number;
  centreId: number | undefined;
  dateFrom: string;
  dateTo: string;
}

function parseCentreId(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function readDashboardStateFromUrl(
  searchParams: Pick<URLSearchParams, 'get'>,
): DashboardUrlState {
  const tab = tabIndexFromSlug(searchParams.get('tab'));
  const centreId = parseCentreId(searchParams.get('centre'));
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (from || to) {
    return {
      activeTab: tab,
      centreId,
      dateFrom: from ?? '',
      dateTo: to ?? '',
    };
  }

  const defaults = defaultDashboardPeriod();
  return {
    activeTab: tab,
    centreId,
    dateFrom: defaults.from,
    dateTo: defaults.to,
  };
}

/** Keep ?tab=&centre=&from=&to= in sync for shareable views. */
export function useDashboardUrl(state: DashboardUrlState) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const skipFirst = useRef(true);

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }

    const params = new URLSearchParams();
    params.set('tab', tabSlugFromIndex(state.activeTab));
    if (state.centreId != null) params.set('centre', String(state.centreId));
    if (state.dateFrom) params.set('from', state.dateFrom);
    if (state.dateTo) params.set('to', state.dateTo);

    const next = params.toString();
    router.replace(`${pathname}?${next}`, { scroll: false });
  }, [state.activeTab, state.centreId, state.dateFrom, state.dateTo, pathname, router]);
}
