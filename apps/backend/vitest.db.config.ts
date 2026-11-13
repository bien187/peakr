import { defineConfig } from 'vitest/config';

/**
 * Tests gegen eine befüllte Datenbank samt Strassengraph (nach `pnpm pipeline all`).
 * Aufruf: DATABASE_URL=… pnpm test:db
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.db.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Ein Prozess: Graph und Verbindungspool nur einmal laden.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
