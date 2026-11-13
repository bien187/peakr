/**
 * Geodätische Hilfsfunktionen für Import und Suche.
 *
 * Die LV95-Umrechnung (Näherungsformeln von swisstopo, ~1 m) liegt im gemeinsamen
 * Paket, weil auch der Link in den swisstopo-Kartenviewer im Browser sie braucht.
 */
export { lv95ToWgs84, wgs84ToLv95, type Lv95, type Wgs84 } from '@ch-alpineroute/shared';
import type { Wgs84 } from '@ch-alpineroute/shared';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number): number => (d * Math.PI) / 180;

/** Grosskreisdistanz in Metern. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Rasterzelle des Wetterrasters (0,1°), z. B. "468_82" für 46,8°N / 8,2°E. */
export const WEATHER_CELL_DEG = 0.1;
export function weatherCell(lat: number, lng: number): string {
  return `${Math.floor(lat / WEATHER_CELL_DEG)}_${Math.floor(lng / WEATHER_CELL_DEG)}`;
}
export function weatherCellCenter(cell: string): Wgs84 {
  const [a, b] = cell.split('_').map(Number);
  return { lat: (a + 0.5) * WEATHER_CELL_DEG, lng: (b + 0.5) * WEATHER_CELL_DEG };
}
