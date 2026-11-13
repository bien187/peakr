import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWeatherBatch, parseWeather } from './openMeteo.service';

const point = { lat: 46.5, lng: 8.0, elevation: 2000 };
const answer = (n: number) =>
  Array.from({ length: n }, () => ({
    elevation: 2000,
    current: { temperature_2m: -3.5, weather_code: 3, visibility: 24000, wind_speed_10m: 12, snow_depth: 0.42 },
    daily: { snowfall_sum: [5.6] },
  }));
const ok = (n: number): Response =>
  new Response(JSON.stringify(n === 1 ? answer(1)[0] : answer(n)), { status: 200, headers: { 'content-type': 'application/json' } });
const connectTimeout = (): Error =>
  new TypeError('fetch failed', { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) });
const fast = { pauseMs: 0, networkRetryMs: 1, rateLimitWaitMs: 1, secondPassDelayMs: 1 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseWeather', () => {
  it('rechnet Schneehöhe von Metern in Zentimeter und übernimmt die Modellhöhe', () => {
    const w = parseWeather(answer(1)[0]);
    expect(w.snowDepthCm).toBe(42);
    expect(w.freshSnowCm).toBe(5.6);
    expect(w.modelElevationM).toBe(2000);
    expect(w.temperatureC).toBe(-3.5);
  });

  it('lässt fehlende Werte leer statt sie zu erfinden', () => {
    const w = parseWeather({ current: {} });
    expect(w.snowDepthCm).toBeNull();
    expect(w.temperatureC).toBeNull();
    expect(w.freshSnowCm).toBeNull();
  });
});

describe('fetchWeatherBatch', () => {
  it('wiederholt nach einer Verbindungs-Zeitüberschreitung und liefert dann die Werte', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(connectTimeout()).mockResolvedValueOnce(ok(2));
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchWeatherBatch([point, point], fast);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.every((w) => w?.snowDepthCm === 42)).toBe(true);
  });

  it('holt einen im ersten Durchgang gescheiterten Block im zweiten Durchgang nach', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(connectTimeout())
      .mockRejectedValueOnce(connectTimeout())
      .mockRejectedValueOnce(connectTimeout())
      .mockRejectedValueOnce(connectTimeout()) // Durchgang 1: alle 4 Versuche gescheitert
      .mockResolvedValueOnce(ok(1)); // Durchgang 2
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchWeatherBatch([point], fast);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(out[0]?.temperatureC).toBe(-3.5);
  });

  it('bricht bei anhaltendem HTTP 429 ab, statt weiter gegen das Kontingent zu laufen', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('Too many requests', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    // 150 Punkte = 2 Blöcke; nach dem ersten Block mit 4×429 kommt kein zweiter Abruf.
    const out = await fetchWeatherBatch(Array.from({ length: 150 }, () => point), fast);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(out.every((w) => w === null)).toBe(true);
  });

  it('gibt bei anderen 4xx-Fehlern den Block sofort auf (fehlerhafte Anfrage)', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{"reason":"bad"}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchWeatherBatch([point], fast);
    // je ein Versuch im ersten und im zweiten Durchgang
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out[0]).toBeNull();
  });
});
