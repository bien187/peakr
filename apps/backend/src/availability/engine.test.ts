import { describe, expect, it } from 'vitest';
import type { AvailabilityCheck } from '@ch-alpineroute/shared';
import {
  assessAvalanche,
  assessClosures,
  assessDaylight,
  assessOperation,
  assessSkiSnow,
  assessSnow,
  assessWeather,
  StationIndex,
  type CellForecast,
  type SnowStation,
} from './checks';
import { combine, emptyConditions, evaluateHikeRoute, evaluateSkiResort, type HikeRouteFacts } from './engine';
import { zurichToUtc } from './time';

// ── Hilfen ────────────────────────────────────────────────────────────────────

const SUMMER_NOW = new Date('2026-07-15T05:00:00Z'); // 07:00 Schweizer Zeit
const WINTER_NOW = new Date('2026-11-13T06:00:00Z'); // 07:00
const iso = (d: Date, hoursAgo: number) => new Date(d.getTime() - hoursAgo * 3_600_000).toISOString();

const station = (over: Partial<SnowStation>): SnowStation => ({
  id: 'imis:X', source: 'slf_imis', name: 'Testalp', lat: 46.6, lng: 8.0, elevationM: 2000, snowCm: 0, newSnowCm: 0,
  measuredAt: iso(SUMMER_NOW, 6), ...over,
});

/** 72 Stunden ab Mitternacht (UTC) des Datums; einzelne Stunden überschreibbar. */
function forecast(date: string, fetchedAt: string, set: Partial<Record<keyof Omit<CellForecast, 'start' | 'fetchedAt' | 'elevationM'>, Record<number, number>>> = {}): CellForecast {
  const col = (base: number, over: Record<number, number> = {}) => Array.from({ length: 72 }, (_, i) => over[i] ?? base);
  return {
    start: `${date}T00:00:00.000Z`,
    precip: col(0, set.precip), snowfall: col(0, set.snowfall), code: col(1, set.code), gust: col(20, set.gust),
    temp: col(12, set.temp), cloud: col(30, set.cloud), fetchedAt, elevationM: 1500,
  };
}

const route = (over: Partial<HikeRouteFacts> = {}): HikeRouteFacts => ({
  destinationId: 'd1', rank: 1, lat: 46.6, lng: 8.0, minElevM: 1200, maxElevM: 2100, durationUpMin: 150, durationDownMin: 100,
  officialShare: 0.95, weatherCell: 'c1', slfRegionId: 'r1', ...over,
});

function summerConditions() {
  const c = emptyConditions();
  c.closuresAt = iso(SUMMER_NOW, 3);
  c.snowAt = iso(SUMMER_NOW, 3);
  c.avalancheAt = iso(SUMMER_NOW, 3);
  c.forecastAt = iso(SUMMER_NOW, 3);
  c.stations = new StationIndex([station({ elevationM: 2300, snowCm: 0 })]);
  c.forecasts.set('c1', forecast('2026-07-15', iso(SUMMER_NOW, 3)));
  return c;
}

const byKind = (checks: AvailabilityCheck[], kind: AvailabilityCheck['kind']) => checks.find((c) => c.kind === kind)!;

// ── Sommer ────────────────────────────────────────────────────────────────────

describe('Sommer: Sperrungen', () => {
  const now = SUMMER_NOW;
  const fresh = iso(now, 3);
  const closure = { id: '1', title: 'Brücke Mühlau', reason: 'Baute demontiert oder gesperrt', duration: 'bis auf Weiteres', url: null, hasDetour: false };

  it('gesperrter Abschnitt ohne Umleitung → nicht verfügbar, mit amtlicher Quelle', () => {
    const c = assessClosures([closure], 0.9, fresh, now);
    expect(c.status).toBe('unavailable');
    expect(c.text).toContain('Brücke Mühlau');
    expect(c.evidence).toBe('official');
  });

  it('mit signalisierter Umleitung → unsicher', () => {
    expect(assessClosures([{ ...closure, hasDetour: true }], 0.9, fresh, now).status).toBe('uncertain');
  });

  it('keine Meldung auf amtlichen Wegen → verfügbar', () => {
    expect(assessClosures([], 0.95, fresh, now).status).toBe('available');
  });

  it('fehlender Bericht ist kein Nachweis: Route grösstenteils abseits des amtlichen Netzes → unsicher', () => {
    const c = assessClosures([], 0.3, fresh, now);
    expect(c.status).toBe('uncertain');
    expect(c.text).toContain('30 %');
  });

  it('veraltete oder fehlende Sperrungsdaten → unsicher', () => {
    expect(assessClosures([], 0.95, iso(now, 72), now).status).toBe('uncertain');
    expect(assessClosures([], 0.95, null, now).evidence).toBe('none');
  });
});

