'use client';

/**
 * Live-Wetterkarte oben rechts auf der Karte.
 *
 *  - Niederschlag: Radar MeteoSchweiz (gemessen, 5-Minuten-Bilder der letzten
 *    Stunde), danach die stündliche Modellprognose.
 *  - Bewölkung, Neuschnee, Temperatur, Böen: stündliche Modellprognose
 *    (Open-Meteo, 0,1°-Raster, bis 48 h).
 *
 * Eingeschaltet läuft die Animation weiter, auch wenn die Einstellungen
 * zugeklappt sind (kompakter Chip mit Zeit und Messung/Prognose); im Panel lässt
 * sie sich anhalten, ziehen und ausschalten. Gezeichnet wird von der
 * WeatherEngine (fliessende Verläufe, dunkler Schleier, Partikel für Wind und
 * Schnee). Daten werden erst beim Einschalten geladen, je Ebene einmal; Fehler
 * bleiben in dieser Komponente – Karte und Suche laufen weiter.
 */
import type * as maplibregl from 'maplibre-gl';
import {
  bandLabel,
  byteToValue,
  gradientAt,
  legendPosition,
  WEATHER_SCALES,
  type ForecastGridResponse,
  type RadarFramesResponse,
  type WeatherLayerKey,
  type WeatherScale,
} from '@ch-alpineroute/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { decodeGrayPng, gridGeom, gridRaw, prepareRadarFrame, toBytes, windField } from '@/lib/weatherField';
import { nowIndex, WeatherEngine, type GridData, type RadarData, type Scene, type Step } from '@/lib/weatherEngine';
import { Icon } from './Icon';

const LAYERS: { key: WeatherLayerKey; icon: string }[] = [
  { key: 'precip', icon: 'CloudRain' },
  { key: 'cloud', icon: 'Cloud' },
  { key: 'snowfall', icon: 'Snowflake' },
  { key: 'temp', icon: 'Thermometer' },
  { key: 'gust', icon: 'Wind' },
];
const ICON: Record<WeatherLayerKey, string> = Object.fromEntries(LAYERS.map((l) => [l.key, l.icon])) as Record<WeatherLayerKey, string>;
/** Erste eigene Ebene der Karte: Wetter liegt darunter (und unter den Beschriftungen der Grundkarte). */
const APP_LAYER = 'trails';
/** Älter als das gilt das letzte Radarbild nicht mehr als aktuell. */
const RADAR_STALE_MIN = 30;
const RADAR_REFRESH_MS = 5 * 60_000;
const GRID_REFRESH_MS = 30 * 60_000;
/** Farbe, über der die Legende die Kartenfarben zeigt (≈ Karte unter dem dunklen Schleier). */
const LEGEND_BG: [number, number, number] = [59, 65, 76];

const fmtTime = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const fmtClock = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short' });
const dayKey = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' });

/** «14:35» heute, sonst «Sa 14:00». */
function fmtShort(t: number): string {
  const today = dayKey.format(Date.now()) === dayKey.format(t);
  return today ? fmtClock.format(t) : `${fmtDay.format(t).replace('.', '')} ${fmtClock.format(t)}`;
}

const dec = (v: number): string => (v < 10 ? v.toFixed(1).replace('.', ',') : String(Math.round(v)));
const minus = (s: string): string => s.replace('-', '−');

/** Wert für den Hinweis unter dem Zeiger, mit Einheit. */
export function fmtWeatherValue(layer: WeatherLayerKey, v: number): string {
  switch (layer) {
    case 'precip':
      return v < 0.1 ? 'trocken' : `${dec(v)} mm/h`;
    case 'snowfall':
      return v < 0.05 ? 'kein Neuschnee' : `${dec(v)} cm/h`;
    case 'temp':
      return `${minus(String(Math.round(v)))} °C`;
    case 'gust':
      return `${Math.round(v)} km/h`;
    default:
      return `${Math.round(v)} %`;
  }
}

