'use client';

import type * as maplibregl from 'maplibre-gl';
import { mapLib } from '@/lib/map';
import { DARK_MODE_VEIL, mapShade } from '@/lib/mapShade';
import { useSettings } from '@/lib/theme';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './Icon';
import { AvailabilityBadge, AvalancheTag, WeatherChip } from './PeakrUI';
import {
  classLabel,
  fetchForecast,
  fetchHourlyTemps,
  fmtAge,
  fmtDate,
  fmtDrive,
  fmtDuration,
  KIND_META,
  PISTE_LABEL,
  planLabel,
  PISTE_ORDER,
  trailheadHint,
  trailheadLabel,
  weatherInfo,
  type HourPt,
  type PDay,
  type PDetail,
  type PRoute,
} from '@/lib/peakr';
import {
  AVAILABILITY_LABEL,
  CHECK_LABEL,
  EVIDENCE_LABEL,
  routeGpx,
  routeGpxPath,
  swisstopoLink,
  type Availability,
  type DriveInfo,
  type Trailhead,
} from '@ch-alpineroute/shared';

type MediaVariant = '3d' | 'map' | 'aerial';

function shortName(name: string) {
  return name.split(' – ')[0].split(' (')[0];
}

const STYLE_URL =
  process.env.NEXT_PUBLIC_SWISSTOPO_STYLE_URL ??
  'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json';
const SWISSIMAGE =
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg';
const RASTER_FALLBACK: maplibregl.StyleSpecification = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

// Mapterhorn-DEM: hochauflösendes Höhenmodell mit CORS (von MapLibre-Beispielen).
const MAPTERHORN_DEM = 'https://tiles.mapterhorn.com/tilejson.json';

function styleFor(variant: MediaVariant): maplibregl.StyleSpecification | string {
  if (variant === 'map') return STYLE_URL;
  if (variant === 'aerial') {
    return {
      version: 8,
      sources: { img: { type: 'raster', tileSize: 256, attribution: '© swisstopo', tiles: [SWISSIMAGE] } },
      layers: [{ id: 'img', type: 'raster', source: 'img' }],
    };
  }
  // 3D: OSM-Raster + Hillshade + echtes Höhenmodell (Mapterhorn-DEM)
  return {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap Contributors', maxzoom: 19 },
      terrainSource: { type: 'raster-dem', url: MAPTERHORN_DEM },
      hillshadeSource: { type: 'raster-dem', url: MAPTERHORN_DEM },
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm' },
      { id: 'hills', type: 'hillshade', source: 'hillshadeSource', layout: { visibility: 'visible' }, paint: { 'hillshade-shadow-color': '#473B24' } },
    ],
    terrain: { source: 'terrainSource', exaggeration: 1.5 },
    sky: {},
  } as maplibregl.StyleSpecification;
}


const ROUTE_COLOR = '#e8542b';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function makeMarker(kind: 'peak' | 'park', label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `t3d-marker t3d-marker-${kind}`;
  const pin = document.createElement('span');
  pin.className = `t3d-pin t3d-pin-${kind}`;
  if (kind === 'park') pin.textContent = 'P';
  const tip = document.createElement('span');
  tip.className = 't3d-tip';
  tip.textContent = label;
  el.appendChild(pin);
  el.appendChild(tip);
  return el;
}

/** Route und Ausgangspunkt, die auf der Detailkarte liegen. */
interface MapRoute {
  key: string;
  trailhead: Trailhead | null;
  line: [number, number][] | null;
}

