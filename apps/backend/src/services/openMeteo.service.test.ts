import { describe, expect, it } from 'vitest';
import { currentHourIndex, parseWeather, type OpenMeteoResponse } from './openMeteo.service';

describe('openMeteo.service', () => {
  it('rechnet snow_depth (m) korrekt in cm um und liest Neuschnee aus daily', () => {
    const fixture: OpenMeteoResponse = {
      hourly: {
        time: ['2026-01-01T00:00'],
        temperature_2m: [-5.4],
        snow_depth: [1.25], // 1,25 m -> 125 cm
        snowfall: [2],
        visibility: [12000],
        wind_speed_10m: [18.6],
        weather_code: [73],
      },
      daily: { time: ['2026-01-01'], snowfall_sum: [8.5], weather_code: [73] },
    };
    const w = parseWeather(fixture);
    expect(w.snowDepthCm).toBe(125);
    expect(w.freshSnowCm).toBe(8.5);
    expect(w.temperatureC).toBe(-5.4);
    expect(w.visibilityM).toBe(12000);
    expect(w.weatherCode).toBe(73);
  });

  it('liefert null statt zu crashen, wenn Felder fehlen', () => {
    const w = parseWeather({});
    expect(w.snowDepthCm).toBeNull();
    expect(w.temperatureC).toBeNull();
    expect(w.freshSnowCm).toBeNull();
  });

  it('currentHourIndex findet die Stunde am nächsten zu jetzt', () => {
    const now = Date.now();
    // Index 2 ist exakt "jetzt" → Differenz 0 → muss gewählt werden.
    const times = [-2, -1, 0, 1].map((h) => new Date(now + h * 3_600_000).toISOString());
    expect(currentHourIndex(times)).toBe(2);
    expect(currentHourIndex([])).toBe(0);
    expect(currentHourIndex(undefined)).toBe(0);
  });
});