describe('Sommer: Schnee entlang der Route', () => {
  const now = SUMMER_NOW;
  const at = { lat: 46.6, lng: 8.0 };

  it('Schnee an einer Station unterhalb des höchsten Punkts → nicht verfügbar (Messung)', () => {
    const idx = new StationIndex([station({ elevationM: 1900, snowCm: 25, name: 'Gantrisch' })]);
    const c = assessSnow(at, 2100, idx, null, now);
    expect(c.status).toBe('unavailable');
    expect(c.evidence).toBe('measured');
    expect(c.text).toContain('Gantrisch');
  });

  it('wenig Schnee knapp unter Routenhöhe → unsicher', () => {
    const idx = new StationIndex([station({ elevationM: 2050, snowCm: 8 })]);
    expect(assessSnow(at, 2100, idx, null, now).status).toBe('uncertain');
  });

  it('wenig Schnee weit unter dem höchsten Punkt → nicht verfügbar (darüber liegt mehr)', () => {
    const idx = new StationIndex([station({ elevationM: 1500, snowCm: 6 })]);
    expect(assessSnow(at, 2100, idx, null, now).status).toBe('unavailable');
  });

  it('schneefrei gemessen auf Routenhöhe → verfügbar', () => {
    const idx = new StationIndex([station({ elevationM: 2300, snowCm: 0 })]);
    const c = assessSnow(at, 2100, idx, null, now);
    expect(c.status).toBe('available');
    expect(c.evidence).toBe('measured');
  });

  it('Stationen über 36 h alt oder ausser Reichweite zählen nicht', () => {
    const idx = new StationIndex([
      station({ elevationM: 1900, snowCm: 40, measuredAt: iso(now, 40) }),
      station({ elevationM: 1900, snowCm: 40, lat: 47.2 }), // ~67 km entfernt
    ]);
    const c = assessSnow(at, 2100, idx, null, now);
    expect(c.status).toBe('uncertain');
    expect(c.evidence).toBe('none');
  });

  it('nur Modell: Modellhöhe nahe der Route und schneefrei → verfügbar, als Modellwert gekennzeichnet', () => {
    const c = assessSnow(at, 2100, new StationIndex([]), { snowCm: 0, elevationM: 1900, at: iso(now, 4) }, now);
    expect(c.status).toBe('available');
    expect(c.evidence).toBe('model');
  });

  it('nur Modell weit unter der Route ohne Schnee → unbekannt (unsicher)', () => {
    expect(assessSnow(at, 2800, new StationIndex([]), { snowCm: 0, elevationM: 1200, at: iso(now, 4) }, now).status).toBe('uncertain');
  });

  it('Modell meldet Schnee unterhalb der Route → nicht verfügbar', () => {
    expect(assessSnow(at, 2600, new StationIndex([]), { snowCm: 30, elevationM: 1600, at: iso(now, 4) }, now).status).toBe('unavailable');
  });
});

