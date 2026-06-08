import { z } from 'zod';

/** Ein Punkt in WGS84 (EPSG:4326). */
export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

/** Grober Bounding-Box-Check Schweiz (inkl. Puffer) — für Eingabevalidierung. */
export const CH_BOUNDS = {
  minLat: 45.5,
  maxLat: 48.0,
  minLng: 5.7,
  maxLng: 10.6,
} as const;

export function isInSwitzerland(p: LatLng): boolean {
  return (
    p.lat >= CH_BOUNDS.minLat &&
    p.lat <= CH_BOUNDS.maxLat &&
    p.lng >= CH_BOUNDS.minLng &&
    p.lng <= CH_BOUNDS.maxLng
  );
}
