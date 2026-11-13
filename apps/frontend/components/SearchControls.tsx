'use client';

import { useRef, useState } from 'react';
import type { GeocodeResult, HikeKind, LatLng, SacDifficulty } from '@ch-alpineroute/shared';
import { Icon } from './Icon';
import { Popover } from './PeakrChrome';
import { api } from '@/lib/api';
import { fmtDuration, HIKE_KINDS, KIND_META, SAC, SAC_HINT } from '@/lib/peakr';

export interface PParams {
  origin: LatLng | null;
  originLabel: string;
  mode: 'ski' | 'hike';
  maxMin: number;
  tolMin: number;
  /** Zielarten; leer = alle. */
  kinds: HikeKind[];
  maxSac: SacDifficulty | '';
  /** Routen unbekannter Schwierigkeit trotz SAC-Filter als Treffer zählen. */
  includeUnknownSac: boolean;
  /** Maximale Gehzeit (Aufstieg) in Minuten; null = egal. */
  maxHikeMin: number | null;
  /** Auch Ziele ohne bekannte Wanderroute auflisten. */
  includeUnrouted: boolean;
  /** Mindesthöhe in m ü. M.; null = egal. */
  minElev: number | null;
  /** Mindestschneehöhe am Berg in cm (Ski); null = egal. */
  minSnow: number | null;
  /** Planungstag relativ zu heute (0–2); null = automatisch (heute bzw. ab 14 Uhr morgen). */
  planDay: number | null;
  /** Startstunde der Tour (Wandern). */
  planStart: number;
  /** Ziele mit unsicherer Verfügbarkeit zeigen; nicht verfügbare bleiben ausgeblendet. */
  includeUncertain: boolean;
}

const PLAN_DAYS: { value: number | null; label: string }[] = [
  { value: null, label: 'Automatisch' },
  { value: 0, label: 'Heute' },
  { value: 1, label: 'Morgen' },
  { value: 2, label: 'Übermorgen' },
];
const START_HOURS = [6, 7, 8, 9, 10, 11, 12, 13];

/** Kurztext für die Filter-Zelle, z. B. «Gipfel, Seen · bis T3». */
export function filterSummary(p: PParams): string {
  const parts: string[] = [];
  if (p.mode === 'hike') {
    parts.push(
      p.kinds.length === 0 || p.kinds.length === HIKE_KINDS.length
        ? 'Alle Ziele'
        : p.kinds.length <= 2
          ? p.kinds.map((k) => KIND_META[k].plural).join(', ')
          : `${p.kinds.length} Zielarten`,
    );
    if (p.maxSac) parts.push(`bis ${p.maxSac}`);
    if (p.maxHikeMin != null) parts.push(`≤ ${fmtDuration(p.maxHikeMin)}`);
  } else {
    if (p.minSnow != null) parts.push(`≥ ${p.minSnow} cm`);
    if (p.minElev != null) parts.push(`ab ${p.minElev} m`);
    if (parts.length === 0) parts.push('Alle Gebiete');
  }
  if (p.mode === 'hike' && p.minElev != null) parts.push(`ab ${p.minElev} m`);
  if (p.planDay != null) parts.push(p.planDay === 0 ? 'heute' : p.planDay === 1 ? 'morgen' : 'übermorgen');
  if (p.includeUncertain) parts.push('+ unsichere');
  return parts.join(' · ');
}

function Toggle({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="pop-toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="pop-toggle-l">{label}</span>
        {hint && <span className="pop-toggle-h">{hint}</span>}
      </span>
    </label>
  );
}

