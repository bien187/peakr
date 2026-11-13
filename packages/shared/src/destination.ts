import { z } from 'zod';
import { availabilitySchema } from './availability';
import { latLngSchema } from './geo';
import { destinationTypeSchema, routingStatusSchema, sacDifficultySchema, trailheadKindSchema } from './enums';

/** Aktuelle Bedingungen (Wetter/Schnee/Lawine/Lift) zu einem Ziel. Unbekanntes ist null. */
export const liveStatusSchema = z.object({
  capturedAt: z.string(),
  temperatureC: z.number().nullable(),
  weatherCode: z.number().int().nullable(),
  visibilityM: z.number().int().nullable(),
  windKmh: z.number().nullable(),
  snowDepthValleyCm: z.number().int().nullable(),
  snowDepthTopCm: z.number().int().nullable(),
  freshSnowCm: z.number().nullable(),
  avalancheLevel: z.number().int().min(1).max(5).nullable(),
  liftsOpen: z.number().int().nullable(),
  liftsTotal: z.number().int().nullable(),
  slopesOpenKm: z.number().nullable(),
  trailStatus: z.string().nullable(),
  /** true = Temperatur aus dem Wetterraster auf die Zielhöhe umgerechnet (Näherung). */
  temperatureAdjusted: z.boolean().optional(),
  /** Quelle des Liftstatus; null = keine Live-Quelle vorhanden. */
  liftSource: z.string().nullable().optional(),
});
export type LiveStatus = z.infer<typeof liveStatusSchema>;

/** Bekanntheits-/Trend-Score eines Ziels. */
export const trendScoreSchema = z.object({
  score: z.number().int().min(1).max(100),
  rationale: z.string().nullable(),
  source: z.string().nullable(),
  isEstimate: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type TrendScore = z.infer<typeof trendScoreSchema>;

/** Stammdaten eines Ziels (ohne Live-/Trend-Daten). */
export const destinationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: destinationTypeSchema,
  canton: z.string().nullable(),
  location: latLngSchema,
  elevationBaseM: z.number().int().nullable(),
  elevationTopM: z.number().int().nullable(),
  sacDifficulty: sacDifficultySchema.nullable(),
  ascentM: z.number().int().nullable(),
  distanceKm: z.number().nullable(),
  wikipediaTitle: z.string().nullable(),
  slfRegionId: z.string().nullable(),
  /** 'peak' | 'lake' | 'hut' | 'viewpoint' | 'pass' bei Wanderzielen. */
  poiKind: z.string().nullable().optional(),
  /** Objektart der Quelle, z. B. «Hauptgipfel», «Schutzhütte», «Kleinskigebiet». */
  objectClass: z.string().nullable().optional(),
  /** Metadaten-Qualität 0–100 (sagt nichts über Existenz oder Wanderbarkeit). */
  qualityScore: z.number().int().nullable().optional(),
  /** 'routed' | 'no_route' | 'unrouted' | 'not_applicable'. */
  routeStatus: z.string().optional(),
  /** Herkunft der Stammdaten: 'swissnames3d' | 'osm'. */
  sourceLayer: z.string().nullable().optional(),
});
export type Destination = z.infer<typeof destinationSchema>;

/** Ausgangspunkt: Parkplatz, Strassenzugang oder Talstation. */
export const trailheadSchema = z.object({
  id: z.string().uuid(),
  kind: trailheadKindSchema,
  name: z.string().nullable(),
  location: latLngSchema,
  elevationM: z.number().int().nullable(),
  /** 3 = öffentlicher Parkplatz, 2 = Parkplatz ohne Zugangsangabe, 1 = Strassenzugang ohne bestätigten Parkplatz. */
  quality: z.number().int().min(1).max(3),
  /** Abstand Strassenende → Ausgangspunkt in Metern (relevant bei autofreien Orten). */
  roadGapM: z.number().nullable(),
  fee: z.string().nullable().optional(),
  capacity: z.string().nullable().optional(),
});
export type Trailhead = z.infer<typeof trailheadSchema>;

/** Kennzahlen einer berechneten Wanderroute Ausgangspunkt → Ziel. */
export const hikeRouteSummarySchema = z.object({
  routeId: z.number().int(),
  rank: z.number().int(),
  distanceKm: z.number(),
  ascentM: z.number().int(),
  descentM: z.number().int(),
  /** Geschätzte Gehzeit hin (DIN 33466), Minuten. */
  durationUpMin: z.number().int(),
  durationDownMin: z.number().int(),
  minElevM: z.number().int().nullable(),
  maxElevM: z.number().int().nullable(),
  /** null = Schwierigkeit unbekannt. sacMin < sacMax bedeutet «T2–T3» (amtliche Wegkategorie). */
  sacMin: sacDifficultySchema.nullable(),
  sacMax: sacDifficultySchema.nullable(),
  /** Anteil der Strecke mit bekannter Schwierigkeit, 0–1. */
  sacKnownShare: z.number(),
  /** Anteil der Strecke auf amtlich signalisierten Wanderwegen, 0–1. */
  officialShare: z.number(),
  /** Abstand zwischen Routenende und Zielpunkt in Metern. */
  endGapM: z.number().int(),
  source: z.string(),
  computedAt: z.string(),
});
export type HikeRouteSummary = z.infer<typeof hikeRouteSummarySchema>;

