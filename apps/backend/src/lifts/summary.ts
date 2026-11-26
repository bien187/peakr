import type {
  LiftStatusArea,
  LiftStatusDetail,
  LiftStatusItem,
  LiftStatusSummary,
  OperationalStatus,
  ResortReportStatus,
  SlopeCounts,
  SourceLink,
} from '@ch-alpineroute/shared';
import { freshnessOf } from './freshness';
import { LIFTRADAR_SITE } from './liftradar';
import { coverageNoteFor } from './mapping';
import { sumCounts } from './status';

/** Zeile aus ski_resort_status, wie die Repositories sie lesen. */
export interface StatusRow {
  source_resort_id: string;
  destination_id: string;
  source_name: string;
  resort_status: string;
  lifts_open: number | null;
  lifts_closed: number | null;
  lifts_preparation: number | null;
  lifts_unknown: number | null;
  lifts_total: number | null;
  slopes_open: number | null;
  slopes_closed: number | null;
  slopes_preparation: number | null;
  slopes_unknown: number | null;
  slopes_total: number | null;
  slopes_open_km: number | null;
  slopes_total_km: number | null;
  snow_valley_cm: number | null;
  snow_mountain_cm: number | null;
  fresh_snow_cm: number | null;
  report_at: Date | string | null;
  checked_at: Date | string | null;
  values_from: Date | string | null;
  fetched_at: Date | string;
  website_url: string | null;
  source_url: string;
  source_links: SourceLink[] | null;
}

export interface ItemRow {
  source_resort_id: string;
  kind: 'lift' | 'slope';
  item_id: string;
  position: number;
  ref: string | null;
  name: string;
  item_type: string | null;
  colour: string | null;
  status: OperationalStatus;
  length_m: number | null;
}

const iso = (v: Date | string | null): string | null =>
  v == null ? null : new Date(v).toISOString();

const REPORTING: ResortReportStatus[] = ['open', 'closed'];

export function areaFromRow(r: StatusRow): LiftStatusArea {
  return {
    id: r.source_resort_id,
    name: r.source_name,
    status: (['open', 'closed', 'no_report'] as string[]).includes(r.resort_status)
      ? (r.resort_status as ResortReportStatus)
      : 'unknown',
    lifts: {
      open: r.lifts_open,
      closed: r.lifts_closed,
      preparation: r.lifts_preparation,
      unknown: r.lifts_unknown,
      total: r.lifts_total,
    },
    slopes: {
      open: r.slopes_open,
      closed: r.slopes_closed,
      preparation: r.slopes_preparation,
      unknown: r.slopes_unknown,
      total: r.slopes_total,
      openKm: r.slopes_open_km,
      totalKm: r.slopes_total_km,
    },
    reportAt: iso(r.report_at),
    checkedAt: iso(r.checked_at),
    valuesFrom: iso(r.values_from),
    fetchedAt: iso(r.fetched_at)!,
    websiteUrl: r.website_url,
    sourceUrl: r.source_url,
    sourceLinks: r.source_links ?? [],
    snow: { valleyCm: r.snow_valley_cm, mountainCm: r.snow_mountain_cm, freshCm: r.fresh_snow_cm },
  };
}

/**
 * Datenzeitpunkt eines Gebiets und ob er der Zeitpunkt des Gebietsberichts ist.
 *  - Werte aus einem älteren Lauf der Quelle (values_from): dessen Zeitpunkt.
 *  - «offen»: der Bericht des Gebiets selbst – ein alter Bericht «offen» ist verdächtig.
 *  - «geschlossen»: wann die Quelle den Bericht zuletzt geprüft hat. Geschlossene
 *    Gebiete veröffentlichen oft tagelang keinen neuen Bericht; die Quelle bestätigt
 *    bei jedem Lauf, dass der neueste Bericht weiterhin «geschlossen» lautet.
 */
export function areaDataTime(a: LiftStatusArea): { at: string | null; isReport: boolean } {
  if (a.valuesFrom) return { at: a.valuesFrom, isReport: false };
  if (a.status === 'closed')
    return a.checkedAt
      ? { at: a.checkedAt, isReport: false }
      : { at: a.reportAt, isReport: a.reportAt !== null };
  return a.reportAt ? { at: a.reportAt, isReport: true } : { at: a.checkedAt, isReport: false };
}

export function areaDataAt(a: LiftStatusArea): string | null {
  return areaDataTime(a).at;
}

function sumKm(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return Math.round((values as number[]).reduce((s, v) => s + v, 0) * 10) / 10;
}

const oldest = (values: (string | null)[]): string | null => {
  const known = values.filter((v): v is string => v !== null).sort();
  return known.length === values.length && known.length > 0 ? known[0] : null;
};

/**
 * Fasst die Gebiete eines Peakr-Skigebiets zusammen. Gezählt werden nur Gebiete
 * mit aktuellem Bericht (offen/geschlossen); als Datenzeitpunkt gilt der älteste
 * davon, damit ein frischer Teilbericht nie einen alten verdeckt.
 */
