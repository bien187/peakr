import { describeError } from '../lib/http';
import { logger } from '../lib/logger';
import {
  type Fetcher,
  type IndexResort,
  detailsFileSchema,
  detailsUrl,
  indexFileSchema,
  indexResortSchema,
  indexUrl,
  resortFileSchema,
  resortUrl,
} from './liftradar';
import {
  type LiftRadarMapping,
  LIFTRADAR_MAPPING,
  LIFTRADAR_UNMAPPED,
  mappingProblems,
} from './mapping';
import { buildSnapshot, type ResortSnapshot } from './snapshot';

/**
 * Abgleich LiftRadar → Datenbank. Ablauf:
 *  1. Zuordnung prüfen und die OSM-Referenzen in Peakr-Ziel-IDs auflösen
 *  2. Index laden (mit ETag; 304 = seit dem letzten vollständigen Abgleich nichts neu)
 *  3. je zugeordnetem Gebiet: hat die Quelle neu gelesen (checked_at)? sonst nichts abrufen
 *  4. Gebietsdatei (ETag) und – falls vorhanden – Einzelliste laden, prüfen, normalisieren
 *  5. je Gebiet in einer Transaktion speichern; Fehler eines Gebiets lassen seinen alten
 *     Stand stehen und stoppen die anderen nicht
 *
 * Abhängigkeiten werden übergeben, damit sich der Ablauf ohne Netz und
 * Datenbank testen lässt.
 */

export interface LiftStore {
  resolveSkiRefs(refs: string[]): Promise<Map<string, string>>;
  loadStoredState(): Promise<
    Map<string, { destinationId: string; checkedAt: string | null; etag: string | null }>
  >;
  saveSnapshot(s: ResortSnapshot): Promise<'changed' | 'unchanged'>;
  touchFetched(ids: string[]): Promise<void>;
  removeUnmapped(keepIds: string[]): Promise<number>;
  getIndexEtag(): Promise<string | null>;
  setIndexEtag(etag: string | null): Promise<void>;
  totals(): Promise<StatusTotals>;
}

export interface StatusTotals {
  reporting: number;
  noReport: number;
  lifts: { open: number; closed: number; preparation: number; unknown: number };
  slopes: { open: number; closed: number; preparation: number; unknown: number };
}

export interface LiftSyncDeps {
  fetcher: Fetcher;
  store: LiftStore;
  now?: () => Date;
  shouldStop?: () => boolean;
  mapping?: readonly LiftRadarMapping[];
  unmapped?: Readonly<Record<string, string>>;
  concurrency?: number;
}

export interface LiftSyncResult extends Record<string, unknown> {
  total: number;
  updated: number;
  failed: number;
  index: 'fetched' | 'not_modified';
  swissResorts: number;
  mapped: number;
  active: number;
  changed: number;
  unchanged: number;
  notModified: number;
  unresolvedRefs: string[];
  missingInIndex: string[];
  unmappedCandidates: string[];
  errors: { id: string; error: string }[];
  invalidIndexEntries: number;
  unknownStatusValues: Record<string, number>;
  countMismatches: string[];
  removed: number;
  totals: StatusTotals;
  seconds: number;
}

const sameInstant = (a: string | null, b: string | null): boolean =>
  a !== null && b !== null && Date.parse(a) === Date.parse(b);

