// Stellt die Daten-Artefakte der Suche bereit (vor `next dev`/`next build`):
//   road-graph.bin          Strassengraph für die Fahrzeitberechnung
//   search-index.json.gz    Suchindex (Ziele, Ausgangspunkte, Routen, Skigebiete)
//
// 1. Lokal gebaut?  → .data/artifacts/… aus dem Repo kopieren.
// 2. Sonst          → aus dem GitHub-Release «data-latest» laden, das der Workflow
//                     «Peakr Daten» wöchentlich aktualisiert (anderer Ort: PEAKR_DATA_URL).
// Fehlt eine Datei am Ende, läuft die App trotzdem; die Suche meldet dann offen,
// dass keine Fahrzeiten berechnet werden können.
import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const base = (process.env.PEAKR_DATA_URL ?? 'https://github.com/bien187/peakr/releases/download/data-latest').replace(/\/$/, '');

const FILES = [
  {
    name: 'road-graph.bin',
    url: process.env.ROAD_GRAPH_URL ?? `${base}/road-graph.bin`,
    // Kennung «PKRG» am Dateianfang
    valid: (b) => b.length > 1_000_000 && b.readUInt32LE(0) === 0x47524b50,
  },
  {
    name: 'search-index.json.gz',
    url: `${base}/search-index.json.gz`,
    // gzip-Kennung 1f 8b
    valid: (b) => b.length > 100_000 && b[0] === 0x1f && b[1] === 0x8b,
  },
];

async function provide({ name, url, valid }) {
  const target = resolve(here, '../data', name);
  const local = resolve(here, '../../../.data/artifacts', name);
  mkdirSync(dirname(target), { recursive: true });

  if (existsSync(local)) {
    if (!existsSync(target) || statSync(local).mtimeMs > statSync(target).mtimeMs) {
      copyFileSync(local, target);
      console.log(`[daten] ${name}: lokal gebaute Datei übernommen (${Math.round(statSync(target).size / 1e5) / 10} MB)`);
    }
    return;
  }
  // Vorhandene Datei höchstens einen Tag weiterverwenden.
  if (existsSync(target) && Date.now() - statSync(target).mtimeMs < 24 * 3_600_000) return;

  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!valid(bytes)) throw new Error('unerwarteter Dateiinhalt');
    writeFileSync(`${target}.part`, bytes);
    renameSync(`${target}.part`, target);
    console.log(`[daten] ${name}: geladen von ${url} (${Math.round(bytes.length / 1e5) / 10} MB)`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (existsSync(target)) console.warn(`[daten] ${name}: Aktualisierung fehlgeschlagen (${reason}) – vorhandene Datei bleibt.`);
    else console.warn(`[daten] ${name}: NICHT VERFÜGBAR (${reason}). Ohne diese Datei liefert die Suche keine Treffer.`);
  }
}

for (const file of FILES) await provide(file);