export function summarize(
  areas: LiftStatusArea[],
  now: Date,
  coverageNote: string | null = null,
): LiftStatusSummary {
  const reporting = areas.filter((a) => REPORTING.includes(a.status));
  const status: ResortReportStatus =
    reporting.length === 0
      ? areas.some((a) => a.status === 'no_report')
        ? 'no_report'
        : 'unknown'
      : reporting.some((a) => a.status === 'open' && (a.lifts.open ?? 1) > 0)
        ? 'open'
        : 'closed';
  const slopes: SlopeCounts = {
    ...sumCounts(reporting.map((a) => a.slopes)),
    openKm: sumKm(reporting.map((a) => a.slopes.openKm)),
    totalKm: sumKm(reporting.map((a) => a.slopes.totalKm)),
  };
  if (reporting.length === 0) {
    slopes.openKm = null;
    slopes.totalKm = null;
  }
  const dataAt = reporting.length > 0 ? oldest(reporting.map(areaDataAt)) : null;
  const { freshness, ageHours } = freshnessOf(dataAt, now);
  return {
    source: 'liftradar',
    sourceName: 'LiftRadar',
    sourceUrl: LIFTRADAR_SITE,
    status,
    lifts: sumCounts(reporting.map((a) => a.lifts)),
    slopes,
    dataAt,
    dataAtIsReport: reporting.length > 0 && reporting.every((a) => areaDataTime(a).isReport),
    fetchedAt: [...areas.map((a) => a.fetchedAt)].sort()[0] ?? now.toISOString(),
    freshness,
    ageHours,
    areas: areas.map((a) => ({ id: a.id, name: a.name, status: a.status })),
    partial: reporting.length < areas.length,
    coverageNote,
  };
}

const STATUS_ORDER: Record<OperationalStatus, number> = {
  open: 0,
  preparation: 1,
  closed: 2,
  unknown: 3,
};

function itemFromRow(r: ItemRow): LiftStatusItem {
  return {
    id: r.item_id,
    areaId: r.source_resort_id,
    ref: r.ref,
    name: r.name,
    type: r.item_type,
    colour: r.colour,
    status: r.status,
    lengthM: r.length_m,
  };
}

/** Einträge: offene zuerst, dann in Vorbereitung, geschlossen, unbekannt; innerhalb in der Reihenfolge der Quelle. */
export function sortItems(rows: ItemRow[], areaOrder: string[]): LiftStatusItem[] {
  const area = new Map(areaOrder.map((id, i) => [id, i]));
  return [...rows]
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (area.get(a.source_resort_id) ?? 0) - (area.get(b.source_resort_id) ?? 0) ||
        a.position - b.position,
    )
    .map(itemFromRow);
}

export function detailFrom(
  rows: StatusRow[],
  items: ItemRow[],
  now: Date,
  coverageNote: string | null = null,
): LiftStatusDetail | null {
  if (rows.length === 0) return null;
  const areas = rows.map(areaFromRow);
  // Gebiete ohne aktuellen Bericht: keine Einzelstatus anzeigen (sie wären veraltet).
  const reportingIds = new Set(areas.filter((a) => REPORTING.includes(a.status)).map((a) => a.id));
  const visible = items.filter((i) => reportingIds.has(i.source_resort_id));
  const order = areas.map((a) => a.id);
  return {
    ...summarize(areas, now, coverageNote),
    areaDetails: areas,
    liftItems: sortItems(
      visible.filter((i) => i.kind === 'lift'),
      order,
    ),
    slopeItems: sortItems(
      visible.filter((i) => i.kind === 'slope'),
      order,
    ),
  };
}

/**
 * Werte für die bisherigen Live-Felder (Bewertung, Favoriten): nur aus einem
 * frischen Bericht, sonst null – ein alter Bericht bekommt keinen Bonus.
 */
export function liftsForScore(s: LiftStatusSummary | null): {
  liftsOpen: number | null;
  liftsTotal: number | null;
} {
  if (
    !s ||
    s.freshness !== 'fresh' ||
    !REPORTING.includes(s.status) ||
    s.lifts.open === null ||
    !s.lifts.total
  ) {
    return { liftsOpen: null, liftsTotal: null };
  }
  return { liftsOpen: s.lifts.open, liftsTotal: s.lifts.total };
}

/** Zusammenfassung je Peakr-Skigebiet aus allen gespeicherten Ständen. */
export function summariesByDestination(
  rows: StatusRow[],
  now: Date,
): Map<string, LiftStatusSummary> {
  const groups = new Map<string, StatusRow[]>();
  for (const r of rows) {
    const list = groups.get(r.destination_id);
    if (list) list.push(r);
    else groups.set(r.destination_id, [r]);
  }
  const out = new Map<string, LiftStatusSummary>();
  for (const [id, list] of groups) {
    out.set(
      id,
      summarize(list.map(areaFromRow), now, coverageNoteFor(list.map((r) => r.source_resort_id))),
    );
  }
  return out;
}

/** Detail eines Skigebiets inkl. Abdeckungshinweis aus der Zuordnung. */
export function detailForDestination(
  rows: StatusRow[],
  items: ItemRow[],
  now: Date,
): LiftStatusDetail | null {
  return detailFrom(rows, items, now, coverageNoteFor(rows.map((r) => r.source_resort_id)));
}
