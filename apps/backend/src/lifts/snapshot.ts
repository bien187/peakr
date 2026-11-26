import { createHash } from 'node:crypto';
import type {
  OperationalStatus,
  ResortReportStatus,
  SlopeCounts,
  SourceLink,
  StatusCounts,
} from '@ch-alpineroute/shared';
import { type DetailsFile, type ResortFile, resortUrl, safeHttpUrl } from './liftradar';
import {
  countItems,
  countsFromSummary,
  EMPTY_COUNTS,
  normalizeItemStatus,
  normalizeResortStatus,
} from './status';

/**
 * Aus einer gelesenen Gebietsdatei (und ggf. der Einzelliste) wird ein
 * vollständiger Stand für die Datenbank. Rein funktional, ohne Abruf und ohne
 * Datenbank – das macht die Regeln testbar.
 */

export interface SnapshotItem {
  kind: 'lift' | 'slope';
  itemId: string;
  position: number;
  ref: string | null;
  name: string;
  itemType: string | null;
  colour: string | null;
  status: OperationalStatus;
  statusRaw: string | null;
  lengthM: number | null;
}

export interface ResortSnapshot {
  sourceResortId: string;
  destinationId: string;
  sourceName: string;
  matchMethod: string;
  matchVerified: boolean;
  resortStatus: ResortReportStatus;
  lifts: StatusCounts;
  slopes: SlopeCounts;
  liftsByType: Record<string, { open: number | null; total: number | null }>;
  slopesByDifficulty: Record<string, { open: number | null; total: number | null }>;
  snow: { valleyCm: number | null; mountainCm: number | null; freshCm: number | null };
  reportAt: string | null;
  checkedAt: string | null;
  valuesFrom: string | null;
  websiteUrl: string | null;
  sourceUrl: string;
  sourceLinks: SourceLink[];
  etag: string | null;
  items: SnapshotItem[];
  contentHash: string;
  /** Statuswerte der Quelle, die Peakr nicht kennt (→ unknown), mit Anzahl. */
  unknownStatusValues: Record<string, number>;
  /** Zähler der Quelle weichen von den gezählten Einträgen ab (nur protokolliert). */
  countMismatch: boolean;
}

const LIFT_TYPES = new Set([
  'gondola',
  'cable_car',
  'chairlift',
  'drag_lift',
  'carpet',
  'funicular',
  'other',
]);
const DIFFICULTIES = new Set(['easy', 'intermediate', 'difficult', 'ski_route', 'other']);
const COLOURS = new Set([
  'green',
  'blue',
  'red',
  'black',
  'yellow',
  'orange',
  'blue_red',
  'red_black',
  'black_blue',
  'yellow_red',
]);

const iso = (s: string | null | undefined): string | null => (s ? new Date(s).toISOString() : null);

function sourceLinks(file: ResortFile): SourceLink[] {
  const out = new Map<string, SourceLink>();
  for (const ref of [
    ...(file.source_details?.conditions ?? []),
    ...(file.source_details?.resort_info ?? []),
  ]) {
    const url = safeHttpUrl(ref.url);
    if (!url) continue;
    const prev = out.get(url);
    // Mehrfach genannt: «Nennung nötig» gewinnt (null = ungeprüft, wie true behandeln).
    const flag = ref.attribution_required ?? null;
    out.set(url, {
      url,
      attributionRequired:
        prev && prev.attributionRequired !== false ? prev.attributionRequired : flag,
    });
  }
  return [...out.values()].slice(0, 12);
}

function toItems(details: DetailsFile, unknown: Record<string, number>): SnapshotItem[] {
  const items: SnapshotItem[] = [];
  const seen = new Set<string>();
  const add = (
    kind: 'lift' | 'slope',
    raw: NonNullable<DetailsFile['lifts']>[number] & {
      difficulty?: string | null;
      colour?: string | null;
      type?: string | null;
    },
    position: number,
  ): void => {
    let itemId = raw.id;
    for (let n = 2; seen.has(`${kind}:${itemId}`); n++) itemId = `${raw.id}~${n}`;
    seen.add(`${kind}:${itemId}`);
    const norm = normalizeItemStatus(raw.status);
    if (!norm.recognized) unknown[String(raw.status)] = (unknown[String(raw.status)] ?? 0) + 1;
    const type = kind === 'lift' ? raw.type : raw.difficulty;
    const allowed = kind === 'lift' ? LIFT_TYPES : DIFFICULTIES;
    items.push({
      kind,
      itemId,
      position,
      ref: raw.ref?.trim() || null,
      name: raw.name.trim(),
      itemType: type ? (allowed.has(type) ? type : 'other') : null,
      colour: kind === 'slope' && raw.colour && COLOURS.has(raw.colour) ? raw.colour : null,
      status: norm.status,
      statusRaw: raw.status ?? null,
      lengthM: raw.length_m ?? null,
    });
  };
  (details.lifts ?? []).forEach((l, i) => add('lift', l, i));
  (details.slopes ?? []).forEach((s, i) => add('slope', s, i));
  return items;
}

