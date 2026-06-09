'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from './Icon';
import { AvalancheTag, ScoreDot, WeatherChip } from './PeakrUI';
import { fetchForecast, weatherInfo, type PDay, type PDetail } from '@/lib/peakr';

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

function makePeakMarker(label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 't3d-marker t3d-marker-peak';
  const pin = document.createElement('span');
  pin.className = 't3d-pin t3d-pin-peak';
  const tip = document.createElement('span');
  tip.className = 't3d-tip';
  tip.textContent = label;
  el.appendChild(pin);
  el.appendChild(tip);
  return el;
}

function DetailMap({ d, variant }: { d: PDetail; variant: MediaVariant }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    const is3d = variant === '3d';
    const center: [number, number] = [d.lng, d.lat];

    const map = new maplibregl.Map({
      container: hostRef.current,
      style: styleFor(variant),
      center,
      zoom: is3d ? 13.0 : 13,
      pitch: is3d ? 70 : 0,
      bearing: is3d ? -22 : 0,
      maxPitch: 85,
      dragRotate: is3d,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: is3d, showCompass: is3d }), 'top-right');
    if (is3d) {
      map.addControl(new maplibregl.TerrainControl({ source: 'terrainSource', exaggeration: 1.5 }), 'top-right');
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
        // Luftbild/DEM evtl. nicht erreichbar → Fehlerhinweis, aber Overlay nicht ewig
        setStatus((s) => (s === 'ready' ? s : 'error'));
      }
    });

    map.on('load', () => {
      if (cancelled) return;
      new maplibregl.Marker({ element: makePeakMarker(shortName(d.name)), anchor: 'bottom' })
        .setLngLat(center)
        .addTo(map);
      map.resize();
      markReady();
    });
    // Robust: Overlay auch lösen, wenn 'load' verzögert ist
    map.once('idle', markReady);
    const fallback = setTimeout(markReady, 2500);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(hostRef.current);

    return () => {
      cancelled = true;
      clearTimeout(fallback);
      ro.disconnect();
      try {
        map.remove();
      } catch {
        /* ignore */
      }
    };
  }, [d.id, d.lat, d.lng, variant, d.name]);

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
            {variant === '3d' && <p className="t3d-overlay-s">Satellitenbild &amp; Höhenmodell</p>}
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
      <div className="t3d-attrib">
        {variant === 'map' ? 'Karte · swisstopo' : variant === 'aerial' ? '© swisstopo · swissimage' : '© OpenStreetMap · Mapterhorn DEM'}
      </div>
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
    fetchForecast(d.lat, d.lng)
      .then((f) => { if (!cancelled) setDays(f); })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [d.id, d.lat, d.lng, preloadDays, preloadErr]);

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
            const w = weatherInfo(day.code);
            return (
              <div key={i} className={'wx-day' + (i === 0 ? ' is-today' : '')}>
                <span className="wx-day-name">{day.label}</span>
                <span className="wx-day-date mono">{day.date}</span>
                <span className="wx-day-ico">
                  <Icon name={w.icon} size={22} stroke={1.6} />
                </span>
                <span className="wx-day-temp">
                  <b>{day.tmax}°</b>
                  <span className="wx-day-min">{day.tmin}°</span>
                </span>
                <span className="wx-day-sub mono">
                  <Icon name="Droplets" size={11} stroke={2} />
                  {day.pop}%
                </span>
                <span className="wx-day-sub mono">
                  <Icon name="Wind" size={11} stroke={2} />
                  {day.wind}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="wx-pop-foot mono">Quelle: Open-Meteo · Planung: MeteoSchweiz</p>
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
          aktuell · {pts[pts.length - 1]}
          {unit}
        </span>
      </div>
    </div>
  );
}

function Fact({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      <span className="fact-value">
        {value}
        {unit && <span className="fact-unit"> {unit}</span>}
      </span>
    </div>
  );
}

const dash = (v: number | null | undefined): string | number => (v == null ? '–' : v);

const MEDIA_TABS: { value: MediaVariant; label: string; icon: string }[] = [
  { value: '3d', label: '3D', icon: 'Mountain' },
  { value: 'map', label: 'Karte', icon: 'Map' },
  { value: 'aerial', label: 'Luftbild', icon: 'Image' },
];