export function SearchControls({
  params,
  set,
  onLocate,
  locating,
  locateError,
}: {
  params: PParams;
  set: (patch: Partial<PParams>) => void;
  onLocate: () => void;
  locating: boolean;
  locateError?: string | null;
}) {
  const [openOrigin, setOpenOrigin] = useState(false);
  const [openDrive, setOpenDrive] = useState(false);
  const [openFilter, setOpenFilter] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const onQuery = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      setSearching(true);
      try {
        const r = await api.geocode(text);
        // Nur die Antwort auf die jüngste Eingabe übernehmen.
        if (mine === seq.current) setResults(r.results);
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 300);
  };

  const pick = (loc: LatLng, label: string) => {
    set({ origin: loc, originLabel: label });
    setOpenOrigin(false);
    setQ('');
    setResults([]);
  };

  const toggleKind = (k: HikeKind) => {
    const has = params.kinds.includes(k);
    const next = has ? params.kinds.filter((x) => x !== k) : [...params.kinds, k];
    // Alle angewählt bedeutet dasselbe wie keine Einschränkung.
    set({ kinds: next.length === HIKE_KINDS.length ? [] : next });
  };

  const isHike = params.mode === 'hike';

  return (
    <div className="capsule">
      {/* Wo starte ich? */}
      <div className="cap-cell origin-cell" style={{ position: 'relative' }}>
        <Icon name="MapPin" size={16} stroke={2} className="cap-ico" />
        <button type="button" className="cap-btn" onClick={() => setOpenOrigin((v) => !v)} aria-expanded={openOrigin}>
          <span className="cap-key">Start</span>
          <span className="cap-val cap-val-clip">{params.originLabel || 'wählen'}</span>
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
              autoFocus
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
          {!searching && results.length === 0 && q.trim().length >= 2 && <p className="twk-hint">Kein Ort gefunden.</p>}
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
          {locateError && <p className="twk-hint pop-err">{locateError}</p>}
        </Popover>
      </div>

      <span className="cap-div" />

      {/* Was suche ich? */}
      <div className="cap-cell">
        <div className="seg seg-mode">
          {(
            [
              ['hike', 'Wandern', 'Footprints'],
              ['ski', 'Ski', 'Snowflake'],
            ] as const
          ).map(([v, l, ic]) => (
            <button
              key={v}
              type="button"
              className={'seg-btn' + (params.mode === v ? ' is-on' : '')}
              onClick={() => set({ mode: v })}
              aria-pressed={params.mode === v}
            >
              <Icon name={ic} size={15} stroke={2} /> {l}
            </button>
          ))}
        </div>
      </div>

      <span className="cap-div" />

      {/* Wie lange möchte ich fahren? */}
      <div className="cap-cell" style={{ position: 'relative' }}>
        <Icon name="Car" size={16} stroke={2} className="cap-ico" />
        <button type="button" className="cap-btn" onClick={() => setOpenDrive((v) => !v)} aria-expanded={openDrive}>
          <span className="cap-key">Fahrzeit</span>
          <span className="cap-val mono">
            ≤ {fmtDuration(params.maxMin)}
            {params.tolMin > 0 ? ` +${params.tolMin}` : ''}
          </span>
        </button>
        <Popover open={openDrive} onClose={() => setOpenDrive(false)} align="right">
          <p className="pop-title">Autofahrt</p>
          <div className="pop-slider">
            <div className="pop-slider-lbl">
              <span>Maximale Fahrzeit</span>
              <span className="mono">{fmtDuration(params.maxMin)}</span>
            </div>
            <input
              type="range"
              min={15}
              max={240}
              step={5}
              value={params.maxMin}
              onChange={(e) => set({ maxMin: +e.target.value })}
              className="range"
              aria-label="Maximale Fahrzeit in Minuten"
            />
          </div>
          <div className="pop-slider">
            <div className="pop-slider-lbl">
              <span>Toleranz</span>
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
              aria-label="Toleranz in Minuten"
            />
          </div>
          <p className="twk-hint">
            Ziele bis {fmtDuration(params.maxMin)} sind Treffer.{' '}
            {params.tolMin > 0
              ? `Bis ${fmtDuration(params.maxMin + params.tolMin)} erscheinen sie als «knapp ausserhalb», darüber gar nicht.`
              : 'Ohne Toleranz gibt es keine zusätzlichen Vorschläge.'}{' '}
            Gerechnet wird über das Strassennetz bis zum Parkplatz bzw. zur Talstation.
          </p>
        </Popover>
      </div>

      <span className="cap-div" />

      {/* Welche Ziele, wie anspruchsvoll? */}
      <div className="cap-cell filter-cell" style={{ position: 'relative' }}>
        <Icon name="SlidersHorizontal" size={16} stroke={2} className="cap-ico" />
        <button type="button" className="cap-btn" onClick={() => setOpenFilter((v) => !v)} aria-expanded={openFilter}>
          <span className="cap-key">{isHike ? 'Ziele & Anspruch' : 'Filter'}</span>
          <span className="cap-val cap-val-clip">{filterSummary(params)}</span>
        </button>
        <Popover open={openFilter} onClose={() => setOpenFilter(false)} align="right">
          <p className="pop-title">Wann?</p>
          <div className="chip-row" style={{ marginTop: 0 }}>
            {PLAN_DAYS.map((d) => (
              <button
                key={String(d.value)}
                type="button"
                className={'chip' + (params.planDay === d.value ? ' is-on' : '')}
                onClick={() => set({ planDay: d.value })}
                aria-pressed={params.planDay === d.value}
              >
                {d.label}
              </button>
            ))}
          </div>
          {isHike && params.planDay != null && (
            <div className="pop-field">
              <span className="field-label">Start der Tour</span>
              <div className="chip-row">
                {START_HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={'chip' + (params.planStart === h ? ' is-on' : '')}
                    onClick={() => set({ planStart: h })}
                    aria-pressed={params.planStart === h}
                  >
                    {h} Uhr
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="twk-hint" style={{ marginTop: 8 }}>
            {isHike
              ? 'Geprüft werden Sperrungen, Schnee, Wetter zur Tourzeit, Lawinenbulletin und Tageslicht. «Automatisch»: heute ab der nächsten Stunde, ab 14 Uhr morgen ab 8 Uhr.'
              : 'Geprüft werden Betriebsstatus, Schnee, Wetter am Skitag und Lawinenbulletin.'}
          </p>
          <Toggle
            on={params.includeUncertain}
            onChange={(v) => set({ includeUncertain: v })}
            label="Auch unsichere Ziele zeigen"
            hint={
              isHike
                ? 'Datenlage unvollständig oder ein Risiko ist möglich. Gesperrte, verschneite oder zu lange Touren bleiben ausgeblendet.'
                : 'Ohne frei nutzbare Live-Quelle zum Betrieb gilt jedes Skigebiet als unsicher – Peakr zeigt keines als geöffnet an.'
            }
          />
          <div className="pop-sep" />
          {isHike ? (
            <>
              <p className="pop-title">Zielarten</p>
              <div className="chip-row" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className={'chip' + (params.kinds.length === 0 ? ' is-on' : '')}
                  onClick={() => set({ kinds: [] })}
                  aria-pressed={params.kinds.length === 0}
                >
                  Alle
                </button>
                {HIKE_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={'chip' + (params.kinds.includes(k) ? ' is-on' : '')}
                    onClick={() => toggleKind(k)}
                    aria-pressed={params.kinds.includes(k)}
                  >
                    <Icon name={KIND_META[k].icon} size={13} stroke={2} /> {KIND_META[k].plural}
                  </button>
                ))}
              </div>

              <div className="pop-field">
                <span className="field-label">Schwierigkeit der Route (SAC)</span>
                <div className="chip-row">
                  <button
                    type="button"
                    className={'chip' + (!params.maxSac ? ' is-on' : '')}
                    onClick={() => set({ maxSac: '' })}
                    aria-pressed={!params.maxSac}
                  >
                    egal
                  </button>
                  {SAC.map((sac) => (
                    <button
                      key={sac}
                      type="button"
                      className={'chip' + (params.maxSac === sac ? ' is-on' : '')}
                      onClick={() => set({ maxSac: sac as SacDifficulty })}
                      aria-pressed={params.maxSac === sac}
                      title={SAC_HINT[sac]}
                    >
                      bis {sac}
                    </button>
                  ))}
                </div>
                {params.maxSac && (
                  <>
                    <p className="twk-hint" style={{ marginTop: 8 }}>
                      Bis {params.maxSac}: {SAC_HINT[params.maxSac]}. Massgebend ist die gewählte Route, nicht das Ziel.
                    </p>
                    <Toggle
                      on={params.includeUnknownSac}
                      onChange={(v) => set({ includeUnknownSac: v })}
                      label="Unbekannte Schwierigkeit mitzählen"
                      hint="Sonst stehen solche Routen in einem eigenen Abschnitt."
                    />
                  </>
                )}
              </div>

              <div className="pop-slider" style={{ marginTop: 14 }}>
                <div className="pop-slider-lbl">
                  <span>Gehzeit Aufstieg</span>
                  <span className="mono">{params.maxHikeMin == null ? 'egal' : `≤ ${fmtDuration(params.maxHikeMin)}`}</span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={510}
                  step={30}
                  value={params.maxHikeMin ?? 510}
                  onChange={(e) => set({ maxHikeMin: +e.target.value >= 510 ? null : +e.target.value })}
                  className="range"
                  aria-label="Maximale Gehzeit"
                />
              </div>
            </>
          ) : (
            <>
              <p className="pop-title">Skigebiete</p>
              <div className="pop-slider">
                <div className="pop-slider-lbl">
                  <span>Schneehöhe am Berg</span>
                  <span className="mono">{params.minSnow == null ? 'egal' : `≥ ${params.minSnow} cm`}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={10}
                  value={params.minSnow ?? 0}
                  onChange={(e) => set({ minSnow: +e.target.value === 0 ? null : +e.target.value })}
                  className="range"
                  aria-label="Mindestschneehöhe"
                />
              </div>
              {params.minSnow != null && (
                <p className="twk-hint">Gebiete ohne Schneemesswert fallen bei diesem Filter weg und werden gezählt.</p>
              )}
            </>
          )}

          <div className="pop-slider" style={{ marginTop: 14 }}>
            <div className="pop-slider-lbl">
              <span>{isHike ? 'Mindesthöhe Ziel' : 'Mindesthöhe Bergstation'}</span>
              <span className="mono">{params.minElev == null ? 'egal' : `ab ${params.minElev} m`}</span>
            </div>
            <input
              type="range"
              min={0}
              max={3500}
              step={100}
              value={params.minElev ?? 0}
              onChange={(e) => set({ minElev: +e.target.value === 0 ? null : +e.target.value })}
              className="range"
              aria-label="Mindesthöhe"
            />
          </div>

          {isHike && (
            <Toggle
              on={params.includeUnrouted}
              onChange={(v) => set({ includeUnrouted: v })}
              label="Ziele ohne bekannte Route zeigen"
              hint="Reale Ziele, zu denen im Wegnetz keine Wanderroute gefunden wurde – ohne Fahrzeit."
            />
          )}

          <button
            type="button"
            className="pop-locate"
            onClick={() =>
              set({
                kinds: [],
                maxSac: '',
                includeUnknownSac: false,
                maxHikeMin: null,
                includeUnrouted: false,
                minElev: null,
                minSnow: null,
                planDay: null,
                planStart: 8,
                includeUncertain: false,
              })
            }
          >
            <Icon name="X" size={14} stroke={2} /> Filter zurücksetzen
          </button>
        </Popover>
      </div>
    </div>
  );
}