describe('Sommer: Wetter zur Tourzeit', () => {
  const now = SUMMER_NOW;
  const fetched = iso(now, 2);
  // Tour 08:00–12:00 Schweizer Zeit = 06–10 UTC → Stunden 6–9
  const win = { from: zurichToUtc('2026-07-15', 8), to: zurichToUtc('2026-07-15', 12) };

  it('ruhiges Wetter → verfügbar, als Prognose gekennzeichnet', () => {
    const c = assessWeather(forecast('2026-07-15', fetched), win, 2100, now);
    expect(c.status).toBe('available');
    expect(c.evidence).toBe('forecast');
    expect(c.text).toContain('08:00–12:00');
  });

  it('Gewitter in der Tourzeit → unsicher mit Uhrzeit', () => {
    const c = assessWeather(forecast('2026-07-15', fetched, { code: { 8: 95 } }), win, 2100, now);
    expect(c.status).toBe('uncertain');
    expect(c.text).toContain('Gewitter möglich ab etwa 10:00');
  });

  it('Gewitter erst nach der Tour zählt nicht', () => {
    expect(assessWeather(forecast('2026-07-15', fetched, { code: { 14: 95 } }), win, 2100, now).status).toBe('available');
  });

  it('Sturmböen → nicht verfügbar; starke Böen → unsicher', () => {
    expect(assessWeather(forecast('2026-07-15', fetched, { gust: { 7: 95 } }), win, 2100, now).status).toBe('unavailable');
    expect(assessWeather(forecast('2026-07-15', fetched, { gust: { 7: 65 } }), win, 2100, now).status).toBe('uncertain');
  });

  it('viel Neuschnee → nicht verfügbar; Niederschlag bei Frost auf Routenhöhe → Schneefall möglich', () => {
    expect(assessWeather(forecast('2026-07-15', fetched, { snowfall: { 6: 6, 7: 6 } }), win, 2100, now).status).toBe('unavailable');
    // 1 °C auf 1500 m → auf 2100 m etwa −3 °C
    const c = assessWeather(forecast('2026-07-15', fetched, { precip: { 6: 2 }, temp: { 6: 1, 7: 1, 8: 1, 9: 1 } }), win, 2100, now);
    expect(c.status).toBe('uncertain');
    expect(c.text).toContain('Schneefall möglich');
  });

  it('starker Regen → unsicher', () => {
    expect(assessWeather(forecast('2026-07-15', fetched, { precip: { 7: 6 } }), win, 2100, now).status).toBe('uncertain');
  });

  it('keine, veraltete oder zu kurze Prognose → unsicher', () => {
    expect(assessWeather(undefined, win, 2100, now).status).toBe('uncertain');
    expect(assessWeather(forecast('2026-07-15', iso(now, 30)), win, 2100, now).status).toBe('uncertain');
    // Prognose ab 15.07. 00:00 UTC für 72 h – der 18.07. liegt ausserhalb.
    const late = { from: zurichToUtc('2026-07-18', 8), to: zurichToUtc('2026-07-18', 12) };
    expect(assessWeather(forecast('2026-07-15', fetched), late, 2100, now).text).toContain('reicht nicht');
  });
});

describe('Lawinenbulletin räumlich ausgewertet', () => {
  const now = WINTER_NOW;
  const fetched = iso(now, 2);
  const region = {
    level: 3,
    validUntil: iso(now, -10),
    ratings: [
      { level: 3, lowerM: 2000, upperM: null, aspects: ['N', 'NE', 'E'] },
      { level: 2, lowerM: null, upperM: null, aspects: [] },
    ],
  };

  it('Route reicht in die Kernzone (über 2000 m) → nicht verfügbar, mit Höhe und Exposition', () => {
    const c = assessAvalanche(region, { minElevM: 1200, maxElevM: 2400 }, fetched, now);
    expect(c.status).toBe('unavailable');
    // Tausendertrennzeichen je nach ICU-Version «'» oder «’»
    expect(c.text).toMatch(/Gefahrenstufe 3 oberhalb 2.000 m/);
    expect(c.text).toContain('N, NO, O');
  });

  it('Route bleibt unterhalb der Kernzone → eine Stufe tiefer → unsicher', () => {
    const c = assessAvalanche(region, { minElevM: 900, maxElevM: 1700 }, fetched, now);
    expect(c.status).toBe('uncertain');
    expect(c.text).toContain('Gefahrenstufe 2');
  });

  it('Stufe 1 → verfügbar; kein Bulletin (ausserhalb der Saison) → verfügbar', () => {
    expect(assessAvalanche({ level: 1, validUntil: null, ratings: [{ level: 1, lowerM: null, upperM: null, aspects: [] }] }, { minElevM: 1000, maxElevM: 2400 }, fetched, now).status).toBe('available');
    expect(assessAvalanche(undefined, { minElevM: 1000, maxElevM: 2400 }, fetched, now).status).toBe('available');
  });

  it('Bulletin nicht abrufbar → hohe Routen unsicher, tiefe nicht betroffen', () => {
    expect(assessAvalanche(undefined, { minElevM: 1000, maxElevM: 2400 }, iso(now, 50), now).status).toBe('uncertain');
    expect(assessAvalanche(undefined, { minElevM: 400, maxElevM: 900 }, iso(now, 50), now).status).toBe('available');
  });

  it('Skigebiet: erst ab Stufe 4 unsicher (Pisten sind gesichert)', () => {
    expect(assessAvalanche(region, { minElevM: 1200, maxElevM: 2600 }, fetched, now, 'ski').status).toBe('available');
    expect(assessAvalanche({ ...region, level: 4, ratings: [{ level: 4, lowerM: null, upperM: null, aspects: [] }] }, { minElevM: 1200, maxElevM: 2600 }, fetched, now, 'ski').status).toBe('uncertain');
  });
});

