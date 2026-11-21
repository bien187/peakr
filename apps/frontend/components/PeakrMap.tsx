'use client';

import type * as maplibregl from 'maplibre-gl';
import { mapLib } from '@/lib/map';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { ExpressionSpecification, GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import { DensityComputer } from '@/lib/density/densityClient';
import { uniquePoints, type DensityPoint } from '@/lib/density/densityEngine';
import {
  DEST_SOURCE,
  destinationLayers,
  HIKE_GREEN,
  MUTED,
  setDestinationTheme,
  SKI_BLUE,
  type IconForKind,
} from '@/lib/density/destinationLayer';
import { heatmapBeforeId, PeakrHeatmapLayer } from '@/lib/density/heatmapLayer';
import { bboxOfFeature, HOTSPOT_TAP_MAX_ZOOM, PeakrSmartHotspotLayer } from '@/lib/density/hotspotLayer';
import { mapShade } from '@/lib/mapShade';
import { fmtDrive, KIND_META, trailheadLabel, type MapSelection, type PPoint } from '@/lib/peakr';
import { useSettings } from '@/lib/theme';
import { WeatherLayer } from './WeatherLayer';

const STYLE_URL =
  process.env.NEXT_PUBLIC_SWISSTOPO_STYLE_URL ??
  'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json';

const RASTER_FALLBACK: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://vectortiles.geo.admin.ch/fonts/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

// Offizielles swisstopo-Wanderwegnetz (swissTLM3D) als WMTS-Raster-Overlay.
const TRAIL_TILES =
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swisstlm3d-wanderwege/default/current/3857/{z}/{x}/{y}.png';
const SWISSTOPO_ATTRIB = '© swisstopo / Schweizer Wanderwege';
const TRAIL_MIN_ZOOM = 13;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const POI_MIN_ZOOM = 13;
const OVERPASS_DEBOUNCE = 800;
/** Feuerstellen werden je Kartenkachel dieser Zoomstufe genau einmal pro Sitzung geladen. */
const POI_TILE_ZOOM = 12;

const FONT = ['Frutiger Neue Regular'];

const ROUTE_COLOR = '#c8452f';
const PARK_BLUE = '#2563a8';
const CASING_COLOR = 'rgba(255,255,255,0.9)';
const NAME_DARK = { text: '#e6ebf2', halo: 'rgba(10,16,24,0.85)' };
const NAME_LIGHT = { text: '#1f2933', halo: '#ffffff' };

/** Farbe entlang der Route bis zum Anteil p (0–1); dahinter durchsichtig – zum Nachzeichnen. */
function routeGradient(color: string, p: number): ExpressionSpecification {
  if (p >= 0.995) return ['interpolate', ['linear'], ['line-progress'], 0, color, 1, color];
  const head = Math.max(0.002, p);
  // Stützstellen streng aufsteigend (sonst verwirft MapLibre den Ausdruck).
  return ['interpolate', ['linear'], ['line-progress'], 0, color, head, color, head + 0.002, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)'];
}

/** Radius des Auswahlrings je Zoom, um `extra` Pixel vergrössert (Zoom-Ausdruck muss zuoberst stehen). */
const selRadius = (extra: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 6, 8 + extra, 14, 14 + extra];

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Kamerafahrten kurz und ruhig (≈ 0,3 s); bei «Bewegung reduzieren» sofort. */
const CAMERA_MS = 300;
const cameraMs = (): number => (reducedMotion() ? 0 : CAMERA_MS);

/**
 * Vereinfachter Modus für schwache Geräte: ein Hotspot-Band statt drei, kein
 * Mint-Schein unter den Punkten. Rechnen tut ohnehin der Web Worker.
 */
function liteDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 2 || nav.connection?.saveData === true;
}

const compactView = (): boolean => typeof window !== 'undefined' && window.innerWidth <= 860;

