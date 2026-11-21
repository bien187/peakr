/**
 * PeakrDestinationLayer – Einzelziele auf nahem Zoom (Zustand C).
 *
 *  - Kleine, schlichte Punkte mit Mint-Akzent (weicher Mint-Schein unter
 *    Wanderzielen); Skigebiete blau, Ziele ohne Angabe grau wie bisher.
 *  - Blenden ein, während die Heatmap ausblendet – kein harter Wechsel.
 *  - Symbole der Art (Gipfel, See …) und Namen erst, wenn genug Platz ist.
 *  - Auswahl, Hinweis beim Überfahren und Detailansicht bleiben unverändert
 *    (Ebenen-IDs `points`, `point-icons`, `point-name` wie bisher).
 */
import type * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';

export const DEST_SOURCE = 'dests';
/** Einblenden der Einzelziele (Zoom von–bis). */
export const DEST_FADE: readonly [number, number] = [9.8, 10.6];
const ICON_FROM = 11.6;
const NAME_FROM = 11.6;

export const HIKE_GREEN = '#3f9457';
export const SKI_BLUE = '#3a72b0';
export const MUTED = '#8a94a0';
export const MINT = '#7fe0a6';
const SKI_BLUE_DARK = '#7aa9e6';

const IS_MUTED: ExpressionSpecification = ['in', ['get', 'section'], ['literal', ['sac_unknown', 'unrouted']]];
/** «Knapp ausserhalb» und Ziele ohne Angabe heller als die eigentlichen Treffer. */
const SECTION_ALPHA: ExpressionSpecification = ['match', ['get', 'section'], 'result', 1, 0.5];

const fadeIn = (to: ExpressionSpecification | number, [a, b] = DEST_FADE): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], a, 0, b, to] as ExpressionSpecification;

export function pointColor(dark: boolean): ExpressionSpecification {
  return ['case', IS_MUTED, MUTED, ['==', ['get', 'type'], 'ski'], dark ? SKI_BLUE_DARK : SKI_BLUE, dark ? MINT : HIKE_GREEN];
}

const strokeColor = (dark: boolean): string => (dark ? 'rgba(8, 14, 11, 0.92)' : '#ffffff');
const haloOpacity = (dark: boolean): ExpressionSpecification => fadeIn(['*', dark ? 0.34 : 0.3, SECTION_ALPHA]);

/** Symbol je Art: weiss auf dem farbigen Punkt, auf der dunklen Karte dunkel auf Mint. */
export type IconForKind = (dark: boolean) => ExpressionSpecification;

export function destinationLayers(opts: { lite: boolean; font: string[]; iconForKind: IconForKind }): LayerSpecification[] {
  const layers: LayerSpecification[] = [];
  if (!opts.lite) {
    layers.push({
      id: 'points-halo',
      type: 'circle',
      source: DEST_SOURCE,
      minzoom: DEST_FADE[0],
      filter: ['all', ['==', ['get', 'type'], 'hike'], ['!', IS_MUTED]],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], DEST_FADE[0], 7, 11, 8.5, 13, 11.5, 15, 14.5],
        'circle-color': MINT,
        'circle-blur': 0.75,
        'circle-opacity': haloOpacity(false),
      },
    });
  }
  layers.push(
    {
      id: 'points',
      type: 'circle',
      source: DEST_SOURCE,
      minzoom: DEST_FADE[0],
      paint: {
        'circle-color': pointColor(false),
        'circle-opacity': fadeIn(SECTION_ALPHA),
        'circle-stroke-opacity': fadeIn(1),
        'circle-radius': ['interpolate', ['linear'], ['zoom'], DEST_FADE[0], 3.2, 11, 4.6, 13, 7, 15, 10],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], DEST_FADE[0], 1, 12, 1.6],
        'circle-stroke-color': strokeColor(false),
      },
    },
    {
      id: 'point-icons',
      type: 'symbol',
      source: DEST_SOURCE,
      minzoom: ICON_FROM,
      layout: {
        'icon-image': opts.iconForKind(false),
        'icon-size': ['interpolate', ['linear'], ['zoom'], ICON_FROM, 0.3, 13, 0.38, 15, 0.52],
        'icon-allow-overlap': false,
      },
      paint: { 'icon-opacity': fadeIn(1, [ICON_FROM, ICON_FROM + 0.5]) },
    },
    {
      id: 'point-name',
      type: 'symbol',
      source: DEST_SOURCE,
      minzoom: NAME_FROM,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-font': opts.font,
      },
      paint: {
        'text-color': '#1f2933',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4,
        'text-opacity': fadeIn(1, [NAME_FROM, NAME_FROM + 0.5]),
      },
    },
  );
  return layers;
}

/** Farben für helle bzw. dunkle Karte. */
export function setDestinationTheme(
  map: maplibregl.Map,
  dark: boolean,
  names: { text: string; halo: string },
  iconForKind: IconForKind,
): void {
  if (map.getLayer('points')) {
    map.setPaintProperty('points', 'circle-color', pointColor(dark));
    map.setPaintProperty('points', 'circle-stroke-color', strokeColor(dark));
  }
  if (map.getLayer('point-icons')) map.setLayoutProperty('point-icons', 'icon-image', iconForKind(dark));
  if (map.getLayer('points-halo')) map.setPaintProperty('points-halo', 'circle-opacity', haloOpacity(dark));
  if (map.getLayer('point-name')) {
    map.setPaintProperty('point-name', 'text-color', names.text);
    map.setPaintProperty('point-name', 'text-halo-color', names.halo);
  }
}
