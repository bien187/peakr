/**
 * Hybride Ziel-Pipeline (v2)
 *
 * STEP 1  Skigebiete           kuratiert + OSM winter_sports
 * STEP 2  Gipfel               OSM natural=peak (ele ≥ 1200 m)
 * STEP 3  Seen                 OSM natural=water + ele (≥ 1000 m)
 * STEP 4  Hütten               OSM (alpine_hut + wilderness_hut)
 * STEP 5  Aussichtspunkte      OSM (viewpoint, nur mit Metadaten)
 * STEP 6  Wanderwege-Distanz   PostGIS ST_DWithin  ODER  GeoAdmin-API
 * STEP 7  Quality-Score        Formel (Basis + Metadaten + Wandernähe + Höhe)
 * STEP 8  Duplikate entfernen  gleicher Name, < 50 m
 * STEP 9  Schwache entfernen   quality_score < 30
 * STEP 10 SLF-Regionen linken
 */

import { curatedDestinations } from '../data/curated-destinations';
import { queryClient } from '../db';
import { logger } from '../lib/logger';
import {
  countDestinations,
  destinationExistsByNameType,
  destinationExistsByOsmId,
  insertDestination,
  removeDuplicateDestinations,
  removeUnqualifiedDestinations,
  type DestinationInsert,
} from '../repositories/import.repo';
import { linkDestinationsToRegions } from '../repositories/import.repo';
import { countHikingRoutes, nearestHikingRouteM, updateNearestRouteDistances } from '../repositories/hikingRoutes.repo';
import { isNearSwissHikingRoute, type Names3dKind } from '../services/geoAdmin.service';
import { elementLatLng, overpassQuery, type OverpassElement } from '../services/overpass.service';

const CH_AREA = 'area["ISO3166-1"="CH"][admin_level=2]->.ch;';

// ─── Quality Score ────────────────────────────────────────────────────────────

interface QualityParams {
  kind: Names3dKind;
  elevation: number | null;
  nearestRouteM: number | null;
  hasWikidata: boolean;
  hasWikipedia: boolean;
  hasDescription: boolean;
}

const BASE_SCORE: Record<Names3dKind, number> = {
  hut: 70,
  viewpoint: 65,
  peak: 60,
  lake: 55,
};

export function computeQualityScore(p: QualityParams): number {
  let score = BASE_SCORE[p.kind] ?? 50;

  if (p.hasWikidata) score += 15;
  if (p.hasWikipedia) score += 15;
  if (p.hasDescription) score += 5;

  if (p.nearestRouteM !== null) {
    if (p.nearestRouteM <= 200) score += 20;
    else if (p.nearestRouteM <= 500) score += 10;
    else if (p.nearestRouteM <= 800) score += 5;
    // > 800 m → kein Bonus, wird in STEP 9 gefiltert
  } else {
    // Unbekannte Nähe: hohe Elevation als Proxy für Erreichbarkeit
    if (p.elevation && p.elevation >= 1500) score += 5;
  }

  // Süsser Fleck 1200–2600 m: wanderoptimale Höhe
  if (p.elevation !== null && p.elevation >= 1200 && p.elevation <= 2600) {
    score += 10;
  }

  return Math.min(100, score);
}

// ─── Wanderwege-Nähe ─────────────────────────────────────────────────────────

/** Bestimmt nearest_route_m: PostGIS wenn Tabelle befüllt, sonst GeoAdmin-API. */
async function resolveNearestRoute(
  lat: number,
  lng: number,
  routesInDb: boolean,
): Promise<number | null> {
  if (routesInDb) {
    return nearestHikingRouteM(lat, lng);
  }
  // Fallback: GeoAdmin-API (langsamer, aber kein lokales Import nötig)
  const near = await isNearSwissHikingRoute(lat, lng, 800);
  return near ? 400 : 1200; // Schätzwert (kein exakter Meter-Wert verfügbar)
}

// ─── STEP 1: Skigebiete ───────────────────────────────────────────────────────

