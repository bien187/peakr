/**
 * PeakrSmartHotspotLayer – schwebende Zahlen auf mittlerem Zoom («530 Ziele»).
 *
 *  - Nur für grosse, relevante Hotspots (Maximum der Dichte mindestens «mittel»,
 *    Mindestanzahl je Band). Die Zahl ist die echte Anzahl der Ziele im leuchtenden
 *    Einzugsgebiet (PeakrDensityEngine) – jedes Ziel zählt höchstens einmal.
 *  - Gezeichnet als MapLibre-Symbole (GPU) mit kleiner dunkler Fläche und feiner
 *    Mint-Kontur: bewegen sich exakt mit der Karte, keine DOM-Elemente.
 *  - Drei Bänder je nach Zoom; dazwischen kurze Überblendung. Grössere Hotspots
 *    werden zuerst platziert, überlappende kleinere fallen weg.
 *  - Ganze Schweiz (Zustand A): keine Zahlen. Nah (Zustand C): keine Zahlen mehr,
 *    dort stehen die Einzelziele.
 */
import type * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import { DEFAULT_LEVELS, hotspotAt, type DensityLevels, type DensityModel, type Hotspot, type HotspotBand } from './densityEngine';
import { KIND_META } from '@/lib/peakr';

export const HOTSPOT_SOURCE = 'hotspots';
const PILL = 'hs-pill';
const FONT_NUM = ['Frutiger Neue Condensed Bold'];
const FONT_UNIT = ['Frutiger Neue Condensed Regular'];

export interface BandRange {
  /** Zoom, für den die Engine das Band rechnet. */
  zoom: number;
  /** Sichtbar von–bis (Zoom), mit Überblendung an den Rändern. */
  from: number;
  to: number;
}

/** Zustand A endet bei 7,4 (darunter nur Heatmap); Zustand C beginnt bei 10,3. */
export const BAND_RANGES: readonly BandRange[] = [
  { zoom: 7.5, from: 7.4, to: 8.4 },
  { zoom: 8.5, from: 8.25, to: 9.4 },
  { zoom: 9.5, from: 9.25, to: 10.3 },
];
/** Schwache Geräte: ein Band für den ganzen mittleren Zoom. */
export const BAND_RANGES_LITE: readonly BandRange[] = [{ zoom: 8.5, from: 7.4, to: 10.3 }];
/** Bis zu diesem Zoom führt Tippen auf leuchtende Flächen hinein. */
export const HOTSPOT_TAP_MAX_ZOOM = 10.3;

const FADE = 0.15;
/** Mindestanteil an allen Zielen für eine Zahl, je Band (weit → nah). */
const LABEL_SHARE = [0.02, 0.008, 0.004];
const LABEL_MIN = 8;
const LABEL_MAX_PER_BAND = 40;

const nf = new Intl.NumberFormat('de-CH');

/** «530 Ziele» bzw. «12 Skigebiete», wenn der Hotspot nur aus Skigebieten besteht. */
export function hotspotUnit(h: Pick<Hotspot, 'kinds'>): string {
  const kinds = Object.keys(h.kinds);
  return kinds.length === 1 && kinds[0] === 'ski' ? 'Skigebiete' : 'Ziele';
}

/** Aufschlüsselung für den Hinweis beim Überfahren, häufigste Arten zuerst. */
export function hotspotBreakdown(h: Pick<Hotspot, 'kinds'>, max = 3): string {
  return Object.entries(h.kinds)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([kind, n]) => {
      const meta = KIND_META[kind as keyof typeof KIND_META];
      return `${nf.format(n)} ${meta ? (n === 1 ? meta.label : meta.plural) : kind}`;
    })
    .join(' · ');
}

/**
 * Welche Hotspots eines Bands eine Zahl bekommen: Maximum mindestens «hoch»
 * (Stufe aus den Daten) und genug Ziele. Kleinere bleiben reine Heatmap.
 */
export function labelledHotspots(
  band: HotspotBand,
  bandIndex: number,
  total: number,
  compact: boolean,
  levels: DensityLevels = DEFAULT_LEVELS,
): Hotspot[] {
  const share = LABEL_SHARE[Math.min(bandIndex, LABEL_SHARE.length - 1)] * (compact ? 1.5 : 1);
  const min = Math.max(LABEL_MIN, Math.ceil(total * share));
  return band.hotspots.filter((h) => h.count >= min && h.peak >= levels.high).slice(0, LABEL_MAX_PER_BAND);
}

function fade(r: BandRange): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], r.from, 0, r.from + FADE, 1, r.to - FADE, 1, r.to, 0] as ExpressionSpecification;
}

