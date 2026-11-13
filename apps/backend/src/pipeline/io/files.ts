import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { logger } from '../../lib/logger';

const execFileAsync = promisify(execFile);
const USER_AGENT = 'peakr-data-pipeline/1.0 (+https://github.com/bien187/peakr)';

export interface DownloadInfo {
  path: string;
  url: string;
  lastModified: string | null;
  downloaded: boolean;
  bytes: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Lädt eine Datei mit Wiederholungen herunter. Ist sie lokal vorhanden und nicht
 * älter als `maxAgeHours`, wird der Download übersprungen (Zwischenspeicher).
 * Geschrieben wird erst in eine .part-Datei, damit ein Abbruch keinen halben
 * Stand hinterlässt.
 */
export async function download(url: string, path: string, maxAgeHours: number): Promise<DownloadInfo> {
  const metaPath = `${path}.meta.json`;
  if (existsSync(path) && existsSync(metaPath)) {
    const ageH = (Date.now() - statSync(path).mtimeMs) / 3_600_000;
    if (ageH < maxAgeHours) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { lastModified: string | null };
      return { path, url, lastModified: meta.lastModified, downloaded: false, bytes: statSync(path).size };
    }
  }

  mkdirSync(dirname(path), { recursive: true });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} bei ${url}`);
      const part = `${path}.part`;
      await streamPipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
      const expected = Number(res.headers.get('content-length') ?? 0);
      const bytes = statSync(part).size;
      if (expected > 0 && bytes !== expected) throw new Error(`Unvollständiger Download: ${bytes} von ${expected} Bytes`);
      renameSync(part, path);
      const lastModified = res.headers.get('last-modified');
      writeFileSync(metaPath, JSON.stringify({ url, lastModified, fetchedAt: new Date().toISOString() }));
      logger.info({ url, mb: Math.round(bytes / 1e6) }, 'Download abgeschlossen');
      return { path, url, lastModified, downloaded: true, bytes };
    } catch (err) {
      lastErr = err;
      logger.warn({ url, attempt, error: err instanceof Error ? err.message : String(err) }, 'Download fehlgeschlagen');
      await sleep(attempt * 5000);
    }
  }
  throw lastErr;
}

/** Führt ein Programm ohne Shell aus (Argumente werden nicht interpretiert). */
export async function run(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') {
      throw new Error(`Programm «${cmd}» fehlt. Installation: macOS «brew install osmium-tool», Ubuntu «apt-get install osmium-tool unzip».`);
    }
    throw new Error(`${cmd} ${args.join(' ')} fehlgeschlagen: ${e.stderr ?? e.message}`);
  }
}

/** GeoJSON-Sequenz (eine Feature-Zeile je Objekt, optional mit RS-Präfix) streamen. */
export async function* readGeoJsonSeq<T = unknown>(path: string): AsyncGenerator<T> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const raw of rl) {
    const line = raw.charCodeAt(0) === 0x1e ? raw.slice(1) : raw;
    if (line.length < 2) continue;
    yield JSON.parse(line) as T;
  }
}

/**
 * Semikolon-getrenntes CSV von swisstopo zeilenweise lesen (UTF-8 mit BOM,
 * keine Anführungszeichen im Datensatz). Liefert Objekte nach Kopfzeile.
 */
export async function* readSemicolonCsv(path: string): AsyncGenerator<Record<string, string>> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const raw of rl) {
    if (header === null) {
      header = raw.replace(/^\uFEFF/, '').split(';');
      continue;
    }
    if (raw.length === 0) continue;
    const cells = raw.split(';');
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? '';
    yield row;
  }
}