export function DetailView({
  d,
  isFav,
  onFav,
  onBack,
  origin,
}: {
  d: PDetail;
  isFav: boolean;
  onFav: (id: string) => void;
  onBack: () => void;
  origin?: { lat: number; lng: number } | null;
}) {
  const [media, setMedia] = useState<MediaVariant>('3d');
  const [wxOpen, setWxOpen] = useState(false);
  const [wxDays, setWxDays] = useState<PDay[] | null>(null);
  const [wxErr, setWxErr] = useState(false);
  const [mapsOpen, setMapsOpen] = useState(false);

  useEffect(() => {
    setMedia('3d');
    setWxOpen(false);
    setWxDays(null);
    setWxErr(false);
    setMapsOpen(false);
  }, [d.id]);

  // Wetter sofort laden, nicht erst bei Klick
  useEffect(() => {
    let cancelled = false;
    fetchForecast(d.lat, d.lng)
      .then((f) => { if (!cancelled) setWxDays(f); })
      .catch(() => { if (!cancelled) setWxErr(true); });
    return () => { cancelled = true; };
  }, [d.id, d.lat, d.lng]);

  const isSki = d.type === 'ski';
  const dest = `${d.lat},${d.lng}`;
  const orig = origin ? `${origin.lat},${origin.lng}` : null;
  const mapsGoogle = `https://www.google.com/maps/dir/?api=1${orig ? `&origin=${orig}` : ''}&destination=${dest}&travelmode=driving`;
  const mapsApple = `https://maps.apple.com/?${orig ? `saddr=${orig}&` : ''}daddr=${dest}&dirflg=d`;

  return (
    <div className="detail">
      <div className="detail-media">
        {/* Remount bei Variantenwechsel → sauberer Karten-Aufbau */}
        <DetailMap key={media} d={d} variant={media} />

        <button type="button" className="media-back" onClick={onBack}>
          <Icon name="ArrowLeft" size={16} stroke={2} /> Karte
        </button>

        <div className="media-toggle">
          {MEDIA_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={'media-tab' + (media === t.value ? ' is-on' : '')}
              onClick={() => setMedia(t.value)}
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
              {isSki ? 'Skigebiet' : 'Wanderziel'}
              {d.canton ? ` · Kanton ${d.canton}` : ''}
            </p>
            <h1 className="detail-name">{d.name}</h1>
          </div>
          <ScoreDot score={d.displayScore} size="lg" />
        </div>

        <p className="detail-blurb">{d.blurb}</p>

        <div className="detail-actions">
          <button type="button" className={'btn' + (isFav ? ' btn-on' : '')} onClick={() => onFav(d.id)}>
            <Icon name="Star" size={16} stroke={2} style={{ fill: isFav ? 'currentColor' : 'none' } as CSSProperties} />
            {isFav ? 'Gemerkt' : 'Merken'}
          </button>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn btn-soft"
              onClick={() => setMapsOpen((v) => !v)}
              aria-expanded={mapsOpen}
            >
              <Icon name="Navigation" size={16} stroke={2} /> In Karten öffnen
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
        </div>

        <div className="facts">
          {isSki ? (
            <>
              <Fact label="Höhe Tal" value={dash(d.baseM)} unit="m" />
              <Fact label="Höhe Berg" value={dash(d.topM)} unit="m" />
              <Fact label="Schnee Berg" value={dash(d.snowTop)} unit="cm" />
              <Fact label="Neuschnee 24 h" value={dash(d.fresh)} unit="cm" />
              <Fact label="Lifte offen" value={d.liftsTotal != null ? `${d.liftsOpen ?? 0}/${d.liftsTotal}` : '–'} />
              <Fact label="Bekanntheit" value={dash(d.fame)} unit="/100" />
            </>
          ) : (
            <>
              <Fact label="SAC-Grad" value={d.sac ?? '–'} />
              <Fact label="Höhe" value={dash(d.topM)} unit="m" />
              <Fact label="Aufstieg" value={dash(d.ascent)} unit="hm" />
              <Fact label="Distanz" value={dash(d.distance)} unit="km" />
              <Fact label="Bekanntheit" value={dash(d.fame)} unit="/100" />
              <Fact label="Wind" value={d.wind != null ? Math.round(d.wind) : '–'} unit="km/h" />
            </>
          )}
        </div>

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
              <WeatherChip code={d.weather} temp={d.temp} />
              <Icon name="ChevronDown" size={14} stroke={2} className={'wx-caret' + (wxOpen ? ' is-open' : '')} />
            </button>
            {d.wind != null && (
              <button
                type="button"
                className="wx-trigger live-item"
                onClick={() => setWxOpen((v) => !v)}
                title="7-Tage-Prognose anzeigen"
              >
                <Icon name="Wind" size={15} stroke={1.75} /> {Math.round(d.wind)} km/h
              </button>
            )}
            {isSki && <AvalancheTag level={d.avalanche} />}
            <span className="wx-hint mono">7-Tage ansehen</span>
          </div>
          {wxOpen && (
            <>
              <div className="wx-backdrop" onClick={() => setWxOpen(false)} />
              <WeatherWindow d={d} onClose={() => setWxOpen(false)} preloadDays={wxDays} preloadErr={wxErr} />
            </>
          )}
          {isSki && (
            <p className="detail-note">
              <Icon name="TriangleAlert" size={13} stroke={2} />
              Lawineneinschätzung ersetzt nicht das offizielle SLF-Bulletin auf whiterisk.ch.
            </p>
          )}
        </section>

        <section className="detail-card">
          <h2 className="detail-h2">{isSki ? 'Schneeverlauf' : 'Temperaturverlauf'}</h2>
          <Sparkline pts={d.history} unit={isSki ? ' cm' : '°'} />
        </section>
      </div>
    </div>
  );
}
