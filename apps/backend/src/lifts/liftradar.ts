import { z } from 'zod';
import { describeError, HttpError } from '../lib/http';
import { logger } from '../lib/logger';

/**
 * LiftRadar (https://liftradar.eu): freie JSON-Dateien mit dem Lift- und
 * Pistenstatus europäischer Skigebiete, ohne Schlüssel und Anmeldung.
 *
 * Geprüft am 25.11.2026 an echten Antworten und an der Dokumentation
 * (https://liftradar.eu/api):
 *  - /json/index.json                alle Gebiete mit Zählern und `checked_at`
 *  - /json/<land>/<id>.json          ein Gebiet: Zähler, Schnee, Bericht-Zeitpunkt, Quellen
 *  - /json/<land>/<id>.details.json  experimentell: jede Anlage und Piste mit Status
 *  - Status von Gebieten: open | closed | no_report; von Anlagen/Pisten:
 *    open | closed | preparation | unknown
 *  - Die Dateien tragen ein ETag; die Quelle liest die Berichte etwa um 08:40
 *    und 13:40 MEZ – häufiger als stündlich abzufragen bringt nichts.
 *  - Fehlende Datei: HTTP 404 mit HTML.
 *
 * Abgefragt wird ausschliesslich liftradar.eu unter /json/ (Allowlist). IDs
 * kommen aus der versionierten Zuordnung, nie aus Benutzereingaben.
 */

export const LIFTRADAR_SITE = 'https://liftradar.eu';
const LIFTRADAR_HOST = 'liftradar.eu';
const USER_AGENT = 'Peakr/1.0 (+https://github.com/bien187/peakr) lift-status-worker';

/** Gültige Gebiets-ID der Quelle (Kleinbuchstaben, Ziffern, Bindestriche). */
export const RESORT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function indexUrl(): string {
  return `${LIFTRADAR_SITE}/json/index.json`;
}

function checkedId(id: string): string {
  if (!RESORT_ID_RE.test(id) || id.length > 80) throw new Error(`Ungültige LiftRadar-ID «${id}»`);
  return id;
}

export function resortUrl(id: string): string {
  return `${LIFTRADAR_SITE}/json/ch/${checkedId(id)}.json`;
}

export function detailsUrl(id: string): string {
  return `${LIFTRADAR_SITE}/json/ch/${checkedId(id)}.details.json`;
}

