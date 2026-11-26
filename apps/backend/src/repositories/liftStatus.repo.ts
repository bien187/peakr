import { queryClient as sql } from '../db';
import type { ResortSnapshot } from '../lifts/snapshot';
import type { ItemRow, StatusRow } from '../lifts/summary';
import type { LiftStore, StatusTotals } from '../lifts/sync';
import { chunks, getMeta, setMeta } from '../pipeline/runs';

/**
 * Lift- und Pistenstatus in der Datenbank (Migration 0006).
 *
 * Schreiben je Gebiet in einer Transaktion: Status und Einzelliste werden nur
 * zusammen ersetzt. Schlägt ein Gebiet fehl, bleibt sein bisheriger Stand
 * unverändert stehen – er wird über die Zeitpunkte als älter erkennbar.
 */

export const SOURCE = 'liftradar';

export interface StoredState {
  sourceResortId: string;
  destinationId: string;
  checkedAt: string | null;
  etag: string | null;
  contentHash: string | null;
}

const STATUS_COLUMNS = sql`
  s.source_resort_id, s.destination_id, s.source_name, s.resort_status,
  s.lifts_open, s.lifts_closed, s.lifts_preparation, s.lifts_unknown, s.lifts_total,
  s.slopes_open, s.slopes_closed, s.slopes_preparation, s.slopes_unknown, s.slopes_total,
  s.slopes_open_km, s.slopes_total_km, s.snow_valley_cm, s.snow_mountain_cm, s.fresh_snow_cm,
  s.report_at, s.checked_at, s.values_from, s.fetched_at, s.website_url, s.source_url, s.source_links
`;

/** Ziel-IDs zu den OSM-Referenzen der Zuordnung (nur aktive Skigebiete). */
export async function resolveSkiRefs(refs: string[]): Promise<Map<string, string>> {
  if (refs.length === 0) return new Map();
  const rows = await sql<{ source_ref: string; destination_id: string }[]>`
    SELECT ds.source_ref, ds.destination_id
    FROM destination_sources ds JOIN destinations d ON d.id = ds.destination_id
    WHERE ds.source = 'osm' AND ds.source_ref = ANY(${refs}) AND d.type = 'ski_resort' AND d.retired_at IS NULL
  `;
  return new Map(rows.map((r) => [r.source_ref, r.destination_id]));
}

export async function loadStoredState(): Promise<Map<string, StoredState>> {
  const rows = await sql<
    {
      source_resort_id: string;
      destination_id: string;
      checked_at: Date | null;
      etag: string | null;
      content_hash: string | null;
    }[]
  >`
    SELECT source_resort_id, destination_id, checked_at, etag, content_hash FROM ski_resort_status WHERE source = ${SOURCE}
  `;
  return new Map(
    rows.map((r) => [
      r.source_resort_id,
      {
        sourceResortId: r.source_resort_id,
        destinationId: r.destination_id,
        checkedAt: r.checked_at ? new Date(r.checked_at).toISOString() : null,
        etag: r.etag,
        contentHash: r.content_hash,
      },
    ]),
  );
}

