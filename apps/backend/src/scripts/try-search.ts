import { searchInputSchema } from '@ch-alpineroute/shared';
import { queryClient } from '../db';
import { search } from '../services/search.service';

const zurich = { lat: 47.3769, lng: 8.5417 };
const cases: [string, unknown][] = [
  ['Zürich 90+10 Gipfel bis T3', { origin: zurich, mode: 'hike', maxMinutes: 90, toleranceMinutes: 10, kinds: ['peak'], maxSac: 'T3' }],
  ['Zürich 90+10 alle Wanderziele', { origin: zurich, mode: 'hike', maxMinutes: 90, toleranceMinutes: 10 }],
  ['Zürich 90+10 Ski', { origin: zurich, mode: 'ski', maxMinutes: 90, toleranceMinutes: 10 }],
  ['Zürich 90+10 Gipfel bis T3 (wiederholt)', { origin: zurich, mode: 'hike', maxMinutes: 90, toleranceMinutes: 10, kinds: ['peak'], maxSac: 'T3' }],
];
for (const [label, raw] of cases) {
  const input = searchInputSchema.parse(raw);
  const t = Date.now();
  const res = await search(input);
  const R = res.items.filter((i) => i.section === 'result'); const SG = res.points.filter((p) => p[5] === 'suggestion').map((p) => p[7] as number); const drives = res.points.filter((p) => p[5] === 'result').map((p) => p[7] ?? 0);
  console.log(`\n== ${label}: ${Date.now() - t} ms | results ${res.totals.results} (max drive ${Math.max(0, ...drives)}), suggestions ${res.totals.suggestions} (${SG.length ? Math.min(...SG) : '-'}–${SG.length ? Math.max(...SG) : '-'} min), sacUnknown ${res.totals.sacUnknown}, unrouted ${res.totals.unrouted}, items ${res.items.length}, points ${res.points.length}, candidates ${res.meta.candidatesEvaluated}, cached ${res.meta.cached}, json ${(JSON.stringify(res).length / 1e6).toFixed(2)} MB`);
  for (const r of R.slice(0, 5)) {
    console.log(
      `  ${String(r.score).padStart(3)} ${r.name.padEnd(28).slice(0, 28)} ${String(r.elevationTopM ?? '?').padStart(4)} m  Auto ${String(r.driveMinutes).padStart(5)} min ${String(r.routeDistanceKm).padStart(5)} km → ${(r.trailhead?.name ?? r.trailhead?.kind ?? '-').slice(0, 26).padEnd(26)}` +
        (r.hike ? ` | ${r.hike.distanceKm} km ↑${r.hike.ascentM} ${r.hike.durationUpMin} min ${r.hike.sacMin ?? '?'}–${r.hike.sacMax ?? '?'} (+${r.hikeVariants})` : '') +
        (r.ski ? ` | ${r.ski.liftsTotal} Anlagen, ${r.ski.pisteKm} km, Schnee ${r.live?.snowDepthValleyCm}/${r.live?.snowDepthTopCm} cm, Lawine ${r.live?.avalancheLevel}, ${r.live?.temperatureC}°C` : '') +
        (r.live && !r.ski ? ` | ${r.live.temperatureC}°C wc${r.live.weatherCode}` : ''),
    );
  }
  const known = ['Rigi Kulm', 'Säntis', 'Grosser Mythen', 'Uetliberg', 'Pilatus', 'Speer', 'Titlis', 'Flumserberg', 'Hoch-Ybrig'];
  const all = res.points.map((p) => ({ name: p[1], driveMinutes: p[7] }));
  console.log('  bekannte:', known.map((k) => { const m = all.find((r) => r.name === k); return m ? `${k} ${m.driveMinutes}min` : null; }).filter(Boolean).join(', '));
}
await queryClient.end();
