'use client';

import type { LatLng } from '@ch-alpineroute/shared';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { scoreColorHex } from '@/lib/format';

export interface MapPoint {
  id: string;
  name: string;
  location: LatLng;
  score: number;
  blocked: boolean;
}

const STYLE_URL = process.env.NEXT_PUBLIC_SWISSTOPO_STYLE_URL;

// Kostenloser OSM-Raster-Fallback (mit Attribution), falls der Vektor-Style nicht lädt.
const RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap-Mitwirkende',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function markerElement(point: MapPoint): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = String(point.score);
  el.style.cssText = `
    width: 30px; height: 30px; border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; color: #fff; cursor: pointer;
    border: 2px solid ${point.blocked ? '#dc2626' : '#0f172a'};
    box-shadow: 0 1px 4px rgba(0,0,0,.5);
    background: ${scoreColorHex(point.score)};
  `;
  return el;
}

export default function MapView({
  points,
  origin,
  selectedId,
  onSelect,
}: {
  points: MapPoint[];
  origin: LatLng | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Karte einmal initialisieren
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL ? STYLE_URL : RASTER_STYLE,
      center: [8.23, 46.8],
      zoom: 6.8,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    let fellBack = false;
    map.on('error', (e) => {
      if (!fellBack && STYLE_URL) {
        fellBack = true;
        console.warn('Vektor-Style nicht ladbar – wechsle auf OSM-Raster.', e?.error?.message);
        map.setStyle(RASTER_STYLE);
      }
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Marker aktualisieren
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of markersRef.current.values()) m.remove();
    markersRef.current.clear();

    const bounds = new maplibregl.LngLatBounds();

    for (const p of points) {
      const el = markerElement(p);
      el.addEventListener('click', () => onSelect(p.id));
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.location.lng, p.location.lat])
        .setPopup(new maplibregl.Popup({ offset: 18 }).setText(p.name))
        .addTo(map);
      markersRef.current.set(p.id, marker);
      bounds.extend([p.location.lng, p.location.lat]);
    }

    if (origin) {
      originMarkerRef.current?.remove();
      originMarkerRef.current = new maplibregl.Marker({ color: '#0ea5e9' })
        .setLngLat([origin.lng, origin.lat])
        .setPopup(new maplibregl.Popup({ offset: 18 }).setText('Startort'))
        .addTo(map);
      bounds.extend([origin.lng, origin.lat]);
    }

    if (points.length > 0 && !bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 600 });
    }
  }, [points, origin, onSelect]);

  // Auswahl: zum gewählten Marker fliegen + Popup öffnen
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const marker = markersRef.current.get(selectedId);
    if (!marker) return;
    map.flyTo({ center: marker.getLngLat(), zoom: Math.max(map.getZoom(), 11), duration: 600 });
    marker.togglePopup();
  }, [selectedId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