function DetailMap({ d, variant, route }: { d: PDetail; variant: MediaVariant; route: MapRoute }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const parkRef = useRef<maplibregl.Marker | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loaded, setLoaded] = useState(false);
  const dark = useSettings().s.mode === 'dark';

  // Dunkler Modus: Karte abgedunkelt mit hellen Beschriftungen, 3D-Ansicht gedimmt.
  // Das Luftbild bleibt, wie es ist (Fotos abzudunkeln hilft niemandem).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    try {
      if (variant === 'map') {
        const shade = mapShade(map, 'route-casing');
        shade.setLabels('theme', dark);
        shade.setVeil('theme', dark ? DARK_MODE_VEIL : 0);
      } else if (variant === '3d' && map.getLayer('osm')) {
        map.setPaintProperty('osm', 'raster-brightness-max', dark ? 0.62 : 1);
        map.setPaintProperty('osm', 'raster-saturation', dark ? -0.25 : 0);
      }
    } catch {
      /* Stil noch nicht bereit */
    }
  }, [dark, loaded, variant]);

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    const is3d = variant === '3d';
    const center: [number, number] = [d.lng, d.lat];

    const map = new (mapLib().Map)({
      container: hostRef.current,
      style: styleFor(variant),
      center,
      zoom: 13,
      pitch: is3d ? 70 : 0,
      bearing: is3d ? -22 : 0,
      maxPitch: 85,
      dragRotate: is3d,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new (mapLib().NavigationControl)({ visualizePitch: is3d, showCompass: is3d }), 'top-right');
    if (is3d) {
      map.addControl(new (mapLib().TerrainControl)({ source: 'terrainSource', exaggeration: 1.5 }), 'top-right');
    }

    const markReady = () => {
      if (!cancelled) setStatus((s) => (s === 'error' ? s : 'ready'));
    };

    let fellBack = false;
    map.on('error', (e) => {
      if (variant === 'map' && !fellBack && e?.error) {
        fellBack = true;
        try {
          map.setStyle(RASTER_FALLBACK);
        } catch {
          /* ignore */
        }
      } else if ((variant === 'aerial' || variant === '3d') && !cancelled) {
        // Luftbild/Höhenmodell evtl. nicht erreichbar → Hinweis zeigen statt endlos zu laden.
        setStatus((s) => (s === 'ready' ? s : 'error'));
      }
    });

    // Langsame Kamerafahrt um das Ziel (nur 3D); pausiert bei Interaktion und wenn Bewegung reduziert werden soll.
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let spinning = false;
    let paused = false;
    let last = performance.now();
    const spin = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (spinning && !cancelled && !paused) map.setBearing(map.getBearing() + 4 * dt);
      raf = requestAnimationFrame(spin);
    };
    const pause = () => {
      paused = true;
    };
    const resume = () => {
      last = performance.now();
      paused = false;
    };

    map.on('load', () => {
      if (cancelled) return;
      new (mapLib().Marker)({ element: makeMarker('peak', shortName(d.name)), anchor: 'bottom' }).setLngLat(center).addTo(map);
      map.addSource('route', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_COLOR, 'line-width': 3.5 },
      });
      map.resize();
      markReady();
      setLoaded(true);
      if (is3d && !calm) {
        spinning = true;
        last = performance.now();
        raf = requestAnimationFrame(spin);
        for (const ev of ['mousedown', 'touchstart', 'wheel'] as const) map.on(ev, pause);
        for (const ev of ['mouseup', 'touchend'] as const) map.on(ev, resume);
      }
    });
    // Robust: Overlay auch lösen, wenn 'load' verzögert ist
    map.once('idle', markReady);
    const fallback = setTimeout(markReady, 2500);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(hostRef.current);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
      ro.disconnect();
      parkRef.current = null;
      mapRef.current = null;
      setLoaded(false);
      try {
        map.remove();
      } catch {
        /* ignore */
      }
    };
  }, [d.id, d.lat, d.lng, variant, d.name]);

  // Gewählte Route und ihren Ausgangspunkt einzeichnen; flache Ansichten zeigen die ganze Route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
    const line = route.line && route.line.length > 1 ? route.line : null;
    src?.setData(
      line ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: {} }] } : EMPTY,
    );
    parkRef.current?.remove();
    parkRef.current = null;
    const th = route.trailhead;
    if (th) {
      parkRef.current = new (mapLib().Marker)({ element: makeMarker('park', trailheadLabel(th)), anchor: 'bottom' })
        .setLngLat([th.location.lng, th.location.lat])
        .addTo(map);
    }
    if (variant !== '3d' && (line || th)) {
      const bounds = new (mapLib().LngLatBounds)([d.lng, d.lat], [d.lng, d.lat]);
      if (th) bounds.extend([th.location.lng, th.location.lat]);
      if (line) for (const c of line) bounds.extend(c);
      map.fitBounds(bounds, { padding: { top: 70, bottom: 50, left: 50, right: 60 }, maxZoom: 15, duration: 400 });
    }
  }, [route.key, loaded, variant]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = variant === '3d' ? '3D-Gelände' : variant === 'aerial' ? 'Luftbild' : 'Karte';
  return (
    <div className="t3d">
      <div className="t3d-map" ref={hostRef} />
      {status === 'loading' && (
        <div className="t3d-overlay">
          <div className="map-terrain t3d-fallback-bg" />
          <div className="t3d-overlay-inner">
            <span className="t3d-spinner" />
            <p className="t3d-overlay-t">{label} wird geladen …</p>
            {variant === '3d' && <p className="t3d-overlay-s">Karte &amp; Höhenmodell</p>}
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="t3d-overlay is-err">
          <div className="map-terrain t3d-fallback-bg" />
          <div className="t3d-overlay-inner">
            <Icon name="MountainSnow" size={26} stroke={1.6} />
            <p className="t3d-overlay-t">{label} nicht verfügbar</p>
            <p className="t3d-overlay-s">Bitte Internetverbindung prüfen oder andere Ansicht wählen.</p>
          </div>
        </div>
      )}
      {(route.line || route.trailhead) && (
        <div className="t3d-legend">
          <span className="t3d-leg">
            <span className="t3d-leg-dot t3d-leg-peak" /> Ziel
          </span>
          {route.trailhead && (
            <span className="t3d-leg">
              <span className="t3d-leg-dot t3d-leg-park">P</span> Ausgangspunkt
            </span>
          )}
          {route.line && (
            <span className="t3d-leg">
              <span className="t3d-leg-route" /> Wanderroute
            </span>
          )}
        </div>
      )}
{/* Quellenangabe liefert MapLibre selbst (unten rechts). */}
    </div>
  );
}