/** Dunkle Fläche mit feiner Mint-Kontur, dehnbar (icon-text-fit). */
function pillImage(): { image: { width: number; height: number; data: Uint8Array }; options: Record<string, unknown> } | null {
  if (typeof document === 'undefined') return null;
  const ratio = 2;
  const w = 32 * ratio;
  const h = 22 * ratio;
  const r = 8 * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const line = 1 * ratio;
  const x = line / 2;
  const y = line / 2;
  const ww = w - line;
  const hh = h - line;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + ww, y, x + ww, y + hh, r);
  ctx.arcTo(x + ww, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + ww, y, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(12, 21, 17, 0.8)';
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = 'rgba(127, 224, 166, 0.85)';
  ctx.stroke();
  const data = new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer);
  return {
    image: { width: w, height: h, data },
    options: {
      pixelRatio: ratio,
      stretchX: [[r + 2, w - r - 2]],
      stretchY: [[r, h - r]],
      content: [r - 4, 6, w - r + 4, h - 6],
    },
  };
}

export class PeakrSmartHotspotLayer {
  private bands: HotspotBand[] = [];

  constructor(
    private readonly map: maplibregl.Map,
    private readonly opts: { lite: boolean; compact: () => boolean },
  ) {}

  get ranges(): readonly BandRange[] {
    return this.opts.lite ? BAND_RANGES_LITE : BAND_RANGES;
  }

  /** Zoomstufen, für die die Engine Bänder rechnen soll. */
  get bandZooms(): number[] {
    return this.ranges.map((r) => r.zoom);
  }

  layerIds(): string[] {
    return this.ranges.map((_, i) => `hotspot-${i}`);
  }

  install(beforeId?: string): void {
    const { map } = this;
    if (!map.hasImage(PILL)) {
      const pill = pillImage();
      if (pill) map.addImage(PILL, pill.image, pill.options as never);
    }
    if (!map.getSource(HOTSPOT_SOURCE)) map.addSource(HOTSPOT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this.ranges.forEach((r, i) => {
      const id = `hotspot-${i}`;
      if (map.getLayer(id)) return;
      map.addLayer(
        {
          id,
          type: 'symbol',
          source: HOTSPOT_SOURCE,
          filter: ['==', ['get', 'band'], i],
          minzoom: r.from,
          maxzoom: r.to,
          layout: {
            'icon-image': PILL,
            'icon-text-fit': 'both',
            'icon-text-fit-padding': [2, 7, 2, 7],
            'text-field': [
              'format',
              ['get', 'n'],
              { 'text-font': ['literal', FONT_NUM] },
              ['concat', ' ', ['get', 'unit']],
              { 'text-font': ['literal', FONT_UNIT] },
            ],
            'text-font': FONT_UNIT,
            'text-size': ['case', ['get', 'compact'], 12, 12.5],
            // Viel Luft zwischen den Zahlen: wenige, schwebende statt eines Rasters.
            'text-padding': this.opts.compact() ? 30 : 44,
            'text-allow-overlap': false,
            'icon-allow-overlap': false,
            'symbol-sort-key': ['-', 0, ['get', 'count']],
          },
          paint: {
            'text-color': '#effff5',
            'text-opacity': fade(r),
            'icon-opacity': fade(r),
          },
        },
        beforeId,
      );
    });
  }

  /** Neues Dichtemodell: Zahlen je Band neu setzen. */
  setModel(model: DensityModel): void {
    this.bands = model.bands;
    const compact = this.opts.compact();
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    model.bands.forEach((band, i) => {
      for (const h of labelledHotspots(band, i, model.points, compact, model.levels)) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
          properties: {
            band: i,
            count: h.count,
            n: nf.format(h.count),
            unit: hotspotUnit(h),
            info: hotspotBreakdown(h),
            compact,
            w: h.bbox[0],
            s: h.bbox[1],
            e: h.bbox[2],
            nn: h.bbox[3],
          },
        });
      }
    });
    (this.map.getSource(HOTSPOT_SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  clear(): void {
    this.bands = [];
    (this.map.getSource(HOTSPOT_SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
  }

  /**
   * Hotspot unter einem angetippten Ort (nur im sichtbar leuchtenden Bereich eines
   * relevanten Hotspots, nur bis mittleren Zoom). Weit herausgezoomt zählt das
   * erste Band, sonst das Band, dessen Zoom am nächsten liegt.
   */
  hotspotAt(lng: number, lat: number, zoom: number): Hotspot | null {
    if (this.bands.length === 0 || zoom >= HOTSPOT_TAP_MAX_ZOOM) return null;
    let best = this.bands[0];
    for (const b of this.bands) if (Math.abs(b.zoom - zoom) < Math.abs(best.zoom - zoom)) best = b;
    const h = hotspotAt(best, lng, lat);
    return h && h.count >= 3 ? h : null;
  }
}

/** Ausdehnung aus den Eigenschaften eines Zahl-Symbols (Klick). */
export function bboxOfFeature(f: maplibregl.MapGeoJSONFeature): [number, number, number, number] | null {
  const p = f.properties as Record<string, unknown>;
  const v = [p.w, p.s, p.e, p.nn].map(Number);
  return v.every(Number.isFinite) ? (v as [number, number, number, number]) : null;
}
