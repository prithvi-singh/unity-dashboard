'use client';

interface Props {
  availableDates: string[];
  selectedDate: string;
  onDateChange: (date: string) => void;
}

export default function DayPicker({ availableDates, selectedDate, onDateChange }: Props) {
  return (
    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
      <svg className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <label htmlFor="monitoring-date" className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
        Day
      </label>
      <select
        id="monitoring-date"
        value={selectedDate}
        onChange={(e) => onDateChange(e.target.value)}
        className="text-sm border-0 bg-transparent text-gray-800 font-medium focus:outline-none focus:ring-0 pr-6 cursor-pointer"
      >
        {availableDates.length === 0 ? (
          <option value={selectedDate}>{selectedDate}</option>
        ) : (
          availableDates.map((d) => (
            <option key={d} value={d}>
              {new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </option>
          ))
        )}
      </select>
    </div>
  );
}
