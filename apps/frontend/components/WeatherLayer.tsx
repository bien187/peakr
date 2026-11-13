'use client';

/**
 * Live-Wetterkarte: schwebender Schalter «Wetter» oben rechts auf der Karte.
 *
 *  - Niederschlag: Radar MeteoSchweiz (gemessen, 5-Minuten-Bilder der letzten
 *    Stunde), danach die stündliche Modellprognose.
 *  - Bewölkung, Neuschnee, Temperatur, Böen: stündliche Modellprognose
 *    (Open-Meteo, 0,1°-Raster, bis 48 h).
 *
 * Daten werden erst beim Einschalten geladen, je Ebene einmal; Verschieben und
 * Zoomen lösen keine Abrufe aus (Radarbild und Raster decken die ganze Schweiz
 * ab). Ausgeschaltet verschwinden Quellen und Ebenen vollständig. Fehler bleiben
 * in dieser Komponente – Karte und Suche laufen weiter.
 */
import type * as maplibregl from 'maplibre-gl';
import { mapLib } from '@/lib/map';
import {
  scaleClass,
  WEATHER_SCALES,
  type ForecastGridResponse,
  type RadarFramesResponse,
  type WeatherLayerKey,
  type WeatherScale,
} from '@ch-alpineroute/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

type Step = { kind: 'radar'; time: number; stamp: string } | { kind: 'forecast'; time: number; hour: number };

const LAYERS: WeatherLayerKey[] = ['precip', 'cloud', 'snowfall', 'temp', 'gust'];
const SRC_RADAR = 'wx-radar';
const SRC_GRID = 'wx-grid';
/** Unter Route, Ausgangspunkt und Zielpunkten einfügen, damit diese lesbar bleiben. */
const BEFORE = 'route-casing';
/** Älter als das gilt das letzte Radarbild nicht mehr als aktuell. */
const RADAR_STALE_MIN = 30;
const TRANSPARENT = 'rgba(0,0,0,0)';

const fmtTime = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const fmtClock = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });

/** GeoJSON der Rasterzellen mit den Werten aller Stunden als v0, v1, … (null = Eigenschaft fehlt). */
function gridGeoJson(g: ForecastGridResponse): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const d = g.cellDeg;
  return {
    type: 'FeatureCollection',
    features: g.cells.map(([lat, lng], i) => {
      const properties: Record<string, number> = {};
      for (let h = 0; h < g.hours; h++) {
        const v = g.values[h][i];
        if (v !== null) properties[`v${h}`] = v;
      }
      return {
        type: 'Feature',
        properties,
        geometry: { type: 'Polygon', coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] },
      };
    }),
  };
}

/** MapLibre-Farbausdruck für eine Stunde: Klassen wie Legende und Radarbild. */
function fillColor(scale: WeatherScale, hour: number): maplibregl.ExpressionSpecification {
  const key = `v${hour}`;
  const stops: (number | string)[] = [];
  scale.from.forEach((f, k) => {
    if (k === 0 && scale.diverging) return;
    stops.push(f, scale.colors[k]);
  });
  const first = scale.diverging ? scale.colors[0] : TRANSPARENT;
  return ['case', ['has', key], ['step', ['get', key], first, ...stops], TRANSPARENT] as maplibregl.ExpressionSpecification;
}

