import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../lib/http';
import {
  DEFAULT_LIFT_SCHEDULE,
  freshnessOf,
  inSeason,
  readLiftSchedule,
  shouldSync,
} from './freshness';
import {
  assertAllowedUrl,
  detailsFileSchema,
  fetchLiftRadar,
  type FetchResult,
  resortFileSchema,
  resortUrl,
  safeHttpUrl,
} from './liftradar';
import {
  coverageNoteFor,
  LIFTRADAR_MAPPING,
  LIFTRADAR_UNMAPPED,
  mappingProblems,
  type LiftRadarMapping,
} from './mapping';
import { buildSnapshot, type ResortSnapshot } from './snapshot';
import {
  countItems,
  countsFromSummary,
  normalizeItemStatus,
  normalizeResortStatus,
  sumCounts,
} from './status';
import {
  areaFromRow,
  detailFrom,
  liftsForScore,
  summarize,
  type ItemRow,
  type StatusRow,
} from './summary';
import { syncLiftStatus, type LiftStore, type StatusTotals } from './sync';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));

const NOW = new Date('2026-12-20T14:00:00+01:00');

// ── Normalisierung ─────────────────────────────────────────────────────────────

describe('Statusnormalisierung', () => {
  it('kennt die Werte der Quelle', () => {
    expect(normalizeItemStatus('open')).toEqual({ status: 'open', recognized: true });
    expect(normalizeItemStatus('Operating')).toEqual({ status: 'open', recognized: true });
    expect(normalizeItemStatus('closed').status).toBe('closed');
    expect(normalizeItemStatus('preparation').status).toBe('preparation');
    expect(normalizeItemStatus('unknown')).toEqual({ status: 'unknown', recognized: true });
  });

  it('fehlender Status ist «unbekannt», nie «geschlossen»', () => {
    expect(normalizeItemStatus(null)).toEqual({ status: 'unknown', recognized: true });
    expect(normalizeItemStatus(undefined).status).toBe('unknown');
    expect(normalizeItemStatus('  ').status).toBe('unknown');
  });

  it('unbekannter Text wird «unbekannt» und als nicht erkannt gemeldet', () => {
    expect(normalizeItemStatus('wartung')).toEqual({ status: 'unknown', recognized: false });
    expect(normalizeResortStatus('maintenance')).toMatchObject({
      resort: 'unknown',
      recognized: false,
    });
    expect(normalizeResortStatus('no_report').resort).toBe('no_report');
  });
});

describe('Zähler', () => {
  it('zählt Einzelstatus; gesamt = alle gelisteten Einträge', () => {
    const c = countItems([
      { status: 'open' },
      { status: 'open' },
      { status: 'closed' },
      { status: 'preparation' },
      { status: 'unknown' },
    ]);
    expect(c).toEqual({ open: 2, closed: 1, preparation: 1, unknown: 1, total: 5 });
  });

  it('ohne Einzelliste: geschlossen bleibt unbekannt statt «gesamt − offen»', () => {
    expect(countsFromSummary(3, 10)).toEqual({
      open: 3,
      closed: null,
      preparation: null,
      unknown: null,
      total: 10,
    });
    expect(countsFromSummary(null, null).total).toBeNull();
  });

  it('Summe ist nur bekannt, wenn alle Teile bekannt sind', () => {
    const a = { open: 1, closed: 2, preparation: 0, unknown: 0, total: 3 };
    const b = { open: 4, closed: null, preparation: null, unknown: null, total: 9 };
    expect(sumCounts([a, b])).toEqual({
      open: 5,
      closed: null,
      preparation: null,
      unknown: null,
      total: 12,
    });
  });
});

// ── Aktualität und Saison ─────────────────────────────────────────────────────

