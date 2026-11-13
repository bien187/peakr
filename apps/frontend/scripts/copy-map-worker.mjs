// MapLibre 6 lädt seinen Web-Worker als eigene Datei. Der Next.js-Bundler liefert sie nicht mit,
// deshalb wird sie vor `next dev`/`next build` nach public/ kopiert und per setWorkerUrl gesetzt
// (siehe lib/map.ts).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('maplibre-gl/package.json'));
const target = resolve(here, '../public/maplibre-gl-worker.mjs');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(resolve(pkgDir, 'dist/maplibre-gl-worker.mjs'), target);
console.log('[map-worker] maplibre-gl-worker.mjs → public/');
