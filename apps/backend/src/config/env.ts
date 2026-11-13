import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// .env liegt im Monorepo-Root — unabhängig vom aktuellen Arbeitsverzeichnis laden.
// Bereits gesetzte Variablen (CI, Vercel, `DATABASE_URL=… pnpm …`) haben Vorrang.
const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../../..');
loadDotenv({ path: resolve(REPO_ROOT, '.env') });

const booleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .transform((v) => v === true || v === 'true' || v === '1');

const DEV_JWT_SECRET = 'dev-only-insecure-secret-change-me-please';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Gepoolte Verbindung (Neon: «-pooler»-Host) – für die Website auf Vercel. */
  DATABASE_URL: z.string().default('postgresql://alpine:alpine@localhost:5432/peakr'),
  /**
   * Direkte Verbindung ohne Pooler – für Migrationen, Datenpipeline und Worker
   * (lange Transaktionen). Fehlt sie, wird DATABASE_URL verwendet.
   */
  DATABASE_URL_UNPOOLED: z.string().optional(),

  // Länge wird nicht hier, sondern in jwtSecretProblem() geprüft: ein ungeeignetes
  // Geheimnis soll nur die Anmeldung abschalten, nicht den ganzen Prozess.
  JWT_SECRET: z.string().default(DEV_JWT_SECRET),
  JWT_EXPIRES_IN: z.string().default('7d'),

  /** Pfad zur Strassengraph-Datei (Standard: .data/artifacts/road-graph.bin im Repo). */
  ROAD_GRAPH_PATH: z.string().optional(),
  /** Arbeitsverzeichnis der Datenpipeline für Downloads und Zwischenstände. */
  DATA_DIR: z.string().optional(),

  /** Optional: OpenRouteService-Schlüssel, nur für den Vergleichstest der Fahrzeiten. */
  ORS_API_KEY: z.string().default(''),

  ENABLE_OPENAI_TREND: booleanFromString.default(false),
  OPENAI_API_KEY: z.string().default(''),

  LOG_LEVEL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.flatten().fieldErrors;
  throw new Error(`Ungültige Umgebungsvariablen: ${JSON.stringify(fields)}`);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Prüft das Signatur-Geheimnis für Anmelde-Token. In Produktion darf der
 * eingebaute Entwicklungswert nie greifen (sonst könnte jeder gültige Token
 * fälschen), und HS256 verlangt mindestens 256 Bit Schlüssel (RFC 7518).
 * Liefert den Grund oder null. Der Wert selbst wird nie ausgegeben.
 */
export function jwtSecretProblem(nodeEnv: string, secret: string): string | null {
  if (nodeEnv !== 'production') return null;
  if (secret === DEV_JWT_SECRET || secret.trim() === '') return 'JWT_SECRET ist nicht gesetzt.';
  if (secret.length < 32) return 'JWT_SECRET ist kürzer als 32 Zeichen.';
  return null;
}

/**
 * Ist das Geheimnis ungeeignet, sind Anmeldung, Registrierung, Konto und
 * Favoriten deaktiviert (HTTP 503); Suche, Karte und Detailseiten laufen weiter.
 * Pipeline und Worker brauchen kein Geheimnis.
 */
export const JWT_SECRET_PROBLEM = jwtSecretProblem(env.NODE_ENV, env.JWT_SECRET);

export const DATA_DIR = env.DATA_DIR ? resolve(env.DATA_DIR) : resolve(REPO_ROOT, '.data');
export const SEARCH_INDEX_PATH = process.env.SEARCH_INDEX_PATH
  ? resolve(process.env.SEARCH_INDEX_PATH)
  : resolve(DATA_DIR, 'artifacts/search-index.json.gz');
export const ROAD_GRAPH_PATH = env.ROAD_GRAPH_PATH
  ? resolve(env.ROAD_GRAPH_PATH)
  : resolve(DATA_DIR, 'artifacts/road-graph.bin');