describe('Aktualität', () => {
  const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  it('frisch ≤ 12 h, älter ≤ 36 h, veraltet darüber, unbekannt ohne Zeitpunkt', () => {
    expect(freshnessOf(ago(5), NOW)).toEqual({ freshness: 'fresh', ageHours: 5 });
    expect(freshnessOf(ago(12), NOW).freshness).toBe('fresh');
    expect(freshnessOf(ago(20), NOW).freshness).toBe('stale');
    expect(freshnessOf(ago(40), NOW).freshness).toBe('outdated');
    expect(freshnessOf(null, NOW)).toEqual({ freshness: 'unknown', ageHours: null });
    expect(freshnessOf('kein Datum', NOW).freshness).toBe('unknown');
  });
});

describe('Saisonlogik', () => {
  const winter = new Date('2026-12-20T09:00:00Z');
  const summer = new Date('2026-07-20T09:00:00Z');
  const minsAgo = (from: Date, m: number) => new Date(from.getTime() - m * 60_000);

  it('Saison nach Schweizer Monat', () => {
    expect(inSeason(winter, DEFAULT_LIFT_SCHEDULE)).toBe(true);
    expect(inSeason(summer, DEFAULT_LIFT_SCHEDULE)).toBe(false);
  });

  it('in der Saison höchstens alle 40 min, ausserhalb höchstens alle 20 h; manuell immer', () => {
    expect(shouldSync(winter, minsAgo(winter, 10), DEFAULT_LIFT_SCHEDULE, false).run).toBe(false);
    expect(shouldSync(winter, minsAgo(winter, 55), DEFAULT_LIFT_SCHEDULE, false).run).toBe(true);
    expect(shouldSync(summer, minsAgo(summer, 600), DEFAULT_LIFT_SCHEDULE, false).run).toBe(false);
    expect(shouldSync(summer, minsAgo(summer, 21 * 60), DEFAULT_LIFT_SCHEDULE, false).run).toBe(
      true,
    );
    expect(shouldSync(summer, minsAgo(summer, 1), DEFAULT_LIFT_SCHEDULE, true).run).toBe(true);
    expect(shouldSync(summer, null, DEFAULT_LIFT_SCHEDULE, false).run).toBe(true);
  });

  it('Werte aus der Umgebung; Unsinn fällt auf die Standardwerte zurück', () => {
    const s = readLiftSchedule({
      LIFTS_SEASON_MONTHS: '12, 1,2',
      LIFTS_SEASON_MIN_INTERVAL_MIN: '55',
      LIFTS_CONCURRENCY: '99',
    });
    expect(s.seasonMonths).toEqual([12, 1, 2]);
    expect(s.seasonMinIntervalMin).toBe(55);
    expect(s.concurrency).toBe(DEFAULT_LIFT_SCHEDULE.concurrency);
    expect(readLiftSchedule({ LIFTS_SEASON_MONTHS: 'x' }).seasonMonths).toEqual(
      DEFAULT_LIFT_SCHEDULE.seasonMonths,
    );
  });
});

// ── Zuordnung ─────────────────────────────────────────────────────────────────

