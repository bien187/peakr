/**
 * Umrechnung Schweizer Landeskoordinaten LV95 (EPSG:2056) ⇄ WGS84 (EPSG:4326).
 *
 * Näherungsformeln von swisstopo («Näherungslösungen für die direkte
 * Transformation CH1903+ ⇔ WGS84»), Genauigkeit rund 1 m. Für den Import wird die
 * Umrechnung in Node benötigt, weil GeoPackage und CSV ohne Datenbank gelesen
 * werden; in der Datenbank selbst rechnet PostGIS.
 */

export interface Wgs84 {
  lat: number;
  lng: number;
}

export interface Lv95 {
  e: number;
  n: number;
}

export function lv95ToWgs84(e: number, n: number): Wgs84 {
  const y = (e - 2_600_000) / 1_000_000;
  const x = (n - 1_200_000) / 1_000_000;

  const lngSec =
    2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
  const latSec =
    16.9023892 +
    3.238272 * x -
    0.270978 * y * y -
    0.002528 * x * x -
    0.0447 * y * y * x -
    0.014 * x * x * x;

  return { lat: (latSec * 100) / 36, lng: (lngSec * 100) / 36 };
}

export function wgs84ToLv95(lat: number, lng: number): Lv95 {
  const phi = (lat * 3600 - 169_028.66) / 10_000;
  const lam = (lng * 3600 - 26_782.5) / 10_000;

  const e =
    2_600_072.37 +
    211_455.93 * lam -
    10_938.51 * lam * phi -
    0.36 * lam * phi * phi -
    44.54 * lam * lam * lam;
  const n =
    1_200_147.07 +
    308_807.95 * phi +
    3_745.25 * lam * lam +
    76.63 * phi * phi -
    194.56 * lam * lam * phi +
    119.79 * phi * phi * phi;

  return { e, n };
}

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
