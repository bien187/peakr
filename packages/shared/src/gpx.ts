/**
 * Export einer Wanderroute als GPX 1.1 und Link in den swisstopo-Kartenviewer.
 *
 * Eine Implementierung für Browser (Download) und Server (Datei-URL für swisstopo),
 * damit beide Wege dieselbe Datei liefern. Erzeugt wird ausschliesslich aus den
 * gespeicherten Routendaten – fehlende Höhen bleiben fehlend, es wird nichts
 * geschätzt oder ergänzt.
 *
 * GPX 1.1: https://www.topografix.com/GPX/1/1/ (Reihenfolge der Elemente laut XSD).
 * Kartenviewer: https://docs.geo.admin.ch/map-viewer/url-parameters.html – externe
 * Dateien über `layers=GPX|<https-URL>` (Format laut ADR «url_param_structure» des
 * offiziellen Viewers geoadmin/web-mapviewer).
 */
import type { HikeRouteDetail } from './destination';
import { classLabel } from './labels';
import { wgs84ToLv95 } from './lv95';

export interface GpxPoint {
  lat: number;
  lng: number;
  /** Höhe in Metern; null/undefined = unbekannt (wird dann weggelassen). */
  ele?: number | null;
}

export interface GpxWaypoint extends GpxPoint {
  name: string;
  desc?: string | null;
  /** Symbolname (Garmin-Konvention, z. B. «Summit»); andere Programme ignorieren ihn. */
  sym?: string | null;
  type?: string | null;
}

export interface GpxDocument {
  name: string;
  desc?: string | null;
  /** Erstellungszeitpunkt der Datei (ISO 8601). */
  time?: string | null;
  link?: { href: string; text?: string } | null;
  copyright?: { author: string; license?: string } | null;
  keywords?: string | null;
  waypoints?: readonly GpxWaypoint[];
  track: readonly GpxPoint[];
  trackType?: string | null;
}

const validLat = (v: number): boolean => Number.isFinite(v) && v >= -90 && v <= 90;
/** GPX 1.1 lonType: −180 ≤ lon < 180. */
const validLng = (v: number): boolean => Number.isFinite(v) && v >= -180 && v < 180;
/** Werte ausserhalb dieses Bereichs sind Datenfehler und werden nicht ausgegeben. */
const validEle = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v >= -500 && v <= 9000;

const fmtCoord = (v: number): string => v.toFixed(6);
const fmtEle = (v: number): string => String(Math.round(v * 10) / 10);

/**
 * Entfernt ungültige Koordinaten und direkt aufeinanderfolgende Doppelpunkte
 * (gleiche Position auf 6 Nachkommastellen ≈ 0,1 m). Ungültige Höhen werden zu null.
 */
export function cleanTrack(points: readonly GpxPoint[]): GpxPoint[] {
  const out: GpxPoint[] = [];
  let lastKey = '';
  for (const p of points) {
    if (!p || !validLat(p.lat) || !validLng(p.lng)) continue;
    const key = `${fmtCoord(p.lat)},${fmtCoord(p.lng)}`;
    const ele = validEle(p.ele) ? p.ele : null;
    if (key === lastKey) {
      const prev = out[out.length - 1];
      if (prev.ele == null && ele != null) prev.ele = ele;
      continue;
    }
    lastKey = key;
    out.push({ lat: p.lat, lng: p.lng, ele });
  }
  return out;
}

