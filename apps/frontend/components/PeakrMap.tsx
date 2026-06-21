'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { ExpressionSpecification, GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import type { PCard } from '@/lib/peakr';

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
const OVERPASS_DEBOUNCE = 600;

// Ziel-Farbe nach Art: Wandern grün, Ski blau (wie im alten Design).
const HIKE_GREEN = '#3f9457';
const SKI_BLUE = '#3a72b0';
const TYPE_COLOR: ExpressionSpecification = ['match', ['get', 'type'], 'ski', SKI_BLUE, HIKE_GREEN];

// Weiße Typ-Symbole (sitzen auf dem farbigen Kreis) – als Map-Images registriert.
const ICON_SVGS: Record<string, string> = {
  'ic-peak': '<path d="M2 21 L9 6 L13 13 L16 8 L22 21 Z" fill="white"/>',
  'ic-lake':
    '<g fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round"><path d="M3 9c2-2.4 4-2.4 6 0s4 2.4 6 0 4-2.4 6 0"/><path d="M3 15c2-2.4 4-2.4 6 0s4 2.4 6 0 4-2.4 6 0"/></g>',
  'ic-hut': '<path d="M3 12 L12 3 L21 12 L18.5 12 L18.5 21 L5.5 21 L5.5 12 Z" fill="white"/>',
  'ic-viewpoint':
    '<g fill="none" stroke="white" stroke-width="2.2"><path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6" fill="white"/></g>',
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
  'ski',
  'ic-ski',
  'ic-peak',
];

const FLAME_SVG =
  '<circle cx="12" cy="12" r="11" fill="#ffffff" stroke="#e0623a" stroke-width="1.5"/>' +
  '<path d="M12 4.5c.7 2.6-2.1 3.6-2.1 6.4 0 1 .6 1.7 1.3 2 .1-.9.6-1.5 1.1-2 .1 1.4 1.6 1.9 1.6 3.5a2.2 2.2 0 0 1-4.4.1c0-3.4 2.5-4.4 2.5-9.5z" fill="#e0623a"/>';

function svgUrl(inner: string): string {
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">${inner}</svg>`,
    )
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

function pointsToFeatures(points: PCard[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, name: p.name, type: p.type, kind: p.kind },
    })),
  };
}

