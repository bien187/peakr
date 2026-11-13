import { z } from 'zod';

/** Art eines Ziels in der Datenbank. */
export const destinationTypeSchema = z.enum(['ski_resort', 'hike_route', 'hike_destination']);
export type DestinationType = z.infer<typeof destinationTypeSchema>;

/** SAC-Wanderskala T1 (einfach) … T6 (sehr schwierig). */
export const sacDifficultySchema = z.enum(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
export type SacDifficulty = z.infer<typeof sacDifficultySchema>;

/** Reihenfolge zum Vergleichen von SAC-Graden. */
export const SAC_ORDER: Record<SacDifficulty, number> = {
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
  T5: 5,
  T6: 6,
};

/** Such-Modus. */
export const modeSchema = z.enum(['ski', 'hike']);
export type Mode = z.infer<typeof modeSchema>;

/** Zielarten beim Wandern (mehrere gleichzeitig wählbar). */
export const hikeKindSchema = z.enum(['peak', 'lake', 'hut', 'viewpoint', 'pass']);
export type HikeKind = z.infer<typeof hikeKindSchema>;
export const HIKE_KINDS: HikeKind[] = ['peak', 'lake', 'hut', 'viewpoint', 'pass'];

/** Benutzerrolle. */
export const userRoleSchema = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

/**
 * Stand der Fahrzeitberechnung für ein Ergebnis.
 *  ok          – Strassenroute bis zum Ausgangspunkt berechnet
 *  partial     – Strasse endet vor dem Ausgangspunkt (z. B. autofreier Ort); Zeit bis zum Strassenende
 *  no_route    – kein Strassenweg innerhalb der Suchgrenze gefunden
 *  unavailable – Fahrzeitberechnung steht nicht zur Verfügung
 */
export const routingStatusSchema = z.enum(['ok', 'partial', 'no_route', 'unavailable']);
export type RoutingStatus = z.infer<typeof routingStatusSchema>;

/** Art des Ausgangspunkts. */
export const trailheadKindSchema = z.enum(['parking', 'road_access', 'valley_station']);
export type TrailheadKind = z.infer<typeof trailheadKindSchema>;