// In XML 1.0 unzulässige Steuerzeichen (Tab, LF und CR sind erlaubt) – gewollt im Muster.
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function esc(s: string): string {
  return s
    .replace(XML_INVALID, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** ISO-Zeit ohne Millisekunden; ungültige Angaben entfallen. */
function xsdTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
}

/** Erzeugt eine GPX-1.1-Datei. Wirft, wenn weniger als zwei gültige Trackpunkte bleiben. */
export function buildGpx(doc: GpxDocument): string {
  const track = cleanTrack(doc.track);
  if (track.length < 2) throw new Error('Für eine GPX-Datei braucht es mindestens zwei gültige Trackpunkte.');
  const waypoints = (doc.waypoints ?? []).filter((w) => validLat(w.lat) && validLng(w.lng) && w.name.trim() !== '');

  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const p of [...track, ...waypoints]) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    '<gpx version="1.1" creator="Peakr" xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
  );

  // metadata: name, desc, author, copyright, link, time, keywords, bounds (Reihenfolge laut XSD)
  out.push('  <metadata>');
  out.push(`    <name>${esc(doc.name)}</name>`);
  if (doc.desc) out.push(`    <desc>${esc(doc.desc)}</desc>`);
  if (doc.copyright) {
    out.push(`    <copyright author="${esc(doc.copyright.author)}">`);
    if (doc.copyright.license) out.push(`      <license>${esc(doc.copyright.license)}</license>`);
    out.push('    </copyright>');
  }
  if (doc.link) {
    out.push(`    <link href="${esc(doc.link.href)}">`);
    if (doc.link.text) out.push(`      <text>${esc(doc.link.text)}</text>`);
    out.push('    </link>');
  }
  const time = xsdTime(doc.time);
  if (time) out.push(`    <time>${time}</time>`);
  if (doc.keywords) out.push(`    <keywords>${esc(doc.keywords)}</keywords>`);
  out.push(
    `    <bounds minlat="${fmtCoord(minLat)}" minlon="${fmtCoord(minLng)}" maxlat="${fmtCoord(maxLat)}" maxlon="${fmtCoord(maxLng)}"/>`,
  );
  out.push('  </metadata>');

  // wpt: ele, time, magvar, geoidheight, name, cmt, desc, src, link, sym, type …
  for (const w of waypoints) {
    out.push(`  <wpt lat="${fmtCoord(w.lat)}" lon="${fmtCoord(w.lng)}">`);
    if (validEle(w.ele)) out.push(`    <ele>${fmtEle(w.ele)}</ele>`);
    out.push(`    <name>${esc(w.name)}</name>`);
    if (w.desc) out.push(`    <desc>${esc(w.desc)}</desc>`);
    if (w.sym) out.push(`    <sym>${esc(w.sym)}</sym>`);
    if (w.type) out.push(`    <type>${esc(w.type)}</type>`);
    out.push('  </wpt>');
  }

  // trk: name, cmt, desc, src, link, number, type, extensions, trkseg
  out.push('  <trk>');
  out.push(`    <name>${esc(doc.name)}</name>`);
  if (doc.desc) out.push(`    <desc>${esc(doc.desc)}</desc>`);
  if (doc.trackType) out.push(`    <type>${esc(doc.trackType)}</type>`);
  out.push('    <trkseg>');
  for (const p of track) {
    out.push(
      validEle(p.ele)
        ? `      <trkpt lat="${fmtCoord(p.lat)}" lon="${fmtCoord(p.lng)}"><ele>${fmtEle(p.ele)}</ele></trkpt>`
        : `      <trkpt lat="${fmtCoord(p.lat)}" lon="${fmtCoord(p.lng)}"/>`,
    );
  }
  out.push('    </trkseg>');
  out.push('  </trk>');
  out.push('</gpx>');
  return out.join('\n') + '\n';
}

/** Dateiname `peakr_wanderroute_<name>.gpx`, nur Kleinbuchstaben, Ziffern und «_». */
export function gpxFileName(name: string): string {
  const slug = name
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/, '');
  return `peakr_wanderroute_${slug || 'route'}.gpx`;
}

// ── Wanderroute → GPX ────────────────────────────────────────────────────────

const KIND_TYPE: Record<string, string> = {
  peak: 'Gipfel',
  pass: 'Pass',
  hut: 'Hütte',
  lake: 'See',
  viewpoint: 'Aussichtspunkt',
};
const KIND_SYM: Record<string, string> = {
  peak: 'Summit',
  pass: 'Summit',
  hut: 'Lodge',
  viewpoint: 'Scenic Area',
};

/** Bezeichnung eines Ortes: amtliche Objektart (z. B. «Berggasthaus»), sonst die Zielart. */
function placeType(kind: string | null | undefined, objectClass: string | null | undefined): string | null {
  return classLabel(objectClass) ?? KIND_TYPE[kind ?? ''] ?? null;
}

/** Ausgangspunkt mit Namen; unbenannte über die Höhe unterscheidbar (wie in der App). */
export function trailheadName(t: HikeRouteDetail['trailhead']): string {
  if (t.name) return t.name;
  const base = t.kind === 'parking' ? 'Parkplatz' : t.kind === 'valley_station' ? 'Talstation' : 'Strassenzugang';
  return t.elevationM != null ? `${base} auf ${t.elevationM} m` : base;
}

