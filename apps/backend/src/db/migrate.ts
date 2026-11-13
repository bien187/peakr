import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { connectionOptions, connectionUrl, sanitizeDatabaseUrl } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../drizzle');

/** Wendet alle ausstehenden Migrationen an. PostGIS ist Pflicht. */
export async function runMigrations(databaseUrl?: string): Promise<void> {
  const url = databaseUrl ? sanitizeDatabaseUrl(databaseUrl) : connectionUrl();
  const client = postgres(url, connectionOptions(url, 1));
  try {
    await client`CREATE EXTENSION IF NOT EXISTS postgis`;
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const target = connectionUrl().replace(/:\/\/[^@]*@/, '://***@');
  console.log(`⏳ Migrationen für ${target} …`);
  runMigrations()
    .then(() => console.log('✅ Migrationen angewendet.'))
    .catch((err) => {
      console.error('❌ Migration fehlgeschlagen:', err);
      process.exit(1);
    });
}
