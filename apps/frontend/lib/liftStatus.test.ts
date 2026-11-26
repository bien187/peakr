import { describe, expect, it } from 'vitest';
import type { LiftStatusArea, LiftStatusSummary } from '@ch-alpineroute/shared';
import {
  isReporting,
  linkLabel,
  openOfTotal,
  reportStamp,
  reportTime,
  requiredCredits,
  slopeColor,
  snowLines,
} from './liftStatus';

const NOW = new Date('2026-12-20T15:00:00+01:00');

describe('Anzeige des Liftstatus', () => {
  it('«offen/gesamt», ohne Gesamtzahl nur offen, ohne Angabe ein Strich', () => {
    expect(openOfTotal({ open: 18, closed: 6, preparation: 0, unknown: 0, total: 24 })).toBe(
      '18/24',
    );
    expect(
      openOfTotal({ open: 3, closed: null, preparation: null, unknown: null, total: null }),
    ).toBe('3');
    expect(
      openOfTotal({ open: null, closed: null, preparation: null, unknown: null, total: 12 }),
    ).toBe('–');
  });

  it('Zeitpunkte in Schweizer Zeit: heute, gestern, älter', () => {
    expect(reportTime('2026-12-20T07:40:00Z', NOW)).toBe('08:40');
    expect(reportTime('2026-12-19T12:40:00Z', NOW)).toBe('gestern 13:40');
    expect(reportTime('2026-12-17T07:40:00Z', NOW)).toBe('17.12. 08:40');
  });

  it('kennzeichnet, ob der Zeitpunkt der Bericht des Gebiets oder die Prüfung der Quelle ist', () => {
    const base = { dataAt: '2026-12-20T07:40:00Z', dataAtIsReport: true } as LiftStatusSummary;
    expect(reportStamp(base, NOW)).toBe('Bericht 08:40');
    expect(reportStamp({ ...base, dataAtIsReport: false }, NOW)).toBe('Stand 08:40');
    expect(reportStamp({ ...base, dataAt: null }, NOW)).toBe('kein aktueller Bericht');
  });

  it('nur offene/geschlossene Berichte gelten als aktueller Bericht', () => {
    expect(isReporting({ status: 'open' })).toBe(true);
    expect(isReporting({ status: 'closed' })).toBe(true);
    expect(isReporting({ status: 'no_report' })).toBe(false);
    expect(isReporting(null)).toBe(false);
  });

  it('nennt Originalquellen mit Nennungspflicht oder ungeprüft, ohne Doppelte', () => {
    expect(
      requiredCredits([
        { url: 'https://infosnow.ch/portal/', attributionRequired: null },
        { url: 'https://www.infosnow.ch/x', attributionRequired: true },
        { url: 'https://example.ch/', attributionRequired: false },
      ]),
    ).toEqual(['infosnow.ch']);
    expect(linkLabel('https://www.verbier.ch/')).toBe('verbier.ch');
  });

  it('Pistenfarbe: Farbe der Quelle vor Schwierigkeit', () => {
    expect(slopeColor('intermediate', 'red')).toBe('#d8362a');
    expect(slopeColor('ski_route', null)).toBe('#e0a100');
    expect(slopeColor('easy', 'blue_red')).toBe('#2f7fd1');
    expect(slopeColor(null, null)).toBe('#9aa3ad');
  });

  it('Schnee laut Bericht: nur Gebiete mit Bericht und Werten, bei Verbünden mit Namen', () => {
    const area = (
      name: string,
      status: LiftStatusArea['status'],
      mountainCm: number | null,
      valleyCm: number | null,
    ): LiftStatusArea =>
      ({ name, status, snow: { mountainCm, valleyCm, freshCm: null } }) as LiftStatusArea;
    expect(snowLines([area('A', 'open', 80, 35)])).toEqual(['Berg 80 cm, Tal 35 cm']);
    expect(
      snowLines([
        area('A', 'open', 80, null),
        area('B', 'closed', null, null),
        area('C', 'no_report', 50, 10),
      ]),
    ).toEqual(['A: Berg 80 cm']);
  });
});