describe('Zuordnung LiftRadar → Peakr', () => {
  it('die eingecheckte Liste ist eindeutig und gültig', () => {
    expect(mappingProblems()).toEqual([]);
    expect(LIFTRADAR_MAPPING.length).toBeGreaterThan(80);
    for (const m of LIFTRADAR_MAPPING) expect(m.evidence.length).toBeGreaterThan(5);
  });

  it('Verbünde: mehrere LiftRadar-Gebiete auf ein Peakr-Gebiet (4 Vallées)', () => {
    const fourValleys = LIFTRADAR_MAPPING.filter((m) => m.peakrRef === 'ski:way/660203241')
      .map((m) => m.liftradarId)
      .sort();
    expect(fourValleys).toEqual(['la-tzoumaz', 'nendaz', 'thyon', 'verbier', 'veysonnaz']);
  });

  it('Gebiete, die mehrere Peakr-Gebiete umfassen, sind bewusst nicht zugeordnet', () => {
    expect(Object.keys(LIFTRADAR_UNMAPPED)).toEqual(
      expect.arrayContaining(['gstaad', 'andermatt-sedrun-disentis', 'lenk']),
    );
    for (const id of Object.keys(LIFTRADAR_UNMAPPED))
      expect(LIFTRADAR_MAPPING.some((m) => m.liftradarId === id)).toBe(false);
  });

  it('erkennt doppelte und ungültige Einträge', () => {
    const bad: LiftRadarMapping[] = [
      { liftradarId: 'a', peakrRef: 'ski:way/1', peakrName: 'A', method: 'manual', evidence: 'x' },
      { liftradarId: 'a', peakrRef: 'ski:way/2', peakrName: 'B', method: 'manual', evidence: 'x' },
      { liftradarId: 'B!', peakrRef: 'way/3', peakrName: 'C', method: 'manual', evidence: 'x' },
      {
        liftradarId: 'gstaad',
        peakrRef: 'ski:way/4',
        peakrName: 'D',
        method: 'manual',
        evidence: 'x',
      },
    ];
    expect(mappingProblems(bad)).toHaveLength(4);
  });

  it('Abdeckungshinweis bei Teilabdeckung (Portes du Soleil)', () => {
    expect(coverageNoteFor(['champery'])).toContain('Schweizer Teil');
    expect(coverageNoteFor(['zermatt'])).toBeNull();
  });
});

// ── Adressen und Links ────────────────────────────────────────────────────────

describe('Allowlist und Links', () => {
  it('fragt nur liftradar.eu/json/… ab', () => {
    expect(resortUrl('saas-fee')).toBe('https://liftradar.eu/json/ch/saas-fee.json');
    expect(() => resortUrl('../index')).toThrow();
    expect(() => assertAllowedUrl('https://example.org/json/ch/x.json')).toThrow();
    expect(() => assertAllowedUrl('http://liftradar.eu/json/index.json')).toThrow();
    expect(() => assertAllowedUrl('https://liftradar.eu/api')).toThrow();
    expect(() => assertAllowedUrl('https://liftradar.eu:8443/json/index.json')).toThrow();
    expect(assertAllowedUrl('https://liftradar.eu/json/index.json').pathname).toBe(
      '/json/index.json',
    );
  });

  it('gibt nur http(s)-Links weiter', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,x')).toBeNull();
    expect(safeHttpUrl('https://www.verbier.ch')).toBe('https://www.verbier.ch/');
    expect(safeHttpUrl(42)).toBeNull();
  });
});

// ── Gebietsdatei → gespeicherter Stand ────────────────────────────────────────

const parse = (name: string) => resortFileSchema.parse(fixture(name));
const snapshot = (file: string, details: string | null, now = NOW): ResortSnapshot =>
  buildSnapshot({
    file: parse(file),
    details: details ? detailsFileSchema.parse(fixture(details)) : null,
    destinationId: '00000000-0000-4000-8000-000000000001',
    matchMethod: 'manual',
    matchVerified: true,
    etag: '"e1"',
    now,
  });