export function PeakrMap({
  points,
  originPt,
  selectedId,
  onSelect,
  alwaysLabels,
}: {
  points: PCard[];
  originPt: { lat: number; lng: number };
  originLabel: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  mode: 'ski' | 'hike';
  alwaysLabels: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const poiAbort = useRef<AbortController | null>(null);
  const poiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);

  // Quellen + Layer installieren (idempotent; auch nach Style-Fallback erneut aufrufbar).
  const installLayers = (map: maplibregl.Map) => {
    for (const [id, inner] of Object.entries(ICON_SVGS)) registerImage(map, id, inner);
    registerImage(map, 'poi-fire', FLAME_SVG);

    if (!map.getSource('dests')) {
      // KEIN Clustering – jeder Ort bleibt auf seinen echten Koordinaten.
      map.addSource('dests', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('sel')) {
      map.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('origin')) {
      map.addSource('origin', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('pois')) {
      map.addSource('pois', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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

    if (!map.getLayer('trails')) {
      map.addLayer({
        id: 'trails',
        type: 'raster',
        source: 'trails',
        minzoom: TRAIL_MIN_ZOOM,
        paint: { 'raster-opacity': 0.85 },
      });
    }
    if (!map.getLayer('sel-ring')) {
      map.addLayer({
        id: 'sel-ring',
        type: 'circle',
        source: 'sel',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 8, 14, 16],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#1f2933',
        },
      });
    }
    if (!map.getLayer('points')) {
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'dests',
        paint: {
          'circle-color': TYPE_COLOR,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 10, 9, 14, 13],
          'circle-stroke-width': 1.6,
          'circle-stroke-color': '#ffffff',
        },
      });
    }
    if (!map.getLayer('point-icons')) {
      map.addLayer({
        id: 'point-icons',
        type: 'symbol',
        source: 'dests',
        minzoom: 9.5,
        layout: {
          'icon-image': ICON_FOR_KIND,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9.5, 0.45, 14, 0.6],
          // bei tausenden Zielen Icons entzerren (Kreise zeigen die Position).
          'icon-allow-overlap': false,
        },
      });
    }
    if (!map.getLayer('point-name')) {
      map.addLayer({
        id: 'point-name',
        type: 'symbol',
        source: 'dests',
        minzoom: 12.5,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
          'text-font': ['Frutiger Neue Regular'],
        },
        paint: {
          'text-color': '#1f2933',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.4,
        },
      });
    }
    if (!map.getLayer('poi-fire')) {
      map.addLayer({
        id: 'poi-fire',
        type: 'symbol',
        source: 'pois',
        layout: { 'icon-image': 'poi-fire', 'icon-size': 0.6, 'icon-allow-overlap': true },
      });
    }
    // Standort als GL-Layer (statt DOM-Marker) → bleibt beim Zoomen exakt fixiert.
    if (!map.getLayer('origin-dot')) {
      map.addLayer({
        id: 'origin-dot',
        type: 'circle',
        source: 'origin',
        paint: {
          'circle-radius': 7,
          'circle-color': '#1f2933',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });
    }
  };

  // Karte einmalig initialisieren
  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: wrapRef.current,
      style: STYLE_URL,
      center: [8.23, 46.8],
      zoom: 6.6,
      maxZoom: 18,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

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
      if (typeof id === 'string') onSelect(id);
    };
    map.on('click', 'points', selectFromEvent);
    map.on('click', 'point-icons', selectFromEvent);

    map.on('click', 'poi-fire', (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (!f) return;
      const geom = f.geometry as GeoJSON.Point;
      const name = (f.properties?.name as string) || 'Feuerstelle';
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ offset: 14, closeButton: false })
        .setLngLat(geom.coordinates as [number, number])
        .setHTML(`<div class="poi-pop"><strong>${escapeHtml(name)}</strong><span>Feuerstelle</span></div>`)
        .addTo(map);
    });

    for (const layer of ['points', 'point-icons', 'poi-fire']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(wrapRef.current);

    return () => {
      ro.disconnect();
      if (poiTimer.current) clearTimeout(poiTimer.current);
      poiAbort.current?.abort();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Zieldaten aktualisieren + auf die nächstgelegenen Ziele zoomen
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource('dests') as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(pointsToFeatures(points));

    const oSrc = map.getSource('origin') as GeoJSONSource | undefined;
    oSrc?.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [originPt.lng, originPt.lat] }, properties: {} },
      ],
    });

    const bounds = new maplibregl.LngLatBounds();
    bounds.extend([originPt.lng, originPt.lat]);
    if (points.length > 0) {
      const nearest = [...points]
        .sort(
          (a, b) =>
            (a.lat - originPt.lat) ** 2 +
            (a.lng - originPt.lng) ** 2 -
            ((b.lat - originPt.lat) ** 2 + (b.lng - originPt.lng) ** 2),
        )
        .slice(0, 150);
      for (const p of nearest) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, {
        padding: { top: 70, bottom: 70, left: 430, right: 70 },
        maxZoom: 12,
        duration: 500,
      });
    } else {
      map.flyTo({ center: [originPt.lng, originPt.lat], zoom: 9, duration: 500 });
    }
  }, [points, originPt.lat, originPt.lng, ready]);

  // Auswahl hervorheben + hinfliegen
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource('sel') as GeoJSONSource | undefined;
    if (!src) return;
    const sel = selectedId ? points.find((p) => p.id === selectedId) : null;
    if (sel) {
      src.setData({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [sel.lng, sel.lat] }, properties: {} },
        ],
      });
      map.flyTo({ center: [sel.lng, sel.lat], zoom: Math.max(map.getZoom(), 12), duration: 500 });
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [selectedId, points, ready]);

  // Feuerstellen dynamisch aus Overpass laden (debounced, ab POI_MIN_ZOOM)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const clearPois = () => {
      const s = map.getSource('pois') as GeoJSONSource | undefined;
      s?.setData({ type: 'FeatureCollection', features: [] });
    };

    const fetchPois = () => {
      if (map.getZoom() < POI_MIN_ZOOM) {
        clearPois();
        return;
      }
      const b = map.getBounds();
      const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
      const query = `[out:json][timeout:25];\n(\n  node["amenity"="bbq"](${bbox});\n  node["amenity"="fireplace"](${bbox});\n);\nout body;`;

      poiAbort.current?.abort();
      const ctrl = new AbortController();
      poiAbort.current = ctrl;

      fetch(OVERPASS_URL, { method: 'POST', body: `data=${encodeURIComponent(query)}`, signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Overpass ${r.status}`))))
        .then((data: { elements?: OverpassNode[] }) => {
          const features: GeoJSON.Feature<GeoJSON.Point>[] = (data.elements ?? []).map((el) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
            properties: { name: el.tags?.name ?? '' },
          }));
          const s = map.getSource('pois') as GeoJSONSource | undefined;
          s?.setData({ type: 'FeatureCollection', features });
        })
        .catch(() => {
          /* abgebrochen oder Overpass-Limit – stillschweigend ignorieren */
        });
    };

    const debounced = () => {
      if (poiTimer.current) clearTimeout(poiTimer.current);
      poiTimer.current = setTimeout(fetchPois, OVERPASS_DEBOUNCE);
    };

    fetchPois();
    map.on('moveend', debounced);
    return () => {
      map.off('moveend', debounced);
    };
  }, [ready]);

  // Namen-Labels nur wenn gewünscht
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer('point-name')) return;
    map.setLayoutProperty('point-name', 'visibility', alwaysLabels ? 'visible' : 'none');
  }, [alwaysLabels, ready]);

  return (
    <div className="map-wrap">
      <div className="pk-map" ref={wrapRef} />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