// Typ-Symbole (sitzen auf dem farbigen Punkt) – als Map-Images registriert: weiss
// für die helle Karte, dunkel auf Mint für die dunkle.
const ICON_SVGS: Record<string, string> = {
  'ic-peak': '<path d="M2 21 L9 6 L13 13 L16 8 L22 21 Z" fill="white"/>',
  'ic-lake':
    '<g fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round"><path d="M3 9c2-2.4 4-2.4 6 0s4 2.4 6 0 4-2.4 6 0"/><path d="M3 15c2-2.4 4-2.4 6 0s4 2.4 6 0 4-2.4 6 0"/></g>',
  'ic-hut': '<path d="M3 12 L12 3 L21 12 L18.5 12 L18.5 21 L5.5 21 L5.5 12 Z" fill="white"/>',
  'ic-viewpoint':
    '<g fill="none" stroke="white" stroke-width="2.2"><path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6" fill="white"/></g>',
  'ic-pass':
    '<g fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7c4 0 5 9 9 9s5-9 9-9"/></g>',
  'ic-ski':
    '<g stroke="white" stroke-width="2.2" stroke-linecap="round"><path d="M12 2.5v19M3.7 7.2l16.6 9.6M20.3 7.2 3.7 16.8"/></g>',
};
const ICON_DARK_INK = '#0b1410';
const ICON_KINDS = ['peak', 'lake', 'hut', 'viewpoint', 'pass', 'ski'];
const iconForKind: IconForKind = (dark) =>
  [
    'match',
    ['get', 'kind'],
    ...ICON_KINDS.flatMap((k) => [k, `ic-${k}${dark ? '-d' : ''}`]),
    dark ? 'ic-peak-d' : 'ic-peak',
  ] as unknown as ExpressionSpecification;

const FLAME_SVG =
  '<circle cx="12" cy="12" r="11" fill="#ffffff" stroke="#e0623a" stroke-width="1.5"/>' +
  '<path d="M12 4.5c.7 2.6-2.1 3.6-2.1 6.4 0 1 .6 1.7 1.3 2 .1-.9.6-1.5 1.1-2 .1 1.4 1.6 1.9 1.6 3.5a2.2 2.2 0 0 1-4.4.1c0-3.4 2.5-4.4 2.5-9.5z" fill="#e0623a"/>';
const PARK_SVG =
  `<rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="${PARK_BLUE}" stroke="#ffffff" stroke-width="2"/>` +
  '<path d="M9 18V6.5h4a3.4 3.4 0 0 1 0 6.8H9" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';

function svgUrl(inner: string): string {
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">${inner}</svg>`)
  );
}

function registerImage(map: maplibregl.Map, id: string, inner: string) {
  if (map.hasImage(id)) return;
  const img = new Image(48, 48);
  img.onload = () => {
    if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
  };
  img.src = svgUrl(inner);
}

interface OverpassNode {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function pointsToFeatures(points: PPoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, name: p.name, type: p.type, kind: p.kind, section: p.section, drive: p.driveMin },
    })),
  };
}

/** Beitrag zur Heatmap: Treffer voll, «knapp ausserhalb» und Ziele ohne Angabe halb (wie ihre Punkte). */
function densityPoints(points: PPoint[]): DensityPoint[] {
  return points.map((p) => ({
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    kind: p.kind,
    weight: p.section === 'result' ? 1 : 0.5,
  }));
}

function densityFeatures(points: DensityPoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { w: p.weight } })),
  };
}

/** Rand, damit Ziele nicht unter der Trefferliste (Desktop links, Mobile unten) liegen. */
function viewPadding(): maplibregl.PaddingOptions {
  const mobile = typeof window !== 'undefined' && window.innerWidth <= 860;
  return mobile ? { top: 40, bottom: 170, left: 36, right: 36 } : { top: 70, bottom: 70, left: 440, right: 70 };
}

/**
 * In einen Hotspot hineinzoomen: auf die Ausdehnung seiner Ziele, mindestens aber
 * gut eine Zoomstufe tiefer (sonst um das Dichtemaximum).
 */
function zoomIntoHotspot(map: maplibregl.Map, bbox: [number, number, number, number], peak: [number, number]): void {
  const z = map.getZoom();
  const duration = cameraMs();
  const cam = map.cameraForBounds(
    [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ],
    { padding: viewPadding(), maxZoom: 13 },
  );
  if (cam && typeof cam.zoom === 'number' && cam.zoom >= z + 1) {
    map.easeTo({ ...cam, duration });
    return;
  }
  map.easeTo({ center: peak, zoom: Math.min(13, z + 1.6), duration });
}