describe('Gebietsbericht normalisieren', () => {
  it('offen mit Einzelliste: Zähler aus den Einträgen, unbekannte Werte protokolliert', () => {
    const s = snapshot('testberg.json', 'testberg.details.json');
    expect(s.resortStatus).toBe('open');
    expect(s.lifts).toEqual({ open: 2, closed: 1, preparation: 1, unknown: 1, total: 5 });
    expect(s.slopes).toMatchObject({
      open: 2,
      closed: 2,
      preparation: 0,
      unknown: 1,
      total: 5,
      openKm: 3.5,
      totalKm: 9,
    });
    expect(s.unknownStatusValues).toEqual({ wartung: 1 });
    expect(s.items.find((i) => i.itemId === 'slope-5-route')).toMatchObject({
      status: 'unknown',
      statusRaw: 'wartung',
      colour: 'yellow',
    });
    expect(s.countMismatch).toBe(false);
    expect(s.reportAt).toBe('2026-12-20T07:30:00.000Z');
    expect(s.checkedAt).toBe('2026-12-20T12:40:42.979Z');
    expect(s.snow).toEqual({ valleyCm: 35, mountainCm: 80, freshCm: 5 });
  });

  it('übernimmt nur sichere Quellenlinks und die Nennungspflicht', () => {
    const s = snapshot('testberg.json', 'testberg.details.json');
    expect(s.websiteUrl).toBe('https://www.testberg.example/');
    expect(s.sourceLinks).toEqual([
      { url: 'https://infosnow.example/portal/', attributionRequired: null },
      { url: 'https://www.testberg.example/info', attributionRequired: false },
    ]);
  });

  it('geschlossen ohne Einzelliste: offen 0, geschlossen unbekannt (nicht berechnet)', () => {
    const s = snapshot('musteralp.json', null);
    expect(s.resortStatus).toBe('closed');
    expect(s.lifts).toEqual({ open: 0, closed: null, preparation: null, unknown: null, total: 3 });
    expect(s.items).toEqual([]);
    expect(s.reportAt).toBeNull();
  });

  it('kein Bericht («no_report»): «0 offen» der Quelle wird nicht übernommen', () => {
    const s = snapshot('stillhang.json', null);
    expect(s.resortStatus).toBe('no_report');
    expect(s.lifts.open).toBeNull();
    expect(s.lifts.total).toBe(6);
    expect(s.slopes.openKm).toBeNull();
    expect(s.valuesFrom).toBe('2026-12-17T07:40:00.000Z');
  });

  it('Prüfsumme ändert sich mit dem Inhalt, nicht mit dem Abrufzeitpunkt', () => {
    const a = snapshot('testberg.json', 'testberg.details.json');
    const later = {
      ...(fixture('testberg.json') as Record<string, unknown>),
      fetched_at: '2026-12-20T18:40:00+01:00',
    };
    const b = buildSnapshot({
      file: resortFileSchema.parse(later),
      details: detailsFileSchema.parse(fixture('testberg.details.json')),
      destinationId: a.destinationId,
      matchMethod: 'manual',
      matchVerified: true,
      etag: '"e2"',
      now: NOW,
    });
    expect(b.contentHash).toBe(a.contentHash);
    const closed = { ...(fixture('testberg.json') as Record<string, unknown>), status: 'closed' };
    expect(
      buildSnapshot({
        ...{ file: resortFileSchema.parse(closed), details: null },
        destinationId: a.destinationId,
        matchMethod: 'manual',
        matchVerified: true,
        etag: null,
        now: NOW,
      }).contentHash,
    ).not.toBe(a.contentHash);
  });

  it('Berichtszeit weit in der Zukunft wird verworfen', () => {
    const s = snapshot('testberg.json', 'testberg.details.json', new Date('2026-12-19T12:00:00Z'));
    expect(s.reportAt).toBeNull();
  });
});

// ── Zusammenfassung für die API ───────────────────────────────────────────────

const row = (over: Partial<StatusRow>): StatusRow => ({
  source_resort_id: 'a',
  destination_id: 'd',
  source_name: 'A',
  resort_status: 'open',
  lifts_open: 2,
  lifts_closed: 1,
  lifts_preparation: 0,
  lifts_unknown: 0,
  lifts_total: 3,
  slopes_open: 4,
  slopes_closed: 1,
  slopes_preparation: 0,
  slopes_unknown: 0,
  slopes_total: 5,
  slopes_open_km: 10,
  slopes_total_km: 15,
  snow_valley_cm: null,
  snow_mountain_cm: null,
  fresh_snow_cm: null,
  report_at: '2026-12-20T07:30:00Z',
  checked_at: '2026-12-20T07:40:00Z',
  values_from: null,
  fetched_at: '2026-12-20T08:00:00Z',
  website_url: null,
  source_url: 'https://liftradar.eu/json/ch/a.json',
  source_links: [],
  ...over,
});