async function importSkiResorts(): Promise<number> {
  let inserted = 0;

  // Kuratierte Liste
  for (const d of curatedDestinations) {
    if (await destinationExistsByNameType(d.name, d.type)) continue;
    await insertDestination({
      ...d,
      poiKind: null,
      sourceLayer: 'curated',
      qualityScore: 90, // Kuratierte Einträge sind immer hochwertig
    });
    inserted++;
  }

  // OSM winter_sports
  const elements = await overpassQuery(
    `[out:json][timeout:120];${CH_AREA}(nwr["landuse"="winter_sports"]["name"](area.ch););out center 300;`,
  ).catch(() => [] as OverpassElement[]);

  for (const el of elements) {
    const osmId = `${el.type}/${el.id}`;
    if (await destinationExistsByOsmId(osmId)) continue;
    const loc = elementLatLng(el);
    if (!loc) continue;
    const wd = el.tags?.wikidata ?? null;
    const wp = parseWikipedia(el.tags);
    await insertDestination({
      name: el.tags?.name ?? 'Skigebiet',
      type: 'ski_resort',
      canton: null,
      lat: loc.lat,
      lng: loc.lng,
      wikipediaTitle: wp,
      sourceRef: { osmId, tags: el.tags },
      poiKind: null,
      sourceLayer: 'osm',
      qualityScore: 75 + (wd ? 10 : 0) + (wp ? 5 : 0),
    });
    inserted++;
  }

  logger.info({ inserted }, 'STEP 1 ✓ Skigebiete');
  return inserted;
}

// ─── STEP 2: Gipfel (OSM natural=peak) ───────────────────────────────────────

async function importPeaks(routesInDb: boolean): Promise<number> {
  logger.info('STEP 2 — Gipfel aus OSM (natural=peak) …');
  const elements = await overpassQuery(
    `[out:json][timeout:120];${CH_AREA}` +
    `node["natural"="peak"]["name"]["ele"](area.ch);` +
    `out 8000;`,
  ).catch(() => [] as OverpassElement[]);

  logger.info({ raw: elements.length }, 'OSM Gipfel geladen');
  let inserted = 0;
  for (const el of elements) {
    const osmId = `${el.type}/${el.id}`;
    if (await destinationExistsByOsmId(osmId)) continue;
    const loc = elementLatLng(el);
    if (!loc || !el.tags?.name) continue;
    const ele = parseEle(el.tags);
    if ((ele ?? 0) < 1200) continue;

    const nearM = await resolveNearestRoute(loc.lat, loc.lng, routesInDb);
    if (nearM !== null && nearM > 800) continue;

    const wd = el.tags.wikidata ?? null;
    const wp = parseWikipedia(el.tags);

    const qScore = computeQualityScore({
      kind: 'peak',
      elevation: ele,
      nearestRouteM: nearM,
      hasWikidata: !!wd,
      hasWikipedia: !!wp,
      hasDescription: false,
    });

    await insertDestination({
      name: el.tags.name,
      type: 'hike_destination',
      canton: null,
      lat: loc.lat,
      lng: loc.lng,
      elevationTopM: ele,
      wikipediaTitle: wp,
      sourceRef: { osmId, tags: el.tags },
      poiKind: 'peak',
      sourceLayer: 'osm',
      nearestRouteM: nearM,
      qualityScore: qScore,
    });
    inserted++;
    if (inserted % 100 === 0) logger.info({ inserted }, 'Gipfel-Fortschritt …');
  }

  logger.info({ inserted, raw: elements.length }, 'STEP 2 ✓ Gipfel');
  return inserted;
}

// ─── STEP 3: Bergseen (OSM natural=water + ele) ───────────────────────────────