/** Nur https://liftradar.eu/json/….json darf abgefragt werden. */
export function assertAllowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== LIFTRADAR_HOST ||
    url.port !== '' ||
    url.username ||
    url.password
  ) {
    throw new Error(`Nicht erlaubte Adresse: ${url.origin}`);
  }
  if (
    !url.pathname.startsWith('/json/') ||
    !url.pathname.endsWith('.json') ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Nicht erlaubter Pfad: ${url.pathname}`);
  }
  return url;
}

/** Nur http(s)-Links aus der Quelle weitergeben (keine javascript:/data:-Adressen), höchstens 500 Zeichen. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// ── Schemas (nur die Felder, die Peakr nutzt; weitere Felder werden ignoriert) ──

const count = z.number().finite().min(0).transform(Math.round);
const km = z.number().finite().min(0);
const isoTime = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), 'kein gültiger Zeitpunkt');

const sourceRefSchema = z.object({
  url: z.string().max(500),
  attribution_required: z.boolean().nullable().optional(),
});

export const indexResortSchema = z.object({
  id: z.string().regex(RESORT_ID_RE).max(80),
  country: z.string().max(4),
  name: z.string().min(1).max(200),
  region: z.string().max(100).nullable().optional(),
  status: z.string().max(40),
  checked_at: isoTime.nullable(),
  lifts: z.object({ open: count.nullable(), total: count.nullable() }).nullable().optional(),
});
export type IndexResort = z.infer<typeof indexResortSchema>;

export const indexFileSchema = z.object({
  generated_at: isoTime.nullable().optional(),
  resorts: z.array(z.unknown()).max(20_000),
});

const countPair = z.object({ open: count.nullable(), total: count.nullable() });
const slopeQuad = z.object({
  open: count.nullable(),
  total: count.nullable(),
  open_km: km.nullable().optional(),
  total_km: km.nullable().optional(),
});

export const resortFileSchema = z.object({
  id: z.string().regex(RESORT_ID_RE).max(80),
  country: z.string().max(4),
  name: z.string().min(1).max(200),
  website: z.string().max(500).nullable().optional(),
  status: z.string().max(40),
  fetched_at: isoTime.nullable(),
  status_from: isoTime.nullable().optional(),
  snow: z
    .object({
      mountain_cm: count.nullable().optional(),
      valley_cm: count.nullable().optional(),
      fresh_cm: count.nullable().optional(),
    })
    .nullable()
    .optional(),
  lifts: countPair.nullable(),
  slopes: slopeQuad.nullable(),
  lifts_by_type: z.record(countPair).nullable().optional(),
  slopes_by_difficulty: z.record(slopeQuad).nullable().optional(),
  lifts_updated_at: isoTime.nullable().optional(),
  /** Verweis auf die Einzelliste, z. B. «json/ch/zermatt.details.json»; fehlt, wenn die Quelle keine hat. */
  details: z.string().max(200).nullable().optional(),
  source_details: z
    .object({
      conditions: z.array(sourceRefSchema).max(50).optional(),
      resort_info: z.array(sourceRefSchema).max(50).optional(),
    })
    .nullable()
    .optional(),
});
export type ResortFile = z.infer<typeof resortFileSchema>;

const itemBase = {
  id: z.string().min(1).max(200),
  ref: z.string().max(60).nullable().optional(),
  name: z.string().min(1).max(200),
  /** Als Text: unbekannte neue Werte werden in status.ts zu 'unknown'. */
  status: z.string().max(40).nullable().optional(),
  length_m: count.nullable().optional(),
};

export const detailsFileSchema = z.object({
  id: z.string().regex(RESORT_ID_RE).max(80),
  updated_at: isoTime.nullable().optional(),
  lifts: z
    .array(z.object({ ...itemBase, type: z.string().max(40).nullable().optional() }))
    .max(1000)
    .nullable()
    .optional(),
  slopes: z
    .array(
      z.object({
        ...itemBase,
        difficulty: z.string().max(40).nullable().optional(),
        colour: z.string().max(40).nullable().optional(),
      }),
    )
    .max(2000)
    .nullable()
    .optional(),
});
export type DetailsFile = z.infer<typeof detailsFileSchema>;

// ── Abruf ──────────────────────────────────────────────────────────────────────

export type FetchResult =
  | { notModified: true; status: 304 }
  | { notModified: false; status: number; etag: string | null; body: unknown };

export interface FetchOptions {
  /** ETag der letzten Antwort → If-None-Match. */
  etag?: string | null;
  timeoutMs?: number;
  /** Wiederholungen nach dem ersten Versuch (nur Netzwerkfehler, 429, 5xx). */
  retries?: number;
  maxBytes?: number;
}

export type Fetcher = (url: string, opts?: FetchOptions) => Promise<FetchResult>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const BACKOFF_MS = [1500, 5000, 12000];

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new Error(`Antwort zu gross (${declared} Bytes)`);
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Antwort zu gross (über ${maxBytes} Bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function retryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return true; // Netzwerkfehler, Zeitüberschreitung
}

/**
 * Holt eine JSON-Datei von LiftRadar. 304 bei unverändertem ETag. Wirft bei
 * 4xx (ausser 429), falschem Inhaltstyp, ungültigem JSON oder zu grosser Antwort.
 */
export const fetchLiftRadar: Fetcher = async (raw, opts = {}) => {
  const url = assertAllowedUrl(raw);
  const { etag, timeoutMs = 15_000, retries = 2, maxBytes = 5_000_000 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': USER_AGENT,
      };
      if (etag) headers['if-none-match'] = etag;
      const res = await fetch(url, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 304) return { notModified: true, status: 304 };
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new HttpError(res.status, `HTTP ${res.status} bei ${url.pathname}`);
      }
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('json')) {
        await res.body?.cancel().catch(() => undefined);
        throw new HttpError(415, `Kein JSON bei ${url.pathname} (${type || 'ohne Inhaltstyp'})`);
      }
      const text = await readBounded(res, maxBytes);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(422, `Ungültiges JSON bei ${url.pathname}`);
      }
      return { notModified: false, status: res.status, etag: res.headers.get('etag'), body };
    } catch (err) {
      lastErr = err;
      const final = err instanceof HttpError && !retryable(err);
      if (final || attempt === retries) break;
      logger.warn(
        { path: url.pathname, attempt: attempt + 1, error: describeError(err) },
        'LiftRadar – Wiederholung',
      );
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
  }
  throw lastErr;
};