describe('Tageslicht', () => {
  const at = { lat: 46.6, lng: 8.0 };

  it('Sommer: 4 h Tour ab 8 Uhr → verfügbar mit Rückkehrzeit', () => {
    const r = assessDaylight(at, { date: '2026-07-15', startHour: 8 }, 240);
    expect(r.check.status).toBe('available');
    expect(r.check.text).toContain('Rückkehr gegen 12:00');
  });

  it('November: Start 14 Uhr, 4 h → Rückkehr nach Einbruch der Dunkelheit → nicht verfügbar', () => {
    expect(assessDaylight(at, { date: '2026-11-13', startHour: 14 }, 240).check.status).toBe('unavailable');
  });

  it('Rückkehr in der Dämmerung → unsicher', () => {
    // Sonnenuntergang ~16:55, Dämmerung bis ~17:28 → Start 14 Uhr, 3 h 10 min
    expect(assessDaylight(at, { date: '2026-11-13', startHour: 14 }, 190).check.status).toBe('uncertain');
  });

  it('länger als das Tageslicht → nicht verfügbar, auch bei frühem Start', () => {
    const r = assessDaylight(at, { date: '2026-12-21', startHour: 5 }, 11 * 60);
    expect(r.check.status).toBe('unavailable');
    expect(r.check.text).toContain('länger als das Tageslicht');
  });
});

describe('Gesamturteil einer Sommerroute', () => {
  it('alle Prüfungen bestanden → verfügbar, Vertrauen mittel (Prognose beteiligt)', () => {
    const a = evaluateHikeRoute(route(), summerConditions(), { date: '2026-07-15', startHour: 8 }, SUMMER_NOW);
    expect(a.status).toBe('available');
    expect(a.reason).toBeNull();
    expect(a.confidence).toBe('medium');
    expect(a.checks.map((c) => c.kind)).toEqual(['closure', 'avalanche', 'snow', 'weather', 'daylight']);
    expect(a.plan?.endsAt).toBe(new Date(zurichToUtc('2026-07-15', 8).getTime() + 250 * 60_000).toISOString());
  });

  it('schlechteste Prüfung bestimmt Status und Grund; Sperrung vor Wetter', () => {
    const c = summerConditions();
    c.closures.set('d1:1', [{ id: 'x', title: 'Steinschlag Taminaschlucht', reason: 'Steinschlag', duration: null, url: null, hasDetour: false }]);
    c.forecasts.set('c1', forecast('2026-07-15', iso(SUMMER_NOW, 3), { gust: { 7: 95 } }));
    const a = evaluateHikeRoute(route(), c, { date: '2026-07-15', startHour: 8 }, SUMMER_NOW);
    expect(a.status).toBe('unavailable');
    expect(a.reason).toContain('Taminaschlucht');
  });

  it('fehlende Daten → unsicher mit geringem Vertrauen, nie verfügbar', () => {
    const a = evaluateHikeRoute(route(), emptyConditions(), { date: '2026-07-15', startHour: 8 }, SUMMER_NOW);
    expect(a.status).toBe('uncertain');
    expect(a.confidence).toBe('low');
  });

  it('combine: Vertrauen hoch nur mit amtlichen Meldungen, Messungen und Berechnungen', () => {
    const ok = (kind: AvailabilityCheck['kind'], evidence: AvailabilityCheck['evidence']): AvailabilityCheck => ({
      kind, status: 'available', text: '', evidence, source: null, observedAt: null,
    });
    expect(combine([ok('closure', 'official'), ok('snow', 'measured'), ok('daylight', 'computed')], null, null, SUMMER_NOW).confidence).toBe('high');
    expect(combine([ok('closure', 'official'), ok('snow', 'model')], null, null, SUMMER_NOW).confidence).toBe('medium');
  });
});

// ── Winter ────────────────────────────────────────────────────────────────────

