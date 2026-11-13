/**
 * Farbklassen der Wetterkarte – eine Quelle für Radarbild (Server), Raster und
 * Legende (Browser).
 *
 * Grössen (Niederschlag, Neuschnee, Böen, Bewölkung) sind einfarbige Rampen von
 * hell nach dunkel, die Temperatur ist divergierend (kalt blau – 0 °C neutral –
 * warm rot). Blau stammt aus der dokumentierten Referenzrampe, die übrigen Töne
 * sind auf deren Helligkeitsstufen abgeleitet. Geprüft: Helligkeit monoton, Abstand
 * benachbarter Stufen ≥ 0,06 (OKLCH L), ein Farbton je Rampe. Die hellste Stufe
 * («wenig») tritt bewusst zurück; den genauen Wert zeigt die Abfrage per Zeiger.
 */

export type WeatherLayerKey = 'precip' | 'snowfall' | 'gust' | 'temp' | 'cloud';

export interface WeatherScale {
  key: WeatherLayerKey;
  label: string;
  unit: string;
  /** Untergrenzen der Klassen; darunter transparent (bei divergierend: erste Klasse ab −∞). */
  from: number[];
  colors: string[];
  /** Divergierend: die erste Klasse reicht bis −∞. */
  diverging?: boolean;
  /** Deckkraft des Rasters auf der Karte. */
  opacity: number;
  /** Text der Legende je Klasse. */
  labels: string[];
}

export const WEATHER_SCALES: Record<WeatherLayerKey, WeatherScale> = {
  precip: {
    key: 'precip', label: 'Niederschlag', unit: 'mm/h',
    from: [0.1, 1, 2, 5, 10, 20],
    colors: ['#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    opacity: 0.72,
    labels: ['0,1', '1', '2', '5', '10', '20+'],
  },
  snowfall: {
    key: 'snowfall', label: 'Neuschnee', unit: 'cm/h',
    from: [0.1, 0.5, 1, 2, 4],
    colors: ['#b9bafe', '#9996fa', '#7c6ff6', '#6254ce', '#493da1'],
    opacity: 0.72,
    labels: ['0,1', '0,5', '1', '2', '4+'],
  },
  gust: {
    key: 'gust', label: 'Windböen', unit: 'km/h',
    from: [30, 50, 70, 90, 110],
    colors: ['#f2b098', '#e68764', '#d95923', '#b44005', '#8a2e00'],
    opacity: 0.62,
    labels: ['30', '50', '70', '90', '110+'],
  },
  temp: {
    key: 'temp', label: 'Temperatur', unit: '°C',
    from: [-Infinity, -20, -10, -5, -1, 1, 5, 10, 20],
    colors: ['#184f95', '#256abf', '#3987e5', '#9ec5f4', '#f0efec', '#f8aaa3', '#e24a48', '#bb3032', '#911e22'],
    diverging: true,
    opacity: 0.55,
    labels: ['<−20', '−20', '−10', '−5', '±1', '1', '5', '10', '20+'],
  },
  cloud: {
    key: 'cloud', label: 'Bewölkung', unit: '%',
    from: [25, 50, 75, 90],
    colors: ['#d0d0d0', '#b2b2b2', '#959595', '#797979'],
    opacity: 0.5,
    labels: ['25', '50', '75', '90+'],
  },
};

/** Klasse eines Werts (Index in `colors`) oder −1 = transparent. */
export function scaleClass(scale: WeatherScale, value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return -1;
  if (!scale.diverging && value < scale.from[0]) return -1;
  let k = scale.from.length - 1;
  while (k > 0 && value < scale.from[k]) k--;
  return k;
}

/** Prognoseraster für die Karte: Werte je Stunde und Zelle (0,1°). */
export interface ForecastGridResponse {
  variable: WeatherLayerKey;
  /** Immer Modellprognose – nie als Messung darstellen. */
  evidence: 'forecast';
  source: string;
  /** Zeitpunkt des Prognoseabrufs (neueste Zelle). */
  fetchedAt: string | null;
  /** Erste Stunde (UTC, volle Stunde). */
  start: string;
  hours: number;
  cellDeg: number;
  /** Südwestecke je Zelle [lat, lng]. */
  cells: [number, number][];
  /** Modellhöhe je Zelle (m), wichtig für die Temperatur. */
  elevations: (number | null)[];
  /** values[stunde][zelle]; null = kein Wert. */
  values: (number | null)[][];
}

/** Liste der jüngsten Radarbilder (Messung). */
export interface RadarFramesResponse {
  evidence: 'measured';
  source: string;
  frames: { time: string; stamp: string }[];
  /** Bildecken für MapLibre: oben links, oben rechts, unten rechts, unten links ([lng, lat]). */
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
}
