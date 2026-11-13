import { describe, expect, it } from 'vitest';
import type { DriveTime } from '../routing/driveTime';
import { ctx, hikeRow, input, skiRow } from '../test/fixtures';
import { assembleHike, assembleSki, pageResponse, searchCacheKey, type FullSearch } from './search.service';

/** Fahrzeit je Ausgangspunkt aus einer Tabelle; fehlt der Eintrag, gibt es keine Strassenroute. */
const drives = (table: Record<string, number>) => (row: { th_id: string | null }): DriveTime | null =>
  row.th_id && row.th_id in table ? { minutes: table[row.th_id], distanceKm: table[row.th_id] } : null;

describe('assembleHike – Fahrzeit und Toleranz', () => {
  it('teilt nach Fahrzeit ein: ≤ Limit Treffer, bis Limit+Toleranz Vorschlag, darüber nichts', () => {
    const a = hikeRow({ th_id: 'a' });
    const b = hikeRow({ th_id: 'b' });
    const c = hikeRow({ th_id: 'c' });
    const d = hikeRow({ th_id: 'd' });
    const out = assembleHike(input(), [a, b, c, d], drives({ a: 90, b: 90.4, c: 100, d: 100.3 }), ctx);
    expect(out.results.map((r) => r.id)).toEqual([a.id]);
    expect(out.suggestions.map((r) => r.id).sort()).toEqual([b.id, c.id].sort());
    expect(out.suggestions.find((r) => r.id === c.id)?.overBudgetMinutes).toBe(10);
  });

  it('ohne Strassenroute erscheint ein Ziel nicht in Reichweite – keine Luftlinien-Schätzung', () => {
    const a = hikeRow({ th_id: 'unknown' });
    const out = assembleHike(input(), [a], drives({}), ctx);
    expect(out.results).toHaveLength(0);
    expect(out.suggestions).toHaveLength(0);
  });

  it('jedes Ergebnis trägt Herkunft und Status der Fahrzeit', () => {
    const out = assembleHike(input(), [hikeRow({ th_id: 'a' })], drives({ a: 30 }), ctx);
    const r = out.results[0];
    expect(r.driveEstimated).toBe(false);
    expect(r.routingStatus).toBe('ok');
    expect(r.routingProvider).toBe('test');
    expect(r.routeDistanceKm).toBe(30);
    expect(r.trailhead?.id).toBe('a');
  });

  it('wählt bei mehreren Varianten eine innerhalb des Limits, auch wenn eine kürzere Wanderung knapp darüber liegt', () => {
    const near = hikeRow({ id: 'x', th_id: 'near', duration_up_min: 240 });
    const far = hikeRow({ id: 'x', th_id: 'far', duration_up_min: 120 });
    const out = assembleHike(input(), [near, far], drives({ near: 60, far: 95 }), ctx);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].trailhead?.id).toBe('near');
    expect(out.suggestions).toHaveLength(0);
  });

  it('beachtet die maximale Gehzeit', () => {
    const out = assembleHike(input({ maxHikeMinutes: 120 }), [hikeRow({ th_id: 'a', duration_up_min: 150 })], drives({ a: 20 }), ctx);
    expect(out.results).toHaveLength(0);
  });
});

describe('assembleHike – SAC-Filter gilt für die gewählte Route', () => {
  it('Route T4 fällt bei «bis T3» weg, auch wenn das Ziel eine T2-Route mit zu langer Fahrzeit hat', () => {
    const hard = hikeRow({ id: 'p', th_id: 'h', sac_min: 'T4', sac_max: 'T6' });
    const easyFar = hikeRow({ id: 'p', th_id: 'e', sac_min: 'T2', sac_max: 'T3' });
    const out = assembleHike(input({ maxSac: 'T3' }), [hard, easyFar], drives({ h: 30, e: 150 }), ctx);
    expect(out.results).toHaveLength(0);
    expect(out.suggestions).toHaveLength(0);
  });

  it('wählt die passende Variante und zeigt deren Schwierigkeit', () => {
    const hard = hikeRow({ id: 'p', th_id: 'h', sac_min: 'T4', sac_max: 'T6', duration_up_min: 60 });
    const easy = hikeRow({ id: 'p', th_id: 'e', sac_min: 'T2', sac_max: 'T3', duration_up_min: 200 });
    const out = assembleHike(input({ maxSac: 'T3' }), [hard, easy], drives({ h: 30, e: 40 }), ctx);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].hike?.sacMax).toBe('T3');
    expect(out.results[0].sacDifficulty).toBe('T3');
  });

  it('unbekannte Schwierigkeit zählt nicht als T1–T3, sondern landet in einem eigenen Abschnitt', () => {
    const unknown = hikeRow({ th_id: 'u', sac_min: null, sac_max: null });
    const out = assembleHike(input({ maxSac: 'T3' }), [unknown], drives({ u: 30 }), ctx);
    expect(out.results).toHaveLength(0);
    expect(out.sacUnknown).toHaveLength(1);
  });

  it('includeUnknownSac nimmt unbekannte Schwierigkeit ausdrücklich in die Treffer auf', () => {
    const unknown = hikeRow({ th_id: 'u', sac_min: null, sac_max: null });
    const out = assembleHike(input({ maxSac: 'T3', includeUnknownSac: true }), [unknown], drives({ u: 30 }), ctx);
    expect(out.results).toHaveLength(1);
    expect(out.sacUnknown).toHaveLength(0);
  });

  it('ohne SAC-Filter gibt es keinen Abschnitt «unbekannt»', () => {
    const out = assembleHike(input(), [hikeRow({ th_id: 'u', sac_min: null, sac_max: null })], drives({ u: 30 }), ctx);
    expect(out.results).toHaveLength(1);
    expect(out.sacUnknown).toHaveLength(0);
  });
});

