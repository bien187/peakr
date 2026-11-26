import { z } from 'zod';

/**
 * Betriebsstatus von Liften und Pisten laut Statusbericht (Quelle: LiftRadar).
 *
 * Statusberichte sind keine Echtzeitdaten: die Quelle liest die Berichte der
 * Skigebiete etwa zweimal täglich. Jede Antwort trägt deshalb die Zeitpunkte
 * und eine Einstufung der Aktualität. Fehlende Werte sind null – nie geschätzt.
 */

/** Status einer einzelnen Anlage bzw. Piste. Fehlt oder ist unbekannt → 'unknown' (nie 'closed'). */
export const operationalStatusSchema = z.enum(['open', 'closed', 'preparation', 'unknown']);
export type OperationalStatus = z.infer<typeof operationalStatusSchema>;

/** Gesamtstatus eines Gebiets laut Bericht. 'no_report': kein aktueller Bericht vorhanden. */
export const resortReportStatusSchema = z.enum(['open', 'closed', 'no_report', 'unknown']);
export type ResortReportStatus = z.infer<typeof resortReportStatusSchema>;

/** Aktualität eines Berichts (Grenzen: apps/backend/src/lifts/freshness.ts). */
export const dataFreshnessSchema = z.enum(['fresh', 'stale', 'outdated', 'unknown']);
export type DataFreshness = z.infer<typeof dataFreshnessSchema>;

const count = z.number().int().min(0).nullable();

/** Zähler; null = von der Quelle nicht geliefert. open + closed + preparation + unknown = total, wo alle bekannt sind. */
export const statusCountsSchema = z.object({
  open: count,
  closed: count,
  preparation: count,
  unknown: count,
  total: count,
});
export type StatusCounts = z.infer<typeof statusCountsSchema>;

export const slopeCountsSchema = statusCountsSchema.extend({
  openKm: z.number().min(0).nullable(),
  totalKm: z.number().min(0).nullable(),
});
export type SlopeCounts = z.infer<typeof slopeCountsSchema>;

/** Link auf eine Originalquelle (nur http/https). */
export const sourceLinkSchema = z.object({
  url: z.string().url(),
  /** true = Quelle verlangt Nennung; null = ungeprüft (wird wie true behandelt). */
  attributionRequired: z.boolean().nullable(),
});
export type SourceLink = z.infer<typeof sourceLinkSchema>;

/** Ein Gebiet der Quelle, das zu diesem Peakr-Skigebiet gehört. */
export const liftStatusAreaSchema = z.object({
  /** ID bei der Quelle, z. B. «verbier». */
  id: z.string(),
  name: z.string(),
  status: resortReportStatusSchema,
  lifts: statusCountsSchema,
  slopes: slopeCountsSchema,
  /** Bericht des Gebiets selbst; null, wenn die Quelle keinen Zeitpunkt nennt. */
  reportAt: z.string().nullable(),
  /** Wann die Quelle den Bericht gelesen hat. */
  checkedAt: z.string().nullable(),
  /** Gesetzt, wenn die Werte aus einem älteren Lauf der Quelle stammen. */
  valuesFrom: z.string().nullable(),
  /** Wann Peakr die Daten zuletzt abgeglichen hat. */
  fetchedAt: z.string(),
  websiteUrl: z.string().url().nullable(),
  sourceUrl: z.string().url(),
  sourceLinks: z.array(sourceLinkSchema),
  snow: z.object({
    valleyCm: z.number().int().nullable(),
    mountainCm: z.number().int().nullable(),
    freshCm: z.number().int().nullable(),
  }),
});
export type LiftStatusArea = z.infer<typeof liftStatusAreaSchema>;

/** Kurzfassung für Suchergebnisse und Karten. */
export const liftStatusSummarySchema = z.object({
  source: z.literal('liftradar'),
  sourceName: z.string(),
  sourceUrl: z.string().url(),
  /** 'open', sobald ein zugehöriges Gebiet offen meldet; 'no_report', wenn keines einen aktuellen Bericht hat. */
  status: resortReportStatusSchema,
  /** Summe über die Gebiete mit aktuellem Bericht. */
  lifts: statusCountsSchema,
  slopes: slopeCountsSchema,
  /**
   * Ältester Datenzeitpunkt der berichtenden Gebiete: bei «offen» der Bericht des Gebiets,
   * bei «geschlossen» die letzte Prüfung durch die Quelle (lifts/summary.ts, areaDataTime).
   */
  dataAt: z.string().nullable(),
  /** true = dataAt ist der Zeitpunkt der Gebietsberichte; false = (auch) der Lesezeitpunkt der Quelle. */
  dataAtIsReport: z.boolean(),
  /** Letzter Abgleich durch Peakr. */
  fetchedAt: z.string(),
  freshness: dataFreshnessSchema,
  ageHours: z.number().nullable(),
  /** Zugehörige Gebiete der Quelle (Name und Status). */
  areas: z.array(z.object({ id: z.string(), name: z.string(), status: resortReportStatusSchema })),
  /** true = nicht alle zugehörigen Gebiete haben einen aktuellen Bericht. */
  partial: z.boolean(),
  /** Hinweis, wenn die Berichte nur einen Teil des Skigebiets abdecken. */
  coverageNote: z.string().nullable(),
});
export type LiftStatusSummary = z.infer<typeof liftStatusSummarySchema>;

/** Eine Anlage oder Piste, wie die Quelle sie listet. */
export const liftStatusItemSchema = z.object({
  id: z.string(),
  /** Gebiet der Quelle, aus dem der Eintrag stammt. */
  areaId: z.string(),
  ref: z.string().nullable(),
  name: z.string(),
  /** Lift: gondola, cable_car, chairlift, drag_lift, carpet, funicular, other. Piste: easy, intermediate, difficult, ski_route, other. */
  type: z.string().nullable(),
  /** Pistenfarbe laut Quelle (blue, red, black, yellow …). */
  colour: z.string().nullable(),
  status: operationalStatusSchema,
  lengthM: z.number().int().nullable(),
});
export type LiftStatusItem = z.infer<typeof liftStatusItemSchema>;

/** Vollständiger Status für die Detailansicht. */
export const liftStatusDetailSchema = liftStatusSummarySchema.extend({
  areaDetails: z.array(liftStatusAreaSchema),
  liftItems: z.array(liftStatusItemSchema),
  slopeItems: z.array(liftStatusItemSchema),
});
export type LiftStatusDetail = z.infer<typeof liftStatusDetailSchema>;