/** Speichert einen Stand. Unveränderter Inhalt (gleiche Prüfsumme): nur Zeitpunkte und ETag aktualisieren. */
export async function saveSnapshot(s: ResortSnapshot): Promise<'changed' | 'unchanged'> {
  return sql.begin(async (tx) => {
    const [prev] = await tx<{ content_hash: string | null }[]>`
      SELECT content_hash FROM ski_resort_status WHERE source = ${SOURCE} AND source_resort_id = ${s.sourceResortId} FOR UPDATE
    `;
    if (prev && prev.content_hash === s.contentHash) {
      await tx`
        UPDATE ski_resort_status SET
          destination_id = ${s.destinationId}, source_name = ${s.sourceName}, match_method = ${s.matchMethod},
          match_verified = ${s.matchVerified}, checked_at = ${s.checkedAt}, fetched_at = now(), etag = ${s.etag}, updated_at = now()
        WHERE source = ${SOURCE} AND source_resort_id = ${s.sourceResortId}
      `;
      return 'unchanged' as const;
    }
    await tx`
      INSERT INTO ski_resort_status (
        source, source_resort_id, destination_id, source_name, match_method, match_verified, resort_status,
        lifts_open, lifts_closed, lifts_preparation, lifts_unknown, lifts_total,
        slopes_open, slopes_closed, slopes_preparation, slopes_unknown, slopes_total, slopes_open_km, slopes_total_km,
        lifts_by_type, slopes_by_difficulty, snow_valley_cm, snow_mountain_cm, fresh_snow_cm,
        report_at, checked_at, values_from, fetched_at, changed_at, website_url, source_url, source_links, etag, content_hash, updated_at
      ) VALUES (
        ${SOURCE}, ${s.sourceResortId}, ${s.destinationId}, ${s.sourceName}, ${s.matchMethod}, ${s.matchVerified}, ${s.resortStatus},
        ${s.lifts.open}, ${s.lifts.closed}, ${s.lifts.preparation}, ${s.lifts.unknown}, ${s.lifts.total},
        ${s.slopes.open}, ${s.slopes.closed}, ${s.slopes.preparation}, ${s.slopes.unknown}, ${s.slopes.total},
        ${s.slopes.openKm}, ${s.slopes.totalKm},
        ${tx.json(s.liftsByType as never)}, ${tx.json(s.slopesByDifficulty as never)},
        ${s.snow.valleyCm}, ${s.snow.mountainCm}, ${s.snow.freshCm},
        ${s.reportAt}, ${s.checkedAt}, ${s.valuesFrom}, now(), now(), ${s.websiteUrl}, ${s.sourceUrl},
        ${tx.json(s.sourceLinks as never)}, ${s.etag}, ${s.contentHash}, now()
      )
      ON CONFLICT (source, source_resort_id) DO UPDATE SET
        destination_id = EXCLUDED.destination_id, source_name = EXCLUDED.source_name, match_method = EXCLUDED.match_method,
        match_verified = EXCLUDED.match_verified, resort_status = EXCLUDED.resort_status,
        lifts_open = EXCLUDED.lifts_open, lifts_closed = EXCLUDED.lifts_closed, lifts_preparation = EXCLUDED.lifts_preparation,
        lifts_unknown = EXCLUDED.lifts_unknown, lifts_total = EXCLUDED.lifts_total,
        slopes_open = EXCLUDED.slopes_open, slopes_closed = EXCLUDED.slopes_closed, slopes_preparation = EXCLUDED.slopes_preparation,
        slopes_unknown = EXCLUDED.slopes_unknown, slopes_total = EXCLUDED.slopes_total,
        slopes_open_km = EXCLUDED.slopes_open_km, slopes_total_km = EXCLUDED.slopes_total_km,
        lifts_by_type = EXCLUDED.lifts_by_type, slopes_by_difficulty = EXCLUDED.slopes_by_difficulty,
        snow_valley_cm = EXCLUDED.snow_valley_cm, snow_mountain_cm = EXCLUDED.snow_mountain_cm, fresh_snow_cm = EXCLUDED.fresh_snow_cm,
        report_at = EXCLUDED.report_at, checked_at = EXCLUDED.checked_at, values_from = EXCLUDED.values_from,
        fetched_at = now(), changed_at = now(), website_url = EXCLUDED.website_url, source_url = EXCLUDED.source_url,
        source_links = EXCLUDED.source_links, etag = EXCLUDED.etag, content_hash = EXCLUDED.content_hash, updated_at = now()
    `;
    await tx`DELETE FROM ski_resort_status_items WHERE source = ${SOURCE} AND source_resort_id = ${s.sourceResortId}`;
    for (const batch of chunks(s.items, 400)) {
      const rows = batch.map((i) => ({
        kind: i.kind,
        item_id: i.itemId,
        position: i.position,
        ref: i.ref,
        name: i.name,
        item_type: i.itemType,
        colour: i.colour,
        status: i.status,
        status_raw: i.statusRaw,
        length_m: i.lengthM,
      }));
      await tx`
        INSERT INTO ski_resort_status_items (source, source_resort_id, kind, item_id, position, ref, name, item_type, colour, status, status_raw, length_m)
        SELECT ${SOURCE}, ${s.sourceResortId}, x.kind, x.item_id, x.position, x.ref, x.name, x.item_type, x.colour, x.status, x.status_raw, x.length_m
        FROM jsonb_to_recordset(${tx.json(rows as never)}) AS x(
          kind text, item_id text, position int, ref text, name text, item_type text, colour text, status text, status_raw text, length_m int
        )
      `;
    }
    return 'changed' as const;
  });
}

/** Unveränderte Gebiete (die Quelle hat seit dem letzten Abgleich nicht neu gelesen): nur «zuletzt abgeglichen» setzen. */
export async function touchFetched(sourceResortIds: string[]): Promise<void> {
  if (sourceResortIds.length === 0) return;
  await sql`
    UPDATE ski_resort_status SET fetched_at = now(), updated_at = now()
    WHERE source = ${SOURCE} AND source_resort_id = ANY(${sourceResortIds})
  `;
}

