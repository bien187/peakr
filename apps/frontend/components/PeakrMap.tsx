'use client';

import type * as maplibregl from 'maplibre-gl';
import { mapLib } from '@/lib/map';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { ExpressionSpecification, GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import { fmtDrive, KIND_META, trailheadLabel, type MapSelection, type PPoint } from '@/lib/peakr';

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

/** Bis zu dieser Zoomstufe werden nahe Ziele zu einem Zähler zusammengefasst. */
const CLUSTER_MAX_ZOOM = 9;
const FONT = ['Frutiger Neue Regular'];

// Ziel-Farbe nach Art: Wandern grün, Ski blau. Ziele ohne berechnete Anreise grau.
const HIKE_GREEN = '#3f9457';
const SKI_BLUE = '#3a72b0';
const MUTED = '#8a94a0';
const ROUTE_COLOR = '#c8452f';
const PARK_BLUE = '#2563a8';
const POINT_COLOR: ExpressionSpecification = [
  'case',
  ['in', ['get', 'section'], ['literal', ['sac_unknown', 'unrouted']]],
  MUTED,
  ['==', ['get', 'type'], 'ski'],
  SKI_BLUE,
  HIKE_GREEN,
];
const IS_CLUSTER: ExpressionSpecification = ['has', 'point_count'];
const NOT_CLUSTER: ExpressionSpecification = ['!', ['has', 'point_count']];

// Weisse Typ-Symbole (sitzen auf dem farbigen Kreis) – als Map-Images registriert.
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
const ICON_FOR_KIND: ExpressionSpecification = [
  'match',
  ['get', 'kind'],
  'peak',
  'ic-peak',
  'lake',
  'ic-lake',
  'hut',
  'ic-hut',
  'viewpoint',
  'ic-viewpoint',
  'pass',
  'ic-pass',
  'ski',
  'ic-ski',
  'ic-peak',
];

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

/** Rand, damit Ziele nicht unter der Trefferliste (Desktop links, Mobile unten) liegen. */
function viewPadding(): maplibregl.PaddingOptions {
  const mobile = typeof window !== 'undefined' && window.innerWidth <= 860;
  return mobile ? { top: 40, bottom: 170, left: 36, right: 36 } : { top: 70, bottom: 70, left: 440, right: 70 };
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
}: {
  /** Alle Treffer der Suche als kompakte Punkte. */
  points: PPoint[];
  /** Ändert sich nur bei neuen Filtern – dann wird der Ausschnitt neu gesetzt. */
  fitToken: string;
  originPt: { lat: number; lng: number };
  selection: MapSelection | null;
  onSelect: (id: string) => void;
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
  const [ready, setReady] = useState(false);

  // Quellen + Layer installieren (idempotent; auch nach Style-Fallback erneut aufrufbar).
  const installLayers = (map: maplibregl.Map) => {
    for (const [id, inner] of Object.entries(ICON_SVGS)) registerImage(map, id, inner);
    registerImage(map, 'poi-fire', FLAME_SVG);
    registerImage(map, 'ic-park', PARK_SVG);

    if (!map.getSource('dests')) {
      map.addSource('dests', {
        type: 'geojson',
        data: EMPTY,
        // Weit herausgezoomt fassen Zähler nahe Ziele zusammen; ab Zoom 10 liegt jedes Ziel an seinem Ort.
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 46,
      });
    }
    for (const id of ['sel', 'origin', 'pois', 'route', 'trailhead']) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
    }
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
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 },
    });
    add({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROUTE_COLOR, 'line-width': 3.5 },
    });
    add({
      id: 'sel-ring',
      type: 'circle',
      source: 'sel',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 9, 14, 17],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#1f2933',
      },
    });
    add({
      id: 'clusters',
      type: 'circle',
      source: 'dests',
      filter: IS_CLUSTER,
      paint: {
        'circle-color': '#1f2933',
        'circle-opacity': 0.86,
        'circle-radius': ['step', ['get', 'point_count'], 13, 20, 16, 100, 20, 500, 25],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });
    add({
      id: 'cluster-count',
      type: 'symbol',
      source: 'dests',
      filter: IS_CLUSTER,
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11.5, 'text-font': FONT, 'text-allow-overlap': true },
      paint: { 'text-color': '#ffffff' },
    });
    add({
      id: 'points',
      type: 'circle',
      source: 'dests',
      filter: NOT_CLUSTER,
      paint: {
        'circle-color': POINT_COLOR,
        // Vorschläge («knapp ausserhalb») heller als die eigentlichen Treffer.
        'circle-opacity': ['match', ['get', 'section'], 'result', 1, 0.5],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 10, 8, 14, 13],
        'circle-stroke-width': 1.6,
        'circle-stroke-color': '#ffffff',
      },
    });
    add({
      id: 'point-icons',
      type: 'symbol',
      source: 'dests',
      filter: NOT_CLUSTER,
      minzoom: 10,
      layout: {
        'icon-image': ICON_FOR_KIND,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.42, 14, 0.6],
        'icon-allow-overlap': false,
      },
    });
    add({
      id: 'point-name',
      type: 'symbol',
      source: 'dests',
      filter: NOT_CLUSTER,
      minzoom: 11.5,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-offset': [0, 1.3],
        'text-anchor': 'top',
        'text-font': FONT,
      },
      paint: { 'text-color': '#1f2933', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
    });
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
  };

  // Karte einmalig initialisieren
  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;
    const map = new (mapLib().Map)({
      container: wrapRef.current,
      style: STYLE_URL,
      center: [8.23, 46.8],
      zoom: 6.6,
      maxZoom: 18,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new (mapLib().NavigationControl)({ showCompass: false }), 'bottom-right');

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
    });

    const selectFromEvent = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === 'string') onSelectRef.current(id);
    };
    map.on('click', 'points', selectFromEvent);
    map.on('click', 'point-icons', selectFromEvent);

    // Zähler antippen → so weit hineinzoomen, bis er sich auflöst.
    map.on('click', 'clusters', (e) => {
      const f = e.features?.[0];
      const clusterId = f?.properties?.cluster_id as number | undefined;
      const src = map.getSource('dests') as GeoJSONSource | undefined;
      if (clusterId == null || !src || !f) return;
      void src
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.3 }))
        .catch(() => undefined);
    });

    // Kurzinfo beim Überfahren: Name, Art und Fahrzeit.
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

    for (const layer of ['points', 'point-icons', 'clusters', 'poi-fire']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(wrapRef.current);

    return () => {
      ro.disconnect();
      if (poiTimer.current) clearTimeout(poiTimer.current);
      hover.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Zieldaten aktualisieren; bei neuen Filtern den Ausschnitt auf alle Treffer setzen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('dests') as GeoJSONSource | undefined)?.setData(pointsToFeatures(points));
    (map.getSource('origin') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [originPt.lng, originPt.lat] }, properties: {} }],
    });

    const key = `${fitToken}|${originPt.lat},${originPt.lng}`;
    if (fitted.current === key) return;
    fitted.current = key;
    const bounds = new (mapLib().LngLatBounds)();
    bounds.extend([originPt.lng, originPt.lat]);
    // Der Ausschnitt richtet sich nach dem, was erreichbar ist – Ziele ohne Fahrzeit ziehen ihn nicht auf.
    for (const p of points) if (p.driveMin != null) bounds.extend([p.lng, p.lat]);
    if (points.length > 0) map.fitBounds(bounds, { padding: viewPadding(), maxZoom: 12, duration: 500 });
    else map.flyTo({ center: [originPt.lng, originPt.lat], zoom: 9, duration: 500 });
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

    // Ausschnitt: Ziel, Ausgangspunkt und – sobald geladen – die ganze Route.
    const bounds = new (mapLib().LngLatBounds)(dest, dest);
    if (selTh) bounds.extend([selTh.location.lng, selTh.location.lat]);
    if (selLine) for (const c of selLine) bounds.extend(c);
    if (selTh || selLine) map.fitBounds(bounds, { padding: viewPadding(), maxZoom: 14, duration: 500 });
    else map.flyTo({ center: dest, zoom: Math.max(map.getZoom(), 11.5), duration: 500 });
  }, [selId, selLine, selTh, ready]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="map-wrap">
      <div className="pk-map" ref={wrapRef} />
      <div className="pk-legend" aria-hidden>
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
