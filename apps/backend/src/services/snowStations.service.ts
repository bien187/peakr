/**
 * Gemessene Schneehöhen an Stationen.
 *
 *  - SLF IMIS (automatische Stationen, 1300–3000 m): Tageswerte HS/HN_1D über die
 *    SLF Measurement API. CC BY 4.0, Quellenangabe «WSL-Institut für Schnee- und
 *    Lawinenforschung SLF» mit Link. Die Schnittstelle ist nicht für Abfragen je
 *    Nutzeranfrage gedacht – Peakr ruft sie nur im Worker ab.
 *  - MeteoSchweiz (manuell, täglich; automatisch, 10 min) über geo.admin.ch.
 *    Open Government Data, Quellenangabe «MeteoSchweiz».
 *
 * Jede Quelle wird einzeln abgerufen; fällt eine aus, bleiben die anderen.
 */
import type { SnowStation } from '../availability/checks';
import { lv95ToWgs84 } from '../geo/lv95';
import { describeError, fetchJson } from '../lib/http';
import { logger } from '../lib/logger';

const IMIS_STATIONS = 'https://measurement-api.slf.ch/public/api/imis/stations';
const IMIS_DAILY = 'https://measurement-api.slf.ch/public/api/imis/daily-snow';
const MCH_MANUAL =
  'https://data.geo.admin.ch/ch.meteoschweiz.messwerte-gesamtschnee-1d/ch.meteoschweiz.messwerte-gesamtschnee-1d_de.json';
const MCH_AUTO =
  'https://data.geo.admin.ch/ch.meteoschweiz.messwerte-schneehoehe-automatisch-10min/ch.meteoschweiz.messwerte-schneehoehe-automatisch-10min_de.json';

interface ImisStation {
  code: string;
  label?: string;
  lat: number;
  lon: number;
  elevation: number;
}
interface ImisDaily {
  station_code: string;
  measure_date: string;
  HS?: number | null;
  HN_1D?: number | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Letzter Tageswert je IMIS-Station mit Lage und Höhe. */
export function parseImis(stations: ImisStation[], daily: ImisDaily[]): SnowStation[] {
  const meta = new Map(stations.map((s) => [s.code, s]));
  const latest = new Map<string, ImisDaily>();
  for (const d of daily) {
    const prev = latest.get(d.station_code);
    if (!prev || d.measure_date > prev.measure_date) latest.set(d.station_code, d);
  }
  const out: SnowStation[] = [];
  for (const [code, d] of latest) {
    const s = meta.get(code);
    if (!s || !finite(s.lat) || !finite(s.lon) || !finite(s.elevation)) continue;
    // Tageswert ohne Uhrzeit: als Beginn des Tages (UTC) werten – eher zu alt als zu frisch.
    const date = /^\d{4}-\d{2}-\d{2}/.exec(d.measure_date)?.[0];
    if (!date) continue;
    out.push({
      id: `imis:${code}`, source: 'slf_imis', name: s.label ?? code, lat: s.lat, lng: s.lon,
      elevationM: Math.round(s.elevation),
      snowCm: finite(d.HS) && d.HS >= 0 ? d.HS : null,
      newSnowCm: finite(d.HN_1D) && d.HN_1D >= 0 ? d.HN_1D : null,
      measuredAt: `${date}T00:00:00.000Z`,
    });
  }
  return out;
}

interface MchFeature {
  id?: string;
  geometry?: { coordinates?: [number, number] };
  properties?: { station_name?: string; value?: number | string | null; reference_ts?: string; altitude?: string | number };
}

/** MeteoSchweiz-Messnetz (GeoJSON in LV95). 99999 bzw. «-» = kein Messwert. */
export function parseMeteoSwiss(fc: { features?: MchFeature[] }, prefix: string): SnowStation[] {
  const out: SnowStation[] = [];
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    const value = typeof p.value === 'number' ? p.value : Number.NaN;
    const coords = f.geometry?.coordinates;
    const altitude = Number(p.altitude);
    const ts = p.reference_ts && Number.isFinite(Date.parse(p.reference_ts)) ? new Date(p.reference_ts).toISOString() : null;
    if (!f.id || !coords || !Number.isFinite(altitude) || !ts || !Number.isFinite(value) || value < 0 || value >= 9999) continue;
    const { lat, lng } = lv95ToWgs84(coords[0], coords[1]);
    out.push({
      id: `${prefix}:${f.id}`, source: 'meteoswiss', name: p.station_name ?? f.id, lat, lng,
      elevationM: Math.round(altitude), snowCm: value, newSnowCm: null, measuredAt: ts,
    });
  }
  return out;
}

export async function fetchSnowStations(): Promise<{ stations: SnowStation[]; failed: string[] }> {
  const failed: string[] = [];
  const attempt = async <T>(name: string, load: () => Promise<T>): Promise<T | null> => {
    try {
      return await load();
    } catch (err) {
      failed.push(name);
      logger.warn({ source: name, error: describeError(err).slice(0, 300) }, 'Schneemessungen nicht abrufbar');
      return null;
    }
  };
  const opts = { timeoutMs: 30_000, retries: 2 };
  const [imisStations, imisDaily, manual, auto] = await Promise.all([
    attempt('slf_imis_stations', () => fetchJson<ImisStation[]>(IMIS_STATIONS, opts)),
    attempt('slf_imis_daily', () => fetchJson<ImisDaily[]>(IMIS_DAILY, opts)),
    attempt('meteoswiss_manual', () => fetchJson<{ features?: MchFeature[] }>(MCH_MANUAL, opts)),
    attempt('meteoswiss_auto', () => fetchJson<{ features?: MchFeature[] }>(MCH_AUTO, opts)),
  ]);
  const stations = [
    ...(imisStations && imisDaily ? parseImis(imisStations, imisDaily) : []),
    ...(manual ? parseMeteoSwiss(manual, 'mch') : []),
    ...(auto ? parseMeteoSwiss(auto, 'mch-auto') : []),
  ];
  return { stations, failed };
}
