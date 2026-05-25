'use client';

import { useEffect } from 'react';
import type { ActionNavigationTarget } from '@/lib/actionNavigation';
import type { BottleneckDrillDownRequest } from '@/lib/bottleneckDrillDown';
import type { RoleDrillDownRequest } from '@/lib/roleDrillDown';
import type { BottleneckActionSortCol } from '@/lib/actionNavigation';

const PULSE_MS = 3_600;
const DRILL_DOWN_DELAY_MS = 650;
const MOUNT_DELAY_MS = 180;

interface Options {
  pending: ActionNavigationTarget | null;
  activeTab: number;
  onClear: () => void;
  onBottleneckDrillDown?: (req: BottleneckDrillDownRequest) => void;
  onRoleDrillDown?: (req: RoleDrillDownRequest) => void;
  onBottleneckSort?: (col: BottleneckActionSortCol) => void;
}

export function useActionFocus({
  pending,
  activeTab,
  onClear,
  onBottleneckDrillDown,
  onRoleDrillDown,
  onBottleneckSort,
}: Options) {
  useEffect(() => {
    if (!pending || activeTab !== pending.tab) return;

    const mountTimer = window.setTimeout(() => {
      if (pending.bottleneckSort) {
        onBottleneckSort?.(pending.bottleneckSort);
      }

      const el = document.querySelector(`[data-focus-target="${pending.focusId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('focus-pulse');
        window.setTimeout(() => el.classList.remove('focus-pulse'), PULSE_MS);
      }

      window.setTimeout(() => {
        if (pending.bottleneckDrillDown) {
          onBottleneckDrillDown?.(pending.bottleneckDrillDown);
        }
        if (pending.roleDrillDown) {
          onRoleDrillDown?.(pending.roleDrillDown);
        }
        onClear();
      }, DRILL_DOWN_DELAY_MS);
    }, MOUNT_DELAY_MS);

    return () => window.clearTimeout(mountTimer);
  }, [
    pending,
    activeTab,
    onClear,
    onBottleneckDrillDown,
    onRoleDrillDown,
    onBottleneckSort,
  ]);
}
