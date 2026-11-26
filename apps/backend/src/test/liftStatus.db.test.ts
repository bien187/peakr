/**
 * Lift- und Pistenstatus gegen die echte Datenbank (Migration 0006): Speichern,
 * unveränderter Inhalt, Ersetzen der Einzelliste, Detail-API, Aufräumen.
 * Legt ein eigenes Test-Skigebiet an und entfernt es danach wieder; fremde
 * Stände bleiben unberührt.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryClient as sql } from '../db';
import { detailsFileSchema, resortFileSchema } from '../lifts/liftradar';
import { buildSnapshot } from '../lifts/snapshot';
import { detailForDestination } from '../lifts/summary';
import { upsertDataSource } from '../pipeline/runs';
import {
  loadStoredState,
  readStatusForDestination,
  removeUnmapped,
  resolveSkiRefs,
  saveSnapshot,
  touchFetched,
} from '../repositories/liftStatus.repo';
import { getDestinationDetail } from '../repositories/destination.repo';

const tag = randomUUID().slice(0, 8);
const areaId = `peakr-test-${tag}`;
const ref = `ski:way/${900_000_000 + Math.floor(Math.random() * 1_000_000)}`;
let destinationId = '';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../lifts/__fixtures__/${name}`, import.meta.url), 'utf8'));

function snapshotOf(
  mutate: (details: { lifts: Record<string, unknown>[] }) => void = () => undefined,
) {
  const file = { ...fixture('testberg.json'), id: areaId };
  const details = { ...fixture('testberg.details.json'), id: areaId } as unknown as {
    lifts: Record<string, unknown>[];
  };
  mutate(details);
  return buildSnapshot({
    file: resortFileSchema.parse(file),
    details: detailsFileSchema.parse(details),
    destinationId,
    matchMethod: 'manual',
    matchVerified: true,
    etag: '"t1"',
    now: new Date('2026-12-20T14:00:00+01:00'),
  });
}

beforeAll(async () => {
  const [d] = await sql<{ id: string }[]>`
    INSERT INTO destinations (name, type, lat, lng) VALUES (${`Testberg ${tag}`}, 'ski_resort', 46.6, 7.6) RETURNING id
  `;
  destinationId = d.id;
  await sql`INSERT INTO destination_sources (source, source_ref, destination_id) VALUES ('osm', ${ref}, ${destinationId})`;
  await upsertDataSource('liftradar');
});

afterAll(async () => {
  await sql`DELETE FROM destinations WHERE id = ${destinationId}`;
});

describe('Lift- und Pistenstatus in der Datenbank', () => {
  it('löst die OSM-Referenz der Zuordnung auf; unbekannte Referenzen nicht', async () => {
    expect((await resolveSkiRefs([ref])).get(ref)).toBe(destinationId);
    expect((await resolveSkiRefs(['ski:way/1'])).size).toBe(0);
  });

  it('speichert Stand und Einzelliste; gleicher Inhalt ersetzt nichts', async () => {
    expect(await saveSnapshot(snapshotOf())).toBe('changed');
    const first = await readStatusForDestination(destinationId);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({
      resort_status: 'open',
      lifts_open: 2,
      lifts_total: 5,
      slopes_unknown: 1,
    });
    expect(first.items).toHaveLength(10);
    expect((await loadStoredState()).get(areaId)).toMatchObject({ destinationId, etag: '"t1"' });

    expect(await saveSnapshot(snapshotOf())).toBe('unchanged');
    expect((await readStatusForDestination(destinationId)).items).toHaveLength(10);
  });

  it('neue und entfernte Anlagen: Einzelliste wird vollständig ersetzt', async () => {
    const outcome = await saveSnapshot(
      snapshotOf((d) => {
        d.lifts = d.lifts.filter((l) => l.id !== 'lift-d-uebungslift');
        d.lifts.push({
          id: 'lift-f-neu',
          ref: 'F',
          name: 'F • Neue Sesselbahn',
          type: 'chairlift',
          status: 'open',
          length_m: null,
        });
      }),
    );
    expect(outcome).toBe('changed');
    const { rows, items } = await readStatusForDestination(destinationId);
    const lifts = items.filter((i) => i.kind === 'lift').map((i) => i.item_id);
    expect(lifts).toContain('lift-f-neu');
    expect(lifts).not.toContain('lift-d-uebungslift');
    expect(rows[0]).toMatchObject({ lifts_open: 3, lifts_closed: 0, lifts_total: 5 });
  });

  it('Detail-API liefert Status, Einzellisten und die Quelle', async () => {
    await touchFetched([areaId]);
    const { rows, items } = await readStatusForDestination(destinationId);
    const detail = detailForDestination(rows, items, new Date('2026-12-20T14:00:00+01:00'))!;
    expect(detail).toMatchObject({ status: 'open', freshness: 'fresh', dataAtIsReport: true });
    expect(detail.liftItems[0].status).toBe('open');

    const found = await getDestinationDetail(destinationId);
    expect(found?.detail.liftStatus?.areaDetails[0]).toMatchObject({
      id: areaId,
      websiteUrl: 'https://www.testberg.example/',
    });
    expect(found?.detail.liftStatus?.liftItems).toHaveLength(5);
    expect(found?.detail.sources.map((s) => s.id)).toContain('liftradar');
  });

  it('nicht mehr zugeordnete Gebiete werden entfernt (samt Einzelliste), andere bleiben', async () => {
    const others = await sql<{ source_resort_id: string }[]>`
      SELECT source_resort_id FROM ski_resort_status WHERE source = 'liftradar' AND source_resort_id <> ${areaId}
    `;
    expect(await removeUnmapped(others.map((o) => o.source_resort_id))).toBe(1);
    const left =
      await sql`SELECT 1 FROM ski_resort_status_items WHERE source_resort_id = ${areaId}`;
    expect(left).toHaveLength(0);
    const stillThere =
      await sql`SELECT count(*)::int AS n FROM ski_resort_status WHERE source = 'liftradar'`;
    expect(stillThere[0].n).toBe(others.length);
  });
});