/** CSS-Verlauf der Legende: Kartenfarben so, wie sie auf dem dunklen Schleier erscheinen. */
function rampCss(scale: WeatherScale, dir: 'to right' | 'to top'): string {
  const stops: string[] = [];
  const N = 24;
  for (let k = 0; k <= N; k++) {
    const x = k / N;
    const [r, g, b, a] = gradientAt(scale, byteToValue(scale, 1 + x * 254));
    const al = a / 255;
    const mix = (c: number, i: number) => Math.round(c * al + LEGEND_BG[i] * (1 - al));
    stops.push(`rgb(${mix(r, 0)} ${mix(g, 1)} ${mix(b, 2)}) ${(x * 100).toFixed(1)}%`);
  }
  return `linear-gradient(${dir}, ${stops.join(', ')})`;
}

/** Lage der Wörter (Mitte jeder Stufe) bzw. der Zahlen auf der Legende. */
function legendMarks(scale: WeatherScale, words: boolean): { pos: number; label: string }[] {
  if (words && scale.bands) {
    const b = scale.bands;
    return b.map((band, k) => {
      const from = legendPosition(scale, band.from);
      const to = k + 1 < b.length ? legendPosition(scale, b[k + 1].from) : 1;
      return { pos: (from + to) / 2, label: band.label };
    });
  }
  return scale.ticks.map((t) => ({ pos: legendPosition(scale, t.value), label: t.label }));
}

