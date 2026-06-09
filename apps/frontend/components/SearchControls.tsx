'use client';

import { useRef, useState } from 'react';
import type { GeocodeResult, LatLng } from '@ch-alpineroute/shared';
import { Icon } from './Icon';
import { Popover } from './PeakrChrome';
import { api } from '@/lib/api';
import { HIKE_KINDS, SAC } from '@/lib/peakr';

export interface PParams {
  origin: LatLng | null;
  originLabel: string;
  mode: 'ski' | 'hike';
  maxMin: number;
  tolMin: number;
  hikeKind: string;
  maxSac: string;
}

export function SearchControls({
  params,
  set,
  onLocate,
  locating,
}: {
  params: PParams;
  set: (patch: Partial<PParams>) => void;
  onLocate: () => void;
  locating: boolean;
}) {
  const [openOrigin, setOpenOrigin] = useState(false);
  const [openAdjust, setOpenAdjust] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onQuery = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.geocode(text);
        setResults(r.results);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const pick = (loc: LatLng, label: string) => {
    set({ origin: loc, originLabel: label });
    setOpenOrigin(false);
    setQ('');
    setResults([]);
  };

  return (
    <div className="capsule">
      {/* origin */}
      <div className="cap-cell origin-cell" style={{ position: 'relative' }}>
        <Icon name="MapPin" size={16} stroke={2} className="cap-ico" />
        <button type="button" className="cap-btn" onClick={() => setOpenOrigin((v) => !v)}>
          <span className="cap-key">Start</span>
          <span className="cap-val">{params.originLabel || 'wählen'}</span>
        </button>
        <Popover open={openOrigin} onClose={() => setOpenOrigin(false)}>
          <p className="pop-title">Startort</p>
          <label className="field" style={{ marginBottom: 8 }}>
            <input
              className="input"
              value={q}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Ort suchen (z. B. Bern, Zürich HB) …"
              aria-label="Ort suchen"
            />
          </label>
          {searching && <p className="twk-hint">Suche …</p>}
          {results.length > 0 && (
            <div className="pop-list">
              {results.map((r, i) => (
                <button
                  key={`${r.label}-${i}`}
                  type="button"
                  className="pop-item"
                  onClick={() => pick({ lat: r.lat, lng: r.lng }, r.label)}
                >
                  <Icon name="MapPin" size={13} stroke={2} />
                  <span>
                    {r.label}
                    {r.canton ? ` · ${r.canton}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {!searching && results.length === 0 && q.trim().length < 2 && (
            <p className="twk-hint">Tippe einen Ort ein – oder nutze deinen Standort.</p>
          )}
          {!searching && results.length === 0 && q.trim().length >= 2 && (
            <p className="twk-hint">Kein Ort gefunden.</p>
          )}
          <button
            type="button"
            className="pop-locate"
            disabled={locating}
            onClick={() => {
              onLocate();
              setOpenOrigin(false);
            }}
          >
            <Icon name="LocateFixed" size={15} stroke={2} />
            {locating ? 'Wird ermittelt …' : 'Mein Standort'}
          </button>
        </Popover>
      </div>

      <span className="cap-div" />

      {/* mode */}
      <div className="cap-cell">
        <div className="seg seg-mode">
          {(
            [
              ['ski', 'Ski', 'Snowflake'],
              ['hike', 'Wandern', 'Footprints'],
            ] as const
          ).map(([v, l, ic]) => (
            <button
              key={v}
              type="button"
              className={'seg-btn' + (params.mode === v ? ' is-on' : '')}
              onClick={() => set({ mode: v })}
            >
              <Icon name={ic} size={15} stroke={2} /> {l}
            </button>
          ))}
        </div>
      </div>

      <span className="cap-div" />

      {/* drive time + advanced */}
      <div className="cap-cell" style={{ position: 'relative' }}>
        <button type="button" className="cap-btn" onClick={() => setOpenAdjust((v) => !v)}>
          <span className="cap-key">Fahrzeit</span>
          <span className="cap-val mono">≤ {params.maxMin} min</span>
        </button>
        <Icon name="SlidersHorizontal" size={15} stroke={2} className="cap-ico cap-ico-r" />
        <Popover open={openAdjust} onClose={() => setOpenAdjust(false)} align="right">
          <p className="pop-title">Filter</p>
          <div className="pop-slider">
            <div className="pop-slider-lbl">
              <span>Max. Fahrzeit</span>
              <span className="mono">{params.maxMin} min</span>
            </div>
            <input
              type="range"
              min={15}
              max={240}
              step={5}
              value={params.maxMin}
              onChange={(e) => set({ maxMin: +e.target.value })}
              className="range"
            />
          </div>
          <div className="pop-slider">
            <div className="pop-slider-lbl">
              <span>Toleranz · Vorschläge</span>
              <span className="mono">+{params.tolMin} min</span>
            </div>
            <input
              type="range"
              min={0}
              max={60}
              step={5}
              value={params.tolMin}
              onChange={(e) => set({ tolMin: +e.target.value })}
              className="range"
            />
          </div>
          {params.mode === 'hike' && (
            <>
              <div className="pop-field">
                <span className="field-label">Zieltyp</span>
                <div className="chip-row">
                  {HIKE_KINDS.map((k) => (
                    <button
                      key={k.value}
                      type="button"
                      className={'chip' + (params.hikeKind === k.value ? ' is-on' : '')}
                      onClick={() => set({ hikeKind: k.value })}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pop-field">
                <span className="field-label">Max. SAC-Schwierigkeit</span>
                <div className="chip-row">
                  <button
                    type="button"
                    className={'chip' + (!params.maxSac ? ' is-on' : '')}
                    onClick={() => set({ maxSac: '' })}
                  >
                    egal
                  </button>
                  {SAC.map((sac) => (
                    <button
                      key={sac}
                      type="button"
                      className={'chip' + (params.maxSac === sac ? ' is-on' : '')}
                      onClick={() => set({ maxSac: sac })}
                    >
                      {sac}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}