function lngLatToTile(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return [Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)];
}

function tileBounds(x: number, y: number, z: number): { s: number; w: number; n: number; e: number } {
  const n = 2 ** z;
  const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return { w: (x / n) * 360 - 180, e: ((x + 1) / n) * 360 - 180, n: lat(y), s: lat(y + 1) };
}

export function PeakrMap({
  points,
  fitToken,
  originPt,
  selection,
  onSelect,
  onBackgroundTap,
}: {
  /** Alle Treffer der Suche als kompakte Punkte. */
  points: PPoint[];
  /** Ändert sich nur bei neuen Filtern – dann wird der Ausschnitt neu gesetzt. */
  fitToken: string;
  originPt: { lat: number; lng: number };
  selection: MapSelection | null;
  onSelect: (id: string) => void;
  /** Tippen ins Leere oder Verschieben der Karte (Handy: Liste einklappen). */
  onBackgroundTap?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const hoverRef = useRef<maplibregl.Popup | null>(null);
  const poiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poiTiles = useRef<Map<string, GeoJSON.Feature<GeoJSON.Point>[] | 'loading'>>(new Map());
  const fitted = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onBackgroundRef = useRef(onBackgroundTap);
  onBackgroundRef.current = onBackgroundTap;
  const [ready, setReady] = useState(false);
  /** Karteninstanz für die Wetterebene (erst nach «load»). */
  const [mapObj, setMapObj] = useState<maplibregl.Map | null>(null);
  const [wxOn, setWxOn] = useState(false);
  const routeAnim = useRef(0);
  const rippleAnim = useRef(0);
  const heatRef = useRef<PeakrHeatmapLayer | null>(null);
  const hotspotsRef = useRef<PeakrSmartHotspotLayer | null>(null);
  const densityRef = useRef<DensityComputer | null>(null);
  const dark = useSettings().s.mode === 'dark';

  // Quellen + Layer installieren (idempotent; auch nach Style-Fallback erneut aufrufbar).
  const installLayers = (map: maplibregl.Map) => {
    for (const [id, inner] of Object.entries(ICON_SVGS)) {
      registerImage(map, id, inner);
      registerImage(map, `${id}-d`, inner.replaceAll('white', ICON_DARK_INK));
    }
    registerImage(map, 'poi-fire', FLAME_SVG);
    registerImage(map, 'ic-park', PARK_SVG);

    // Einzelziele ohne Zusammenfassen: weit heraus übernimmt die Heatmap.
    if (!map.getSource(DEST_SOURCE)) map.addSource(DEST_SOURCE, { type: 'geojson', data: EMPTY });
    for (const id of ['sel', 'origin', 'pois', 'trailhead']) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
    }
    // lineMetrics: die Route lässt sich damit beim Erscheinen «nachzeichnen» (line-gradient).
    if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: EMPTY, lineMetrics: true });
    if (!map.getSource('trails')) {
      map.addSource('trails', {
        type: 'raster',
        tiles: [TRAIL_TILES],
        tileSize: 256,
        minzoom: TRAIL_MIN_ZOOM,
        maxzoom: 18,
        attribution: SWISSTOPO_ATTRIB,
      });
    }

    const add = (layer: maplibregl.LayerSpecification) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    };
    add({ id: 'trails', type: 'raster', source: 'trails', minzoom: TRAIL_MIN_ZOOM, paint: { 'raster-opacity': 0.85 } });
    add({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 7, 'line-gradient': routeGradient(CASING_COLOR, 1) },
    });
    add({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 3.5, 'line-gradient': routeGradient(ROUTE_COLOR, 1) },
    });
    // Kurzer Ring, der sich beim Auswählen eines Ziels einmal ausbreitet.
    add({
      id: 'sel-ripple',
      type: 'circle',
      source: 'sel',
      paint: {
        'circle-radius': selRadius(0),
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#1f2933',
        'circle-stroke-opacity': 0,
      },
    });
    add({
      id: 'sel-ring',
      type: 'circle',
      source: 'sel',
      paint: {
        'circle-radius': selRadius(0),
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#1f2933',
      },
    });
    // Zustand C: Einzelziele (blenden ab mittlerem Zoom ein).
    for (const layer of destinationLayers({ lite: liteDevice(), font: FONT, iconForKind })) add(layer);
    // Zustand B: schwebende Zahlen über den grossen Hotspots.
    hotspotsRef.current?.install();
    add({
      id: 'poi-fire',
      type: 'symbol',
      source: 'pois',
      minzoom: POI_MIN_ZOOM,
      layout: { 'icon-image': 'poi-fire', 'icon-size': 0.6, 'icon-allow-overlap': true },
    });
    add({
      id: 'trailhead',
      type: 'symbol',
      source: 'trailhead',
      layout: {
        'icon-image': 'ic-park',
        'icon-size': 0.95,
        'icon-allow-overlap': true,
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-offset': [0, 1.25],
        'text-anchor': 'top',
        'text-font': FONT,
        'text-optional': true,
      },
      paint: { 'text-color': PARK_BLUE, 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    });
    // Standort als GL-Layer (statt DOM-Marker) → bleibt beim Zoomen exakt fixiert.
    add({
      id: 'origin-dot',
      type: 'circle',
      source: 'origin',
      paint: { 'circle-radius': 7, 'circle-color': '#1f2933', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' },
    });
    // Zustand A/B: organische Heatmap – unter Linien und Beschriftungen der Grundkarte.
    heatRef.current?.install(heatmapBeforeId(map, 'trails'));
  };

  // Karte einmalig initialisieren
  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;
    const motion = !reducedMotion();
    const map = new (mapLib().Map)({
      container: wrapRef.current,
      style: STYLE_URL,
      center: [8.23, 46.8],
      zoom: 6.6,
      maxZoom: 18,
      attributionControl: { compact: true },
      // Zahlen und Namen blenden weich über; bei «Bewegung reduzieren» sofort.
      fadeDuration: motion ? 200 : 0,
    });
    mapRef.current = map;
    // Nur in der Entwicklung: Browsertests setzen Zoom und Ausschnitt direkt (fällt im Build weg).
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __peakrMap?: maplibregl.Map }).__peakrMap = map;
    map.addControl(new (mapLib().NavigationControl)({ showCompass: false }), 'bottom-right');
    heatRef.current = new PeakrHeatmapLayer(map, { reducedMotion: !motion });
    hotspotsRef.current = new PeakrSmartHotspotLayer(map, { lite: liteDevice(), compact: compactView });
    densityRef.current = new DensityComputer();

    let fellBack = false;
    let styleLoaded = false;
    map.on('error', (e) => {
      if (!fellBack && !styleLoaded && STYLE_URL && e?.error) {
        fellBack = true;
        try {
          map.setStyle(RASTER_FALLBACK);
          map.once('styledata', () => installLayers(map));
        } catch {
          /* ignore */
        }
      }
    });

    map.on('load', () => {
      styleLoaded = true;
      installLayers(map);
      map.resize();
      setReady(true);
      setMapObj(map);
    });

    const hotspotLayers = hotspotsRef.current.layerIds();
    const selectFromEvent = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === 'string') onSelectRef.current(id);
    };
    map.on('click', 'points', selectFromEvent);
    map.on('click', 'point-icons', selectFromEvent);

    // Zahl angetippt: in den Hotspot hineinzoomen.
    const zoomFromLabel = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const bbox = f ? bboxOfFeature(f) : null;
      if (!f || !bbox) return;
      zoomIntoHotspot(map, bbox, (f.geometry as GeoJSON.Point).coordinates as [number, number]);
    };
    for (const id of hotspotLayers) map.on('click', id, zoomFromLabel);

    // Tippen ins Leere: auf einer leuchtenden Fläche hineinzoomen; sonst (und zusätzlich)
    // gilt es als Tippen auf die Karte (Handy: Liste einklappen).
    map.on('click', (e) => {
      const layers = ['points', 'point-icons', 'poi-fire', 'trailhead', ...hotspotLayers].filter((id) => map.getLayer(id));
      if (layers.length > 0 && map.queryRenderedFeatures(e.point, { layers }).length > 0) return;
      const h = hotspotsRef.current?.hotspotAt(e.lngLat.lng, e.lngLat.lat, map.getZoom());
      if (h) zoomIntoHotspot(map, h.bbox, [h.lng, h.lat]);
      onBackgroundRef.current?.();
    });
    map.on('dragstart', (e) => {
      if (e.originalEvent) onBackgroundRef.current?.();
    });

    // Kurzinfo beim Überfahren: Name, Art und Fahrzeit bzw. Arten eines Hotspots.
    const hover = new (mapLib().Popup)({ offset: 12, closeButton: false, closeOnClick: false, className: 'pk-hover' });
    hoverRef.current = hover;
    map.on('mousemove', 'points', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as { name: string; kind: string; drive?: number | null };
      const kind = KIND_META[p.kind as keyof typeof KIND_META]?.label ?? '';
      const drive = typeof p.drive === 'number' ? ` · ${fmtDrive(p.drive)} Fahrt` : '';
      hover
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(`<div class="poi-pop"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(kind + drive)}</span></div>`)
        .addTo(map);
    });
    map.on('mouseleave', 'points', () => hover.remove());
    for (const id of hotspotLayers) {
      map.on('mousemove', id, (e) => {
        const f = e.features?.[0];
        const p = f?.properties as { n?: string; unit?: string; info?: string } | undefined;
        if (!f || !p?.info) return;
        hover
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(`<div class="poi-pop"><strong>${escapeHtml(`${p.n} ${p.unit}`)}</strong><span>${escapeHtml(p.info)} · zum Hineinzoomen klicken</span></div>`)
          .addTo(map);
      });
      map.on('mouseleave', id, () => hover.remove());
    }

    map.on('click', 'poi-fire', (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (!f) return;
      const geom = f.geometry as GeoJSON.Point;
      const name = (f.properties?.name as string) || 'Feuerstelle';
      popupRef.current?.remove();
      popupRef.current = new (mapLib().Popup)({ offset: 14, closeButton: false })
        .setLngLat(geom.coordinates as [number, number])
        .setHTML(`<div class="poi-pop"><strong>${escapeHtml(name)}</strong><span>Feuerstelle</span></div>`)
        .addTo(map);
    });

    for (const layer of ['points', 'point-icons', 'poi-fire', ...hotspotLayers]) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
    // Leuchtende Fläche unter der Maus (Desktop): Lupe als Hinweis aufs Hineinzoomen.
    let hoverFrame = 0;
    map.on('mousemove', (e) => {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const canvas = map.getCanvas();
        if (canvas.style.cursor === 'pointer') return;
        const z = map.getZoom();
        const h = z < HOTSPOT_TAP_MAX_ZOOM ? hotspotsRef.current?.hotspotAt(e.lngLat.lng, e.lngLat.lat, z) : null;
        canvas.style.cursor = h ? 'zoom-in' : '';
      });
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(wrapRef.current);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(hoverFrame);
      if (poiTimer.current) clearTimeout(poiTimer.current);
      densityRef.current?.destroy();
      densityRef.current = null;
      heatRef.current = null;
      hotspotsRef.current = null;
      hover.remove();
      setMapObj(null);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Zieldaten aktualisieren; bei neuen Filtern den Ausschnitt auf alle Treffer setzen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(DEST_SOURCE) as GeoJSONSource | undefined)?.setData(pointsToFeatures(points));
    // Dichte im Web Worker; Heatmap und Zahlen wechseln erst mit dem fertigen Modell.
    // Dieselbe bereinigte Liste für GPU-Heatmap und Engine (keine Doppelten).
    const dens = uniquePoints(densityPoints(points));
    const hotspots = hotspotsRef.current;
    let current = true;
    densityRef.current?.compute(dens, hotspots?.bandZooms ?? []).then((model) => {
      if (!current || !model || mapRef.current !== map) return;
      heatRef.current?.setData(densityFeatures(dens), model);
      hotspots?.setModel(model);
    });
    (map.getSource('origin') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [originPt.lng, originPt.lat] }, properties: {} }],
    });

    const key = `${fitToken}|${originPt.lat},${originPt.lng}`;
    if (fitted.current !== key) {
      fitted.current = key;
      const bounds = new (mapLib().LngLatBounds)();
      bounds.extend([originPt.lng, originPt.lat]);
      // Der Ausschnitt richtet sich nach dem, was erreichbar ist – Ziele ohne Fahrzeit ziehen ihn nicht auf.
      for (const p of points) if (p.driveMin != null) bounds.extend([p.lng, p.lat]);
      if (points.length > 0) map.fitBounds(bounds, { padding: viewPadding(), maxZoom: 12, duration: cameraMs() });
      else map.flyTo({ center: [originPt.lng, originPt.lat], zoom: 9, duration: cameraMs() });
    }
    return () => {
      current = false;
    };
  }, [points, fitToken, originPt.lat, originPt.lng, ready]);

  // Auswahl hervorheben: Ring ums Ziel, Ausgangspunkt als «P», Route als Linie.
  const selId = selection?.id ?? null;
  const selLine = selection?.line ?? null;
  const selTh = selection?.trailhead ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    if (!selection) {
      set('sel', EMPTY);
      set('route', EMPTY);
      set('trailhead', EMPTY);
      return;
    }
    const dest: [number, number] = [selection.lng, selection.lat];
    set('sel', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: dest }, properties: {} }] });
    set(
      'trailhead',
      selTh
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [selTh.location.lng, selTh.location.lat] },
                properties: { name: trailheadLabel(selTh) },
              },
            ],
          }
        : EMPTY,
    );
    set(
      'route',
      selLine && selLine.length > 1
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: selLine }, properties: {} }] }
        : EMPTY,
    );
    if (selLine && selLine.length > 1) drawRoute(map, routeAnim);

    // Ausschnitt: Ziel, Ausgangspunkt und – sobald geladen – die ganze Route.
    const bounds = new (mapLib().LngLatBounds)(dest, dest);
    if (selTh) bounds.extend([selTh.location.lng, selTh.location.lat]);
    if (selLine) for (const c of selLine) bounds.extend(c);
    if (selTh || selLine) map.fitBounds(bounds, { padding: viewPadding(), maxZoom: 14, duration: cameraMs() });
    else map.flyTo({ center: dest, zoom: Math.max(map.getZoom(), 11.5), duration: cameraMs() });
  }, [selId, selLine, selTh, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Neues Ziel ausgewählt: ein Ring breitet sich einmal aus.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selId) return;
    ripple(map, rippleAnim);
  }, [selId, ready]);

  // Auf dunkler Karte (Wetter oder dunkler Modus) sind Auswahlring und Welle hell;
  // die Heatmap tritt im Wetterbild zurück.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const id of ['sel-ring', 'sel-ripple']) {
      if (map.getLayer(id)) map.setPaintProperty(id, 'circle-stroke-color', wxOn || dark ? '#ffffff' : '#1f2933');
    }
    heatRef.current?.setTheme(dark, wxOn);
  }, [wxOn, dark, ready]);

  // Dunkler Modus: dunkle Variante der Grundkarte – Flächen dunkel, Strassen, Wege und
  // Markierungen hell (lib/darkStyle.ts); MapLibre blendet die Farben weich über.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    mapShade(map, 'trails').setDark(dark);
    const names = dark ? NAME_DARK : NAME_LIGHT;
    setDestinationTheme(map, dark, names, iconForKind);
    if (map.getLayer('trailhead')) {
      map.setPaintProperty('trailhead', 'text-color', dark ? '#9ec2f5' : PARK_BLUE);
      map.setPaintProperty('trailhead', 'text-halo-color', names.halo);
    }
  }, [dark, ready]);

  useEffect(
    () => () => {
      cancelAnimationFrame(routeAnim.current);
      cancelAnimationFrame(rippleAnim.current);
    },
    [],
  );

  // Feuerstellen aus OpenStreetMap (Overpass): ab Zoom 13, je Kartenkachel nur einmal pro Sitzung.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const cache = poiTiles.current;

    const render = () => {
      const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
      for (const v of cache.values()) if (v !== 'loading') features.push(...v);
      (map.getSource('pois') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
    };

    const load = () => {
      if (map.getZoom() < POI_MIN_ZOOM) return;
      const b = map.getBounds();
      const [x0, y0] = lngLatToTile(b.getWest(), b.getNorth(), POI_TILE_ZOOM);
      const [x1, y1] = lngLatToTile(b.getEast(), b.getSouth(), POI_TILE_ZOOM);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x}/${y}`;
          if (cache.has(key)) continue;
          cache.set(key, 'loading');
          const t = tileBounds(x, y, POI_TILE_ZOOM);
          const bbox = `${t.s},${t.w},${t.n},${t.e}`;
          const query = `[out:json][timeout:25];\n(\n  node["amenity"="bbq"](${bbox});\n  node["leisure"="firepit"](${bbox});\n);\nout body;`;
          fetch(OVERPASS_URL, { method: 'POST', body: `data=${encodeURIComponent(query)}` })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Overpass ${r.status}`))))
            .then((data: { elements?: OverpassNode[] }) => {
              cache.set(
                key,
                (data.elements ?? []).map((el) => ({
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
                  properties: { name: el.tags?.name ?? '' },
                })),
              );
              render();
            })
            .catch(() => {
              // Overpass ist ein Gratisdienst mit Limits: Kachel später erneut versuchen, Karte bleibt nutzbar.
              cache.delete(key);
            });
        }
      }
    };

    const debounced = () => {
      if (poiTimer.current) clearTimeout(poiTimer.current);
      poiTimer.current = setTimeout(load, OVERPASS_DEBOUNCE);
    };

    render();
    debounced();
    map.on('moveend', debounced);
    return () => {
      map.off('moveend', debounced);
    };
  }, [ready]);

  return (
    <div className={'map-wrap' + (wxOn ? ' wx-on' : '')}>
      <div className="pk-map" ref={wrapRef} />
      <WeatherLayer map={mapObj} onActiveChange={setWxOn} />
      <div className="pk-legend" aria-hidden>
        <span>
          <i className="pk-legend-heat" /> Dichte der Ziele
        </span>
        <span>
          <i style={{ background: HIKE_GREEN }} /> Wandern
        </span>
        <span>
          <i style={{ background: SKI_BLUE }} /> Ski
        </span>
        <span>
          <i style={{ background: HIKE_GREEN, opacity: 0.5 }} /> knapp ausserhalb
        </span>
        <span>
          <i style={{ background: MUTED }} /> Angabe fehlt
        </span>
        <span>
          <i className="pk-legend-p" style={{ background: PARK_BLUE }} /> Ausgangspunkt
        </span>
      </div>
    </div>
  );
}

