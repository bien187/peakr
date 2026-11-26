/**
 * Prüfbericht zur Zuordnung LiftRadar ↔ Peakr (nur lesen, ändert nichts).
 *
 *   pnpm liftradar:mapping            alle Schweizer LiftRadar-Gebiete mit Stand der Zuordnung
 *   pnpm liftradar:mapping --open     nur Gebiete ohne Zuordnung, mit Kandidaten
 *   pnpm liftradar:mapping --details  zusätzlich Anlagennamen vergleichen (lädt die Einzellisten)
 *
 * Kandidaten sind Vorschläge (Abstand, Namensähnlichkeit, gemeinsame
 * Anlagennamen) – nie automatisch übernommen. Nach Prüfung von Hand in
 * apps/backend/src/lifts/mapping.ts eintragen.
 */
import { queryClient as sql } from '../db';
import { haversineM } from '../geo/lv95';
import { describeError } from '../lib/http';
import {
  detailsFileSchema,
  detailsUrl,
  fetchLiftRadar,
  indexFileSchema,
  indexResortSchema,
  indexUrl,
} from '../lifts/liftradar';
import { LIFTRADAR_MAPPING, LIFTRADAR_UNMAPPED, mappingFor } from '../lifts/mapping';
import { resolveSkiRefs } from '../repositories/liftStatus.repo';

const args = new Set(process.argv.slice(2));
const ONLY_OPEN = args.has('--open');
const WITH_DETAILS = args.has('--details');
const RADIUS_M = 15_000;

interface PeakrResort {
  id: string;
  name: string;
  ref: string | null;
  lat: number;
  lng: number;
  lifts: number;
  liftNames: string[];
}

const STOP = new Set(
  'sesselbahn sessellift skilift schlepplift gondelbahn luftseilbahn seilbahn bahn lift ski telesiege telecabine teleski telepherique de du la le les des et und express'.split(
    ' ',
  ),
);
function tokens(s: string): Set<string> {
  const plain = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return new Set(plain.split(/[^a-z]+/).filter((t) => t.length > 2 && !STOP.has(t)));
}
function nameSimilarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  const inter = [...A].filter((t) => B.has(t)).length;
  return inter / Math.max(1, new Set([...A, ...B]).size);
}

