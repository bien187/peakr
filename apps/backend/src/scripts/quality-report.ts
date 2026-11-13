/**
 * Datenqualitätsbericht – zählt, was tatsächlich in der Datenbank steht, und
 * stellt es den Rohzahlen der Quellen aus dem letzten Importlauf gegenüber.
 *
 *   pnpm report:quality              Bericht auf der Konsole
 *   pnpm report:quality --write      zusätzlich nach docs/DATENQUALITAET.md
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../config/env';
import { queryClient as sql } from '../db';

const nf = new Intl.NumberFormat('de-CH');
const n = (v: number | string | null | undefined): string => (v == null ? '–' : nf.format(Number(v)));
const pct = (a: number, b: number): string => (b > 0 ? `${((a / b) * 100).toFixed(1)} %` : '–');

async function main(): Promise<void> {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);

  // Statistiken sind freies JSON je Pipeline-Schritt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runs = await sql<{ job: string; finished_at: Date; stats: Record<string, any> }[]>`
    SELECT DISTINCT ON (job) job, finished_at, stats FROM import_runs
    WHERE status = 'success' AND job LIKE 'pipeline:%' ORDER BY job, started_at DESC
  `;
  const run = (job: string) => runs.find((r) => r.job === job);
  const sources = await sql<{ id: string; name: string; version: string | null }[]>`SELECT id, name, version FROM data_sources ORDER BY id`;

  const kinds = await sql<{ kind: string; total: number; routed: number; no_route: number; unrouted: number; no_ele: number; sn3d: number; osm_only: number; both: number }[]>`
    SELECT d.poi_kind AS kind, count(*)::int AS total,
      count(*) FILTER (WHERE route_status = 'routed')::int AS routed,
      count(*) FILTER (WHERE route_status = 'no_route')::int AS no_route,
      count(*) FILTER (WHERE route_status = 'unrouted')::int AS unrouted,
      count(*) FILTER (WHERE elevation_top_m IS NULL)::int AS no_ele,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM destination_sources s WHERE s.destination_id = d.id AND s.source = 'swissnames3d'))::int AS sn3d,
      count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM destination_sources s WHERE s.destination_id = d.id AND s.source = 'swissnames3d'))::int AS osm_only,
      count(*) FILTER (WHERE (SELECT count(DISTINCT s.source) FROM destination_sources s WHERE s.destination_id = d.id) > 1)::int AS both
    FROM destinations d WHERE d.type = 'hike_destination' AND d.retired_at IS NULL
    GROUP BY 1 ORDER BY 2 DESC
  `;
  const [elev] = await sql<{ below1200: number; below800: number }[]>`
    SELECT count(*) FILTER (WHERE elevation_top_m < 1200)::int AS below1200, count(*) FILTER (WHERE elevation_top_m < 800)::int AS below800
    FROM destinations WHERE type = 'hike_destination' AND retired_at IS NULL AND poi_kind = 'peak'
  `;
  const cantons = await sql<{ canton: string; c: number }[]>`
    SELECT canton, count(*)::int AS c FROM destinations WHERE type = 'hike_destination' AND retired_at IS NULL GROUP BY 1 ORDER BY 1
  `;
  const [routes] = await sql<{ routes: number; dests: number; sac_unknown: number; sac_range: number; official_full: number; gap: number; variants: number }[]>`
    SELECT count(*)::int AS routes, count(DISTINCT destination_id)::int AS dests,
      count(*) FILTER (WHERE sac_max IS NULL)::int AS sac_unknown,
      count(*) FILTER (WHERE sac_min IS DISTINCT FROM sac_max AND sac_max IS NOT NULL)::int AS sac_range,
      count(*) FILTER (WHERE official_share >= 0.99)::int AS official_full,
      count(*) FILTER (WHERE end_gap_m > 150)::int AS gap,
      count(*) FILTER (WHERE rank > 1)::int AS variants
    FROM hike_routes hr JOIN destinations d ON d.id = hr.destination_id AND d.retired_at IS NULL
  `;
  const sac = await sql<{ sac: string | null; c: number }[]>`
    SELECT sac_max::text AS sac, count(*)::int AS c FROM hike_routes hr JOIN destinations d ON d.id = hr.destination_id AND d.retired_at IS NULL
    WHERE hr.rank = 1 GROUP BY 1 ORDER BY 1 NULLS LAST
  `;
  const th = await sql<{ kind: string; quality: number; c: number; no_drive: number }[]>`
    SELECT kind, quality, count(*)::int AS c, count(*) FILTER (WHERE drive_lat IS NULL)::int AS no_drive FROM trailheads GROUP BY 1, 2 ORDER BY 1, 2
  `;
  const [ski] = await sql<{ resorts: number; access: number; partial: number; lifts: number; piste_km: number; with_live: number; with_snow: number; with_lifts_live: number }[]>`
    SELECT count(*)::int AS resorts,
      count(*) FILTER (WHERE t.drive_lat IS NOT NULL)::int AS access,
      count(*) FILTER (WHERE t.road_snap_m > 600)::int AS partial,
      coalesce(sum(s.lifts_total), 0)::int AS lifts,
      coalesce(round(sum(s.piste_km)), 0)::int AS piste_km,
      count(*) FILTER (WHERE l.captured_at IS NOT NULL)::int AS with_live,
      count(*) FILTER (WHERE l.snow_depth_top_cm IS NOT NULL)::int AS with_snow,
      count(*) FILTER (WHERE l.lifts_open IS NOT NULL)::int AS with_lifts_live
    FROM destinations d
    LEFT JOIN ski_resort_details s ON s.destination_id = d.id
    LEFT JOIN trailheads t ON t.id = s.trailhead_id
    LEFT JOIN LATERAL (SELECT * FROM live_status x WHERE x.destination_id = d.id ORDER BY captured_at DESC LIMIT 1) l ON true
    WHERE d.type = 'ski_resort' AND d.retired_at IS NULL
  `;
  // Mögliche Doppel: gleiche Art, gleicher normalisierter Name, < 300 m Abstand.
  const [dups] = await sql<{ pairs: number }[]>`
    SELECT count(*)::int AS pairs FROM destinations a JOIN destinations b
      ON a.id < b.id AND a.poi_kind = b.poi_kind AND lower(a.name) = lower(b.name)
     AND ST_DWithin(a.geom::geography, b.geom::geography, 300)
    WHERE a.type = 'hike_destination' AND b.type = 'hike_destination' AND a.retired_at IS NULL AND b.retired_at IS NULL
  `;
  const [invalid] = await sql<{ bad_coord: number; bad_ele: number; no_name: number; bad_route: number }[]>`
    SELECT
      (SELECT count(*)::int FROM destinations WHERE retired_at IS NULL AND (lat NOT BETWEEN 45.7 AND 47.9 OR lng NOT BETWEEN 5.8 AND 10.6)) AS bad_coord,
      (SELECT count(*)::int FROM destinations WHERE retired_at IS NULL AND (elevation_top_m < 190 OR elevation_top_m > 4640)) AS bad_ele,
      (SELECT count(*)::int FROM destinations WHERE retired_at IS NULL AND trim(name) = '') AS no_name,
      (SELECT count(*)::int FROM hike_routes WHERE NOT ST_IsValid(geom) OR ST_NPoints(geom) < 2 OR distance_m <= 0) AS bad_route
  `;
  const [retired] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM destinations WHERE retired_at IS NOT NULL`;

  const total = kinds.reduce((a, k) => a + k.total, 0);
  const routed = kinds.reduce((a, k) => a + k.routed, 0);
  const label: Record<string, string> = { peak: 'Gipfel', pass: 'Pässe/Sättel', hut: 'Hütten/Berggasthäuser', lake: 'Seen', viewpoint: 'Aussichtspunkte' };

  out('# Peakr – Datenqualitätsbericht');
  out();
  out(`Erstellt am ${new Date().toLocaleString('de-CH', { timeZone: 'Europe/Zurich' })} mit \`pnpm report:quality\` aus der Datenbank.`);
  out();
  out('## Quellen');
  out();
  out('| Quelle | Stand |');
  out('|---|---|');
  for (const s of sources) out(`| ${s.name} | ${s.version ?? 'laufend'} |`);
  out();

  out('## Wanderziele');
  out();
  out(`**${n(total)}** aktive Wanderziele in **${cantons.length}** Kantonen; ${n(retired.c)} stillgelegt (nicht mehr in den Quellen bzw. ausserhalb der Schweiz).`);
  out();
  out('| Art | Anzahl | mit Route | ohne Route im Wegnetz | swissNAMES3D | nur OSM | aus beiden Quellen | ohne Höhe |');
  out('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const k of kinds) {
    out(`| ${label[k.kind] ?? k.kind} | ${n(k.total)} | ${n(k.routed)} (${pct(k.routed, k.total)}) | ${n(k.no_route + k.unrouted)} | ${n(k.sn3d)} | ${n(k.osm_only)} | ${n(k.both)} | ${n(k.no_ele)} |`);
  }
  out(`| **Summe** | **${n(total)}** | **${n(routed)} (${pct(routed, total)})** | | | | | |`);
  out();
  out(`Gipfel unter 1'200 m (früher hart ausgeschlossen): ${n(elev.below1200)}, davon unter 800 m: ${n(elev.below800)}.`);
  out();
  const d = run('pipeline:destinations')?.stats;
  if (d) {
    out('**Abgleich mit den Rohdaten des letzten Imports:**');
    out();
    out(`- swissNAMES3D: ${n(d.swissnames3d?.rows)} Namenseinträge gelesen → ${n(d.swissnames3d?.peak)} Gipfel, ${n(d.swissnames3d?.pass)} Pässe, ${n(d.swissnames3d?.hut)} Hütten, ${n(d.swissnames3d?.lake)} Seen, ${n(d.swissnames3d?.viewpoint)} Aussichtspunkte als Wanderziel-Objektarten.`);
    out(`- OpenStreetMap: ${n(d.osm?.features)} Objekte gelesen, ${n(d.osm?.unnamed)} ohne Namen und ${n(d.osm?.tooSmallWater)} Kleinstgewässer verworfen.`);
    out(`- ${n(d.candidates)} Kandidaten → ${n(d.duplicatesMerged)} als Doppel zusammengeführt → ${n(d.destinations)} Ziele; ${n(d.outsideSwitzerland)} lagen ausserhalb der Schweiz.`);
    out();
  }
  out('Nach Kanton: ' + cantons.map((c) => `${c.canton} ${n(c.c)}`).join(' · '));
  out();

  out('## Wanderrouten');
  out();
  out(`- ${n(routes.routes)} Routen zu ${n(routes.dests)} Zielen (${n(routes.variants)} davon zusätzliche Varianten).`);
  out(`- Schwierigkeit unbekannt: ${n(routes.sac_unknown)} Routen (${pct(routes.sac_unknown, routes.routes)}); als Bereich (amtliche Wegkategorie, z. B. T2–T3): ${n(routes.sac_range)}.`);
  out(`- Vollständig auf signalisierten Wanderwegen: ${n(routes.official_full)} (${pct(routes.official_full, routes.routes)}).`);
  out(`- Weg endet mehr als 150 m vor dem Zielpunkt: ${n(routes.gap)}.`);
  out();
  out('Beste Route je Ziel nach SAC: ' + sac.map((s) => `${s.sac ?? 'unbekannt'} ${n(s.c)}`).join(' · '));
  out();
  const net = run('pipeline:network')?.stats;
  if (net) {
    out(`Wegnetz: ${n(net.hike?.hikeNetworkKm)} km begehbare Wege, davon ${n(net.hike?.onOfficialTrailsKm)} km amtliche Wanderwege (swissTLM3D: ${n(net.officialTrailsKm)} km); ${n(net.hike?.unknownDifficultyKm)} km ohne Schwierigkeitsangabe.`);
    out(`Strassennetz: ${n(net.road?.roadKm)} km, ${n(net.road?.nodes)} Knoten.`);
    out(`Ohne Route: ${n(net.noTrailNearby)} Ziele ohne Weg in der Nähe, ${n(net.noStartFound)} ohne erreichbaren Ausgangspunkt.`);
    out();
  }

  out('## Ausgangspunkte und Fahrzeiten');
  out();
  out('| Art | Qualität | Anzahl | ohne Strassenanschluss |');
  out('|---|---:|---:|---:|');
  const thLabel: Record<string, string> = { parking: 'Parkplatz', road_access: 'Strassenzugang', valley_station: 'Talstation' };
  for (const t of th) out(`| ${thLabel[t.kind] ?? t.kind} | ${t.quality} | ${n(t.c)} | ${n(t.no_drive)} |`);
  out();
  out('Fahrzeiten werden je Suche über den Strassengraphen gerechnet. Ein Ausgangspunkt ohne Strassenanschluss erhält nie eine Fahrzeit.');
  out();

  out('## Skigebiete');
  out();
  const s = run('pipeline:ski')?.stats;
  out(`- ${n(ski.resorts)} Skigebiete mit ${n(ski.lifts)} Anlagen und ${n(ski.piste_km)} km Pisten (OpenStreetMap).`);
  if (s) out(`- Gruppierung: ${n(s.clusters)} räumliche Gruppen, ${n(s.winterSportsAreas)} OSM-Skigebietsflächen, ${n(s.mergedByName)} gleichnamige zusammengeführt, ${n(s.liftOnlyClustersDropped)} einzelne Anlagen ohne Pisten verworfen.`);
  out(`- Zufahrt bis zur Talstation: ${n(ski.access)}; Strasse endet über 600 m vorher (autofreie Orte): ${n(ski.partial)}.`);
  out(`- Mit aktuellen Wetterdaten: ${n(ski.with_live)}, mit Schneehöhe: ${n(ski.with_snow)}, mit Live-Liftstatus: ${n(ski.with_lifts_live)}.`);
  out();

  out('## Prüfungen');
  out();
  out('| Prüfung | Befund |');
  out('|---|---:|');
  out(`| Mögliche Doppel (gleiche Art, gleicher Name, < 300 m) | ${n(dups.pairs)} |`);
  out(`| Koordinaten ausserhalb der Schweiz | ${n(invalid.bad_coord)} |`);
  out(`| Höhe ausserhalb 190–4'640 m | ${n(invalid.bad_ele)} |`);
  out(`| Ziele ohne Namen | ${n(invalid.no_name)} |`);
  out(`| Ungültige Routengeometrien | ${n(invalid.bad_route)} |`);
  out();

  const text = lines.join('\n');
  console.log(text);
  if (process.argv.includes('--write')) {
    const path = resolve(REPO_ROOT, 'docs/DATENQUALITAET.md');
    writeFileSync(path, text + '\n');
    console.error(`→ ${path}`);
  }
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error(err);
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  });