function Legend({ scale, kind }: { scale: WeatherScale; kind: Step['kind'] | null }) {
  return (
    <div className="wx-legend" aria-label={`Legende ${scale.label} in ${scale.unit}`}>
      <div className="wx-legend-head">
        <span>
          {scale.label} <span className="wx-unit">{scale.unit}</span>
        </span>
        {kind && <span className={'wx-badge' + (kind === 'radar' ? ' is-measured' : '')}>{kind === 'radar' ? 'Radar · gemessen' : 'Prognose · Modell'}</span>}
      </div>
      <div className="wx-legend-row">
        {scale.colors.map((c, k) => (
          <span key={c} className="wx-legend-cell">
            <i style={{ background: c }} />
            <span className="mono">{scale.labels[k]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function WeatherLayer({ map, onOpenChange }: { map: maplibregl.Map | null; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [layer, setLayer] = useState<WeatherLayerKey>('precip');
  const [radar, setRadar] = useState<{ data: RadarFramesResponse; at: number } | null>(null);
  const [radarFailed, setRadarFailed] = useState(false);
  const [grids, setGrids] = useState<Partial<Record<WeatherLayerKey, ForecastGridResponse>>>({});
  const [gridFailed, setGridFailed] = useState<Partial<Record<WeatherLayerKey, boolean>>>({});
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [styleTick, setStyleTick] = useState(0);
  const gridLayerRef = useRef<WeatherLayerKey | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => onOpenChange?.(open), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Daten laden: nur wenn eingeschaltet, je Ebene einmal ────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const jobs: Promise<unknown>[] = [];
    if (layer === 'precip' && (!radar || Date.now() - radar.at > 5 * 60_000)) {
      jobs.push(
        fetch('/api/weather/radar')
          .then((r) => (r.ok ? (r.json() as Promise<RadarFramesResponse>) : Promise.reject(new Error(String(r.status)))))
          .then((data) => {
            if (cancelled) return;
            setRadar({ data, at: Date.now() });
            setRadarFailed(false);
            // Bilder vorladen: der Browser behält sie im Cache, die Animation läuft ohne Warten.
            for (const f of data.frames) {
              const img = new Image();
              img.src = `/api/weather/radar/${f.stamp}`;
            }
          })
          .catch(() => !cancelled && setRadarFailed(true)),
      );
    }
    if (!grids[layer]) {
      jobs.push(
        fetch(`/api/weather/forecast?var=${layer}`)
          .then((r) => (r.ok ? (r.json() as Promise<ForecastGridResponse>) : Promise.reject(new Error(String(r.status)))))
          .then((g) => {
            if (cancelled) return;
            setGrids((x) => ({ ...x, [layer]: g }));
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
  }, [open, layer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zeitachse: Radar (gemessen), danach Prognosestunden ──────────────────────
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [];
    if (layer === 'precip' && radar) for (const f of radar.data.frames) out.push({ kind: 'radar', time: Date.parse(f.time), stamp: f.stamp });
    const g = grids[layer];
    if (g) {
      const start = Date.parse(g.start);
      const after = out.length > 0 ? out[out.length - 1].time : -Infinity;
      for (let h = 0; h < g.hours; h++) {
        const t = start + h * 3_600_000;
        if (t > after) out.push({ kind: 'forecast', time: t, hour: h });
      }
    }
    return out;
  }, [layer, radar, grids]);

  // Standard: jüngstes Radarbild bzw. laufende Prognosestunde.
  useEffect(() => {
    const lastRadar = steps.map((s) => s.kind).lastIndexOf('radar');
    setStepIdx(Math.max(0, lastRadar));
    setPlaying(false);
  }, [layer, steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animation
  useEffect(() => {
    if (!playing || steps.length < 2) return;
    const ms = steps[stepIdx]?.kind === 'radar' ? 600 : 900;
    const id = setTimeout(() => setStepIdx((i) => (i + 1) % steps.length), ms);
    return () => clearTimeout(id);
  }, [playing, stepIdx, steps]);

  // Nach einem Stilwechsel der Karte (Fallback-Stil) Ebenen neu anlegen.
  useEffect(() => {
    if (!map || !open) return;
    const bump = () => setStyleTick((t) => t + 1);
    map.on('styledata', bump);
    return () => {
      map.off('styledata', bump);
    };
  }, [map, open]);

  // ── Karte: Ebenen anlegen, aktualisieren, beim Ausschalten entfernen ─────────
  useEffect(() => {
    if (!map || !open) return;
    const before = () => (map.getLayer(BEFORE) ? BEFORE : undefined);
    const step = steps[stepIdx];
    try {
      setMapError(false);
      if (step?.kind === 'radar' && radar) {
        const url = `/api/weather/radar/${step.stamp}`;
        const src = map.getSource(SRC_RADAR) as maplibregl.ImageSource | undefined;
        if (src) src.updateImage({ url, coordinates: radar.data.coordinates });
        else map.addSource(SRC_RADAR, { type: 'image', url, coordinates: radar.data.coordinates });
        if (!map.getLayer(SRC_RADAR)) {
          map.addLayer({ id: SRC_RADAR, type: 'raster', source: SRC_RADAR, paint: { 'raster-fade-duration': 0 } }, before());
        }
        map.setLayoutProperty(SRC_RADAR, 'visibility', 'visible');
        if (map.getLayer(SRC_GRID)) map.setLayoutProperty(SRC_GRID, 'visibility', 'none');
      } else if (step?.kind === 'forecast' && grids[layer]) {
        const g = grids[layer]!;
        const src = map.getSource(SRC_GRID) as maplibregl.GeoJSONSource | undefined;
        if (!src) map.addSource(SRC_GRID, { type: 'geojson', data: gridGeoJson(g) });
        else if (gridLayerRef.current !== layer) src.setData(gridGeoJson(g));
        gridLayerRef.current = layer;
        const scale = WEATHER_SCALES[layer];
        if (!map.getLayer(SRC_GRID)) {
          map.addLayer(
            { id: SRC_GRID, type: 'fill', source: SRC_GRID, paint: { 'fill-antialias': false, 'fill-opacity': scale.opacity } },
            before(),
          );
        }
        map.setPaintProperty(SRC_GRID, 'fill-color', fillColor(scale, step.hour));
        map.setPaintProperty(SRC_GRID, 'fill-opacity', scale.opacity);
        map.setLayoutProperty(SRC_GRID, 'visibility', 'visible');
        if (map.getLayer(SRC_RADAR)) map.setLayoutProperty(SRC_RADAR, 'visibility', 'none');
      } else {
        for (const id of [SRC_RADAR, SRC_GRID]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      }
    } catch {
      setMapError(true);
    }
  }, [map, open, steps, stepIdx, layer, radar, grids, styleTick]);

  // Wert unter dem Zeiger (Prognoseraster): Zahl statt nur Farbe.
  useEffect(() => {
    if (!map || !open) return;
    const popup = new (mapLib().Popup)({ closeButton: false, closeOnClick: false, offset: 10, className: 'pk-hover' });
    popupRef.current = popup;
    const onMove = (e: maplibregl.MapLayerMouseEvent) => {
      const step = steps[stepIdx];
      if (step?.kind !== 'forecast') return;
      const v = e.features?.[0]?.properties?.[`v${step.hour}`];
      if (typeof v !== 'number') {
        popup.remove();
        return;
      }
      const scale = WEATHER_SCALES[layer];
      const value = layer === 'temp' || layer === 'gust' || layer === 'cloud' ? Math.round(v) : v.toFixed(1);
      popup.setLngLat(e.lngLat).setHTML(`<div class="poi-pop"><strong>${value} ${scale.unit}</strong><span>Prognose ${fmtClock.format(step.time)}</span></div>`).addTo(map);
    };
    const onLeave = () => popup.remove();
    map.on('mousemove', SRC_GRID, onMove);
    map.on('mouseleave', SRC_GRID, onLeave);
    return () => {
      map.off('mousemove', SRC_GRID, onMove);
      map.off('mouseleave', SRC_GRID, onLeave);
      popup.remove();
    };
  }, [map, open, steps, stepIdx, layer]);

  // Ausschalten: alles entfernen.
  useEffect(() => {
    if (!map || open) return;
    try {
      for (const id of [SRC_RADAR, SRC_GRID]) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
    } catch {
      /* Karte bereits abgebaut */
    }
    gridLayerRef.current = null;
    setPlaying(false);
  }, [map, open]);

  const step = steps[stepIdx] ?? null;
  const scale = WEATHER_SCALES[layer];
  const latestRadar = radar?.data.frames.at(-1);
  const radarAgeMin = latestRadar ? (Date.now() - Date.parse(latestRadar.time)) / 60_000 : null;
  const grid = grids[layer];
  const notices: string[] = [];
  if (layer === 'precip' && radarFailed) notices.push('Radar zurzeit nicht abrufbar – gezeigt wird nur die Prognose.');
  else if (layer === 'precip' && radar && (radar.data.frames.length === 0 || (radarAgeMin !== null && radarAgeMin > RADAR_STALE_MIN))) {
    notices.push(latestRadar ? `Keine aktuellen Radardaten – letzte Messung ${fmtClock.format(Date.parse(latestRadar.time))} Uhr.` : 'Keine aktuellen Radardaten.');
  }
  if (gridFailed[layer]) notices.push('Prognose zurzeit nicht abrufbar.');
  else if (grid && grid.hours === 0) notices.push('Keine aktuelle Prognose vorhanden.');
  if (mapError) notices.push('Die Wetterebene konnte nicht gezeichnet werden. Karte und Suche funktionieren weiter.');
  const nothing = !loading && steps.length === 0;

  return (
    <div className="wx-ctl">
      <button
        type="button"
        className={'wx-toggle' + (open ? ' is-on' : '')}
        aria-pressed={open}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="CloudRain" size={16} stroke={2} /> Wetter
      </button>
      {open && (
        <div className="wx-panel" role="region" aria-label="Wetterkarte">
          <div className="wx-layers" role="radiogroup" aria-label="Wetterebene">
            {LAYERS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={layer === k}
                className={'wx-chip' + (layer === k ? ' is-on' : '')}
                onClick={() => setLayer(k)}
              >
                {WEATHER_SCALES[k].label}
              </button>
            ))}
          </div>

          {steps.length > 0 && step && (
            <div className="wx-time">
              <button
                type="button"
                className="wx-play"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? 'Animation anhalten' : 'Animation abspielen'}
                disabled={steps.length < 2}
              >
                <Icon name={playing ? 'Pause' : 'Play'} size={15} stroke={2.2} />
              </button>
              <input
                type="range"
                className="wx-slider"
                min={0}
                max={steps.length - 1}
                value={stepIdx}
                onChange={(e) => {
                  setPlaying(false);
                  setStepIdx(Number(e.target.value));
                }}
                aria-label="Zeitpunkt"
                aria-valuetext={fmtTime.format(step.time)}
              />
              <span className="wx-when mono">{fmtTime.format(step.time)}</span>
            </div>
          )}

          <Legend scale={scale} kind={step?.kind ?? null} />

          {loading && <p className="wx-note mono">Lädt Wetterdaten …</p>}
          {nothing && !loading && <p className="wx-note is-warn">Für diese Ebene liegen zurzeit keine Wetterdaten vor.</p>}
          {notices.map((n) => (
            <p key={n} className="wx-note is-warn">
              <Icon name="CircleAlert" size={12} stroke={2} /> {n}
            </p>
          ))}
          <p className="wx-src">
            {layer === 'precip' ? 'Radar: MeteoSchweiz (gemessen, alle 5 min) · ' : ''}
            Prognose: Open-Meteo (Modell, 0,1°-Raster{grid?.fetchedAt ? `, Stand ${fmtClock.format(Date.parse(grid.fetchedAt))} Uhr` : ''})
            {layer === 'temp' ? ' · Temperatur auf Höhe des Modellgeländes' : ''}
          </p>
        </div>
      )}
    </div>
  );
}

/** Für Tests: Klasse eines Werts wie auf der Karte. */
export function legendClass(layer: WeatherLayerKey, value: number | null): number {
  return scaleClass(WEATHER_SCALES[layer], value);
}
