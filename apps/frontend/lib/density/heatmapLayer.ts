/**
 * PeakrHeatmapLayer – organische Dichte der Ziele als MapLibre-Heatmap (GPU).
 *
 *  - Liegt über den Flächen der Grundkarte (Relief, Wald, Wasser) und unter allen
 *    Linien und Beschriftungen: Strassen, Wege, Höhenlinien und Namen bleiben
 *    scharf darüber – die Heatmap wirkt wie Licht unter der Topografie.
 *  - Farben nur Mint/Grün. Auf der dunklen Karte genau die Stufen aus dem
 *    Auftrag (heller = dichter). Auf der hellen Karte dieselben Grüntöne, aber
 *    dichter = dunkler: auf weissem Grund würde helleres Mint schwächer wirken.
 *  - Radius und Intensität kommen aus der PeakrDensityEngine (geografisch
 *    skaliert, normalisiert). Ab mittlerem Zoom blendet die Heatmap weich aus,
 *    während die Einzelziele einblenden.
 */
import type * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import { DENSITY_LEVELS, intensityExpression, MAX_INTENSITY, radiusExpression, type DensityModel } from './densityEngine';

export const HEAT_SOURCE = 'density';
export const HEAT_LAYER = 'density-heat';

/** Übergang zu den Einzelzielen: ab hier blendet die Heatmap aus, bis hier ist sie weg. */
export const HEAT_FADE: readonly [number, number] = [9.8, 11.3];
/** Im Wetterbild tritt die Heatmap zurück. */
const WEATHER_FACTOR = 0.5;

const L = DENSITY_LEVELS;
const ZERO = 'rgba(87,159,119,0)';
const RAMP_DARK: [number, string][] = [
  [L.veryLow, 'rgba(87,159,119,0.08)'],
  [L.low, 'rgba(91,190,137,0.16)'],
  [L.medium, 'rgba(107,211,153,0.30)'],
  [L.high, 'rgba(127,224,166,0.48)'],
  [L.veryHigh, 'rgba(160,238,187,0.65)'],
];
const RAMP_LIGHT: [number, string][] = [
  [L.veryLow, 'rgba(107,211,153,0.07)'],
  [L.low, 'rgba(91,190,137,0.15)'],
  [L.medium, 'rgba(72,170,115,0.26)'],
  [L.high, 'rgba(56,150,98,0.38)'],
  [L.veryHigh, 'rgba(42,128,82,0.50)'],
];

export function heatColor(dark: boolean): ExpressionSpecification {
  const ramp = dark ? RAMP_DARK : RAMP_LIGHT;
  return ['interpolate', ['linear'], ['heatmap-density'], 0, ZERO, ...ramp.flat()] as ExpressionSpecification;
}

export function heatOpacity(factor: number): ExpressionSpecification {
  const [a, b] = HEAT_FADE;
  return ['interpolate', ['linear'], ['zoom'], 4, factor, a, factor, (a + b) / 2, factor * 0.4, b, 0] as ExpressionSpecification;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * Einfügeort: vor der ersten Linie bzw. Beschriftung nach der Wasserfläche der
 * Grundkarte – also über Relief, Wald und Wasser, unter Strassen, Wegen und
 * Namen. Ohne passende Ebenen (Ersatzkarte) direkt unter der ersten eigenen Ebene.
 */
export function heatmapBeforeId(map: maplibregl.Map, firstAppLayer: string): string | undefined {
  const order = map.getLayersOrder();
  const app = order.indexOf(firstAppLayer);
  const base = app >= 0 ? order.slice(0, app) : order;
  const water = base.lastIndexOf('water');
  if (water >= 0) {
    for (let i = water + 1; i < base.length; i++) {
      const type = map.getLayer(base[i])?.type;
      if (type === 'line' || type === 'symbol') return base[i];
    }
  }
  const symbol = base.find((id) => map.getLayer(id)?.type === 'symbol');
  return symbol ?? (app >= 0 ? firstAppLayer : undefined);
}

export class PeakrHeatmapLayer {
  private dark = false;
  private weather = false;
  /** Erst sichtbar, wenn ein Dichtemodell da ist (sonst stimmte die Intensität nicht). */
  private hasModel = false;

  constructor(
    private readonly map: maplibregl.Map,
    private readonly opts: { reducedMotion: boolean },
  ) {}

  /** Quelle und Ebene anlegen (idempotent, auch nach Stilwechsel). */
  install(beforeId: string | undefined): void {
    const { map } = this;
    if (!map.getSource(HEAT_SOURCE)) map.addSource(HEAT_SOURCE, { type: 'geojson', data: EMPTY });
    if (map.getLayer(HEAT_LAYER)) return;
    map.addLayer(
      {
        id: HEAT_LAYER,
        type: 'heatmap',
        source: HEAT_SOURCE,
        maxzoom: HEAT_FADE[1] + 0.2,
        paint: {
          'heatmap-weight': ['get', 'w'],
          'heatmap-intensity': MAX_INTENSITY,
          'heatmap-radius': radiusExpression() as ExpressionSpecification,
          'heatmap-color': heatColor(this.dark),
          'heatmap-opacity': heatOpacity(0),
          // Nur Themenwechsel (hell/dunkel/Wetter) und das erste Einblenden gleiten;
          // neue Daten samt Intensität wechseln gleichzeitig, ohne Zwischenstand.
          'heatmap-opacity-transition': { duration: this.opts.reducedMotion ? 0 : 450, delay: 0 },
          'heatmap-intensity-transition': { duration: 0, delay: 0 },
        },
      },
      beforeId,
    );
  }

  /** Neue Ziele samt Dichtemodell: Daten und Intensität im selben Moment. */
  setData(features: GeoJSON.FeatureCollection<GeoJSON.Point>, model: DensityModel): void {
    const { map } = this;
    (map.getSource(HEAT_SOURCE) as GeoJSONSource | undefined)?.setData(features);
    if (!map.getLayer(HEAT_LAYER)) return;
    map.setPaintProperty(HEAT_LAYER, 'heatmap-intensity', intensityExpression(model.intensity) as ExpressionSpecification);
    this.hasModel = true;
    this.applyOpacity();
  }

  setTheme(dark: boolean, weather: boolean): void {
    const colorChanged = dark !== this.dark;
    this.dark = dark;
    this.weather = weather;
    if (!this.map.getLayer(HEAT_LAYER)) return;
    if (colorChanged) this.map.setPaintProperty(HEAT_LAYER, 'heatmap-color', heatColor(dark));
    this.applyOpacity();
  }

  private applyOpacity(): void {
    if (!this.map.getLayer(HEAT_LAYER)) return;
    const factor = this.hasModel ? (this.weather ? WEATHER_FACTOR : 1) : 0;
    this.map.setPaintProperty(HEAT_LAYER, 'heatmap-opacity', heatOpacity(factor));
  }
}
