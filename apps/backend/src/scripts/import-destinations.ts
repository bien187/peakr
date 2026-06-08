import { curatedDestinations } from '../data/curated-destinations';
import { queryClient } from '../db';
import { logger } from '../lib/logger';
import {
  countDestinations,
  destinationExistsByNameType,
  destinationExistsByOsmId,
  insertDestination,
  type DestinationInsert,
} from '../repositories/import.repo';
import { elementLatLng, overpassQuery, type OverpassElement } from '../services/overpass.service';

const CH_AREA = 'area["ISO3166-1"="CH"][admin_level=2]->.ch;';

function parseWikipedia(tags: Record<string, string> | undefined): string | null {
  if (!tags) return null;
  if (tags['wikipedia:de']) return tags['wikipedia:de'];
  const w = tags.wikipedia;
  if (w) {
    const de = /^de:(.+)$/.exec(w);
    if (de) return de[1];
    const any = /^[a-z]{2}:(.+)$/.exec(w);
    return any ? any[1] : w;
  }
  return null;
}

function parseEle(tags: Record<string, string> | undefined): number | null {
  const raw = tags?.ele;
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

async function importCurated(): Promise<number> {
  let inserted = 0;
  for (const d of curatedDestinations) {
    if (await destinationExistsByNameType(d.name, d.type)) continue;
    await insertDestination(d);
    inserted++;
  }
  logger.info({ inserted }, 'Kuratierte Ziele importiert');
  return inserted;
}

async function importOverpassGroup(
  label: string,
  ql: string,
  map: (el: OverpassElement) => DestinationInsert | null,
): Promise<number> {
  logger.info({ label }, '⏳ Overpass-Abfrage (Rate-Limit beachten) ...');
  let elements: OverpassElement[];
  try {
    elements = await overpassQuery(ql);
  } catch (err) {
    logger.error({ label, error: err instanceof Error ? err.message : String(err) }, 'Overpass-Abfrage fehlgeschlagen – überspringe Gruppe');
    return 0;
  }

  let inserted = 0;
  for (const el of elements) {
    const osmId = `${el.type}/${el.id}`;
    try {
      if (await destinationExistsByOsmId(osmId)) continue;
      const dest = map(el);
      if (!dest) continue;
      await insertDestination(dest);
      inserted++;
    } catch (err) {
      logger.warn({ osmId, error: err instanceof Error ? err.message : String(err) }, 'Insert übersprungen');
    }
  }
  logger.info({ label, found: elements.length, inserted }, 'Overpass-Gruppe importiert');
  return inserted;
}

async function main(): Promise<void> {
  let total = 0;
  total += await importCurated();

  // 1) Skigebiete (winter_sports-Flächen mit Namen)
  total += await importOverpassGroup(
    'ski_resorts',
    `[out:json][timeout:120];${CH_AREA}(nwr["landuse"="winter_sports"]["name"](area.ch););out center 300;`,
    (el) => {
      const loc = elementLatLng(el);
      if (!loc) return null;
      return {
        name: el.tags?.name ?? 'Skigebiet',
        type: 'ski_resort',
        canton: null,
        lat: loc.lat,
        lng: loc.lng,
        wikipediaTitle: parseWikipedia(el.tags),
        sourceRef: { osmId: `${el.type}/${el.id}`, tags: el.tags },
      };
    },
  );

  // 2) Gipfel (nur namentlich + Höhe ≥ 2500 m, um Rauschen zu begrenzen)
  total += await importOverpassGroup(
    'peaks',
    `[out:json][timeout:120];${CH_AREA}(node["natural"="peak"]["name"]["ele"](area.ch););out 600;`,
    (el) => {
      const loc = elementLatLng(el);
      const ele = parseEle(el.tags);
      if (!loc || ele === null || ele < 2500) return null;
      return {
        name: el.tags?.name ?? 'Gipfel',
        type: 'hike_destination',
        canton: null,
        lat: loc.lat,
        lng: loc.lng,
        elevationTopM: ele,
        wikipediaTitle: parseWikipedia(el.tags),
        sourceRef: { osmId: `${el.type}/${el.id}`, tags: el.tags },
      };
    },
  );

  // 3) Benannte Bergseen
  total += await importOverpassGroup(
    'lakes',
    `[out:json][timeout:120];${CH_AREA}((way|relation)["natural"="water"]["water"="lake"]["name"](area.ch););out center 250;`,
    (el) => {
      const loc = elementLatLng(el);
      if (!loc) return null;
      return {
        name: el.tags?.name ?? 'See',
        type: 'hike_destination',
        canton: null,
        lat: loc.lat,
        lng: loc.lng,
        elevationTopM: parseEle(el.tags),
        wikipediaTitle: parseWikipedia(el.tags),
        sourceRef: { osmId: `${el.type}/${el.id}`, tags: el.tags },
      };
    },
  );

  const grand = await countDestinations();
  logger.info({ insertedThisRun: total, totalInDb: grand }, '✅ Ziel-Import fertig.');
  logger.info('Tipp: danach `pnpm import:slf-regions` ausführen, um Lawinenregionen zu verknüpfen.');
  await queryClient.end();
}

main().catch((err) => {
  logger.error(err, 'Ziel-Import fehlgeschlagen');
  process.exit(1);
});