describe('Zusammenfassung', () => {
  it('Verbund: summiert berichtende Gebiete, ältester Bericht zählt, fehlender Bericht → teilweise', () => {
    const s = summarize(
      [
        areaFromRow(row({ source_resort_id: 'a', report_at: '2026-12-20T07:30:00Z' })),
        areaFromRow(
          row({
            source_resort_id: 'b',
            resort_status: 'closed',
            lifts_open: 0,
            lifts_closed: 4,
            lifts_total: 4,
            report_at: '2026-12-20T06:00:00Z',
          }),
        ),
        areaFromRow(
          row({
            source_resort_id: 'c',
            resort_status: 'no_report',
            lifts_open: null,
            report_at: null,
          }),
        ),
      ],
      NOW,
    );
    expect(s.status).toBe('open');
    expect(s.lifts).toEqual({ open: 2, closed: 5, preparation: 0, unknown: 0, total: 7 });
    // Ältester Zeitpunkt: Bericht des offenen Gebiets (07:30) vor der Prüfung des geschlossenen (07:40).
    expect(s.dataAt).toBe('2026-12-20T07:30:00.000Z');
    expect(s.freshness).toBe('fresh');
    expect(s.partial).toBe(true);
    expect(s.areas.map((a) => a.status)).toEqual(['open', 'closed', 'no_report']);
  });

  it('ohne aktuellen Bericht: kein Datenzeitpunkt, Aktualität unbekannt, keine Zähler', () => {
    const s = summarize([areaFromRow(row({ resort_status: 'no_report', lifts_open: null }))], NOW);
    expect(s).toMatchObject({ status: 'no_report', dataAt: null, freshness: 'unknown' });
    expect(s.lifts.open).toBeNull();
  });

  it('geschlossen: zählt die letzte Prüfung der Quelle, nicht der alte Bericht; offen: der Bericht selbst', () => {
    const closed = summarize(
      [
        areaFromRow(
          row({ resort_status: 'closed', lifts_open: 0, report_at: '2026-12-15T07:00:00Z' }),
        ),
      ],
      NOW,
    );
    expect(closed).toMatchObject({
      dataAt: '2026-12-20T07:40:00.000Z',
      dataAtIsReport: false,
      freshness: 'fresh',
    });
    const open = summarize([areaFromRow(row({ report_at: '2026-12-15T07:00:00Z' }))], NOW);
    expect(open).toMatchObject({ dataAt: '2026-12-15T07:00:00.000Z', freshness: 'outdated' });
    const older = summarize([areaFromRow(row({ values_from: '2026-12-18T07:40:00Z' }))], NOW);
    expect(older.freshness).toBe('outdated');
  });

  it('ohne Gebietszeitpunkt gilt der Lesezeitpunkt der Quelle (gekennzeichnet)', () => {
    const s = summarize([areaFromRow(row({ report_at: null }))], NOW);
    expect(s.dataAt).toBe('2026-12-20T07:40:00.000Z');
    expect(s.dataAtIsReport).toBe(false);
  });

  it('Bewertung/Favoriten erhalten «offen» nur aus einem frischen Bericht', () => {
    const fresh = summarize([areaFromRow(row({}))], NOW);
    expect(liftsForScore(fresh)).toEqual({ liftsOpen: 2, liftsTotal: 3 });
    const old = summarize([areaFromRow(row({ report_at: '2026-12-18T07:30:00Z' }))], NOW);
    expect(old.freshness).toBe('outdated');
    expect(liftsForScore(old)).toEqual({ liftsOpen: null, liftsTotal: null });
  });

  it('Detail: offene Einträge zuerst; Einträge von Gebieten ohne Bericht entfallen', () => {
    const item = (over: Partial<ItemRow>): ItemRow => ({
      source_resort_id: 'a',
      kind: 'lift',
      item_id: 'x',
      position: 0,
      ref: null,
      name: 'X',
      item_type: 'chairlift',
      colour: null,
      status: 'closed',
      length_m: null,
      ...over,
    });
    const d = detailFrom(
      [row({ source_resort_id: 'a' }), row({ source_resort_id: 'c', resort_status: 'no_report' })],
      [
        item({ item_id: '1', position: 0, status: 'closed' }),
        item({ item_id: '2', position: 1, status: 'open' }),
        item({ item_id: '3', position: 2, status: 'unknown' }),
        item({ item_id: '4', position: 3, status: 'preparation' }),
        item({ item_id: '5', source_resort_id: 'c', status: 'open' }),
        item({ item_id: 's1', kind: 'slope', item_type: 'easy', status: 'open' }),
      ],
      NOW,
    )!;
    expect(d.liftItems.map((i) => i.id)).toEqual(['2', '4', '1', '3']);
    expect(d.slopeItems).toHaveLength(1);
    expect(detailFrom([], [], NOW)).toBeNull();
  });
});