async function importLakes(routesInDb: boolean): Promise<number> {
  logger.info('STEP 3 — Bergseen aus OSM …');
  const elements = await overpassQuery(
    `[out:json][timeout:180];${CH_AREA}` +
    `(nwr["natural"="water"]["name"]["ele"](area.ch););` +
    `out center 3000;`,
  ).catch(() => [] as OverpassElement[]);

  logger.info({ raw: elements.length }, 'OSM Seen geladen');
  let inserted = 0;
  for (const el of elements) {
    const osmId = `${el.type}/${el.id}`;
    if (await destinationExistsByOsmId(osmId)) continue;
    const loc = elementLatLng(el);
    if (!loc || !el.tags?.name) continue;
    const ele = parseEle(el.tags);
    if ((ele ?? 0) < 1000) continue;

    const nearM = await resolveNearestRoute(loc.lat, loc.lng, routesInDb);
    if (nearM !== null && nearM > 800) continue;

    const wd = el.tags.wikidata ?? null;
    const wp = parseWikipedia(el.tags);

    const qScore = computeQualityScore({
      kind: 'lake',
      elevation: ele,
      nearestRouteM: nearM,
      hasWikidata: !!wd,
      hasWikipedia: !!wp,
      hasDescription: false,
    });

    await insertDestination({
      name: el.tags.name,
      type: 'hike_destination',
      canton: null,
      lat: loc.lat,
      lng: loc.lng,
      elevationTopM: ele,
      wikipediaTitle: wp,
      sourceRef: { osmId, tags: el.tags },
      poiKind: 'lake',
      sourceLayer: 'osm',
      nearestRouteM: nearM,
      qualityScore: qScore,
    });
    inserted++;
  }

  logger.info({ inserted, raw: elements.length }, 'STEP 3 ✓ Seen');
  return inserted;
}

// ─── STEP 4: Hütten (OSM) ────────────────────────────────────────────────────

async function importHuts(routesInDb: boolean): Promise<number> {
  logger.info('STEP 4 — Hütten aus OSM …');
  const elements = await overpassQuery(
    `[out:json][timeout:120];${CH_AREA}` +
    `(node["tourism"="alpine_hut"]["name"](area.ch);` +
    ` node["tourism"="wilderness_hut"]["name"](area.ch);` +
    ` node["amenity"="shelter"]["name"]["sac_scale"](area.ch););` +
    `out 2000;`,
  ).catch(() => [] as OverpassElement[]);

  let inserted = 0;
  for (const el of elements) {
    const osmId = `${el.type}/${el.id}`;
    if (await destinationExistsByOsmId(osmId)) continue;
    const loc = elementLatLng(el);
    if (!loc) continue;
    if (!el.tags?.name) continue;

    const nearM = await resolveNearestRoute(loc.lat, loc.lng, routesInDb);
    if (nearM !== null && nearM > 800) continue;

    const wp = parseWikipedia(el.tags);
    const wd = el.tags?.wikidata ?? null;
    const desc = el.tags?.description ?? el.tags?.['description:de'] ?? null;

    const qScore = computeQualityScore({
      kind: 'hut',
      elevation: parseEle(el.tags),
      nearestRouteM: nearM,
      hasWikidata: !!wd,
      hasWikipedia: !!wp,
      hasDescription: !!desc,
    });

    await insertDestination({
      name: el.tags.name,
      type: 'hike_destination',
      canton: null,
      lat: loc.lat,
      lng: loc.lng,
      elevationTopM: parseEle(el.tags),
      wikipediaTitle: wp,
      sourceRef: { osmId, tags: el.tags },
      poiKind: 'hut',
      sourceLayer: 'osm',
      nearestRouteM: nearM,
      qualityScore: qScore,
    });
    inserted++;
    await new Promise((r) => setTimeout(r, routesInDb ? 0 : 80));
  }

  logger.info({ inserted, raw: elements.length }, 'STEP 4 ✓ Hütten');
  return inserted;
}

// ─── STEP 5: Aussichtspunkte (OSM, nur mit Metadaten) ─────────────────────────

