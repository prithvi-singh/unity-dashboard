'use client';

type SortDir = 'asc' | 'desc';

interface Props {
  col: string;
  label: string;
  sortCol: string;
  sortDir: SortDir;
  onSort: (col: string, defaultDir: SortDir) => void;
  defaultDir?: SortDir;
  align?: 'left' | 'right';
  className?: string;
  title?: string;
}

export default function SortableTh({
  col,
  label,
  sortCol,
  sortDir,
  onSort,
  defaultDir = 'desc',
  align = 'left',
  className = '',
  title,
}: Props) {
  const active = sortCol === col;
  const alignClass = align === 'right' ? 'text-right' : 'text-left';

  return (
    <th
      scope="col"
      className={[
        'px-3 py-[10px]',
        alignClass,
        active ? 'text-gray-900' : 'text-gray-500',
        className,
      ].join(' ')}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(col, defaultDir)}
        className={[
          'inline-flex items-center gap-0.5 w-full',
          align === 'right' ? 'justify-end' : 'justify-start',
          'text-[11px] font-medium uppercase tracking-[0.03em]',
          active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700',
          'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded',
        ].join(' ')}
      >
        {label}
        {title && (
          <span
            title={title}
            aria-label={title}
            className="text-[9px] text-gray-400 hover:text-gray-600 cursor-help font-normal normal-case tracking-normal"
          >
            ⓘ
          </span>
        )}
        {active && (
          <span className="text-[10px] text-gray-600">{sortDir === 'asc' ? '↑' : '↓'}</span>
        )}
      </button>
    </th>
  );
}