/** Führt `fn` für alle Einträge aus, höchstens `limit` gleichzeitig. */
async function eachLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function syncLiftStatus(
  deps: LiftSyncDeps,
  opts: { force?: boolean } = {},
): Promise<LiftSyncResult> {
  const started = Date.now();
  const now = deps.now ?? (() => new Date());
  const shouldStop = deps.shouldStop ?? (() => false);
  const mapping = deps.mapping ?? LIFTRADAR_MAPPING;
  const unmapped = deps.unmapped ?? LIFTRADAR_UNMAPPED;
  const force = opts.force === true;
  const { fetcher, store } = deps;

  const problems = mappingProblems(mapping);
  if (problems.length > 0) throw new Error(`Zuordnung fehlerhaft: ${problems.join('; ')}`);

  const destByRef = await store.resolveSkiRefs([...new Set(mapping.map((m) => m.peakrRef))]);
  const active = mapping.filter((m) => destByRef.has(m.peakrRef));
  const unresolvedRefs = mapping
    .filter((m) => !destByRef.has(m.peakrRef))
    .map((m) => `${m.liftradarId} → ${m.peakrRef}`);
  if (unresolvedRefs.length > 0)
    logger.warn({ unresolvedRefs }, 'LiftRadar: Peakr-Gebiete der Zuordnung nicht gefunden');
  const state = await store.loadStoredState();

  const base = (over: Partial<LiftSyncResult>): LiftSyncResult => ({
    total: 0,
    updated: 0,
    failed: 0,
    index: 'fetched',
    swissResorts: 0,
    mapped: mapping.length,
    active: active.length,
    changed: 0,
    unchanged: 0,
    notModified: 0,
    unresolvedRefs,
    missingInIndex: [],
    unmappedCandidates: [],
    errors: [],
    invalidIndexEntries: 0,
    unknownStatusValues: {},
    countMismatches: [],
    removed: 0,
    totals: {
      reporting: 0,
      noReport: 0,
      lifts: { open: 0, closed: 0, preparation: 0, unknown: 0 },
      slopes: { open: 0, closed: 0, preparation: 0, unknown: 0 },
    },
    seconds: 0,
    ...over,
  });

  // Den ETag des Index nur nutzen, wenn alle zugeordneten Gebiete schon einen Stand haben.
  const canUseIndexEtag = !force && active.every((m) => state.has(m.liftradarId));
  const indexRes = await fetcher(indexUrl(), {
    etag: canUseIndexEtag ? await store.getIndexEtag() : null,
    maxBytes: 10_000_000,
  });

  if (indexRes.notModified) {
    const ids = active.map((m) => m.liftradarId);
    await store.touchFetched(ids);
    const removed = await store.removeUnmapped(ids);
    return base({
      index: 'not_modified',
      total: ids.length,
      updated: ids.length,
      unchanged: ids.length,
      removed,
      totals: await store.totals(),
      seconds: Math.round((Date.now() - started) / 100) / 10,
    });
  }

  const index = indexFileSchema.safeParse(indexRes.body);
  if (!index.success)
    throw new Error(`LiftRadar-Index ungültig: ${index.error.issues[0]?.message ?? 'Format'}`);
  const swiss = new Map<string, IndexResort>();
  let invalidIndexEntries = 0;
  for (const raw of index.data.resorts) {
    const r = indexResortSchema.safeParse(raw);
    if (!r.success) {
      invalidIndexEntries++;
      continue;
    }
    if (r.data.country === 'ch') swiss.set(r.data.id, r.data);
  }
  if (swiss.size === 0)
    throw new Error(
      'LiftRadar-Index ohne Schweizer Gebiete – Antwort unplausibel, nichts geändert.',
    );

  const mappedIds = new Set(mapping.map((m) => m.liftradarId));
  const unmappedCandidates = [...swiss.keys()]
    .filter((id) => !mappedIds.has(id) && !(id in unmapped))
    .sort();
  const missingInIndex = active.filter((m) => !swiss.has(m.liftradarId)).map((m) => m.liftradarId);
  if (unmappedCandidates.length > 0)
    logger.info({ unmappedCandidates }, 'LiftRadar: neue Schweizer Gebiete ohne Zuordnung');
  if (missingInIndex.length > 0)
    logger.warn(
      { missingInIndex },
      'LiftRadar: zugeordnete Gebiete fehlen im Index – bisheriger Stand bleibt',
    );

  const work = active.filter((m) => swiss.has(m.liftradarId));
  const unchangedIds: string[] = [];
  const errors: { id: string; error: string }[] = [];
  const unknownStatusValues: Record<string, number> = {};
  const countMismatches: string[] = [];
  let changed = 0;
  let sameContent = 0;
  let notModified = 0;
  let stopped = 0;

  await eachLimited(work, deps.concurrency ?? 4, async (m) => {
    if (shouldStop()) {
      stopped++;
      return;
    }
    const id = m.liftradarId;
    const destinationId = destByRef.get(m.peakrRef)!;
    const entry = swiss.get(id)!;
    const prev = state.get(id);
    // Die Quelle hat seit dem letzten Abgleich nicht neu gelesen → nichts abrufen.
    if (
      !force &&
      prev &&
      prev.destinationId === destinationId &&
      sameInstant(prev.checkedAt, entry.checked_at)
    ) {
      unchangedIds.push(id);
      return;
    }
    try {
      const res = await fetcher(resortUrl(id), { etag: force ? null : (prev?.etag ?? null) });
      if (res.notModified) {
        notModified++;
        unchangedIds.push(id);
        return;
      }
      const file = resortFileSchema.safeParse(res.body);
      if (!file.success)
        throw new Error(
          `Gebietsdatei ungültig (${file.error.issues[0]?.path.join('.')}: ${file.error.issues[0]?.message})`,
        );
      if (file.data.id !== id) throw new Error(`Gebietsdatei gehört zu «${file.data.id}»`);
      let details = null;
      const reporting = file.data.status === 'open' || file.data.status === 'closed';
      if (file.data.details && reporting) {
        const d = await fetcher(detailsUrl(id));
        if (d.notModified) throw new Error('Einzelliste ohne Inhalt (304)');
        const parsed = detailsFileSchema.safeParse(d.body);
        if (!parsed.success)
          throw new Error(
            `Einzelliste ungültig (${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message})`,
          );
        if (parsed.data.id !== id) throw new Error(`Einzelliste gehört zu «${parsed.data.id}»`);
        details = parsed.data;
      }
      const snap = buildSnapshot({
        file: file.data,
        details,
        destinationId,
        matchMethod: m.method,
        matchVerified: m.verified !== false,
        etag: res.etag,
        now: now(),
        indexCheckedAt: entry.checked_at,
      });
      for (const [k, v] of Object.entries(snap.unknownStatusValues))
        unknownStatusValues[k] = (unknownStatusValues[k] ?? 0) + v;
      if (snap.countMismatch) countMismatches.push(id);
      const outcome = await store.saveSnapshot(snap);
      if (outcome === 'changed') changed++;
      else sameContent++;
    } catch (err) {
      const error = describeError(err);
      errors.push({ id, error });
      logger.warn(
        { resort: id, error },
        'LiftRadar: Gebiet nicht aktualisiert – bisheriger Stand bleibt',
      );
    }
  });

  await store.touchFetched(unchangedIds);
  const removed = await store.removeUnmapped(active.map((m) => m.liftradarId));
  // ETag nur merken, wenn alles vollständig abgeglichen ist; sonst holt der nächste Lauf den Index neu.
  await store.setIndexEtag(
    errors.length === 0 && stopped === 0 && missingInIndex.length === 0 ? indexRes.etag : null,
  );
  if (Object.keys(unknownStatusValues).length > 0)
    logger.warn(
      { unknownStatusValues },
      'LiftRadar: unbekannte Statuswerte (als «unbekannt» gespeichert)',
    );

  const unchanged = unchangedIds.length + sameContent;
  return base({
    total: work.length,
    updated: changed + unchanged,
    failed: errors.length + stopped,
    swissResorts: swiss.size,
    changed,
    unchanged,
    notModified,
    missingInIndex,
    unmappedCandidates,
    errors: errors.slice(0, 25),
    invalidIndexEntries,
    unknownStatusValues,
    countMismatches,
    removed,
    totals: await store.totals(),
    seconds: Math.round((Date.now() - started) / 100) / 10,
  });
}