async function main(): Promise<void> {
  const resorts = await sql<PeakrResort[]>`
    SELECT d.id, d.name, d.lat::float8 AS lat, d.lng::float8 AS lng, s.lifts_total AS lifts,
           (SELECT source_ref FROM destination_sources ds WHERE ds.destination_id = d.id AND ds.source = 'osm' AND ds.source_ref LIKE 'ski:%' LIMIT 1) AS ref,
           coalesce((SELECT array_agg(l.name) FROM ski_lifts l WHERE l.destination_id = d.id AND l.name IS NOT NULL), '{}') AS "liftNames"
    FROM destinations d JOIN ski_resort_details s ON s.destination_id = d.id
    WHERE d.type = 'ski_resort' AND d.retired_at IS NULL
  `;
  const res = await fetchLiftRadar(indexUrl(), { maxBytes: 10_000_000 });
  if (res.notModified) throw new Error('unerwartet: 304 ohne ETag');
  const index = indexFileSchema.parse(res.body);
  const swiss = index.resorts
    .map((r) => indexResortSchema.safeParse(r))
    .flatMap((r) => (r.success && r.data.country === 'ch' ? [r.data] : []))
    .sort((a, b) => a.id.localeCompare(b.id));
  const location = new Map(
    (index.resorts as { id?: string; location?: { lat: number; lon: number } }[]).flatMap((r) =>
      r.id && r.location ? [[r.id, r.location] as const] : [],
    ),
  );
  const resolved = await resolveSkiRefs([...new Set(LIFTRADAR_MAPPING.map((m) => m.peakrRef))]);

  console.log(
    `Peakr-Skigebiete: ${resorts.length} · LiftRadar Schweiz: ${swiss.length} · zugeordnet: ${LIFTRADAR_MAPPING.length}\n`,
  );
  console.log(
    'LiftRadar | Stand | Peakr-Gebiet bzw. Kandidaten (Abstand, Namensähnlichkeit, Anlagen Peakr/LiftRadar[, gleiche Anlagennamen])',
  );
  console.log('—'.repeat(110));

  const proposals: string[] = [];
  for (const r of swiss) {
    const m = mappingFor(r.id);
    const excluded = LIFTRADAR_UNMAPPED[r.id];
    if (ONLY_OPEN && (m || excluded)) continue;
    if (m) {
      const ok = resolved.has(m.peakrRef);
      console.log(
        `${r.id} | ${m.verified === false ? 'zugeordnet, ungeprüft' : 'zugeordnet'}${ok ? '' : ' – PEAKR-GEBIET FEHLT'} | ${m.peakrName} (${m.peakrRef}) – ${m.evidence}`,
      );
      continue;
    }
    if (excluded) {
      console.log(`${r.id} | ausgenommen | ${excluded}`);
      continue;
    }
    const loc = location.get(r.id);
    if (!loc) {
      console.log(`${r.id} | offen | keine Koordinaten im Index`);
      continue;
    }
    let lrLifts: string[] = [];
    if (WITH_DETAILS) {
      try {
        const d = await fetchLiftRadar(detailsUrl(r.id));
        if (!d.notModified)
          lrLifts = (detailsFileSchema.parse(d.body).lifts ?? []).map((l) => l.name);
      } catch (err) {
        lrLifts = [];
        console.log(`  (Einzelliste ${r.id} nicht lesbar: ${describeError(err)})`);
      }
    }
    const candidates = resorts
      .map((p) => {
        const km = haversineM(loc.lat, loc.lon, p.lat, p.lng) / 1000;
        const peakrTokens = p.liftNames.map(tokens);
        const shared = lrLifts.filter((n) => {
          const t = tokens(n);
          return peakrTokens.some((pt) => [...t].some((x) => pt.has(x)));
        }).length;
        return { p, km, sim: nameSimilarity(r.name, p.name), shared };
      })
      .filter((c) => c.km * 1000 <= RADIUS_M)
      .sort((a, b) => b.shared - a.shared || b.sim - a.sim || a.km - b.km)
      .slice(0, 3);
    const text = candidates.length
      ? candidates
          .map(
            (c) =>
              `${c.p.name} (${c.km.toFixed(1)} km, ${c.sim.toFixed(2)}, ${c.p.lifts}/${r.lifts?.total ?? '?'}${WITH_DETAILS ? `, ${c.shared}/${lrLifts.length}` : ''})`,
          )
          .join(' · ')
      : `kein Peakr-Gebiet im Umkreis von ${RADIUS_M / 1000} km`;
    console.log(`${r.id} | offen | ${text}`);
    const best = candidates[0];
    if (best?.p.ref) {
      proposals.push(
        `  { liftradarId: '${r.id}', peakrRef: '${best.p.ref}', peakrName: '${best.p.name.replace(/'/g, "\\'")}', method: '${WITH_DETAILS && best.shared > 0 ? 'lift_names' : 'name_location'}', evidence: 'VORSCHLAG – prüfen', verified: false },`,
      );
    }
  }

  const unresolved = LIFTRADAR_MAPPING.filter((m) => !resolved.has(m.peakrRef));
  if (unresolved.length > 0) {
    console.log(
      `\nZuordnungen ohne Peakr-Gebiet (Referenz nicht gefunden): ${unresolved.map((m) => `${m.liftradarId} → ${m.peakrRef}`).join(', ')}`,
    );
  }
  if (proposals.length > 0) {
    console.log('\nVorschläge (erst nach Prüfung in lifts/mapping.ts übernehmen):');
    console.log(proposals.join('\n'));
  }
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error(describeError(err));
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  });
