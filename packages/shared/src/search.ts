import { z } from 'zod';
import { latLngSchema } from './geo';
import { hikeKindSchema, modeSchema, routingStatusSchema, sacDifficultySchema } from './enums';
import {
  destinationSchema,
  hikeRouteSummarySchema,
  liveStatusSchema,
  skiInfoSchema,
  trailheadSchema,
  trendScoreSchema,
} from './destination';

/** Eingabe für die Kern-Suche POST /api/search. */
export const searchInputSchema = z.object({
  origin: latLngSchema,
  mode: modeSchema,
  /** Maximale Autofahrzeit in Minuten. */
  maxMinutes: z.number().int().min(15).max(240),
  /** Toleranz: Ziele bis maxMinutes + Toleranz erscheinen als Vorschläge. */
  toleranceMinutes: z.number().int().min(0).max(60).default(10),

  // ── Wandern ──
  /** Zielarten; leer oder nicht gesetzt = alle. */
  kinds: z.array(hikeKindSchema).max(5).optional(),
  /** Höchste zulässige SAC-Schwierigkeit der gewählten Route. */
  maxSac: sacDifficultySchema.optional(),
  /** Routen mit unbekannter Schwierigkeit trotz SAC-Filter in die Treffer aufnehmen. */
  includeUnknownSac: z.boolean().default(false),
  /** Maximale Gehzeit (eine Richtung) in Minuten. */
  maxHikeMinutes: z.number().int().min(10).max(720).optional(),
  /** Auch Ziele ohne bekannte Wanderroute auflisten (ohne Fahrzeit). */
  includeUnrouted: z.boolean().default(false),

  // ── beide Modi ──
  /** Mindesthöhe des Ziels bzw. der Bergstation in m ü. M. */
  minElevationM: z.number().int().min(0).max(4700).optional(),

  // ── Ski ──
  /** Mindestschneehöhe am Berg in cm; Gebiete ohne Messwert fallen dann weg. */
  minSnowCm: z.number().int().min(0).max(500).optional(),

  // ── Ausgabe ──
  /** Sortierung innerhalb jedes Abschnitts. */
  sort: z.enum(['score', 'drive', 'hike', 'elevation', 'snow']).default('score'),
  /** Die Detailkarten werden seitenweise geliefert; die Kartenpunkte immer vollständig. */
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(60),
  /** Nur diese Ziele als Detailkarten liefern (z. B. nach Klick auf einen Kartenpunkt). */
  ids: z.array(z.string().uuid()).max(50).optional(),
});
export type SearchInput = z.infer<typeof searchInputSchema>;

/** Transparente Aufschlüsselung des Scores (alle Beiträge nachvollziehbar). */
export const scoreBreakdownSchema = z.object({
  base: z.number(),
  snow: z.number(),
  freshSnow: z.number(),
  liftsOpen: z.number(),
  conditions: z.number(),
  avalanchePenalty: z.number(),
  trendBonus: z.number(),
  /** Grösse/Bedeutung des Ziels. */
  size: z.number().default(0),
  /** Datenlage (Metadaten, Routenqualität). */
  data: z.number().default(0),
  total: z.number(),
});
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

