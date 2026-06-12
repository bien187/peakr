import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env';
import * as schema from './schema';

/**
 * Lokales Postgres (docker-compose: Host `localhost`/`127.0.0.1`/`db`) läuft ohne
 * TLS; gehostete Anbieter wie Supabase verlangen es. Darum SSL automatisch
 * aktivieren, sobald die DB nicht lokal ist.
 */
const isLocalDb = /@(localhost|127\.0\.0\.1|db)(:\d+)?\//.test(env.DATABASE_URL);

/** Roher postgres.js-Client (auch für rohe ST_*-SQL-Queries nutzbar). */
export const queryClient = postgres(env.DATABASE_URL, {
  max: 10,
  ssl: isLocalDb ? false : 'require',
  // Supabase-Pooler (Transaction-Mode) kennt keine Prepared Statements.
  // Abschalten macht jeden Supabase-Connection-String nutzbar; lokal unschädlich.
  prepare: false,
});

/** Drizzle-Instanz mit vollem Schema. */
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
