import { z } from 'zod';

/** Ein Treffer der Ortssuche (Proxy auf swisstopo SearchServer). */
export const geocodeResultSchema = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
  canton: z.string().nullable().optional(),
  detail: z.string().nullable().optional(),
});
export type GeocodeResult = z.infer<typeof geocodeResultSchema>;

export const geocodeResponseSchema = z.object({
  results: z.array(geocodeResultSchema),
});
export type GeocodeResponse = z.infer<typeof geocodeResponseSchema>;