/** Autofahrt vom angefragten Startort zu einem Ausgangspunkt (nur mit Startort in der Anfrage). */
export const driveInfoSchema = z.object({
  /** Minuten; null = nicht berechenbar (siehe status). */
  minutes: z.number().nullable(),
  distanceKm: z.number().nullable(),
  status: routingStatusSchema,
});
export type DriveInfo = z.infer<typeof driveInfoSchema>;

/** Benannter Ort, an dem die Route vorbeiführt (Hütte, Pass, See …), aus den Zieldaten. */
export const routeWaypointSchema = z.object({
  name: z.string(),
  /** Art des Ortes wie `poiKind` der Ziele: 'peak' | 'hut' | 'lake' | 'viewpoint' | 'pass' … */
  kind: z.string().nullable(),
  /** Objektart der Quelle, z. B. «Berggasthaus», «Schutzhütte». */
  objectClass: z.string().nullable().optional(),
  location: latLngSchema,
  /** Amtliche bzw. erfasste Höhe des Ortes; null = unbekannt. */
  elevationM: z.number().int().nullable(),
  /** Wegstrecke ab Ausgangspunkt bis zur Stelle, an der der Weg dem Ort am nächsten kommt (m). */
  alongM: z.number().int(),
});
export type RouteWaypoint = z.infer<typeof routeWaypointSchema>;

export const hikeRouteDetailSchema = hikeRouteSummarySchema.extend({
  trailhead: trailheadSchema,
  /** Fahrzeit zum Ausgangspunkt dieser Variante; fehlt ohne Startort. */
  drive: driveInfoSchema.nullable().optional(),
  /** GeoJSON-Linie [lng, lat] vom Ausgangspunkt zum Ziel. */
  line: z.array(z.tuple([z.number(), z.number()])),
  /**
   * Höhe je Stützpunkt von `line` in Metern (gleiche Länge). null = für diese Route
   * nicht gespeichert; einzelne Einträge null = an diesem Punkt unbekannt.
   */
  elevations: z.array(z.number().nullable()).nullable().optional(),
  /** Benannte Orte höchstens 50 m neben dem Weg, in Gehrichtung sortiert. */
  waypoints: z.array(routeWaypointSchema).optional(),
  /** Verfügbarkeit dieser Variante zur geplanten Zeit (Sperrungen, Schnee, Wetter, Lawinen, Tageslicht). */
  availability: availabilitySchema.nullable().optional(),
});
export type HikeRouteDetail = z.infer<typeof hikeRouteDetailSchema>;

/** Statische Angaben zu einem Skigebiet (aus OpenStreetMap). */
export const skiInfoSchema = z.object({
  liftsTotal: z.number().int(),
  liftsByType: z.record(z.number()),
  pisteKm: z.number().nullable(),
  pisteKmByDifficulty: z.record(z.number()),
  grouping: z.string(),
});
export type SkiInfo = z.infer<typeof skiInfoSchema>;

/** Ziel inkl. aktuellem Status & Trend (ohne Verlauf) — z.B. für Favoriten. */
export const destinationWithStatusSchema = destinationSchema.extend({
  live: liveStatusSchema.nullable(),
  trend: trendScoreSchema.nullable(),
});
export type DestinationWithStatus = z.infer<typeof destinationWithStatusSchema>;

export const dataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  attribution: z.string().nullable(),
  license: z.string().nullable(),
  version: z.string().nullable(),
  fetchedAt: z.string().nullable(),
});
export type DataSourceInfo = z.infer<typeof dataSourceSchema>;

/** Detailansicht inkl. Routen, Zufahrt, Status, Trend und Verlauf. */
export const destinationDetailSchema = destinationSchema.extend({
  names: z.record(z.string()).optional(),
  altNames: z.array(z.string()).optional(),
  live: liveStatusSchema.nullable(),
  trend: trendScoreSchema.nullable(),
  history: z.array(liveStatusSchema),
  routes: z.array(hikeRouteDetailSchema),
  ski: skiInfoSchema.nullable(),
  /** Zufahrtspunkt eines Skigebiets (Talstation). */
  access: trailheadSchema.nullable(),
  /** Fahrzeit zur Talstation; fehlt ohne Startort. */
  accessDrive: driveInfoSchema.nullable().optional(),
  /** Skigebiet: Verfügbarkeit (Betrieb, Schnee, Wetter, Lawinen). Wandern: je Route unter `routes`. */
  availability: availabilitySchema.nullable().optional(),
  sources: z.array(dataSourceSchema),
  updatedAt: z.string().nullable(),
});
export type DestinationDetail = z.infer<typeof destinationDetailSchema>;