function duration(min: number): string {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

function sacText(r: Pick<HikeRouteDetail, 'sacMin' | 'sacMax'>): string {
  if (!r.sacMax) return 'unbekannt';
  return r.sacMin && r.sacMin !== r.sacMax ? `${r.sacMin}–${r.sacMax}` : r.sacMax;
}

export interface RouteGpxInput {
  destination: {
    name: string;
    location: { lat: number; lng: number };
    elevationTopM: number | null;
    poiKind?: string | null;
    objectClass?: string | null;
  };
  route: Pick<
    HikeRouteDetail,
    | 'rank'
    | 'distanceKm'
    | 'ascentM'
    | 'descentM'
    | 'durationUpMin'
    | 'sacMin'
    | 'sacMax'
    | 'officialShare'
    | 'endGapM'
    | 'computedAt'
    | 'trailhead'
    | 'line'
    | 'elevations'
    | 'waypoints'
  >;
  /** Anzahl Varianten des Ziels; ab zwei steht die Variante im Dateinamen. */
  variantCount?: number;
  /** Adresse der Detailseite in Peakr für den Link in den Metadaten. */
  appUrl?: string | null;
  /** Erstellungszeitpunkt; Standard: jetzt. */
  time?: string;
}

export interface RouteGpx {
  fileName: string;
  xml: string;
  /** Anzahl Trackpunkte nach der Bereinigung. */
  trackPoints: number;
  /** Anteil der Trackpunkte mit Höhe, 0–1. */
  elevationShare: number;
}

/** Baut die GPX-Datei einer Peakr-Wanderroute (Track, Start, Ziel, Orte am Weg). */
export function routeGpx(input: RouteGpxInput): RouteGpx {
  const { destination: d, route: r } = input;
  const start = trailheadName(r.trailhead);
  const title = `${d.name} ab ${start}`;

  const elevations = r.elevations && r.elevations.length === r.line.length ? r.elevations : null;
  const track = cleanTrack(r.line.map(([lng, lat], i) => ({ lat, lng, ele: elevations ? elevations[i] : null })));
  const withEle = track.filter((p) => p.ele != null).length;
  const elevationShare = track.length > 0 ? withEle / track.length : 0;

  const desc = [
    `Wanderroute zu ${d.name}${d.elevationTopM != null ? ` (${d.elevationTopM} m)` : ''} ab ${start}.`,
    `${r.distanceKm.toFixed(1)} km, Aufstieg ${r.ascentM} m, Abstieg ${r.descentM} m,` +
      ` Gehzeit hin ${duration(r.durationUpMin)} (DIN 33466, ohne Pausen), Schwierigkeit ${sacText(r)},` +
      ` ${Math.round(r.officialShare * 100)} % auf signalisierten Wanderwegen.`,
    r.endGapM > 60 ? `Der erfasste Weg endet rund ${Math.round(r.endGapM / 10) * 10} m vor dem Zielpunkt.` : null,
    withEle === 0
      ? 'Ohne Höhenangaben je Trackpunkt.'
      : 'Höhen: amtliche Wegdaten swissTLM3D bzw. Geländemodell, am Ziel die amtliche Höhe.',
    'Aus dem Wegnetz berechnet (swisstopo-Wanderwege und OpenStreetMap), nicht begangen.' +
      ' Verhältnisse, Sperrungen und Ausrüstung vor der Tour selbst prüfen.',
    `Berechnet am ${r.computedAt.slice(0, 10)}. Daten: © swisstopo, © OpenStreetMap-Mitwirkende (ODbL).`,
  ]
    .filter(Boolean)
    .join(' ');

  const first = track[0];
  const waypoints: GpxWaypoint[] = [
    {
      lat: r.trailhead.location.lat,
      lng: r.trailhead.location.lng,
      ele: r.trailhead.elevationM,
      name: `Start: ${start}`,
      desc: r.trailhead.kind === 'parking' ? 'Parkplatz (Ausgangspunkt)' : 'Strassenzugang (Ausgangspunkt, Parkplatz nicht bestätigt)',
      sym: r.trailhead.kind === 'parking' ? 'Parking Area' : 'Trail Head',
      type: 'Start',
    },
    ...(r.waypoints ?? []).slice(0, 30).map((w) => {
      const type = placeType(w.kind, w.objectClass) ?? 'Ort';
      return {
        lat: w.location.lat,
        lng: w.location.lng,
        ele: w.elevationM,
        name: w.name,
        desc: `${type} am Weg, nach ${(w.alongM / 1000).toFixed(1)} km`,
        sym: KIND_SYM[w.kind ?? ''] ?? null,
        type,
      };
    }),
    {
      lat: d.location.lat,
      lng: d.location.lng,
      ele: d.elevationTopM,
      name: `Ziel: ${d.name}`,
      desc: placeType(d.poiKind, d.objectClass) ?? 'Ziel',
      sym: KIND_SYM[d.poiKind ?? ''] ?? 'Flag, Red',
      type: 'Ziel',
    },
  ];
  // Fehlt der Ausgangspunkt (kaputte Daten), dient der erste Trackpunkt als Start.
  if (!validLat(waypoints[0].lat) || !validLng(waypoints[0].lng)) {
    waypoints[0] = { ...waypoints[0], lat: first?.lat ?? NaN, lng: first?.lng ?? NaN, ele: first?.ele ?? null };
  }

  const variant = (input.variantCount ?? 1) > 1 ? ` Variante ${r.rank}` : '';
  const xml = buildGpx({
    name: title,
    desc,
    time: input.time ?? new Date().toISOString(),
    link: input.appUrl ? { href: input.appUrl, text: 'Peakr' } : null,
    copyright: { author: 'swisstopo, OpenStreetMap-Mitwirkende', license: 'https://www.openstreetmap.org/copyright' },
    keywords: 'Wanderung, Peakr, Schweiz',
    waypoints,
    track,
    trackType: 'hiking',
  });
  return { fileName: gpxFileName(`${d.name}${variant}`), xml, trackPoints: track.length, elevationShare };
}

// ── swisstopo-Kartenviewer ───────────────────────────────────────────────────

/** Auflösung (m/px) je Zoomstufe 0–13 des Viewers in LV95 (web-mapviewer, LV95_RESOLUTIONS). */
const LV95_RESOLUTIONS = [650, 500, 250, 100, 50, 20, 10, 5, 2.5, 2, 1, 0.5, 0.25, 0.1];
/** Zulässiger Bereich für `center` laut Dokumentation der URL-Parameter. */
const LV95_E = [2_450_000, 2_900_000] as const;
const LV95_N = [1_050_000, 1_350_000] as const;

/** Pfad der GPX-Datei einer Route (für den Viewer öffentlich per HTTPS abrufbar). */
export function routeGpxPath(destinationId: string, rank: number): string {
  return `/api/destinations/${encodeURIComponent(destinationId)}/routes/${rank}/gpx`;
}

/**
 * Nur öffentlich erreichbare HTTPS-Adressen ohne Zeichen, die im `layers`-Parameter
 * eine Bedeutung haben (`,` `;` `@` `|`) oder die Hash-Query brechen (`?` `&` `#` `=`).
 */
export function isViewerLoadableUrl(url: string): boolean {
  const m = /^https:\/\/([a-z0-9.-]+)(:\d+)?(\/[A-Za-z0-9\-._~/]*)?$/i.exec(url);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return !(
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

export interface SwisstopoLinkInput {
  /** Routenlinie [lng, lat]. */
  line: readonly [number, number][];
  /** Öffentliche HTTPS-Adresse der GPX-Datei; fehlt sie, zeigt der Link nur den Ausschnitt. */
  gpxUrl?: string | null;
  /** Fenstergrösse in Pixeln für die Wahl der Zoomstufe. */
  viewport?: { width: number; height: number };
  lang?: 'de' | 'fr' | 'it' | 'rm' | 'en';
}

export interface SwisstopoLink {
  url: string;
  /** true = die Route wird als GPX-Ebene übergeben. */
  withRoute: boolean;
}

/**
 * Link in map.geo.admin.ch mit amtlicher Landeskarte, Wanderwegnetz und – sofern
 * öffentlich abrufbar – der Route als GPX-Ebene. Ausschnitt und Zoom zeigen die
 * ganze Route.
 */
export function swisstopoLink(input: SwisstopoLinkInput): SwisstopoLink {
  const params = [`lang=${input.lang ?? 'de'}`];

  let minE = Infinity;
  let minN = Infinity;
  let maxE = -Infinity;
  let maxN = -Infinity;
  for (const [lng, lat] of input.line) {
    if (!validLat(lat) || !validLng(lng)) continue;
    const { e, n } = wgs84ToLv95(lat, lng);
    minE = Math.min(minE, e);
    maxE = Math.max(maxE, e);
    minN = Math.min(minN, n);
    maxN = Math.max(maxN, n);
  }
  if (Number.isFinite(minE)) {
    const e = Math.round((minE + maxE) / 2);
    const n = Math.round((minN + maxN) / 2);
    if (e >= LV95_E[0] && e <= LV95_E[1] && n >= LV95_N[0] && n <= LV95_N[1]) {
      // Kopfzeile und Seitenmenü des Viewers abziehen, 15 % Rand lassen.
      const vw = Math.max(320, input.viewport?.width ?? 1200) * 0.85;
      const vh = Math.max(320, (input.viewport?.height ?? 800) - 140) * 0.85;
      let z = 0;
      for (let i = 0; i < LV95_RESOLUTIONS.length; i++) {
        if ((maxE - minE) / LV95_RESOLUTIONS[i] <= vw && (maxN - minN) / LV95_RESOLUTIONS[i] <= vh) z = i;
        else break;
      }
      // Nicht näher als 1 m/px heranzoomen (sehr kurze Routen).
      params.push(`center=${e},${n}`, `z=${Math.min(z, 10)}`);
    }
  }

  params.push('bgLayer=ch.swisstopo.pixelkarte-farbe');
  const layers = ['ch.swisstopo.swisstlm3d-wanderwege'];
  const withRoute = !!input.gpxUrl && isViewerLoadableUrl(input.gpxUrl);
  if (withRoute) layers.push(`GPX|${input.gpxUrl}`);
  params.push(`layers=${layers.join(';')}`);

  return { url: `https://map.geo.admin.ch/#/map?${params.join('&')}`, withRoute };
}
