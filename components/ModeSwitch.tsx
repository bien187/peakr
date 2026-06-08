'use client';

import type { Mode } from '@ch-alpineroute/shared';

const OPTIONS: { value: Mode; label: string; icon: string }[] = [
  { value: 'ski', label: 'Ski', icon: '🎿' },
  { value: 'hike', label: 'Wandern', icon: '🥾' },
];

export function ModeSwitch({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Modus"
      className="inline-flex w-full rounded-xl bg-slate-800 p-1"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition ${
              active ? 'bg-sky-600 text-white shadow' : 'text-slate-300 hover:text-white'
            }`}
          >
            <span aria-hidden>{opt.icon}</span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