function Legend({ scale, kind }: { scale: WeatherScale; kind: Step['kind'] | null }) {
  const ramp = useMemo(() => rampCss(scale, 'to right'), [scale]);
  return (
    <div className="wx-legend" aria-label={`Legende ${scale.label} in ${scale.unit}`}>
      <div className="wx-legend-head">
        <span>
          {scale.label} <span className="wx-unit">{scale.unit}</span>
        </span>
        {kind && (
          <span className={'wx-badge' + (kind === 'radar' ? ' is-measured' : '')}>
            {kind === 'radar' ? 'Radar · gemessen' : 'Prognose · Modell'}
          </span>
        )}
      </div>
      <div className="wx-ramp" style={{ background: ramp }} />
      <div className="wx-ticks mono">
        {legendMarks(scale, false).map((m) => (
          <span key={m.label} style={{ left: `${m.pos * 100}%` }}>
            {m.label}
          </span>
        ))}
      </div>
      {scale.bands && (
        <div className="wx-words">
          {legendMarks(scale, true).map((m) => (
            <span key={m.label} style={{ left: `${m.pos * 100}%` }}>
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Kleine senkrechte Legende neben dem Chip, solange die Einstellungen zu sind. */
function MiniLegend({ scale }: { scale: WeatherScale }) {
  const ramp = useMemo(() => rampCss(scale, 'to top'), [scale]);
  const marks = legendMarks(scale, !!scale.bands);
  return (
    <div className="wx-mini" aria-hidden>
      <div className="wx-mini-ramp" style={{ background: ramp }} />
      <div className="wx-mini-marks">
        {marks.map((m) => (
          <span key={m.label} style={{ bottom: `${m.pos * 100}%` }}>
            {m.label}
          </span>
        ))}
      </div>
      {!scale.bands && <span className="wx-mini-unit">{scale.unit}</span>}
    </div>
  );
}

interface RadarState {
  list: RadarFramesResponse;
  frames: Map<string, Uint16Array>;
  width: number;
  height: number;
  at: number;
}

interface GridState {
  resp: ForecastGridResponse;
  data: GridData | null;
  at: number;
}

/** Ein Radarbild als Datenbild laden und für die Karte aufbereiten. */
async function fetchRadarFrame(stamp: string): Promise<{ width: number; height: number; data: Uint16Array }> {
  const r = await fetch(`/api/weather/radar/${stamp}/data`);
  if (!r.ok) throw new Error(String(r.status));
  const buf = await r.arrayBuffer();
  const img = typeof DecompressionStream === 'function' ? await decodeGrayPng(buf) : await decodeViaCanvas(buf);
  return { width: img.width, height: img.height, data: prepareRadarFrame(img.bytes, img.width, img.height) };
}

/** Ersatz für Browser ohne DecompressionStream: über ein Bild ohne Farbumrechnung. */
async function decodeViaCanvas(buf: ArrayBuffer): Promise<{ width: number; height: number; bytes: Uint8Array }> {
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas');
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const bytes = new Uint8Array(c.width * c.height);
  for (let i = 0; i < bytes.length; i++) bytes[i] = d[i * 4];
  return { width: c.width, height: c.height, bytes };
}

async function loadRadar(prev: RadarState | null): Promise<RadarState> {
  const r = await fetch('/api/weather/radar');
  if (!r.ok) throw new Error(String(r.status));
  const list = (await r.json()) as RadarFramesResponse;
  const frames = new Map<string, Uint16Array>();
  let width = prev?.width ?? 0;
  let height = prev?.height ?? 0;
  await Promise.allSettled(
    list.frames.map(async (f) => {
      const have = prev?.frames.get(f.stamp);
      if (have) {
        frames.set(f.stamp, have);
        return;
      }
      const fr = await fetchRadarFrame(f.stamp);
      if (!width) {
        width = fr.width;
        height = fr.height;
      }
      // Alle Bilder müssen gleich gross sein – sonst lieber ohne dieses Bild.
      if (fr.width === width && fr.height === height) frames.set(f.stamp, fr.data);
    }),
  );
  return { list, frames, width, height, at: Date.now() };
}

function buildGrid(layer: WeatherLayerKey, resp: ForecastGridResponse): GridData | null {
  const geom = gridGeom(resp);
  if (!geom || resp.hours === 0) return null;
  const scale = WEATHER_SCALES[layer];
  const raw = Array.from({ length: resp.hours }, (_, h) => gridRaw(geom, resp.values[h] ?? []));
  return { geom, raw, bytes: raw.map((x) => toBytes(scale, x)), wind: layer === 'gust' ? windField(geom, resp) : null };
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const h = () => setReduced(m.matches);
    h();
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return reduced;
}

export function WeatherLayer({ map, onActiveChange }: { map: maplibregl.Map | null; onActiveChange?: (active: boolean) => void }) {
  const [active, setActive] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [layer, setLayer] = useState<WeatherLayerKey>('precip');
  const [radar, setRadar] = useState<RadarState | null>(null);
  const [radarFailed, setRadarFailed] = useState(false);
  const [grids, setGrids] = useState<Partial<Record<WeatherLayerKey, GridState>>>({});
  const [gridFailed, setGridFailed] = useState<Partial<Record<WeatherLayerKey, boolean>>>({});
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mapError, setMapError] = useState(false);
  const reduced = useReducedMotion();
  const engineRef = useRef<WeatherEngine | null>(null);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const readRef = useRef<HTMLDivElement>(null);
  const readValRef = useRef<HTMLSpanElement>(null);
  const readMetaRef = useRef<HTMLSpanElement>(null);
  const autoplayRef = useRef(false);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const radarRef = useRef(radar);
  radarRef.current = radar;

  useEffect(() => onActiveChange?.(active), [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Engine: eine je Karte ──────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    const engine = new WeatherEngine(
      map,
      {
        step: (i) => setStepIdx(i),
        pos: (p) => {
          const el = sliderRef.current;
          if (el) el.value = String(p);
        },
        playing: (p) => setPlaying(p),
        error: () => setMapError(true),
      },
      APP_LAYER,
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [map]);

  useEffect(() => engineRef.current?.setReducedMotion(reduced), [reduced, map]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (active) {
      setMapError(false);
      engine.activate();
    } else {
      engine.deactivate();
      autoplayRef.current = false;
    }
  }, [active, map]);

  // ── Daten laden: nur eingeschaltet, je Ebene einmal (Radar alle 5 min neu) ───
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const jobs: Promise<unknown>[] = [];
    if (layer === 'precip' && (!radar || Date.now() - radar.at > RADAR_REFRESH_MS)) {
      jobs.push(
        loadRadar(radar)
          .then((next) => {
            if (cancelled) return;
            setRadar(next);
            setRadarFailed(false);
          })
          .catch(() => !cancelled && setRadarFailed(true)),
      );
    }
    const g = grids[layer];
    if (!g || Date.now() - g.at > GRID_REFRESH_MS) {
      jobs.push(
        fetch(`/api/weather/forecast?var=${layer}`)
          .then((r) => (r.ok ? (r.json() as Promise<ForecastGridResponse>) : Promise.reject(new Error(String(r.status)))))
          .then((resp) => {
            if (cancelled) return;
            setGrids((x) => ({ ...x, [layer]: { resp, data: buildGrid(layer, resp), at: Date.now() } }));
            setGridFailed((x) => ({ ...x, [layer]: false }));
          })
          .catch(() => !cancelled && setGridFailed((x) => ({ ...x, [layer]: true }))),
      );
    }
    if (jobs.length === 0) return;
    setLoading(true);
    void Promise.allSettled(jobs).then(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [active, layer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Radar regelmässig nachladen, solange Niederschlag sichtbar ist (nur neue Bilder).
  useEffect(() => {
    if (!active || layer !== 'precip') return;
    const id = setInterval(() => {
      if (document.hidden) return;
      void loadRadar(radarRef.current)
        .then((next) => {
          setRadar(next);
          setRadarFailed(false);
        })
        .catch(() => setRadarFailed(true));
    }, RADAR_REFRESH_MS);
    return () => clearInterval(id);
  }, [active, layer]);

  // ── Szene: Zeitachse aus Radar (gemessen) und Prognosestunden ──────────────
  const scene = useMemo<Scene>(() => {
    const steps: Step[] = [];
    let radarData: RadarData | null = null;
    if (layer === 'precip' && radar && radar.width > 0) {
      const frames: Uint16Array[] = [];
      for (const f of radar.list.frames) {
        const data = radar.frames.get(f.stamp);
        if (!data) continue;
        steps.push({ kind: 'radar', time: Date.parse(f.time), frame: frames.length });
        frames.push(data);
      }
      if (frames.length > 0) radarData = { width: radar.width, height: radar.height, corners: radar.list.coordinates, frames };
    }
    const g = grids[layer];
    if (g?.data) {
      const start = Date.parse(g.resp.start);
      const after = steps.length > 0 ? steps[steps.length - 1].time : -Infinity;
      for (let h = 0; h < g.resp.hours; h++) {
        const t = start + h * 3_600_000;
        if (t > after) steps.push({ kind: 'forecast', time: t, hour: h });
      }
    }
    return { layer, steps, radar: radarData, grid: g?.data ?? null };
  }, [layer, radar, grids]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setScene(scene);
    // Beim Einschalten von selbst abspielen (nicht bei «Bewegung reduzieren»).
    if (active && !autoplayRef.current && scene.steps.length >= 2 && !reduced) {
      autoplayRef.current = true;
      engine.play();
    }
  }, [scene, active, map]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wert unter dem Zeiger (nur mit Maus) ───────────────────────────────────
  useEffect(() => {
    if (!map || !active) return;
    const box = readRef.current;
    if (!box) return;
    const hide = () => {
      box.hidden = true;
    };
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const engine = engineRef.current;
      const r = engine?.readout(e.lngLat.lng, e.lngLat.lat);
      const layers = ['points', 'clusters', 'point-icons'].filter((id) => map.getLayer(id));
      if (!r || (layers.length > 0 && map.queryRenderedFeatures(e.point, { layers }).length > 0)) {
        hide();
        return;
      }
      const lk = layerRef.current;
      const band = bandLabel(WEATHER_SCALES[lk], r.value);
      if (readValRef.current) readValRef.current.textContent = fmtWeatherValue(lk, r.value) + (band && r.value > 0.05 ? ` · ${band}` : '');
      if (readMetaRef.current) readMetaRef.current.textContent = `${r.kind === 'radar' ? 'Radar gemessen' : 'Prognose'} · ${fmtShort(r.time)}`;
      box.style.transform = `translate(${Math.round(e.point.x + 14)}px, ${Math.round(e.point.y + 14)}px)`;
      box.hidden = false;
    };
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!fine) return;
    map.on('mousemove', onMove);
    map.on('mouseout', hide);
    map.on('movestart', hide);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', hide);
      map.off('movestart', hide);
      hide();
    };
  }, [map, active]);

  // Auf dem Handy klappen die Einstellungen beim Verschieben der Karte ein – das Wetter läuft weiter.
  useEffect(() => {
    if (!map || !panelOpen) return;
    const onDrag = (e: { originalEvent?: Event }) => {
      if (e.originalEvent && window.innerWidth <= 860) setPanelOpen(false);
    };
    map.on('dragstart', onDrag);
    return () => {
      map.off('dragstart', onDrag);
    };
  }, [map, panelOpen]);

  // Zeitregler: beim Ziehen direkt folgen, erst beim Loslassen (natives «change») einrasten.
  // React meldet onChange bei jeder Bewegung – deshalb hier das native Ereignis.
  const settle = useCallback(() => engineRef.current?.settle(), []);
  const sliderCb = useCallback(
    (el: HTMLInputElement | null) => {
      sliderRef.current?.removeEventListener('change', settle);
      sliderRef.current = el;
      el?.addEventListener('change', settle);
    },
    [settle],
  );

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (playing) engine.pause();
    else engine.play();
  }, [playing]);

  const turnOn = () => {
    setActive(true);
    setPanelOpen(true);
  };
  const turnOff = () => {
    setActive(false);
    setPanelOpen(false);
  };

  // ── Anzeige ────────────────────────────────────────────────────────────────
  const steps = scene.steps;
  const n = steps.length;
  const idx = Math.min(stepIdx, Math.max(0, n - 1));
  const step = n > 0 ? steps[idx] : null;
  const scale = WEATHER_SCALES[layer];
  const radarCount = steps.filter((s) => s.kind === 'radar').length;
  const nowIdx = useMemo(() => nowIndex(steps), [steps]);
  const pct = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 0);
  const nowPct = pct(nowIdx);
  const trackStyle = {
    '--split': `${radarCount > 0 && n > 1 ? pct(Math.min(n - 1, radarCount - 0.5)) : 0}%`,
    '--now': `${nowPct}%`,
    // «Jetzt» am Rand nicht über die Spur hinausragen lassen.
    '--now-shift': nowPct < 8 ? '0%' : nowPct > 92 ? '-100%' : '-50%',
  } as CSSProperties;

  const latestRadar = radar?.list.frames.at(-1);
  const radarAgeMin = latestRadar ? (Date.now() - Date.parse(latestRadar.time)) / 60_000 : null;
  const grid = grids[layer];
  const notices: string[] = [];
  if (layer === 'precip' && radarFailed) notices.push('Radar zurzeit nicht abrufbar – gezeigt wird nur die Prognose.');
  else if (layer === 'precip' && radar && (radar.list.frames.length === 0 || (radarAgeMin !== null && radarAgeMin > RADAR_STALE_MIN))) {
    notices.push(latestRadar ? `Keine aktuellen Radardaten – letzte Messung ${fmtClock.format(Date.parse(latestRadar.time))} Uhr.` : 'Keine aktuellen Radardaten.');
  }
  if (gridFailed[layer]) notices.push('Prognose zurzeit nicht abrufbar.');
  else if (grid && !grid.data) notices.push('Keine aktuelle Prognose vorhanden.');
  if (layer === 'gust' && grid?.data && !grid.data.wind) {
    notices.push('Die Windrichtung fehlt im aktuellen Prognosestand – die Böen werden ohne Bewegung gezeigt.');
  }
  if (mapError) notices.push('Die Wetterebene konnte nicht gezeichnet werden. Karte und Suche funktionieren weiter.');
  const nothing = !loading && n === 0;
  const kindLabel = step?.kind === 'radar' ? 'gemessen' : 'Prognose';

  return (
    <>
      <div className={'wx-ctl' + (active ? ' is-active' : '')}>
        {!active && (
          <button type="button" className="wx-toggle" aria-pressed={false} onClick={turnOn}>
            <span className="wx-toggle-ico" aria-hidden>
              <Icon name="CloudRain" size={16} stroke={2} />
            </span>
            Wetter
          </button>
        )}

        {active && !panelOpen && (
          <>
            <div className="wx-chipbar">
              <button
                type="button"
                className="wx-live"
                onClick={() => setPanelOpen(true)}
                aria-expanded={false}
                aria-label={`Wettereinstellungen öffnen – ${scale.label}, ${step ? fmtShort(step.time) : ''} ${kindLabel}`}
              >
                <span className={'wx-dot' + (playing ? ' is-live' : '')} aria-hidden />
                <Icon name={ICON[layer]} size={15} stroke={2} />
                <span className="wx-live-name">{scale.label}</span>
                {step && <span className="wx-live-time mono">{fmtShort(step.time)}</span>}
                {step && <span className={'wx-live-kind' + (step.kind === 'radar' ? ' is-measured' : '')}>{kindLabel}</span>}
              </button>
              <button type="button" className="wx-x" onClick={turnOff} aria-label="Wetter ausblenden" title="Wetter ausblenden">
                <Icon name="X" size={15} stroke={2.2} />
              </button>
            </div>
            {n > 0 && <MiniLegend scale={scale} />}
          </>
        )}

        {active && panelOpen && (
          <div className="wx-panel" role="region" aria-label="Wetterkarte">
            <div className="wx-head">
              <span className="wx-title">
                <span className={'wx-dot' + (playing ? ' is-live' : '')} aria-hidden />
                Wetter
              </span>
              <span className="wx-head-actions">
                <button
                  type="button"
                  className="wx-icon-btn"
                  onClick={() => setPanelOpen(false)}
                  aria-label="Einstellungen einklappen – das Wetter läuft weiter"
                  title="Einklappen – das Wetter läuft weiter"
                >
                  <Icon name="ChevronUp" size={16} stroke={2.2} />
                </button>
                <button type="button" className="wx-icon-btn" onClick={turnOff} aria-label="Wetter ausschalten" title="Wetter ausschalten">
                  <Icon name="X" size={16} stroke={2.2} />
                </button>
              </span>
            </div>

            <div className="wx-layers" role="radiogroup" aria-label="Wetterebene">
              {LAYERS.map(({ key, icon }) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={layer === key}
                  className={'wx-layer' + (layer === key ? ' is-on' : '')}
                  onClick={() => setLayer(key)}
                >
                  <Icon name={icon} size={14} stroke={2} />
                  {WEATHER_SCALES[key].label}
                </button>
              ))}
            </div>

            {n > 0 && step && (
              <div className="wx-time">
                <button
                  type="button"
                  className={'wx-play' + (playing ? ' is-playing' : '')}
                  onClick={togglePlay}
                  aria-label={playing ? 'Animation anhalten' : 'Animation abspielen'}
                  disabled={n < 2}
                >
                  <Icon name={playing ? 'Pause' : 'Play'} size={15} stroke={2.2} />
                </button>
                <div className="wx-track" style={trackStyle}>
                  <input
                    ref={sliderCb}
                    type="range"
                    className="wx-slider"
                    min={0}
                    max={Math.max(1, n - 1)}
                    step="any"
                    defaultValue={idx}
                    onInput={(e) => engineRef.current?.scrub(Number((e.target as HTMLInputElement).value))}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        engineRef.current?.stepBy(-1);
                      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        engineRef.current?.stepBy(1);
                      }
                    }}
                    aria-label="Zeitpunkt"
                    aria-valuetext={`${fmtTime.format(step.time)}, ${kindLabel}`}
                  />
                  <span className="wx-now" aria-hidden>
                    Jetzt
                  </span>
                </div>
                <span className="wx-when mono">{fmtTime.format(step.time)}</span>
              </div>
            )}

            {n > 0 ? (
              <Legend scale={scale} kind={step?.kind ?? null} />
            ) : (
              loading && <div className="wx-ramp is-loading" aria-hidden />
            )}

            {loading && <p className="wx-note mono">Wetterdaten werden geladen …</p>}
            {nothing && !loading && <p className="wx-note is-warn">Für diese Ebene liegen zurzeit keine Wetterdaten vor.</p>}
            {notices.map((msg) => (
              <p key={msg} className="wx-note is-warn">
                <Icon name="CircleAlert" size={12} stroke={2} /> {msg}
              </p>
            ))}
            <p className="wx-src">
              {layer === 'precip' ? 'Radar: MeteoSchweiz (gemessen, alle 5 min) · ' : ''}
              Prognose: Open-Meteo (Modell, 0,1°-Raster{grid?.resp.fetchedAt ? `, Stand ${fmtClock.format(Date.parse(grid.resp.fetchedAt))} Uhr` : ''})
              {layer === 'temp' ? ' · Temperatur auf Höhe des Modellgeländes' : ''}
              {layer === 'gust' && grid?.data?.wind ? ' · Striche zeigen Richtung und Stärke der Böen' : ''}
            </p>
          </div>
        )}
      </div>
      <div className="wx-readout" ref={readRef} hidden aria-hidden>
        <span className="wx-readout-v" ref={readValRef} />
        <span className="wx-readout-m" ref={readMetaRef} />
      </div>
    </>
  );
}
