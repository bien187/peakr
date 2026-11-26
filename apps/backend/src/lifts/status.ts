import type { OperationalStatus, ResortReportStatus, StatusCounts } from '@ch-alpineroute/shared';

/**
 * Zentrale Normalisierung der Statuswerte. Nur hier wird aus dem Text der
 * Quelle ein interner Status – nirgends sonst, auch nicht im Frontend.
 *
 * Grundsatz: Ein fehlender oder unbekannter Status ist «unknown», nie «closed».
 */

const ITEM_STATUS: Record<string, OperationalStatus> = {
  open: 'open',
  operating: 'open',
  closed: 'closed',
  // LiftRadar: «in Vorbereitung» (z. B. Öffnung später am Tag, Pistenpräparation)
  preparation: 'preparation',
  unknown: 'unknown',
};

export interface NormalizedStatus {
  status: OperationalStatus;
  /** false = der Wert der Quelle ist unbekannt (wird protokolliert). */
  recognized: boolean;
}

/** Status einer Anlage oder Piste. null/leer → unknown (erkannt); unbekannter Text → unknown (nicht erkannt). */
export function normalizeItemStatus(raw: string | null | undefined): NormalizedStatus {
  if (raw === null || raw === undefined || raw.trim() === '')
    return { status: 'unknown', recognized: true };
  const status = ITEM_STATUS[raw.trim().toLowerCase()];
  return status ? { status, recognized: true } : { status: 'unknown', recognized: false };
}

const RESORT_STATUS: Record<string, ResortReportStatus> = {
  open: 'open',
  closed: 'closed',
  no_report: 'no_report',
};

/** Gesamtstatus eines Gebiets. Unbekannter Text → unknown. */
export function normalizeResortStatus(
  raw: string | null | undefined,
): NormalizedStatus & { resort: ResortReportStatus } {
  const s = RESORT_STATUS[(raw ?? '').trim().toLowerCase()];
  return s
    ? { resort: s, status: 'unknown', recognized: true }
    : { resort: 'unknown', status: 'unknown', recognized: false };
}

export const EMPTY_COUNTS: StatusCounts = {
  open: null,
  closed: null,
  preparation: null,
  unknown: null,
  total: null,
};

/** Zählt Einträge je Status. total = alle gelisteten Einträge (auch unbekannte). */
export function countItems(items: { status: OperationalStatus }[]): StatusCounts {
  const c = { open: 0, closed: 0, preparation: 0, unknown: 0, total: items.length };
  for (const i of items) c[i.status]++;
  return c;
}

/**
 * Zähler, wenn die Quelle keine Einzelliste liefert: nur «offen» und «gesamt»
 * aus der Zusammenfassung. Geschlossene, vorbereitete und unbekannte Anlagen
 * lassen sich daraus nicht trennen und bleiben null.
 */
export function countsFromSummary(
  open: number | null | undefined,
  total: number | null | undefined,
): StatusCounts {
  const t = total ?? null;
  const o = open ?? null;
  return {
    open: o !== null && t !== null ? Math.min(o, t) : o,
    closed: null,
    preparation: null,
    unknown: null,
    total: t,
  };
}

/** Summe mehrerer Zähler; ein Feld ist nur dann bekannt, wenn es in allen Teilen bekannt ist. */
export function sumCounts<T extends StatusCounts>(parts: T[]): StatusCounts {
  const keys = ['open', 'closed', 'preparation', 'unknown', 'total'] as const;
  const out: StatusCounts = { ...EMPTY_COUNTS };
  if (parts.length === 0) return out;
  for (const k of keys) {
    let sum = 0;
    let known = true;
    for (const p of parts) {
      const v = p[k];
      if (v === null) {
        known = false;
        break;
      }
      sum += v;
    }
    out[k] = known ? sum : null;
  }
  return out;
}