function hashOf(s: Omit<ResortSnapshot, 'contentHash' | 'checkedAt' | 'etag'>): string {
  const stable = {
    status: s.resortStatus,
    lifts: s.lifts,
    slopes: s.slopes,
    liftsByType: s.liftsByType,
    slopesByDifficulty: s.slopesByDifficulty,
    snow: s.snow,
    reportAt: s.reportAt,
    valuesFrom: s.valuesFrom,
    website: s.websiteUrl,
    links: s.sourceLinks,
    items: s.items.map((i) => [
      i.kind,
      i.itemId,
      i.position,
      i.ref,
      i.name,
      i.itemType,
      i.colour,
      i.status,
      i.lengthM,
    ]),
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 32);
}

export interface SnapshotInput {
  file: ResortFile;
  /** Einzelliste; null = die Gebietsdatei verweist auf keine. */
  details: DetailsFile | null;
  destinationId: string;
  matchMethod: string;
  matchVerified: boolean;
  etag: string | null;
  now: Date;
  /** `checked_at` aus dem Index – derselbe Wert, mit dem der nächste Lauf vergleicht. */
  indexCheckedAt?: string | null;
}

export function buildSnapshot(input: SnapshotInput): ResortSnapshot {
  const { file, details, now } = input;
  const unknownStatusValues: Record<string, number> = {};
  const resort = normalizeResortStatus(file.status);
  if (!resort.recognized) unknownStatusValues[`resort:${file.status}`] = 1;
  const reporting = resort.resort === 'open' || resort.resort === 'closed';

  // Einzelstatus nur aus einem aktuellen Bericht; bei «no_report» wären sie veraltet.
  const items = reporting && details ? toItems(details, unknownStatusValues) : [];
  const liftItems = items.filter((i) => i.kind === 'lift');
  const slopeItems = items.filter((i) => i.kind === 'slope');
  const hasLiftList = reporting && Array.isArray(details?.lifts) && liftItems.length > 0;
  const hasSlopeList = reporting && Array.isArray(details?.slopes) && slopeItems.length > 0;

  let lifts: StatusCounts;
  let slopeCounts: StatusCounts;
  if (!reporting) {
    // Ohne aktuellen Bericht ist «0 offen» der Quelle bedeutungslos: offen bleibt unbekannt.
    lifts = { ...EMPTY_COUNTS, total: file.lifts?.total ?? null };
    slopeCounts = { ...EMPTY_COUNTS, total: file.slopes?.total ?? null };
  } else {
    lifts = hasLiftList
      ? countItems(liftItems)
      : countsFromSummary(file.lifts?.open, file.lifts?.total);
    slopeCounts = hasSlopeList
      ? countItems(slopeItems)
      : countsFromSummary(file.slopes?.open, file.slopes?.total);
  }
  const countMismatch =
    (hasLiftList && file.lifts?.open != null && file.lifts.open !== lifts.open) ||
    (hasSlopeList && file.slopes?.open != null && file.slopes.open !== slopeCounts.open);

  // Zeitpunkt des Gebietsberichts; liegt er mehr als eine Stunde in der Zukunft, ist er unbrauchbar.
  let reportAt = iso(file.lifts_updated_at ?? details?.updated_at ?? null);
  if (reportAt && Date.parse(reportAt) > now.getTime() + 3_600_000) reportAt = null;

  const base = {
    sourceResortId: file.id,
    destinationId: input.destinationId,
    sourceName: file.name,
    matchMethod: input.matchMethod,
    matchVerified: input.matchVerified,
    resortStatus: resort.resort,
    lifts,
    slopes: {
      ...slopeCounts,
      openKm: reporting ? (file.slopes?.open_km ?? null) : null,
      totalKm: file.slopes?.total_km ?? null,
    },
    liftsByType: Object.fromEntries(
      Object.entries(file.lifts_by_type ?? {}).map(([k, v]) => [
        k,
        { open: reporting ? v.open : null, total: v.total },
      ]),
    ),
    slopesByDifficulty: Object.fromEntries(
      Object.entries(file.slopes_by_difficulty ?? {}).map(([k, v]) => [
        k,
        { open: reporting ? v.open : null, total: v.total },
      ]),
    ),
    snow: {
      valleyCm: file.snow?.valley_cm ?? null,
      mountainCm: file.snow?.mountain_cm ?? null,
      freshCm: file.snow?.fresh_cm ?? null,
    },
    reportAt,
    checkedAt: iso(input.indexCheckedAt ?? file.fetched_at),
    valuesFrom: iso(file.status_from ?? null),
    websiteUrl: safeHttpUrl(file.website),
    sourceUrl: resortUrl(file.id),
    sourceLinks: sourceLinks(file),
    etag: input.etag,
    items,
    unknownStatusValues,
    countMismatch,
  };
  return { ...base, contentHash: hashOf(base) };
}
