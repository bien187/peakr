import postgres from 'postgres';
import { env } from '../config/env';

/**
 * Lokales Postgres (docker-compose: Host `localhost`/`127.0.0.1`/`db`) läuft ohne
 * TLS; gehostete Anbieter wie Neon verlangen es.
 */
export function isLocalDatabase(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|db|postgres)(:\d+)?\//.test(url);
}

/** URL-Parameter, die der Treiber versteht bzw. an den Server weiterreichen darf. */
const KEEP_PARAMS = new Set(['options', 'application_name']);

/**
 * Entfernt libpq-spezifische Parameter wie `sslmode` oder `channel_binding`.
 * postgres.js schickt unbekannte URL-Parameter als Startparameter an den
 * Server; Postgres bzw. der Neon-Pooler bricht die Verbindung dann ab
 * («unrecognized configuration parameter»). TLS wird separat gesetzt.
 */
export function sanitizeDatabaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (!KEEP_PARAMS.has(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

/**
 * Website (Vercel) → gepoolte URL; Kommandozeile (Migration, Pipeline, Worker)
 * → direkte URL, falls vorhanden. Der Pooler läuft im Transaktionsmodus und
 * eignet sich nicht für lange Importtransaktionen.
 */
export function connectionUrl(): string {
  const raw = process.env.VERCEL ? env.DATABASE_URL : (env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL);
  return sanitizeDatabaseUrl(raw);
}

export function connectionOptions(url: string, max: number): postgres.Options<Record<string, postgres.PostgresType>> {
  return {
    max,
    idle_timeout: 20,
    // Neon weckt eine pausierte Datenbank beim ersten Zugriff; das dauert einige Sekunden.
    connect_timeout: 20,
    ssl: isLocalDatabase(url) ? false : 'require',
    // Pooler im Transaktionsmodus kennen keine benannten Prepared Statements.
    prepare: false,
    onnotice: () => undefined,
  };
}

declare global {
  // In der Next.js-Entwicklung wird das Modul bei jedem Hot-Reload neu geladen;
  // ohne diesen Halter entstünde jedes Mal ein neuer Verbindungspool.
  var __peakrSql: postgres.Sql | undefined;
}

function createClient(): postgres.Sql {
  const url = connectionUrl();
  // Serverless: wenige Verbindungen je Instanz; Batch-Läufe öffnen bei Bedarf mehr.
  return postgres(url, connectionOptions(url, Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 2 : 8))));
}

/** postgres.js-Client. Alle Abfragen sind parametrisierte Tagged Templates. */
export const queryClient: postgres.Sql = globalThis.__peakrSql ?? createClient();
if (env.NODE_ENV !== 'production') globalThis.__peakrSql = queryClient;

export type Sql = postgres.Sql;
