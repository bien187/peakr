'use client';

import type { HikeKind, SacDifficulty } from '@ch-alpineroute/shared';
import { useState } from 'react';
import type { SearchParams } from '@/lib/searchParams';
import { LocationSearch } from './LocationSearch';
import { ModeSwitch } from './ModeSwitch';

const HIKE_KINDS: { value: HikeKind; label: string }[] = [
  { value: 'any', label: 'Alle' },
  { value: 'peak', label: 'Gipfel' },
  { value: 'lake', label: 'Bergsee' },
  { value: 'hut', label: 'Hütte' },
  { value: 'viewpoint', label: 'Aussichtspunkt' },
  { value: 'route', label: 'Route' },
];

const SAC: SacDifficulty[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

export function FilterPanel({
  params,
  onChange,
  onSearch,
  loading,
}: {
  params: SearchParams;
  onChange: (patch: Partial<SearchParams>) => void;
  onSearch: () => void;
  loading: boolean;
}) {
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const useMyLocation = () => {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('Geolocation wird vom Browser nicht unterstützt.');
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          origin: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          originLabel: '📍 Mein Standort',
        });
        setGeoLoading(false);
      },
      () => {
        setGeoLoading(false);
        setGeoError('Standort konnte nicht ermittelt werden (Berechtigung?).');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <ModeSwitch value={params.mode} onChange={(mode) => onChange({ mode })} />

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Startort
        </label>
        <LocationSearch
          label={params.originLabel}
          onSelect={(origin, originLabel) => onChange({ origin, originLabel })}
        />
        <button
          type="button"
          onClick={useMyLocation}
          disabled={geoLoading}
          className="mt-2 flex min-h-9 w-full items-center justify-center gap-1 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {geoLoading ? 'Standort wird ermittelt …' : '📍 Mein Standort verwenden'}
        </button>
        {geoError && <p className="mt-1 text-xs text-red-400">{geoError}</p>}
      </div>

      <div>
        <label className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span>Max. Fahrzeit</span>
          <span className="text-sky-400">{params.maxMinutes} min</span>
        </label>
        <input
          type="range"
          min={15}
          max={240}
          step={5}
          value={params.maxMinutes}
          onChange={(e) => onChange({ maxMinutes: Number(e.target.value) })}
          className="w-full accent-sky-500"
        />
      </div>

      <div>
        <label className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span>Toleranz (+X Min Vorschläge)</span>
          <span className="text-sky-400">+{params.toleranceMinutes} min</span>
        </label>
        <input
          type="range"
          min={0}
          max={60}
          step={5}
          value={params.toleranceMinutes}
          onChange={(e) => onChange({ toleranceMinutes: Number(e.target.value) })}
          className="w-full accent-sky-500"
        />
      </div>

      {params.mode === 'hike' && (
        <>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Wanderziel-Typ
            </label>
            <select
              value={params.hikeKind}
              onChange={(e) => onChange({ hikeKind: e.target.value as HikeKind })}
              className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
            >
              {HIKE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Max. SAC-Schwierigkeit
            </label>
            <select
              value={params.maxSacDifficulty}
              onChange={(e) => onChange({ maxSacDifficulty: e.target.value as SacDifficulty | '' })}
              className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm"
            >
              <option value="">egal</option>
              {SAC.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <button
        onClick={onSearch}
        disabled={loading || !params.origin}
        className="min-h-12 rounded-xl bg-sky-600 px-4 font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Suche läuft …' : !params.origin ? 'Startort wählen' : 'Ziele finden'}
      </button>
    </div>
  );
}
