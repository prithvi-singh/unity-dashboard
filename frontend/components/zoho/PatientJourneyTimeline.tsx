
'use client';

// PatientJourneyTimeline — vertical timeline of Zoho + Unity events.
// Used inside PatientZohoDrawer as a collapsible "Full Journey" section.
// Design system state colours: Green #1D9E75, Amber #BA7517, Red #A32D2D, Grey #888780.

import type { JourneyEvent } from '@/lib/zoho/funnel';

interface Props {
  timeline: JourneyEvent[];
}

function dotColour(event: JourneyEvent): string {
  if (event.source === 'zoho') return '#888780';

  // Unity events — colour by event type
  const label = event.label.toLowerCase();
  if (label.includes('report') || label.includes('goal')) return '#1D9E75';
  if (label.includes('assessment')) return '#1D9E75';
  if (label.includes('register')) return '#1D9E75';
  if (label.includes('completed')) return '#1D9E75';
  // Gap/not-started events
  if (label.includes('gap') || label.includes('not started') || label.includes('pending')) return '#BA7517';
  return '#1D9E75';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function PatientJourneyTimeline({ timeline }: Props) {
  if (timeline.length === 0) {
    return (
      <p className="text-[12px] text-gray-400 text-center py-4">
        No journey events recorded.
      </p>
    );
  }

  return (
    <div className="relative pl-6">
      {/* Vertical line */}
      <div
        className="absolute left-[7px] top-1.5 bottom-1.5 w-px"
        style={{ backgroundColor: '#E5E7EB' }}
      />

      <div className="space-y-4">
        {timeline.map((event, i) => {
          const colour = dotColour(event);
          return (
            <div key={`${event.date}-${event.label}-${i}`} className="relative">
              {/* Dot */}
              <div
                className="absolute left-[-19px] top-[5px] w-[13px] h-[13px] rounded-full border-2 border-white"
                style={{ backgroundColor: colour }}
              />

              {/* Content */}
              <div>
                <p className="text-[11px] text-gray-400 mb-0.5">{formatDate(event.date)}</p>
                <p className="text-[13px] font-medium text-gray-800 leading-snug">
                  {event.label}
                </p>
                {event.detail && (
                  <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">
                    {event.detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
