'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { fmtDrive, scoreColor, type PCard } from '@/lib/peakr';

const STYLE_URL =
  process.env.NEXT_PUBLIC_SWISSTOPO_STYLE_URL ??
  'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json';

// Kostenloser OSM-Raster-Fallback, falls der Vektor-Style nicht lädt.
const RASTER_FALLBACK: maplibregl.StyleSpecification = {
  version: 8,
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

const LABEL_ZOOM = 9;

function markerEl(r: PCard, onSelect: (id: string) => void): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'pk-mk';
  el.dataset.sug = r.suggestion ? '1' : '0';
  el.style.setProperty('--pin', scoreColor(r.score));
  const token = document.createElement('div');
  token.className = 'pk-mk-token';
  token.textContent = String(r.score);
  const label = document.createElement('div');
  label.className = 'pk-mk-label';
  label.textContent = `${r.name.split(' – ')[0].split(' (')[0]} · ${fmtDrive(r.driveMin)}`;
  el.appendChild(token);
  el.appendChild(label);
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onSelect(r.id);
  });
  return el;
}

export function PeakrMap({
  results,
  originPt,
  selectedId,
  onSelect,
  alwaysLabels,
}: {
  results: PCard[];
  originPt: { lat: number; lng: number };
  originLabel: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  mode: 'ski' | 'hike';
  alwaysLabels: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const originMarker = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);

  // Karte einmalig initialisieren
  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: wrapRef.current,
      style: STYLE_URL,
      center: [8.23, 46.8],
      zoom: 6.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    let fellBack = false;
    map.on('error', (e) => {
      if (!fellBack && STYLE_URL && e?.error) {
        fellBack = true;
        try {
          map.setStyle(RASTER_FALLBACK);
        } catch {
          /* ignore */
        }
      }
    });
    map.on('load', () => {
      map.resize();
      setReady(true);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(wrapRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Labels beim Zoomen ein-/ausblenden
  useEffect(() => {
    const map = mapRef.current;
    const wrap = wrapRef.current;
    if (!map || !wrap) return;
    const apply = () => {
      const on = alwaysLabels && map.getZoom() >= LABEL_ZOOM;
      wrap.classList.toggle('labels-on', on);
    };
    apply();
    map.on('zoom', apply);
    return () => {
      map.off('zoom', apply);
    };
  }, [ready, alwaysLabels]);

  // Marker aktualisieren + auf alle Ziele zoomen
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    for (const m of markers.current.values()) m.remove();
    markers.current.clear();

    const bounds = new maplibregl.LngLatBounds();
    for (const r of results) {
      const marker = new maplibregl.Marker({ element: markerEl(r, onSelect) })
        .setLngLat([r.lng, r.lat])
        .addTo(map);
      markers.current.set(r.id, marker);
      bounds.extend([r.lng, r.lat]);
    }

    originMarker.current?.remove();
    const oEl = document.createElement('div');
    oEl.className = 'pk-origin-dot';
    originMarker.current = new maplibregl.Marker({ element: oEl })
      .setLngLat([originPt.lng, originPt.lat])
      .addTo(map);
    bounds.extend([originPt.lng, originPt.lat]);

    if (results.length > 0 && !bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: { top: 70, bottom: 70, left: 70, right: 430 }, maxZoom: 11, duration: 500 });
    } else {
      map.flyTo({ center: [originPt.lng, originPt.lat], zoom: 9, duration: 500 });
    }
  }, [results, originPt.lat, originPt.lng, ready, onSelect]);

  // Auswahl hervorheben + hinfliegen
  useEffect(() => {
    for (const [id, m] of markers.current) {
      m.getElement().dataset.sel = id === selectedId ? '1' : '0';
    }
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const sel = results.find((r) => r.id === selectedId);
    if (sel) {
      map.flyTo({ center: [sel.lng, sel.lat], zoom: Math.max(map.getZoom(), 10), duration: 500 });
    }
  }, [selectedId, results]);

  return (
    <div className="map-wrap">
      <div className="pk-map" ref={wrapRef} />
    </div>
  );
}