/** Entfernt Stände von Gebieten, die nicht mehr zugeordnet sind. */
export async function removeUnmapped(keepIds: string[]): Promise<number> {
  const res = await sql`
    DELETE FROM ski_resort_status WHERE source = ${SOURCE} AND NOT (source_resort_id = ANY(${keepIds}))
  `;
  return res.count;
}

/** Letzter erfolgreicher Abgleich (für die Saisonlogik). */
export async function lastSuccessfulSync(job: string): Promise<Date | null> {
  const [row] = await sql<{ finished_at: Date | null }[]>`
    SELECT finished_at FROM import_runs WHERE job = ${job} AND status IN ('success', 'partial') AND (stats->>'skipped') IS NULL
    ORDER BY finished_at DESC NULLS LAST LIMIT 1
  `;
  return row?.finished_at ? new Date(row.finished_at) : null;
}

/** Alle Stände (für die Suche; wenige hundert Zeilen). */
export async function readAllStatusRows(): Promise<StatusRow[]> {
  return sql<StatusRow[]>`
    SELECT ${STATUS_COLUMNS} FROM ski_resort_status s
    WHERE s.source = ${SOURCE}
    ORDER BY s.destination_id, s.source_name
  `;
}

/** Stände und Einzellisten eines Skigebiets (Detailansicht). */
export async function readStatusForDestination(
  destinationId: string,
): Promise<{ rows: StatusRow[]; items: ItemRow[] }> {
  const rows = await sql<StatusRow[]>`
    SELECT ${STATUS_COLUMNS} FROM ski_resort_status s
    WHERE s.source = ${SOURCE} AND s.destination_id = ${destinationId}
    ORDER BY s.source_name
  `;
  if (rows.length === 0) return { rows, items: [] };
  const items = await sql<ItemRow[]>`
    SELECT i.source_resort_id, i.kind, i.item_id, i.position, i.ref, i.name, i.item_type, i.colour, i.status, i.length_m
    FROM ski_resort_status_items i
    WHERE i.source = ${SOURCE} AND i.source_resort_id = ANY(${rows.map((r) => r.source_resort_id)})
  `;
  return { rows, items };
}

const INDEX_META_KEY = 'liftradar_index';

export async function getIndexEtag(): Promise<string | null> {
  return (await getMeta<{ etag: string | null }>(INDEX_META_KEY))?.etag ?? null;
}

export async function setIndexEtag(etag: string | null): Promise<void> {
  await setMeta(INDEX_META_KEY, { etag, savedAt: new Date().toISOString() });
}

/** Gesamtzahlen über alle gespeicherten Gebiete (für den Bericht des Laufs). */
export async function statusTotals(): Promise<StatusTotals> {
  const [r] = await sql<
    {
      reporting: number;
      no_report: number;
      lo: number;
      lc: number;
      lp: number;
      lu: number;
      so: number;
      sc: number;
      sp: number;
      su: number;
    }[]
  >`
    SELECT
      count(*) FILTER (WHERE resort_status IN ('open', 'closed'))::int AS reporting,
      count(*) FILTER (WHERE resort_status NOT IN ('open', 'closed'))::int AS no_report,
      coalesce(sum(lifts_open), 0)::int AS lo, coalesce(sum(lifts_closed), 0)::int AS lc,
      coalesce(sum(lifts_preparation), 0)::int AS lp, coalesce(sum(lifts_unknown), 0)::int AS lu,
      coalesce(sum(slopes_open), 0)::int AS so, coalesce(sum(slopes_closed), 0)::int AS sc,
      coalesce(sum(slopes_preparation), 0)::int AS sp, coalesce(sum(slopes_unknown), 0)::int AS su
    FROM ski_resort_status WHERE source = ${SOURCE}
  `;
  return {
    reporting: r.reporting,
    noReport: r.no_report,
    lifts: { open: r.lo, closed: r.lc, preparation: r.lp, unknown: r.lu },
    slopes: { open: r.so, closed: r.sc, preparation: r.sp, unknown: r.su },
  };
}

/** Datenbankanbindung für den Abgleich (lifts/sync.ts). */
export const liftStore: LiftStore = {
  resolveSkiRefs,
  loadStoredState,
  saveSnapshot,
  touchFetched,
  removeUnmapped,
  getIndexEtag,
  setIndexEtag,
  totals: statusTotals,
};