/** Lesbarer Bericht für das Protokoll des Laufs. */
export function formatReport(r: LiftSyncResult): string {
  const t = r.totals;
  return [
    'LiftRadar-Abgleich',
    `Index: ${r.index === 'not_modified' ? 'unverändert (304)' : `geladen, ${r.swissResorts} Schweizer Gebiete`}`,
    `Zugeordnet: ${r.mapped} (aktiv ${r.active}${r.unresolvedRefs.length ? `, ${r.unresolvedRefs.length} Peakr-Gebiete nicht gefunden` : ''})`,
    `Neu gespeichert: ${r.changed} · unverändert: ${r.unchanged} (davon 304: ${r.notModified}) · Fehler: ${r.errors.length}`,
    `Nicht im Index: ${r.missingInIndex.length ? r.missingInIndex.join(', ') : '–'}`,
    `Ohne Zuordnung (neu): ${r.unmappedCandidates.length ? r.unmappedCandidates.join(', ') : '–'}`,
    `Gebiete mit aktuellem Bericht: ${t.reporting}, ohne: ${t.noReport}`,
    `Lifte: offen ${t.lifts.open}, geschlossen ${t.lifts.closed}, in Vorbereitung ${t.lifts.preparation}, unbekannt ${t.lifts.unknown}`,
    `Pisten: offen ${t.slopes.open}, geschlossen ${t.slopes.closed}, in Vorbereitung ${t.slopes.preparation}, unbekannt ${t.slopes.unknown}`,
    `Dauer: ${r.seconds} s`,
  ].join('\n');
}
