'use client';

import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

export interface KpiDefinition {
  title: string;
  description: string;
}

const TOOLTIP_WIDTH = 280;
const TOOLTIP_H_EST = 130;
const GAP = 8;

function computePosition(triggerEl: HTMLElement): { top: number; left: number } {
  const rect = triggerEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spaceBelow = vh - rect.bottom - GAP;
  const spaceAbove = rect.top - GAP;
  const top =
    spaceBelow >= TOOLTIP_H_EST || spaceBelow >= spaceAbove
      ? rect.bottom + GAP
      : rect.top - TOOLTIP_H_EST - GAP;

  const centerLeft = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
  const left = Math.max(8, Math.min(centerLeft, vw - TOOLTIP_WIDTH - 8));

  return { top, left };
}

function InfoCircleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7" cy="4.5" r="0.8" fill="currentColor" />
      <line x1="7" y1="6.75" x2="7" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function KpiTooltip({ title, description }: KpiDefinition) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = useId();
  const tooltipId = `kpi-tip-${uid.replace(/:/g, '')}`;

  const open = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (triggerRef.current) setPos(computePosition(triggerRef.current));
    setVisible(true);
  }, []);

  const scheduleClose = useCallback(() => {
    hideTimer.current = setTimeout(() => setVisible(false), 90);
  }, []);

  const cancelClose = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const toggle = useCallback(() => {
    setVisible((prev) => {
      if (!prev && triggerRef.current) setPos(computePosition(triggerRef.current));
      return !prev;
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        tooltipRef.current?.contains(e.target as Node)
      ) return;
      setVisible(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [visible]);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`About: ${title}`}
        aria-describedby={visible ? tooltipId : undefined}
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        onFocus={open}
        onBlur={scheduleClose}
        onClick={toggle}
        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] -m-2 p-2 rounded-full text-gray-400 hover:text-gray-600 transition-colors duration-100 ml-0.5 flex-shrink-0 cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        tabIndex={0}
      >
        <InfoCircleIcon />
      </button>

      {visible && typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: TOOLTIP_WIDTH,
              zIndex: 9999,
              animation: 'kpiTooltipFadeIn 0.13s ease-out both',
            }}
          >
            <div className="bg-white rounded-xl border border-gray-100 shadow-[0_8px_32px_rgba(0,0,0,0.11),0_2px_8px_rgba(0,0,0,0.06)] p-4 text-left">
              <p className="text-[11px] font-bold text-gray-800 mb-1.5 leading-snug">{title}</p>
              <p className="text-[11.5px] text-gray-500 leading-relaxed">{description}</p>
            </div>
          </div>,
          document.body,
        )
      }
    </>
  );
}