// ── Abruf ─────────────────────────────────────────────────────────────────────

describe('fetchLiftRadar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"x"' },
      ...init,
    });

  it('sendet If-None-Match und liefert 304 als «unverändert»', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchLiftRadar('https://liftradar.eu/json/index.json', { etag: '"abc"' });
    expect(r.notModified).toBe(true);
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['if-none-match']).toBe('"abc"');
    expect(init.redirect).toBe('error');
  });

  it('404 (HTML) ist endgültig: kein erneuter Versuch', async () => {
    const fetchMock = vi.fn(
      async () => new Response('<html>', { status: 404, headers: { 'content-type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchLiftRadar('https://liftradar.eu/json/ch/x.details.json'),
    ).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lehnt falschen Inhaltstyp und zu grosse Antworten ab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      ),
    );
    await expect(
      fetchLiftRadar('https://liftradar.eu/json/index.json', { retries: 0 }),
    ).rejects.toThrow(/Kein JSON/);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ big: 'x'.repeat(5000) })),
    );
    await expect(
      fetchLiftRadar('https://liftradar.eu/json/index.json', { retries: 0, maxBytes: 1000 }),
    ).rejects.toThrow(/zu gross/);
  });

  it('wiederholt vorübergehende Fehler mit Wartezeit, dann Erfolg', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const p = fetchLiftRadar('https://liftradar.eu/json/index.json', { retries: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ notModified: false, etag: '"x"', body: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ruft keine fremden Adressen ab', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchLiftRadar('https://evil.example/json/index.json')).rejects.toThrow(
      /Nicht erlaubte/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Abgleich (ohne Netz und Datenbank) ────────────────────────────────────────

function memoryStore(destinations: Record<string, string>) {
  const saved = new Map<string, ResortSnapshot>();
  const meta: { etag: string | null } = { etag: null };
  const touched: string[] = [];
  const store: LiftStore = {
    resolveSkiRefs: async (refs) =>
      new Map(refs.filter((r) => r in destinations).map((r) => [r, destinations[r]])),
    loadStoredState: async () =>
      new Map(
        [...saved.values()].map((s) => [
          s.sourceResortId,
          { destinationId: s.destinationId, checkedAt: s.checkedAt, etag: s.etag },
        ]),
      ),
    saveSnapshot: async (s) => {
      const prev = saved.get(s.sourceResortId);
      saved.set(s.sourceResortId, s);
      return prev?.contentHash === s.contentHash ? 'unchanged' : 'changed';
    },
    touchFetched: async (ids) => void touched.push(...ids),
    removeUnmapped: async (keep) => {
      let n = 0;
      for (const id of [...saved.keys()]) {
        if (!keep.includes(id)) {
          saved.delete(id);
          n++;
        }
      }
      return n;
    },
    getIndexEtag: async () => meta.etag,
    setIndexEtag: async (e) => void (meta.etag = e),
    totals: async (): Promise<StatusTotals> => ({
      reporting: 0,
      noReport: 0,
      lifts: { open: 0, closed: 0, preparation: 0, unknown: 0 },
      slopes: { open: 0, closed: 0, preparation: 0, unknown: 0 },
    }),
  };
  return { store, saved, meta, touched };
}

/** Gefälschtes Netz aus den Testdateien; fehlende Dateien → 404. */
function fakeFetcher(
  files: Record<string, unknown>,
  overrides: Record<string, () => FetchResult | Promise<FetchResult>> = {},
) {
  const calls: string[] = [];
  const fetcher = async (
    url: string,
    opts: { etag?: string | null } = {},
  ): Promise<FetchResult> => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (overrides[path]) return overrides[path]();
    if (path === '/json/index.json' && opts.etag === '"idx"')
      return { notModified: true, status: 304 };
    const body = files[path];
    if (body === undefined) throw new HttpError(404, `HTTP 404 bei ${path}`);
    return {
      notModified: false,
      status: 200,
      etag: path === '/json/index.json' ? '"idx"' : `"${path}"`,
      body,
    };
  };
  return { fetcher, calls };
}

const FILES = {
  '/json/index.json': fixture('index.json'),
  '/json/ch/testberg.json': fixture('testberg.json'),
  '/json/ch/testberg.details.json': fixture('testberg.details.json'),
  '/json/ch/musteralp.json': fixture('musteralp.json'),
  '/json/ch/stillhang.json': fixture('stillhang.json'),
};
const MAPPING: LiftRadarMapping[] = [
  {
    liftradarId: 'testberg',
    peakrRef: 'ski:way/1',
    peakrName: 'Testberg',
    method: 'lift_names',
    evidence: 'Test',
  },
  {
    liftradarId: 'musteralp',
    peakrRef: 'ski:way/2',
    peakrName: 'Musteralp',
    method: 'name_location',
    evidence: 'Test',
  },
  {
    liftradarId: 'stillhang',
    peakrRef: 'ski:way/3',
    peakrName: 'Stillhang',
    method: 'manual',
    evidence: 'Test',
    verified: false,
  },
  {
    liftradarId: 'verschwunden',
    peakrRef: 'ski:way/4',
    peakrName: 'Weg',
    method: 'manual',
    evidence: 'Test',
  },
  {
    liftradarId: 'ohne-peakr',
    peakrRef: 'ski:way/999',
    peakrName: 'Fehlt',
    method: 'manual',
    evidence: 'Test',
  },
];
const DEST = { 'ski:way/1': 'd1', 'ski:way/2': 'd2', 'ski:way/3': 'd3', 'ski:way/4': 'd4' };

describe('Abgleich', () => {
  it('erster Lauf: speichert, meldet fehlende, neue und nicht auflösbare Gebiete', async () => {
    const { store, saved, meta } = memoryStore(DEST);
    const { fetcher } = fakeFetcher(FILES);
    const r = await syncLiftStatus({
      fetcher,
      store,
      mapping: MAPPING,
      unmapped: {},
      now: () => NOW,
    });
    expect(r).toMatchObject({
      index: 'fetched',
      swissResorts: 4,
      active: 4,
      total: 3,
      changed: 3,
      failed: 0,
      invalidIndexEntries: 1,
    });
    expect(r.missingInIndex).toEqual(['verschwunden']);
    expect(r.unmappedCandidates).toEqual(['neuegg']);
    expect(r.unresolvedRefs).toEqual(['ohne-peakr → ski:way/999']);
    expect(r.unknownStatusValues).toEqual({ wartung: 1 });
    expect(saved.get('testberg')?.items).toHaveLength(10);
    expect(saved.get('stillhang')?.matchVerified).toBe(false);
    // Ein zugeordnetes Gebiet fehlte im Index → ETag nicht merken, nächster Lauf liest den Index neu.
    expect(meta.etag).toBeNull();
  });

  it('zweiter Lauf ohne neuen Bericht: keine Gebietsdateien abrufen; Index 304 → nur ein Abruf', async () => {
    const mapping = MAPPING.slice(0, 3);
    const { store, meta, touched } = memoryStore(DEST);
    await syncLiftStatus({
      fetcher: fakeFetcher(FILES).fetcher,
      store,
      mapping,
      unmapped: {},
      now: () => NOW,
    });
    expect(meta.etag).toBe('"idx"');

    // Index geladen (ETag nicht passend), aber checked_at unverändert → keine weiteren Abrufe.
    meta.etag = '"anders"';
    const second = fakeFetcher(FILES);
    const r2 = await syncLiftStatus({
      fetcher: second.fetcher,
      store,
      mapping,
      unmapped: {},
      now: () => NOW,
    });
    expect(second.calls).toEqual(['/json/index.json']);
    expect(r2).toMatchObject({ changed: 0, unchanged: 3, failed: 0 });
    expect(touched).toEqual(expect.arrayContaining(['testberg', 'musteralp', 'stillhang']));

    // Index unverändert (304).
    const third = fakeFetcher(FILES);
    const r3 = await syncLiftStatus({
      fetcher: third.fetcher,
      store,
      mapping,
      unmapped: {},
      now: () => NOW,
    });
    expect(r3.index).toBe('not_modified');
    expect(third.calls).toEqual(['/json/index.json']);
  });

  it('ein fehlerhaftes Gebiet stoppt die anderen nicht und lässt seinen alten Stand stehen', async () => {
    const mapping = MAPPING.slice(0, 3);
    const { store, saved, meta } = memoryStore(DEST);
    await syncLiftStatus({
      fetcher: fakeFetcher(FILES).fetcher,
      store,
      mapping,
      unmapped: {},
      now: () => NOW,
    });
    const before = saved.get('testberg');
    meta.etag = null;

    const newer = structuredClone(FILES) as Record<string, { resorts?: { checked_at: string }[] }>;
    for (const r of newer['/json/index.json'].resorts!)
      if (r.checked_at) r.checked_at = '2026-12-20T18:40:00+01:00';
    const { fetcher } = fakeFetcher(newer, {
      '/json/ch/testberg.details.json': () => ({
        notModified: false,
        status: 200,
        etag: null,
        body: { id: 'testberg', lifts: [{ name: 'ohne id' }] },
      }),
    });
    const r = await syncLiftStatus({ fetcher, store, mapping, unmapped: {}, now: () => NOW });
    expect(r.failed).toBe(1);
    expect(r.errors[0]).toMatchObject({ id: 'testberg' });
    expect(r.errors[0].error).toContain('Einzelliste ungültig');
    expect(r.updated).toBe(2);
    expect(saved.get('testberg')).toBe(before);
  });

  it('unplausibler Index (keine Schweizer Gebiete) bricht ab, ohne etwas zu ändern', async () => {
    const { store, saved } = memoryStore(DEST);
    const { fetcher } = fakeFetcher({ '/json/index.json': { generated_at: null, resorts: [] } });
    await expect(
      syncLiftStatus({ fetcher, store, mapping: MAPPING, unmapped: {}, now: () => NOW }),
    ).rejects.toThrow(/ohne Schweizer/);
    expect(saved.size).toBe(0);
  });

  it('Gebiete, die nicht mehr zugeordnet sind, werden entfernt', async () => {
    const { store, saved } = memoryStore(DEST);
    await syncLiftStatus({
      fetcher: fakeFetcher(FILES).fetcher,
      store,
      mapping: MAPPING.slice(0, 3),
      unmapped: {},
      now: () => NOW,
    });
    const r = await syncLiftStatus(
      {
        fetcher: fakeFetcher(FILES).fetcher,
        store,
        mapping: MAPPING.slice(0, 1),
        unmapped: {},
        now: () => NOW,
      },
      { force: true },
    );
    expect(r.removed).toBe(2);
    expect([...saved.keys()]).toEqual(['testberg']);
  });
});