/** Route vom Ausgangspunkt zum Ziel nachzeichnen (0,9 s); bei «Bewegung reduzieren» sofort ganz. */
function drawRoute(map: maplibregl.Map, anim: { current: number }): void {
  cancelAnimationFrame(anim.current);
  const set = (p: number) => {
    if (!map.getLayer('route-line')) return;
    map.setPaintProperty('route-line', 'line-gradient', routeGradient(ROUTE_COLOR, p));
    map.setPaintProperty('route-casing', 'line-gradient', routeGradient(CASING_COLOR, p));
  };
  if (reducedMotion()) {
    set(1);
    return;
  }
  const t0 = performance.now();
  const frame = (now: number) => {
    const t = Math.min(1, (now - t0) / 900);
    set(1 - (1 - t) ** 3);
    if (t < 1) anim.current = requestAnimationFrame(frame);
  };
  set(0);
  anim.current = requestAnimationFrame(frame);
}

/** Ein heller Ring breitet sich vom gewählten Ziel aus und verblasst. */
function ripple(map: maplibregl.Map, anim: { current: number }): void {
  cancelAnimationFrame(anim.current);
  if (reducedMotion() || !map.getLayer('sel-ripple')) return;
  const t0 = performance.now();
  const frame = (now: number) => {
    const t = Math.min(1, (now - t0) / 1100);
    const e = 1 - (1 - t) ** 3;
    map.setPaintProperty('sel-ripple', 'circle-radius', selRadius(e * 22));
    map.setPaintProperty('sel-ripple', 'circle-stroke-opacity', 0.85 * (1 - t));
    if (t < 1) anim.current = requestAnimationFrame(frame);
  };
  anim.current = requestAnimationFrame(frame);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