describe('Winter: Skigebiet', () => {
  const now = WINTER_NOW;
  const today = '2026-11-13';
  const conditions = () => {
    const c = emptyConditions();
    c.avalancheAt = iso(now, 2);
    c.forecastAt = iso(now, 2);
    c.stations = new StationIndex([station({ elevationM: 2500, snowCm: 55, name: 'Weissfluhjoch', measuredAt: iso(now, 7), lat: 46.83, lng: 9.81 })]);
    return c;
  };
  const resort = (over: Partial<Parameters<typeof evaluateSkiResort>[0]> = {}) => ({
    lat: 46.8, lng: 9.83, topElevM: 2600, baseElevM: 1550, slfRegionId: null,
    lifts: { liftsOpen: null, liftsTotal: 30, source: null, capturedAt: null },
    snowTopCm: 60, snowValleyCm: 20, snowAt: iso(now, 2), forecast: forecast(today, iso(now, 2), { temp: Object.fromEntries(Array.from({ length: 72 }, (_, i) => [i, -4])) }),
    ...over,
  });

  it('ohne Live-Betriebsstatus nie «verfügbar» – höchstens unsicher', () => {
    const a = evaluateSkiResort(resort(), conditions(), { date: today, startHour: 8 }, now);
    expect(a.status).toBe('uncertain');
    expect(a.reason).toContain('Betriebsstatus unbekannt');
    expect(byKind(a.checks, 'operation').evidence).toBe('none');
  });

  it('mit aktueller Betriebsmeldung (heute, Anlagen offen) und Schnee → verfügbar', () => {
    const lifts = { liftsOpen: 18, liftsTotal: 30, source: 'Bergbahn (Vereinbarung)', capturedAt: iso(now, 1) };
    const a = evaluateSkiResort(resort({ lifts }), conditions(), { date: today, startHour: 8 }, now);
    expect(a.status).toBe('available');
    expect(byKind(a.checks, 'operation').text).toContain('18 von 30 Anlagen offen');
  });

  it('Betriebsmeldung «alle Anlagen zu» → nicht verfügbar; veraltet oder für einen anderen Tag → unsicher', () => {
    const closed = { liftsOpen: 0, liftsTotal: 30, source: 'Bergbahn', capturedAt: iso(now, 1) };
    expect(assessOperation(closed, today, now).status).toBe('unavailable');
    expect(assessOperation({ ...closed, liftsOpen: 10, capturedAt: iso(now, 13) }, today, now).status).toBe('uncertain');
    expect(assessOperation({ ...closed, liftsOpen: 10 }, '2026-11-14', now).status).toBe('uncertain');
  });

  it('Schnee: Messung der nahen Station bevorzugt und gekennzeichnet, Modell zusätzlich genannt', () => {
    const idx = new StationIndex([station({ elevationM: 2500, snowCm: 55, name: 'Weissfluhjoch', measuredAt: iso(now, 7), lat: 46.83, lng: 9.81 })]);
    const c = assessSkiSnow({ topCm: 60, valleyCm: 20, at: iso(now, 2), topElevM: 2600 }, idx.near(46.8, 9.83, 15)[0], now);
    expect(c.status).toBe('available');
    expect(c.evidence).toBe('measured');
    expect(c.text).toContain('Modell: Berg 60 cm, Tal 20 cm');
    expect(c.text).toContain('gemessen: 55 cm an der Station Weissfluhjoch');
    expect(c.text).toContain('Technische Beschneiung ist nicht erfasst');
  });

  it('wenig Naturschnee → unsicher (Beschneiung unbekannt); keine Schneedaten → unsicher', () => {
    expect(assessSkiSnow({ topCm: 4, valleyCm: 0, at: iso(now, 2), topElevM: 2600 }, null, now).status).toBe('uncertain');
    expect(assessSkiSnow({ topCm: null, valleyCm: null, at: null, topElevM: 2600 }, null, now).evidence).toBe('none');
  });

  it('Sturm am Skitag → nicht verfügbar', () => {
    const lifts = { liftsOpen: 18, liftsTotal: 30, source: 'Bergbahn', capturedAt: iso(now, 1) };
    const a = evaluateSkiResort(resort({ lifts, forecast: forecast(today, iso(now, 2), { gust: { 11: 110 } }) }), conditions(), { date: today, startHour: 8 }, now);
    expect(a.status).toBe('unavailable');
    expect(a.reason).toContain('Sturmböen');
  });
});
