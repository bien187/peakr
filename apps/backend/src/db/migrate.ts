import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../config/env';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../drizzle');

// Gehostete DBs (z.B. Supabase) verlangen TLS; lokales docker-compose nicht.
const isLocalDb = /@(localhost|127\.0\.0\.1|db)(:\d+)?\//.test(env.DATABASE_URL);

async function main(): Promise<void> {
  const client = postgres(env.DATABASE_URL, {
    max: 1,
    ssl: isLocalDb ? false : 'require',
    prepare: false, // Supabase-Pooler-kompatibel
  });
  try {
    console.log('⏳ Stelle PostGIS-Extension sicher ...');
    try {
      await client`CREATE EXTENSION IF NOT EXISTS postgis;`;
    } catch (e) {
      console.warn('⚠️  PostGIS konnte nicht aktiviert werden (wird für Geo-Queries benötigt):', e);
    }

    console.log(`⏳ Wende Migrationen an aus ${migrationsFolder} ...`);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
    console.log('✅ Migrationen erfolgreich angewendet.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Migration fehlgeschlagen:', err);
  process.exit(1);
});
