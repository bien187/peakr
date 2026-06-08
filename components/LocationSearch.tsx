'use client';

import type { GeocodeResult, LatLng } from '@ch-alpineroute/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export function LocationSearch({
  label,
  onSelect,
}: {
  label: string;
  onSelect: (loc: LatLng, label: string) => void;
}) {
  const [q, setQ] = useState(label);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setQ(label), [label]);

  const handleChange = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.geocode(text);
        setResults(r.results);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const pick = (r: GeocodeResult) => {
    onSelect({ lat: r.lat, lng: r.lng }, r.label);
    setQ(r.label);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Startort (z.B. Bern, Zürich HB) …"
        className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm outline-none focus:border-sky-500"
        aria-label="Startort suchen"
      />
      {loading && <span className="absolute right-3 top-3 text-xs text-slate-500">…</span>}
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {results.map((r, i) => (
            <li key={`${r.label}-${i}`}>
              <button
                onClick={() => pick(r)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-800"
              >
                {r.label}
                {r.canton ? <span className="ml-1 text-slate-500">({r.canton})</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