async function importViewpoints(routesInDb: boolean): Promise<number> {
  logger.info('STEP 5 — Aussichtspunkte aus OSM …');
  const elements = await overpassQuery(
    `[out:json][timeout:120];${CH_AREA}` +
    `node["tourism"="viewpoint"]["name"](area.ch);` +
    `out 1000;`,
  ).catch(() => [] as OverpassElement[]);

  let inserted = 0;
  for (const el of elements) {
    const osmId = `${el.type}/${el.id}`;
    if (await destinationExistsByOsmId(osmId)) continue;
    const loc = elementLatLng(el);
    if (!loc || !el.tags?.name) continue;

    // Qualitätsfilter: mindestens eine Metadaten-Quelle
    const wd = el.tags.wikidata ?? null;
    const wp = parseWikipedia(el.tags);
    const desc = el.tags.description ?? el.tags['description:de'] ?? null;
    const website = el.tags.website ?? el.tags.url ?? null;
    if (!wd && !wp && !desc && !website) continue; // kein Metadatum → überspringen

    const nearM = await resolveNearestRoute(loc.lat, loc.lng, routesInDb);
    if (nearM !== null && nearM > 800) continue;

    const qScore = computeQualityScore({
      kind: 'viewpoint',
      elevation: parseEle(el.tags),
      nearestRouteM: nearM,
      hasWikidata: !!wd,
      hasWikipedia: !!wp,
      hasDescription: !!desc,
    });

    await insertDestination({
      name: el.tags.name,
      type: 'hike_destination',
      canton: null,
      lat: loc.lat,
      lng: loc.lng,
      elevationTopM: parseEle(el.tags),
      wikipediaTitle: wp,
      sourceRef: { osmId, tags: el.tags },
      poiKind: 'viewpoint',
      sourceLayer: 'osm',
      nearestRouteM: nearM,
      qualityScore: qScore,
    });
    inserted++;
    await new Promise((r) => setTimeout(r, routesInDb ? 0 : 80));
  }

  logger.info({ inserted, raw: elements.length }, 'STEP 5 ✓ Aussichtspunkte');
  return inserted;
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const routesInDb = (await countHikingRoutes()) > 0;
  if (routesInDb) {
    logger.info('hiking_routes befüllt → PostGIS-Distanzfilter aktiv.');
  } else {
    logger.warn(
      'hiking_routes leer → GeoAdmin-API als Fallback (langsamer). ' +
      'Für schnelleren Import zuerst `pnpm import:hiking-routes` ausführen.',
    );
  }

  let total = 0;
  total += await importSkiResorts();
  total += await importPeaks(routesInDb);
  total += await importLakes(routesInDb);
  total += await importHuts(routesInDb);
  total += await importViewpoints(routesInDb);

  // STEP 6: Wanderwege-Distanzen für alle neuen Einträge ohne Distanz ergänzen
  if (routesInDb) {
    logger.info('STEP 6 — Wanderwege-Distanzen batch-update …');
    const updated = await updateNearestRouteDistances();
    logger.info({ updated }, 'STEP 6 ✓ Distanzen aktualisiert');
  }

  // STEP 8: Duplikate entfernen
  logger.info('STEP 8 — Duplikate entfernen …');
  const dupes = await removeDuplicateDestinations();
  logger.info({ dupes }, 'STEP 8 ✓ Duplikate entfernt');

  // STEP 9: Unqualifizierte entfernen (score < 30 = schlecht + nicht wandernah)
  logger.info('STEP 9 — Schwache Einträge entfernen (quality_score < 30) …');
  const removed = await removeUnqualifiedDestinations(30);
  logger.info({ removed }, 'STEP 9 ✓ Einträge entfernt');

  // STEP 10: SLF-Regionen
  logger.info('STEP 10 — SLF-Regionen verknüpfen …');
  const linked = await linkDestinationsToRegions();
  logger.info({ linked }, 'STEP 10 ✓ SLF-Regionen');

  const grand = await countDestinations();
  logger.info(
    { insertedThisRun: total, totalInDb: grand, dupesRemoved: dupes, weakRemoved: removed },
    '✅ Ziel-Import (v2) abgeschlossen.',
  );

  await queryClient.end();
}

main().catch((err) => {
  logger.error(err, 'Ziel-Import fehlgeschlagen');
  process.exit(1);
});
