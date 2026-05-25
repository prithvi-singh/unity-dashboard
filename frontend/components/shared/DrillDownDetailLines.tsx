'use client';

import { parseDrillDownDetail } from '@/lib/drillDownDisplay';

interface Props {
  detail: string | null;
}

export default function DrillDownDetailLines({ detail }: Props) {
  const lines = parseDrillDownDetail(detail);

  if (lines.length === 0) {
    return <span className="text-gray-300">—</span>;
  }

  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-0.5 my-0">
      {lines.map((line) => (
        <div key={`${line.label}-${line.value}`} className="inline-flex gap-1 text-xs leading-snug">
          <dt className="text-gray-400">{line.label}</dt>
          <dd className="text-gray-800 font-medium">{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}
