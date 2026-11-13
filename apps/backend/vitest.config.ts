import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Datenbanktests brauchen eine befüllte DB: separat mit `pnpm test:db`.
    exclude: ['src/**/*.db.test.ts', 'node_modules/**'],
  },
});
