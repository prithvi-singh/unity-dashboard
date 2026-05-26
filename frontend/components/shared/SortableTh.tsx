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

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 text-[10px] ${active ? 'text-gray-600' : 'text-gray-400'}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '⇅'}
    </span>
  );
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
    <th scope="col" className={`px-5 py-3 ${alignClass} ${className}`} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(col, defaultDir)}
        className={`inline-flex items-center w-full ${align === 'right' ? 'justify-end' : 'justify-start'} text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em] hover:text-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded`}
      >
        {label}
        {title && (
          <span
            title={title}
            aria-label={title}
            className="ml-0.5 text-[9px] text-gray-400 hover:text-gray-600 cursor-help font-normal normal-case tracking-normal"
          >
            ⓘ
          </span>
        )}
        <SortIcon active={active} dir={sortDir} />
      </button>
    </th>
  );
}