export function WeatherWindow({
  d,
  onClose,
  preloadDays,
  preloadErr,
}: {
  d: PDetail;
  onClose: () => void;
  preloadDays?: PDay[] | null;
  preloadErr?: boolean;
}) {
  const [days, setDays] = useState<PDay[] | null>(preloadDays ?? null);
  const [err, setErr] = useState(preloadErr ?? false);

  // Nur fetchen wenn noch keine vorgeladenen Daten vorhanden
  useEffect(() => {
    if (preloadDays !== undefined) {
      setDays(preloadDays);
      setErr(preloadErr ?? false);
      return;
    }
    let cancelled = false;
    setDays(null);
    setErr(false);
    fetchForecast(d.lat, d.lng, d.topM)
      .then((f) => { if (!cancelled) setDays(f); })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [d.id, d.lat, d.lng, d.topM, preloadDays, preloadErr]);

  return (
    <div className="wx-pop" role="dialog" aria-label="7-Tage-Wetter">
      <div className="wx-pop-head">
        <div>
          <p className="wx-pop-kicker">7-Tage-Prognose</p>
          <p className="wx-pop-place">
            {shortName(d.name)}
            {d.topM ? ` · ${d.topM} m` : ''}
          </p>
        </div>
        <button type="button" className="wx-pop-x" onClick={onClose} aria-label="Schliessen">
          <Icon name="X" size={16} stroke={2} />
        </button>
      </div>

      {err ? (
        <p className="wx-pop-foot">Prognose momentan nicht abrufbar.</p>
      ) : !days ? (
        <p className="wx-pop-foot mono">Lädt …</p>
      ) : (
        <div className="wx-grid">
          {days.map((day, i) => {
            const w = weatherInfo(day.code, day.tmax);
            return (
              <div key={i} className={'wx-day' + (i === 0 ? ' is-today' : '')}>
                <span className="wx-day-name">{day.label}</span>
                <span className="wx-day-date mono">{day.date}</span>
                <span className="wx-day-ico">
                  <Icon name={w.icon} size={22} stroke={1.6} />
                </span>
                <span className="wx-day-temp">
                  <b>{day.tmax ?? '–'}°</b>
                  <span className="wx-day-min">{day.tmin ?? '–'}°</span>
                </span>
                <span className="wx-day-sub mono">
                  <Icon name="Droplets" size={11} stroke={2} />
                  {day.pop ?? '–'}%
                </span>
                <span className="wx-day-sub mono">
                  <Icon name="Wind" size={11} stroke={2} />
                  {day.wind ?? '–'}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="wx-pop-foot mono">Quelle: Open-Meteo · für die Tourenplanung MeteoSchweiz beachten</p>
    </div>
  );
}

export function Sparkline({ pts, unit }: { pts: number[]; unit: string }) {
  if (pts.length < 2) {
    return <p className="detail-note">Noch keine Verlaufsdaten verfügbar.</p>;
  }
  const w = 520,
    h = 120,
    pad = 8;
  const min = Math.min(...pts),
    max = Math.max(...pts);
  const span = max - min || 1;
  const xy = pts.map((p, i) => [
    pad + (i / (pts.length - 1)) * (w - pad * 2),
    h - pad - ((p - min) / span) * (h - pad * 2),
  ]);
  const line = xy.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const area = `${line} L ${xy[xy.length - 1][0].toFixed(1)} ${h - pad} L ${xy[0][0].toFixed(1)} ${h - pad} Z`;
  return (
    <div className="spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="spark-svg">
        <path d={area} className="spark-area" />
        <path d={line} className="spark-line" />
        <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="3.5" className="spark-end" />
      </svg>
      <div className="spark-axis">
        <span className="mono">Verlauf</span>
        <span className="mono">
          {min}–{max}
          {unit}
        </span>
      </div>
    </div>
  );
}

/** Detaillierter Temperaturverlauf: Stunden auf der x-Achse, °C auf der y-Achse. */
export function TempChart({ pts }: { pts: HourPt[] }) {
  if (pts.length < 2) {
    return <p className="detail-note">Noch keine Prognosedaten verfügbar.</p>;
  }
  const W = 540,
    H = 170,
    padL = 30,
    padR = 10,
    padT = 12,
    padB = 28;
  const temps = pts.map((p) => p.temp);
  let min = Math.min(...temps);
  let max = Math.max(...temps);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const x = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.temp).toFixed(1)).join(' ');
  const area = `${line} L ${x(pts.length - 1).toFixed(1)} ${H - padB} L ${x(0).toFixed(1)} ${H - padB} Z`;
  const yTicks = [max, Math.round((min + max) / 2), min];
  const xTicks = pts.map((p, i) => ({ p, i })).filter(({ p }) => p.hour % 6 === 0);

  return (
    <div className="tchart">
      <svg viewBox={`0 0 ${W} ${H}`} className="tchart-svg">
        {yTicks.map((v, k) => (
          <g key={'y' + k}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="tchart-grid" />
            <text x={padL - 6} y={y(v) + 3.5} textAnchor="end" className="tchart-ylabel">
              {v}°
            </text>
          </g>
        ))}
        {xTicks.map(({ p, i }, k) => (
          <g key={'x' + k}>
            <line
              x1={x(i)}
              x2={x(i)}
              y1={padT}
              y2={H - padB}
              className={'tchart-vgrid' + (p.hour === 0 ? ' is-day' : '')}
            />
            <text x={x(i)} y={H - padB + 16} textAnchor="middle" className="tchart-xlabel">
              {p.hour === 0 ? p.day : String(p.hour).padStart(2, '0')}
            </text>
          </g>
        ))}
        <path d={area} className="tchart-area" />
        <path d={line} className="tchart-line" />
      </svg>
    </div>
  );
}

function Fact({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      <span className="fact-value">
        {value}
        {unit && value !== '–' && <span className="fact-unit"> {unit}</span>}
      </span>
    </div>
  );
}

const nf = new Intl.NumberFormat('de-CH');
const dash = (v: number | null | undefined): string => (v == null ? '–' : nf.format(v));
const pct = (v: number): string => `${Math.round(v * 100)} %`;

const MEDIA_TABS: { value: MediaVariant; label: string; icon: string }[] = [
  { value: '3d', label: '3D', icon: 'Mountain' },
  { value: 'map', label: 'Karte', icon: 'Map' },
  { value: 'aerial', label: 'Luftbild', icon: 'Image' },
];

/** Fahrzeit-Angabe mit ehrlichem Text, wenn sie fehlt. */
function driveText(drive: DriveInfo | null, hasOrigin: boolean): { main: string; note: string | null } {
  if (!hasOrigin || !drive) return { main: '–', note: 'Für die Fahrzeit einen Startort in der Suche wählen.' };
  if (drive.minutes == null) {
    return {
      main: '–',
      note:
        drive.status === 'unavailable'
          ? 'Fahrzeit derzeit nicht berechenbar (Strassennetz nicht geladen).'
          : 'Vom Startort aus wurde keine Strassenverbindung gefunden. Es wird keine Fahrzeit geschätzt.',
    };
  }
  return {
    main: `${fmtDrive(drive.minutes)}${drive.distanceKm != null ? ` · ${nf.format(Math.round(drive.distanceKm))} km` : ''}`,
    note: drive.status === 'partial' ? 'Die Strasse endet vor dem Ziel der Anreise (autofreier Ort) – das letzte Stück mit Bahn oder zu Fuss.' : null,
  };
}

const AV_DOT: Record<string, string> = { available: 'Check', uncertain: 'CircleHelp', unavailable: 'X' };
const CONF_LABEL = { high: 'hoch', medium: 'mittel', low: 'gering' } as const;
const CONF_HINT = {
  high: 'amtliche Meldungen, Messungen und Berechnungen',
  medium: 'Prognose oder Modellwerte beteiligt',
  low: 'für mindestens eine Prüfung fehlen Daten',
} as const;

/** Verfügbarkeit mit allen Einzelprüfungen: Status, Begründung, Belegart, Quelle, Stand. */
function AvailabilityCard({ a, isSki }: { a: Availability | null; isSki: boolean }) {
  if (!a) {
    return (
      <section className="detail-card av-card">
        <h2 className="detail-h2">Verfügbarkeit</h2>
        <p className="detail-note is-plain">
          <Icon name="CircleHelp" size={13} stroke={2} />
          {isSki
            ? 'Die Verfügbarkeit konnte nicht geprüft werden.'
            : 'Ohne berechnete Route lässt sich die Verfügbarkeit nicht prüfen.'}
        </p>
      </section>
    );
  }
  const plan = a.plan ? planLabel(a.plan) : null;
  const back = a.plan?.endsAt ? new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' }).format(new Date(a.plan.endsAt)) : null;
  return (
    <section className="detail-card av-card">
      <h2 className="detail-h2">Verfügbarkeit</h2>
      <div className="av-summary">
        <AvailabilityBadge a={a} />
        {plan && (
          <span className="av-summary-plan">
            {isSki ? `Skitag ${plan.replace(/ ab \d+ Uhr$/, '')} (9–16 Uhr)` : `Tour ${plan}${back ? `, zurück gegen ${back} Uhr` : ''}`}
          </span>
        )}
      </div>
      <ul className="av-list">
        {a.checks.map((c) => (
          <li key={c.kind} className={'av-item is-' + c.status}>
            <span className="av-dot" aria-hidden>
              <Icon name={AV_DOT[c.status]} size={13} stroke={2.6} />
            </span>
            <span className="av-item-head">
              {CHECK_LABEL[c.kind]} <span className="av-item-state">{AVAILABILITY_LABEL[c.status]}</span>
            </span>
            <div>
              <p className="av-item-text">
                {c.text}
                {c.url && (
                  <>
                    {' '}
                    <a href={c.url} target="_blank" rel="noopener noreferrer">
                      Mehr
                    </a>
                  </>
                )}
              </p>
              <p className="av-item-meta">
                {EVIDENCE_LABEL[c.evidence]}
                {c.source ? ` · ${c.source}` : ''}
                {c.observedAt ? ` · Stand ${fmtAge(c.observedAt) ?? fmtDate(c.observedAt)}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="detail-note">
        <Icon name="Info" size={13} stroke={2} />
        Vertrauen {CONF_LABEL[a.confidence]} ({CONF_HINT[a.confidence]}). Automatische Prüfung – massgebend sind Signalisation
        vor Ort, das SLF-Bulletin und die Meldungen der Betreiber.
      </p>
    </section>
  );
}

/**
 * «In Swisstopo öffnen» und «GPX herunterladen» für die gewählte Variante. Die
 * GPX-Datei entsteht im Browser aus den geladenen Routendaten; swisstopo lädt
 * dieselbe Datei über die öffentliche Peakr-URL (nur ab einer HTTPS-Adresse).
 */
function RouteExport({ d, route }: { d: PDetail; route: PRoute }) {
  const [env, setEnv] = useState<{ origin: string; width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEnv({ origin: window.location.origin, width: window.innerWidth, height: window.innerHeight });
  }, []);
  useEffect(() => setError(null), [route.routeId]);

  if (route.line.length < 2) return null;
  const link = swisstopoLink({
    line: route.line,
    gpxUrl: env ? `${env.origin}${routeGpxPath(d.id, route.rank)}` : null,
    viewport: env ?? undefined,
  });
  const withElevation = route.src.elevations?.some((z) => z != null) ?? false;
  const places = route.src.waypoints?.length ?? 0;

  const download = () => {
    setError(null);
    try {
      const gpx = routeGpx({
        destination: {
          name: d.name, location: { lat: d.lat, lng: d.lng }, elevationTopM: d.topM,
          poiKind: d.kind, objectClass: d.objectClass,
        },
        route: route.src,
        variantCount: d.routes.length,
        appUrl: env ? `${env.origin}/destinations/${d.id}` : null,
      });
      const url = URL.createObjectURL(new Blob([gpx.xml], { type: 'application/gpx+xml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = gpx.fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Erst später freigeben: manche Browser starten den Download verzögert.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError('Die GPX-Datei konnte nicht erstellt werden – die Routendaten sind unvollständig.');
    }
  };

  return (
    <div className="route-export">
      <div className="route-export-btns">
        <a className="btn btn-soft" href={link.url} target="_blank" rel="noopener noreferrer">
          <Icon name="Map" size={16} stroke={2} /> In Swisstopo öffnen
        </a>
        <button type="button" className="btn btn-soft" onClick={download}>
          <Icon name="Download" size={16} stroke={2} /> GPX herunterladen
        </button>
      </div>
      <p className="route-export-hint">
        {link.withRoute
          ? 'Swisstopo zeigt die Route auf der Landeskarte mit dem Wanderwegnetz.'
          : 'Swisstopo öffnet den Kartenausschnitt der Route. Die Route selbst lädt swisstopo nur von der veröffentlichten Peakr-Adresse – hier die GPX-Datei im Viewer über «Import» hinzufügen.'}{' '}
        GPX 1.1 mit Track, Start, Ziel{places > 0 ? ` und ${places} ${places === 1 ? 'Ort' : 'Orten'} am Weg` : ''}
        {withElevation ? ', mit Höhen.' : ' – ohne Höhenangaben (werden mit dem nächsten Datenaufbau ergänzt).'}
      </p>
      {error && (
        <p className="detail-note is-plain route-export-err" role="alert">
          <Icon name="CircleAlert" size={13} stroke={2} /> {error}
        </p>
      )}
    </div>
  );
}

function RouteOption({ r, active, onPick, hasOrigin }: { r: PRoute; active: boolean; onPick: () => void; hasOrigin: boolean }) {
  return (
    <button type="button" className={'route-opt' + (active ? ' is-on' : '')} onClick={onPick} aria-pressed={active}>
      <span className="route-opt-head">
        <span className="route-opt-rank">{r.rank}</span>
        <span className="route-opt-th">
          <Icon name={r.trailhead.kind === 'parking' ? 'SquareParking' : 'Milestone'} size={14} stroke={2} />
          ab {trailheadLabel(r.trailhead)}
        </span>
        {hasOrigin && r.drive?.minutes != null && (
          <span className="route-opt-drive mono">
            <Icon name="Car" size={13} stroke={2} /> {fmtDrive(r.drive.minutes)}
          </span>
        )}
      </span>
      <span className="route-opt-stats mono">
        <span>{fmtDuration(r.minUp)} ↑</span>
        <span>{r.km.toFixed(1)} km</span>
        <span>
          ↑ {nf.format(r.up)} m{r.down >= 30 ? ` · ↓ ${nf.format(r.down)} m Gegenabstieg` : ''}
        </span>
        <span>{r.sacKnown ? r.sacLabel : 'SAC unbekannt'}</span>
      </span>
      {r.src.availability && (
        <span className="route-opt-av">
          <AvailabilityBadge a={r.src.availability} compact />
        </span>
      )}
    </button>
  );
}

export function DetailView({
  d,
  isFav,
  onFav,
  onBack,
  origin,
  originLabel,
  initialRouteId,
}: {
  d: PDetail;
  isFav: boolean;
  onFav: (id: string) => void;
  onBack: () => void;
  origin?: { lat: number; lng: number } | null;
  originLabel?: string | null;
  /** Variante, die in der Suche gewählt war. */
  initialRouteId?: number | null;
}) {
  const [media, setMedia] = useState<MediaVariant>('3d');
  const [wxOpen, setWxOpen] = useState(false);
  const [wxDays, setWxDays] = useState<PDay[] | null>(null);
  const [wxHours, setWxHours] = useState<HourPt[]>([]);
  const [wxErr, setWxErr] = useState(false);
  const [mapsOpen, setMapsOpen] = useState(false);
  const [routeId, setRouteId] = useState<number | null>(initialRouteId ?? null);

  useEffect(() => {
    setMedia('3d');
    setWxOpen(false);
    setWxDays(null);
    setWxHours([]);
    setWxErr(false);
    setMapsOpen(false);
    setRouteId(initialRouteId ?? null);
  }, [d.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prognose direkt laden, nicht erst bei Klick
  useEffect(() => {
    let cancelled = false;
    fetchForecast(d.lat, d.lng, d.topM)
      .then((f) => {
        if (!cancelled) setWxDays(f);
      })
      .catch(() => {
        if (!cancelled) setWxErr(true);
      });
    fetchHourlyTemps(d.lat, d.lng, d.topM)
      .then((h) => {
        if (!cancelled) setWxHours(h);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [d.id, d.lat, d.lng, d.topM]);

  const isSki = d.type === 'ski';
  const route = d.routes.find((r) => r.routeId === routeId) ?? d.routes[0] ?? null;
  const trailhead = isSki ? d.access : (route?.trailhead ?? null);
  const drive = isSki ? d.accessDrive : (route?.drive ?? null);
  const hasOrigin = origin != null;
  const dt = driveText(drive, hasOrigin);
  const cls = classLabel(d.objectClass);

  // Navigation führt zum Ausgangspunkt (Parkplatz/Talstation), nicht auf den Gipfel.
  const navTarget = trailhead ? trailhead.location : { lat: d.lat, lng: d.lng };
  const dest = `${navTarget.lat},${navTarget.lng}`;
  const orig = origin ? `${origin.lat},${origin.lng}` : null;
  const mapsGoogle = `https://www.google.com/maps/dir/?api=1${orig ? `&origin=${orig}` : ''}&destination=${dest}&travelmode=driving`;
  const mapsApple = `https://maps.apple.com/?${orig ? `saddr=${orig}&` : ''}daddr=${dest}&dirflg=d`;
  const mapRoute: MapRoute = {
    key: `${d.id}:${isSki ? 'ski' : (route?.routeId ?? 'none')}`,
    trailhead,
    line: route?.line ?? null,
  };
  const pisteTotal = Object.values(d.pisteKmByDifficulty).reduce((a, b) => a + b, 0);

  return (
    <div className="detail">
      <div className="detail-media">
        {/* Remount bei Variantenwechsel → sauberer Karten-Aufbau */}
        <DetailMap key={media} d={d} variant={media} route={mapRoute} />

        <button type="button" className="media-back" onClick={onBack}>
          <Icon name="ArrowLeft" size={16} stroke={2} /> Suche
        </button>

        <div className="media-toggle">
          {MEDIA_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={'media-tab' + (media === t.value ? ' is-on' : '')}
              onClick={() => setMedia(t.value)}
              aria-pressed={media === t.value}
            >
              <Icon name={t.icon} size={14} stroke={2} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="detail-body">
        <div className="detail-head">
          <div>
            <p className="detail-kicker">
              <Icon name={KIND_META[d.kind].icon} size={13} stroke={2} /> {KIND_META[d.kind].label}
              {cls && cls !== KIND_META[d.kind].label ? ` · ${cls}` : ''}
              {d.canton ? ` · Kanton ${d.canton}` : ''}
            </p>
            <h1 className="detail-name">{d.name}</h1>
            {d.altNames.length > 0 && <p className="detail-alt">auch: {d.altNames.slice(0, 4).join(' · ')}</p>}
          </div>
        </div>

        <div className="detail-actions">
          <button type="button" className={'btn' + (isFav ? ' btn-on' : '')} onClick={() => onFav(d.id)}>
            <Icon name="Star" size={16} stroke={2} style={{ fill: isFav ? 'currentColor' : 'none' } as CSSProperties} />
            {isFav ? 'Gemerkt' : 'Merken'}
          </button>
          <div style={{ position: 'relative' }}>
            <button type="button" className="btn btn-soft" onClick={() => setMapsOpen((v) => !v)} aria-expanded={mapsOpen}>
              <Icon name="Navigation" size={16} stroke={2} /> {trailhead ? 'Navigation zum Ausgangspunkt' : 'In Karten öffnen'}
              <Icon name="ChevronDown" size={13} stroke={2} />
            </button>
            {mapsOpen && (
              <>
                <div className="wx-backdrop" onClick={() => setMapsOpen(false)} />
                <div className="pop" style={{ position: 'absolute', top: '100%', marginTop: 6, left: 0, minWidth: 176, zIndex: 40 }}>
                  <div className="pop-list">
                    <a className="pop-item" href={mapsApple} target="_blank" rel="noreferrer" onClick={() => setMapsOpen(false)}>
                      <Icon name="MapPin" size={14} stroke={2} /> Apple Maps
                    </a>
                    <a className="pop-item" href={mapsGoogle} target="_blank" rel="noreferrer" onClick={() => setMapsOpen(false)}>
                      <Icon name="Navigation" size={14} stroke={2} /> Google Maps
                    </a>
                  </div>
                </div>
              </>
            )}
          </div>
          {d.wikipedia && (
            <a
              className="btn btn-soft"
              href={`https://de.wikipedia.org/wiki/${encodeURIComponent(d.wikipedia.replace(/ /g, '_'))}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="ExternalLink" size={15} stroke={2} /> Wikipedia
            </a>
          )}
        </div>

        <div className="facts">
          {isSki ? (
            <>
              <Fact label="Höhe Tal" value={dash(d.baseM)} unit="m" />
              <Fact label="Höhe Berg" value={dash(d.topM)} unit="m" />
              <Fact label="Schnee Berg" value={dash(d.snowTop)} unit="cm" />
              <Fact label="Schnee Tal" value={dash(d.snowValley)} unit="cm" />
              <Fact label="Neuschnee 24 h" value={dash(d.fresh)} unit="cm" />
              {d.liftsOpen != null ? (
                <Fact label="Lifte offen" value={`${d.liftsOpen}/${dash(d.liftsTotal)}`} />
              ) : (
                <Fact label="Anlagen" value={dash(d.liftsTotal)} />
              )}
              <Fact label="Pisten" value={d.pisteKm != null ? nf.format(Math.round(d.pisteKm)) : '–'} unit="km" />
            </>
          ) : (
            <>
              <Fact label="Höhe" value={dash(d.topM)} unit="m" />
              <Fact label="Gehzeit Aufstieg" value={route ? fmtDuration(route.minUp) : '–'} />
              <Fact label="Gehzeit Abstieg" value={route ? fmtDuration(route.minDown) : '–'} />
              <Fact label="Strecke" value={route ? route.km.toFixed(1) : '–'} unit="km" />
              <Fact label="Aufstieg" value={route ? nf.format(route.up) : '–'} unit="m" />
              <Fact label="SAC" value={route ? (route.sacKnown ? route.sacLabel : 'unbekannt') : '–'} />
            </>
          )}
        </div>

        <AvailabilityCard a={isSki ? d.availability : (route?.src.availability ?? null)} isSki={isSki} />

        <section className="detail-card">
          <h2 className="detail-h2">Anreise mit dem Auto</h2>
          {trailhead ? (
            <div className="access">
              <div className="access-main">
                <span className="access-time mono">{dt.main}</span>
                {hasOrigin && drive?.minutes != null && <span className="access-from">ab {originLabel || 'Startort'}</span>}
              </div>
              <div className="access-th">
                <Icon name={trailhead.kind === 'valley_station' ? 'CableCar' : trailhead.kind === 'parking' ? 'SquareParking' : 'Milestone'} size={18} stroke={2} />
                <div>
                  <p className="access-th-name">{trailheadLabel(trailhead)}</p>
                  <p className="access-th-sub">
                    {trailheadHint(trailhead)}
                    {/* Ohne Namen steht die Höhe bereits im Titel. */}
                    {trailhead.name && trailhead.elevationM != null ? ` · ${nf.format(trailhead.elevationM)} m` : ''}
                    {trailhead.fee === 'yes' ? ' · gebührenpflichtig' : trailhead.fee === 'no' ? ' · gratis' : ''}
                    {trailhead.capacity && /^\d+$/.test(trailhead.capacity) ? ` · ${trailhead.capacity} Plätze` : ''}
                  </p>
                </div>
              </div>
              {dt.note && (
                <p className="detail-note">
                  <Icon name="Info" size={13} stroke={2} /> {dt.note}
                </p>
              )}
            </div>
          ) : (
            <p className="detail-note is-plain">
              <Icon name="CircleAlert" size={13} stroke={2} />
              {isSki
                ? 'Für dieses Skigebiet ist keine Talstation mit Strassenanschluss bekannt. Es wird keine Fahrzeit angegeben.'
                : 'Ohne bekannte Wanderroute gibt es keinen Ausgangspunkt – und damit keine Fahrzeit.'}
            </p>
          )}
        </section>

        {!isSki && (
          <section className="detail-card">
            <h2 className="detail-h2">Wanderroute{d.routes.length > 1 ? ` · ${d.routes.length} Varianten` : ''}</h2>
            {route ? (
              <>
                <div className="route-list">
                  {d.routes.map((r) => (
                    <RouteOption key={r.routeId} r={r} active={r.routeId === route.routeId} onPick={() => setRouteId(r.routeId)} hasOrigin={hasOrigin} />
                  ))}
                </div>
                <dl className="route-meta">
                  <div>
                    <dt>Auf signalisierten Wanderwegen</dt>
                    <dd>{pct(route.officialShare)}</dd>
                  </div>
                  <div>
                    <dt>Schwierigkeit</dt>
                    <dd>{route.sacKnown ? route.sacLabel : 'unbekannt – im Wegnetz nicht erfasst'}</dd>
                  </div>
                  <div>
                    <dt>Höchster Punkt</dt>
                    <dd>{route.maxElev != null ? `${nf.format(route.maxElev)} m` : '–'}</dd>
                  </div>
                  <div>
                    <dt>Berechnet am</dt>
                    <dd>{fmtDate(route.computedAt)}</dd>
                  </div>
                </dl>
                <RouteExport d={d} route={route} />
                {route.endGapM > 60 && (
                  <p className="detail-note">
                    <Icon name="Info" size={13} stroke={2} />
                    Der erfasste Weg endet rund {nf.format(Math.round(route.endGapM / 10) * 10)} m vor dem Zielpunkt. Das
                    letzte Stück ist im Wegnetz nicht verzeichnet.
                  </p>
                )}
                <p className="detail-note">
                  <Icon name="TriangleAlert" size={13} stroke={2} />
                  Aus dem Wegnetz berechnet (swisstopo-Wanderwege und OpenStreetMap), nicht begangen. Gehzeit nach DIN 33466
                  ohne Pausen. Verhältnisse, Sperrungen und Ausrüstung selbst prüfen.
                </p>
              </>
            ) : (
              <p className="detail-note is-plain">
                <Icon name="CircleAlert" size={13} stroke={2} />
                {d.routeStatus === 'unrouted'
                  ? 'Für dieses Ziel wurde noch keine Route berechnet.'
                  : 'Zu diesem Ziel wurde im Wegnetz keine durchgehende Wanderroute ab einem Parkplatz gefunden. Peakr zeigt deshalb keine Route – das Ziel selbst existiert.'}
              </p>
            )}
          </section>
        )}

        {isSki && (d.liftsTotal ?? 0) > 0 && (
          <section className="detail-card">
            <h2 className="detail-h2">Anlagen &amp; Pisten</h2>
            <div className="chip-row" style={{ marginTop: 0 }}>
              {Object.entries(d.liftsByType)
                .sort((a, b) => b[1] - a[1])
                .map(([type, n]) => (
                  <span key={type} className="chip is-static">
                    {n} × {type}
                  </span>
                ))}
            </div>
            {pisteTotal > 0 && (
              <div className="piste-bars">
                {PISTE_ORDER.filter((k) => (d.pisteKmByDifficulty[k] ?? 0) > 0).map((k) => {
                  const km = d.pisteKmByDifficulty[k];
                  const meta = PISTE_LABEL[k] ?? PISTE_LABEL.unknown;
                  return (
                    <div key={k} className="piste-row">
                      <span className="piste-l">{meta.label}</span>
                      <span className="piste-track">
                        <span className="piste-fill" style={{ width: `${Math.max(3, (km / pisteTotal) * 100)}%`, background: meta.color }} />
                      </span>
                      <span className="piste-v mono">{km.toFixed(1)} km</span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="detail-note">
              <Icon name="Info" size={13} stroke={2} />
              Anlagen und Pistenlängen stammen aus OpenStreetMap und sind Bestandsdaten.{' '}
              {d.liftsOpen == null
                ? 'Für dieses Gebiet gibt es keine frei nutzbare Live-Quelle zum Betriebsstatus – er wird deshalb nicht angezeigt.'
                : 'Der Betriebsstatus stammt vom Betreiber.'}
            </p>
          </section>
        )}

        <section className="detail-card live-card">
          <h2 className="detail-h2">Aktuelle Lage</h2>
          <div className="live-row">
            <button
              type="button"
              className="wx-trigger"
              onClick={() => setWxOpen((v) => !v)}
              aria-expanded={wxOpen}
              title="7-Tage-Prognose anzeigen"
            >
              <WeatherChip code={d.weather} temp={d.temp} approx={d.tempAdjusted} />
              <Icon name="ChevronDown" size={14} stroke={2} className={'wx-caret' + (wxOpen ? ' is-open' : '')} />
            </button>
            {d.wind != null && (
              <span className="live-item">
                <Icon name="Wind" size={15} stroke={1.75} /> {Math.round(d.wind)} km/h
              </span>
            )}
            {(isSki || d.avalanche != null) && <AvalancheTag level={d.avalanche} />}
            <span className="live-stamp mono">{d.liveAt ? `Stand ${fmtAge(d.liveAt)}` : 'noch keine Messwerte'}</span>
          </div>
          {wxOpen && (
            <>
              <div className="wx-backdrop" onClick={() => setWxOpen(false)} />
              <WeatherWindow d={d} onClose={() => setWxOpen(false)} preloadDays={wxDays} preloadErr={wxErr} />
            </>
          )}
          {(isSki || d.avalanche != null) && (
            <p className="detail-note">
              <Icon name="TriangleAlert" size={13} stroke={2} />
              Die Lawinenstufe ist die höchste Stufe der SLF-Warnregion und ersetzt nicht das Bulletin auf whiterisk.ch.
            </p>
          )}
        </section>

        <section className="detail-card">
          <h2 className="detail-h2">{isSki ? 'Schneehöhe am Berg' : 'Temperaturverlauf (stündlich)'}</h2>
          {isSki ? <Sparkline pts={d.history.map((h) => h.snow)} unit=" cm" /> : <TempChart pts={wxHours} />}
        </section>

        <section className="detail-card">
          <h2 className="detail-h2">Datenquellen</h2>
          <ul className="src-list">
            {d.sources.map((s) => (
              <li key={s.id}>
                <span className="src-name">{s.name}</span>
                <span className="src-meta">
                  {s.attribution ?? ''}
                  {s.version ? ` · Stand ${fmtDate(s.version)}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="detail-note">
            <Icon name="Info" size={13} stroke={2} />
            {d.quality != null ? `Datenlage ${d.quality}/100 (Vollständigkeit der Angaben). ` : ''}
            {d.updatedAt ? `Stammdaten zuletzt aktualisiert am ${fmtDate(d.updatedAt)}.` : ''}
          </p>
        </section>
      </div>
    </div>
  );
}
