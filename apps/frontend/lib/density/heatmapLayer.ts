/**
 * PeakrHeatmapLayer – Dichte der Ziele als MapLibre-Heatmap (GPU).
 *
 *  - Liegt über den Flächen der Grundkarte (Relief, Wald, Wasser) und unter allen
 *    Linien und Beschriftungen: Strassen, Wege, Grenzen und Namen bleiben scharf
 *    darüber – die Heatmap wirkt wie Licht unter der Topografie.
 *  - Farben nur Mint/Grün, deutlich deckend (2.1): fünf klar unterscheidbare
 *    Stufen von dunklem Mint bis zu hellem Mint mit leichter Lichtwirkung. Die
 *    Stufen sitzen auf Quantilen der Daten (PeakrDensityEngine), damit jede Stufe
 *    echte Ziele zeigt und auch dünn besetzte Regionen erkennbar bleiben.
 *  - Auf der hellen Karte dieselben Grüntöne, dichter = dunkler (helles Mint
 *    wirkt auf Weiss schwächer).
 *  - Ab mittlerem Zoom blendet die Heatmap zügig aus, während die Einzelziele
 *    einblenden. Übergänge kurz (≈ 0,2 s), keine Animation ohne Nutzeraktion.
 */
import type * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import { DEFAULT_LEVELS, intensityExpression, MAX_INTENSITY, radiusExpression, type DensityLevels, type DensityModel } from './densityEngine';

export const HEAT_SOURCE = 'density';
export const HEAT_LAYER = 'density-heat';

/** Übergang zu den Einzelzielen: ab hier blendet die Heatmap aus, bis hier ist sie weg. */
export const HEAT_FADE: readonly [number, number] = [10.0, 11.2];
/** Im Wetterbild tritt die Heatmap zurück. */
const WEATHER_FACTOR = 0.55;
/** Dauer weicher Wechsel (Thema, erstes Einblenden). */
export const HEAT_TRANSITION_MS = 220;

type Ramp = [string, string, string, string, string, string];
/** Dunkle Karte: Rand, sehr niedrig, niedrig, mittel, hoch, sehr hoch. */
const RAMP_DARK: Ramp = [
  'rgba(40,104,72,0.12)',
  'rgba(46,116,80,0.33)',
  'rgba(58,142,98,0.47)',
  'rgba(84,184,128,0.63)',
  'rgba(130,226,168,0.83)',
  'rgba(198,252,220,0.95)',
];
/** Helle Karte: dieselben Grüntöne, dichter = dunkler. */
const RAMP_LIGHT: Ramp = [
  'rgba(110,190,145,0.12)',
  'rgba(98,182,134,0.28)',
  'rgba(74,162,112,0.42)',
  'rgba(50,140,94,0.57)',
  'rgba(28,116,72,0.72)',
  'rgba(14,92,56,0.84)',
];

/**
 * Farbe je normalisierter Dichte. Unter «sehr niedrig» ein kurzer, weicher Rand
 * (ab der Hälfte der Stufe) – so bleibt zwischen den Zielen dunkle Karte statt Nebel.
 */
export function heatColor(dark: boolean, levels: DensityLevels = DEFAULT_LEVELS): ExpressionSpecification {
  const r = dark ? RAMP_DARK : RAMP_LIGHT;
  // Stützstellen streng aufsteigend (sonst verwirft MapLibre den Ausdruck).
  const stops = [levels.veryLow * 0.5, levels.veryLow, levels.low, levels.medium, levels.high, levels.veryHigh];
  let prev = 0;
  const safe = stops.map((v) => (prev = Math.max(Number.isFinite(v) ? v : 0, prev + 1e-4)));
  return ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(46,118,82,0)', ...safe.flatMap((v, i) => [v, r[i]])] as ExpressionSpecification;
}

export function heatOpacity(factor: number): ExpressionSpecification {
  const [a, b] = HEAT_FADE;
  return ['interpolate', ['linear'], ['zoom'], 4, factor, a, factor, (a + b) / 2, factor * 0.45, b, 0] as ExpressionSpecification;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * Einfügeort: vor der ersten Linie bzw. Beschriftung nach der Wasserfläche der
 * Grundkarte – also über Relief, Wald und Wasser, unter Strassen, Wegen, Grenzen
 * und Namen. Ohne passende Ebenen (Ersatzkarte) direkt unter der ersten eigenen Ebene.
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
  private levels: DensityLevels = DEFAULT_LEVELS;
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
          'heatmap-color': heatColor(this.dark, this.levels),
          'heatmap-opacity': heatOpacity(0),
          // Nur Themenwechsel und das erste Einblenden gleiten (kurz); neue Daten
          // samt Intensität und Stufen wechseln gleichzeitig, ohne Zwischenstand.
          'heatmap-opacity-transition': { duration: this.opts.reducedMotion ? 0 : HEAT_TRANSITION_MS, delay: 0 },
          'heatmap-intensity-transition': { duration: 0, delay: 0 },
        },
      },
      beforeId,
    );
  }

  /** Neue Ziele samt Dichtemodell: Daten, Intensität und Farbstufen im selben Moment. */
  setData(features: GeoJSON.FeatureCollection<GeoJSON.Point>, model: DensityModel): void {
    const { map } = this;
    (map.getSource(HEAT_SOURCE) as GeoJSONSource | undefined)?.setData(features);
    if (!map.getLayer(HEAT_LAYER)) return;
    this.levels = model.levels;
    map.setPaintProperty(HEAT_LAYER, 'heatmap-intensity', intensityExpression(model.intensity) as ExpressionSpecification);
    map.setPaintProperty(HEAT_LAYER, 'heatmap-color', heatColor(this.dark, this.levels));
    this.hasModel = true;
    this.applyOpacity();
  }

  setTheme(dark: boolean, weather: boolean): void {
    const colorChanged = dark !== this.dark;
    this.dark = dark;
    this.weather = weather;
    if (!this.map.getLayer(HEAT_LAYER)) return;
    if (colorChanged) this.map.setPaintProperty(HEAT_LAYER, 'heatmap-color', heatColor(dark, this.levels));
    this.applyOpacity();
  }

  private applyOpacity(): void {
    if (!this.map.getLayer(HEAT_LAYER)) return;
    const factor = this.hasModel ? (this.weather ? WEATHER_FACTOR : 1) : 0;
    this.map.setPaintProperty(HEAT_LAYER, 'heatmap-opacity', heatOpacity(factor));
  }
}