describe('assembleSki', () => {
  it('Gebiete ohne Zufahrt erscheinen getrennt und ohne Fahrzeit', () => {
    const noAccess = skiRow({ th_id: null, drive_lat: null, drive_lng: null });
    const out = assembleSki(input({ mode: 'ski' }), [noAccess], drives({}), ctx);
    expect(out.unrouted).toHaveLength(1);
    expect(out.unrouted[0].driveMinutes).toBeNull();
    expect(out.unrouted[0].routingStatus).toBe('no_route');
  });

  it('Mindestschneehöhe: Gebiete ohne Messwert werden nicht als passend behandelt, sondern gezählt', () => {
    const noData = skiRow({ th_id: 'a' });
    const deep = skiRow({ th_id: 'b', captured_at: new Date(), snow_depth_top_cm: 120 });
    const thin = skiRow({ th_id: 'c', captured_at: new Date(), snow_depth_top_cm: 20 });
    const out = assembleSki(input({ mode: 'ski', minSnowCm: 50 }), [noData, deep, thin], drives({ a: 30, b: 30, c: 30 }), ctx);
    expect(out.results.map((r) => r.id)).toEqual([deep.id]);
    expect(out.excludedUnknownSnow).toBe(1);
  });

  it('autofreie Orte: Strasse endet weit vor der Talstation → Status «partial»', () => {
    const car = skiRow({ th_id: 'z', road_snap_m: 5000 });
    const out = assembleSki(input({ mode: 'ski' }), [car], drives({ z: 60 }), ctx);
    expect(out.results[0].routingStatus).toBe('partial');
  });

  it('erfindet keinen Liftstatus: ohne Live-Quelle bleibt «offen» leer', () => {
    const r = skiRow({ th_id: 'a', captured_at: new Date(), snow_depth_top_cm: 50 });
    const out = assembleSki(input({ mode: 'ski' }), [r], drives({ a: 30 }), ctx);
    expect(out.results[0].live?.liftsOpen).toBeNull();
    expect(out.results[0].live?.liftsTotal).toBe(10);
  });

  it('Lawinenstufe 4 markiert ein Gebiet als nicht empfohlen', () => {
    const r = skiRow({ th_id: 'a', captured_at: new Date(), avalanche_level: 4 });
    const out = assembleSki(input({ mode: 'ski' }), [r], drives({ a: 30 }), ctx);
    expect(out.results[0].blocked).toBe(true);
  });
});

describe('Seiten und Kartenpunkte', () => {
  const full = (): FullSearch => {
    const rows = Array.from({ length: 150 }, (_, i) => hikeRow({ th_id: `t${i}` }));
    const table = Object.fromEntries(rows.map((r, i) => [r.th_id, i < 130 ? 30 + i * 0.4 : 95]));
    const part = assembleHike(input(), rows, drives(table), ctx);
    return {
      ...part,
      unrouted: [],
      meta: {
        candidatesEvaluated: rows.length,
        routing: { provider: 'test', status: 'ok', graphBuiltAt: null, osmTimestamp: null, originSnapM: 0 },
        excludedUnknownSnow: 0,
        liveData: 'ok',
        dataVersion: null,
        generatedAt: new Date().toISOString(),
      },
    };
  };

  it('liefert alle Treffer als Kartenpunkte, auch wenn die Liste seitenweise kommt – kein stilles Abschneiden', () => {
    const f = full();
    const first = pageResponse(f, input({ limit: 60 }), false, 0);
    expect(first.items).toHaveLength(60);
    expect(first.points).toHaveLength(150);
    expect(first.page.hasMore).toBe(true);
    expect(first.totals.results + first.totals.suggestions).toBe(150);
  });

  it('Folgeseiten setzen nahtlos fort und enden korrekt', () => {
    const f = full();
    const ids = new Set<string>();
    for (let offset = 0; offset < 200; offset += 60) {
      const page = pageResponse(f, input({ offset, limit: 60 }), false, 0);
      for (const it of page.items) ids.add(it.id);
      if (!page.page.hasMore) break;
    }
    expect(ids.size).toBe(150);
  });

  it('Sortierung nach Fahrzeit ordnet innerhalb der Abschnitte', () => {
    const page = pageResponse(full(), input({ sort: 'drive', limit: 200 }), false, 0);
    const res = page.items.filter((i) => i.section === 'result').map((i) => i.driveMinutes ?? 0);
    expect(res).toEqual([...res].sort((a, b) => a - b));
  });

  it('Cache-Schlüssel hängt an Filtern und Datenstand, nicht an Sortierung oder Seite', () => {
    const base = searchCacheKey(input(), 'v1');
    expect(searchCacheKey(input({ sort: 'drive', offset: 60 }), 'v1')).toBe(base);
    expect(searchCacheKey(input({ maxSac: 'T3' }), 'v1')).not.toBe(base);
    expect(searchCacheKey(input(), 'v2')).not.toBe(base);
    expect(searchCacheKey(input({ kinds: ['lake', 'peak'] }), 'v1')).toBe(searchCacheKey(input({ kinds: ['peak', 'lake'] }), 'v1'));
  });
});
