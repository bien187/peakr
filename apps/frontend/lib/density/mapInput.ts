/**
 * Welche Ziele der Suche in Heatmap, Hotspot-Zahlen und Kartenausschnitt eingehen.
 *
 * Nur die Treffer innerhalb der gewählten Fahrzeit. «Knapp ausserhalb» (Toleranz),
 * Ziele ohne Route bzw. mit unbekannter Schwierigkeit und – auf Wunsch gezeigte –
 * nicht verfügbare erscheinen nur als Einzelpunkte und in der Liste. Sonst würde
 * z. B. bei «≤ 30 min +60» die Toleranzzone bis 90 min (5000+ Ziele) die eigentlichen
 * Treffer (700) überstrahlen, und die Karte sähe aus wie bei jeder anderen Fahrzeit.
 */
import type { PPoint } from '@/lib/peakr';
import type { DensityPoint } from './densityEngine';

/** Treffer innerhalb der Fahrzeit (verfügbar bzw. auf Wunsch unsicher), nicht «nicht verfügbar». */
export const isHeatPoint = (p: PPoint): boolean => p.section === 'result' && p.status !== 'unavailable';

/** Eingabe für Heatmap und Hotspot-Zahlen. */
export function heatPoints(points: readonly PPoint[]): DensityPoint[] {
  return points.filter(isHeatPoint).map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, kind: p.kind, weight: 1 }));
}

/**
 * Ziele für den Kartenausschnitt nach einer Suche: die Treffer innerhalb der Fahrzeit.
 * Nur wenn es keine gibt, alle mit Fahrzeit (damit «knapp ausserhalb» sichtbar wird).
 */
export function fitPoints(points: readonly PPoint[]): PPoint[] {
  const hits = points.filter((p) => p.section === 'result' && p.driveMin != null);
  return hits.length > 0 ? hits : points.filter((p) => p.driveMin != null);
}
