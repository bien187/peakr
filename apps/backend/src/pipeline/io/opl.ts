import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * Leser für das OPL-Textformat von osmium («Object Per Line»), erzeugt mit
 *   osmium add-locations-to-ways … -f opl,add_metadata=false
 * Wege enthalten dadurch ihre Knoten samt Koordinaten; die Topologie bleibt über
 * die OSM-Knoten-IDs exakt erhalten.
 */

export interface OplNode {
  id: number;
  lat: number;
  lng: number;
  tags: Record<string, string>;
}

export interface OplWay {
  id: number;
  tags: Record<string, string>;
  /** OSM-Knoten-IDs in Wegrichtung. */
  nodeIds: number[];
  lats: number[];
  lngs: number[];
}

const ESCAPE = /%([0-9a-fA-F]+)%/g;
function unescape(s: string): string {
  return s.indexOf('%') === -1
    ? s
    : s.replace(ESCAPE, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

export function parseTags(field: string): Record<string, string> {
  const tags: Record<string, string> = {};
  if (field.length === 0) return tags;
  for (const pair of field.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    tags[unescape(pair.slice(0, eq))] = unescape(pair.slice(eq + 1));
  }
  return tags;
}

export function parseOplLine(line: string): OplNode | OplWay | null {
  const kind = line.charCodeAt(0);
  if (kind !== 110 /* n */ && kind !== 119 /* w */) return null;
  const fields = line.split(' ');
  const id = Number(fields[0].slice(1));
  let tagField = '';
  let nodesField = '';
  let x = NaN;
  let y = NaN;
  for (let i = 1; i < fields.length; i++) {
    const f = fields[i];
    const c = f.charCodeAt(0);
    if (c === 84 /* T */) tagField = f.slice(1);
    else if (c === 78 /* N */) nodesField = f.slice(1);
    else if (c === 120 /* x */) x = Number(f.slice(1));
    else if (c === 121 /* y */) y = Number(f.slice(1));
  }

  if (kind === 110) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { id, lat: y, lng: x, tags: parseTags(tagField) };
  }

  const nodeIds: number[] = [];
  const lats: number[] = [];
  const lngs: number[] = [];
  if (nodesField.length > 0) {
    for (const ref of nodesField.split(',')) {
      // Form: n<ID>x<lng>y<lat>; Knoten ohne Koordinate (ausserhalb des Auszugs) werden übersprungen.
      const xi = ref.indexOf('x');
      const yi = ref.indexOf('y', xi + 1);
      if (xi === -1 || yi === -1) continue;
      const lng = Number(ref.slice(xi + 1, yi));
      const lat = Number(ref.slice(yi + 1));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      nodeIds.push(Number(ref.slice(1, xi)));
      lats.push(lat);
      lngs.push(lng);
    }
  }
  return { id, tags: parseTags(tagField), nodeIds, lats, lngs };
}

export function isOplWay(o: OplNode | OplWay): o is OplWay {
  return 'nodeIds' in o;
}

/** Streamt eine OPL-Datei zeilenweise. */
export async function* readOpl(path: string): AsyncGenerator<OplNode | OplWay> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const parsed = parseOplLine(line);
    if (parsed) yield parsed;
  }
}
