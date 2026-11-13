import { z } from 'zod';

/**
 * Verfügbarkeit eines Ziels bzw. einer Route für die geplante Tour.
 *
 *  available    alle Prüfungen bestanden – auf Grundlage aktueller Daten
 *  uncertain    Datenlage unvollständig, veraltet oder ein Risiko ist möglich
 *  unavailable  gesperrt, Schnee, Sturm, Lawinengefahr oder Tageslicht reicht nicht
 *
 * Ein fehlender Bericht ist kein Nachweis für «offen»: Fehlen Daten, lautet das
 * Ergebnis höchstens «uncertain».
 */
export const availabilityStatusSchema = z.enum(['available', 'uncertain', 'unavailable']);
export type AvailabilityStatus = z.infer<typeof availabilityStatusSchema>;

export const availabilityCheckKindSchema = z.enum(['closure', 'snow', 'weather', 'avalanche', 'daylight', 'operation']);
export type AvailabilityCheckKind = z.infer<typeof availabilityCheckKindSchema>;

/**
 * Art des Belegs. Prognosen und Modellwerte werden nie als Messung ausgegeben.
 *  official  amtliche Meldung (Sperrung, Lawinenbulletin)
 *  measured  Messung einer Station
 *  forecast  Wetterprognose (Modell, Zukunft)
 *  model     Modellwert für die Gegenwart (z. B. modellierte Schneehöhe)
 *  computed  berechnet (z. B. Sonnenuntergang)
 *  none      keine Daten
 */
export const evidenceSchema = z.enum(['official', 'measured', 'forecast', 'model', 'computed', 'none']);
export type Evidence = z.infer<typeof evidenceSchema>;

export const availabilityCheckSchema = z.object({
  kind: availabilityCheckKindSchema,
  status: availabilityStatusSchema,
  /** Kurzer, eigenständig verständlicher Satz. */
  text: z.string(),
  evidence: evidenceSchema,
  /** Quelle(n) in Kurzform, z. B. «SLF (IMIS)». */
  source: z.string().nullable(),
  /** Zeitpunkt der zugrunde liegenden Daten (Messung, Meldung, Modelllauf). */
  observedAt: z.string().nullable(),
  url: z.string().nullable().optional(),
});
export type AvailabilityCheck = z.infer<typeof availabilityCheckSchema>;

/** Geplante Tour: Datum (Schweizer Zeit) und Startstunde. */
export const tourPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().int().min(0).max(23),
});
export type TourPlan = z.infer<typeof tourPlanSchema>;

export const availabilitySchema = z.object({
  status: availabilityStatusSchema,
  /** Wichtigster Grund für «uncertain»/«unavailable»; null bei «available». */
  reason: z.string().nullable(),
  /** high: amtliche Meldungen/Messungen · medium: Prognose/Modell beteiligt · low: Daten fehlen. */
  confidence: z.enum(['high', 'medium', 'low']),
  /** Zeitpunkt der Bewertung. */
  checkedAt: z.string(),
  /** Planung, für die bewertet wurde; Ende = Rückkehr nach Gehzeit hin und zurück (ohne Pausen). */
  plan: tourPlanSchema.extend({ endsAt: z.string().nullable() }).nullable(),
  checks: z.array(availabilityCheckSchema),
});
export type Availability = z.infer<typeof availabilitySchema>;

const RANK: Record<AvailabilityStatus, number> = { available: 0, uncertain: 1, unavailable: 2 };

/** Schlechtester Status einer Liste (leer = available). */
export function worstStatus(statuses: readonly AvailabilityStatus[]): AvailabilityStatus {
  let worst: AvailabilityStatus = 'available';
  for (const s of statuses) if (RANK[s] > RANK[worst]) worst = s;
  return worst;
}

export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  available: 'verfügbar',
  uncertain: 'unsicher',
  unavailable: 'nicht verfügbar',
};

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  official: 'amtliche Meldung',
  measured: 'gemessen',
  forecast: 'Prognose (Modell)',
  model: 'Modellwert',
  computed: 'berechnet',
  none: 'keine Daten',
};

export const CHECK_LABEL: Record<AvailabilityCheckKind, string> = {
  closure: 'Sperrungen',
  snow: 'Schnee',
  weather: 'Wetter zur Tourzeit',
  avalanche: 'Lawinengefahr',
  daylight: 'Tageslicht',
  operation: 'Betrieb',
};
