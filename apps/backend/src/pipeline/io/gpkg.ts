import { DatabaseSync } from 'node:sqlite';

/**
 * Minimaler GeoPackage-Leser für Linien mit Höhenwerten (LineStringZ /
 * MultiLineStringZ). GeoPackage ist eine SQLite-Datei; die Geometrie liegt als
 * «GeoPackageBinary» vor: Kopf (Kennung GP, Flags, SRS, optionale Hülle) + WKB.
 * Verwendet das in Node eingebaute SQLite – keine native Zusatzabhängigkeit.
 */

export interface Line3D {
  /** Abwechselnd x, y, z (LV95-Ost, LV95-Nord, Höhe in m). */
  coords: Float64Array;
}

const ENVELOPE_BYTES = [0, 32, 48, 48, 64];

/** Zerlegt einen GeoPackage-Geometrie-Blob in seine Linienzüge. */
export function parseGpkgLines(blob: Uint8Array): Line3D[] {
  if (blob.length < 8 || blob[0] !== 0x47 || blob[1] !== 0x50) {
    throw new Error('GeoPackage: Geometrie ohne GP-Kennung');
  }
  const flags = blob[3];
  const envelope = (flags >> 1) & 0x07;
  if (envelope > 4) throw new Error('GeoPackage: ungültiger Hüllen-Code');
  if ((flags >> 4) & 0x01) return []; // leere Geometrie
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const out: Line3D[] = [];
  readWkb(view, 8 + ENVELOPE_BYTES[envelope], out);
  return out;
}

function readWkb(view: DataView, start: number, out: Line3D[]): number {
  const little = view.getUint8(start) === 1;
  const rawType = view.getUint32(start + 1, little);
  // ISO-WKB: +1000 = Z, +2000 = M, +3000 = ZM; EWKB: Bit 31 = Z, Bit 30 = M.
  const base = rawType & 0xffff;
  const kind = base % 1000;
  const dimCode = Math.floor(base / 1000);
  const hasZ = dimCode === 1 || dimCode === 3 || (rawType & 0x80000000) !== 0;
  const hasM = dimCode === 2 || dimCode === 3 || (rawType & 0x40000000) !== 0;
  const stride = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);
  let off = start + 5;

  if (kind === 2) {
    const n = view.getUint32(off, little);
    off += 4;
    const coords = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      coords[i * 3] = view.getFloat64(off, little);
      coords[i * 3 + 1] = view.getFloat64(off + 8, little);
      coords[i * 3 + 2] = hasZ ? view.getFloat64(off + 16, little) : NaN;
      off += stride * 8;
    }
    if (n >= 2) out.push({ coords });
    return off;
  }
  if (kind === 5 || kind === 7) {
    const parts = view.getUint32(off, little);
    off += 4;
    for (let p = 0; p < parts; p++) off = readWkb(view, off, out);
    return off;
  }
  throw new Error(`GeoPackage: Geometrietyp ${rawType} wird nicht unterstützt`);
}

export interface TrailRow {
  category: string | null;
  lines: Line3D[];
}

/** Streamt die Wanderweg-Segmente (Kategorie + 3D-Geometrie) aus dem swisstopo-GeoPackage. */
export function* readTrailSegments(path: string): Generator<TrailRow> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const table = db
      .prepare("SELECT table_name AS t FROM gpkg_contents WHERE data_type = 'features' LIMIT 1")
      .get() as { t: string } | undefined;
    if (!table) throw new Error('GeoPackage: keine Feature-Tabelle gefunden');
    const geomCol = db
      .prepare('SELECT column_name AS c FROM gpkg_geometry_columns WHERE table_name = ?')
      .get(table.t) as { c: string } | undefined;
    if (!geomCol) throw new Error('GeoPackage: keine Geometriespalte gefunden');
    // Bezeichner stammen aus der Datei selbst: nur einfache Namen zulassen.
    for (const ident of [table.t, geomCol.c]) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) throw new Error(`GeoPackage: unerwarteter Bezeichner «${ident}»`);
    }
    const stmt = db.prepare(`SELECT "${geomCol.c}" AS geom, wanderwege AS category FROM "${table.t}"`);
    for (const row of stmt.iterate() as Iterable<{ geom: Uint8Array | null; category: string | null }>) {
      if (!row.geom) continue;
      yield { category: row.category, lines: parseGpkgLines(row.geom) };
    }
  } finally {
    db.close();
  }
}
