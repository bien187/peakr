'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { DIRECTIONS, useTheme } from '@/lib/theme';

/**
 * Theme-Steuerung fürs Produkt (ersetzt das Prototyp-Tweaks-Panel):
 * Dark-Mode-Schalter + Auswahl der Design-Richtung. Gehört in den Header.
 */
export function ThemeMenu() {
  const { direction, dark, setDirection, toggleDark } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggleDark}
        className="grid h-10 w-10 place-items-center rounded-[10px] text-ink-2 transition hover:bg-surface-2 hover:text-ink"
        title={dark ? 'Helles Design' : 'Dunkles Design'}
        aria-label="Hell/Dunkel umschalten"
      >
        <Icon name={dark ? 'Sun' : 'Moon'} size={18} stroke={2} />
      </button>

      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid h-10 w-10 place-items-center rounded-[10px] text-ink-2 transition hover:bg-surface-2 hover:text-ink"
          title="Design-Richtung"
          aria-label="Design-Richtung wählen"
        >
          <Icon name="Palette" size={18} stroke={2} />
        </button>

        {open && (
          <div className="absolute right-0 top-[calc(100%+10px)] z-50 min-w-[230px] rounded-xl border border-line bg-surface p-1.5 shadow-pk">
            <p className="px-2.5 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
              Design-Richtung
            </p>
            {DIRECTIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => {
                  setDirection(d.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-2 ${
                  direction === d.value ? 'text-accent-2' : 'text-ink'
                }`}
              >
                <span
                  className="h-4 w-4 flex-none rounded-full border border-line-2"
                  style={{ background: `oklch(0.62 0.13 ${hueFor(d.value)})` }}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{d.label}</span>
                  <span className="block text-[11px] text-ink-3">{d.sub}</span>
                </span>
                {direction === d.value && (
                  <Icon name="Check" size={16} stroke={2.5} className="ml-auto text-accent" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function hueFor(d: string): number {
  return d === 'paper' ? 42 : d === 'glacier' ? 236 : 158;
}