/** Ein einzelnes Suchergebnis mit Fahrzeit, Ausgangspunkt, Route, Score und Bedingungen. */
export const searchResultSchema = destinationSchema.extend({
  /** Autofahrzeit in Minuten bis zum Ausgangspunkt; null = nicht berechenbar. */
  driveMinutes: z.number().nullable(),
  /** Immer false: Schätzungen aus der Luftlinie gibt es nicht mehr. */
  driveEstimated: z.boolean(),
  routingProvider: z.string(),
  routingStatus: routingStatusSchema,
  /** Strassendistanz in km; null = unbekannt. */
  routeDistanceKm: z.number().nullable(),
  /** Stand des Strassennetzes (ISO-Zeitpunkt des Graph-Builds). */
  routingUpdatedAt: z.string().nullable(),
  distanceAirKm: z.number(),

  /** Ausgangspunkt, zu dem die Fahrzeit gilt. */
  trailhead: trailheadSchema.nullable(),
  /** Gewählte Wanderroute (nur Wandern); null = keine bekannte Route. */
  hike: hikeRouteSummarySchema.nullable(),
  /** Anzahl weiterer Routenvarianten, die die Filter erfüllen. */
  hikeVariants: z.number().int().default(0),
  /** Statische Skigebietsdaten (nur Ski). */
  ski: skiInfoSchema.nullable(),

  score: z.number().int().min(0).max(100),
  scoreBreakdown: scoreBreakdownSchema,
  live: liveStatusSchema.nullable(),
  trend: trendScoreSchema.nullable(),
  blocked: z.boolean(),
  blockedReason: z.string().nullable(),
  /** Nur bei Vorschlägen gesetzt: wie viele Minuten über dem Limit (für "+X Min"). */
  overBudgetMinutes: z.number().int().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/** Abschnitt, in den ein Treffer fällt. */
export const searchSectionSchema = z.enum(['result', 'suggestion', 'sac_unknown', 'unrouted']);
export type SearchSection = z.infer<typeof searchSectionSchema>;

export const searchItemSchema = searchResultSchema.extend({ section: searchSectionSchema });
export type SearchItem = z.infer<typeof searchItemSchema>;

/**
 * Kompakter Kartenpunkt: [id, Name, Breite, Länge, Art, Abschnitt, Score, Fahrminuten].
 * Als Tupel, damit auch mehrere tausend Treffer in eine Antwort passen.
 */
export const mapPointSchema = z.tuple([
  z.string(),
  z.string(),
  z.number(),
  z.number(),
  z.string(),
  searchSectionSchema,
  z.number(),
  z.number().nullable(),
]);
export type MapPoint = z.infer<typeof mapPointSchema>;

export const searchResponseSchema = z.object({
  /** Detailkarten der angeforderten Seite, in Abschnittsreihenfolge. */
  items: z.array(searchItemSchema),
  /**
   * Gesamtzahlen je Abschnitt – unabhängig von der Seitengrösse:
   *  results      Fahrzeit ≤ maxMinutes
   *  suggestions  maxMinutes < Fahrzeit ≤ maxMinutes + Toleranz
   *  sacUnknown   in Reichweite, aber nur über Routen unbekannter Schwierigkeit erreichbar (bei SAC-Filter)
   *  unrouted     ohne bekannte Wanderroute bzw. Zufahrt – ohne Fahrzeit
   */
  totals: z.object({
    results: z.number().int(),
    suggestions: z.number().int(),
    sacUnknown: z.number().int(),
    unrouted: z.number().int(),
  }),
  /** ALLE Treffer als Kartenpunkte (nur auf der ersten Seite mitgeliefert). */
  points: z.array(mapPointSchema).default([]),
  page: z.object({ offset: z.number().int(), limit: z.number().int(), hasMore: z.boolean() }),
  meta: z.object({
    candidatesEvaluated: z.number().int(),
    routing: z.object({
      provider: z.string(),
      status: routingStatusSchema,
      graphBuiltAt: z.string().nullable(),
      osmTimestamp: z.string().nullable(),
      /** Abstand Startpunkt → nächste Strasse in Metern. */
      originSnapM: z.number().nullable(),
    }),
    /** Ski: Gebiete, die wegen fehlender Messwerte nicht gefiltert werden konnten. */
    excludedUnknownSnow: z.number().int().default(0),
    /** 'unavailable': Datenbank nicht erreichbar – Treffer und Fahrzeiten stimmen, Wetter/Schnee/Lawine fehlen. */
    liveData: z.enum(['ok', 'unavailable']).default('ok'),
    dataVersion: z.string().nullable(),
    cached: z.boolean().default(false),
    tookMs: z.number().int().default(0),
    generatedAt: z.string(),
  }),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
