/**
 * Umrechnung Schweizer Landeskoordinaten LV95 (EPSG:2056) ⇄ WGS84 (EPSG:4326).
 *
 * Näherungsformeln von swisstopo («Näherungslösungen für die direkte
 * Transformation CH1903+ ⇔ WGS84»), Genauigkeit rund 1 m. Liegt im gemeinsamen
 * Paket, weil sowohl der Import (Node) als auch der Link in den swisstopo-Kartenviewer
 * (Browser) LV95 brauchen; in der Datenbank selbst rechnet PostGIS.
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
