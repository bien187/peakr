import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gpx as toGeoJson } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import type { HikeRouteDetail } from '../src/destination';
import {
  buildGpx,
  cleanTrack,
  gpxFileName,
  isViewerLoadableUrl,
  routeGpx,
  routeGpxAppPath,
  routeGpxPath,
  swisstopoAndroidIntent,
  swisstopoAppUrl,
  swisstopoLink,
  type GpxPoint,
  type RouteGpxInput,
} from '../src/gpx';
import { lv95ToWgs84 } from '../src/lv95';

const here = dirname(fileURLToPath(import.meta.url));
const XSD = join(here, 'gpx-1.1.xsd');

/** Echte Peakr-Route (Rigi Kulm, Variante 1) aus dem Datenaufbau, siehe fixtures/README.md. */
const rigi = JSON.parse(readFileSync(join(here, 'fixtures/rigi-kulm-route.json'), 'utf8')) as {
  destination: RouteGpxInput['destination'] & { id: string };
  route: HikeRouteDetail;
  variantCount: number;
};

const hasXmllint = (() => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Prüft eine GPX-Datei mit xmllint gegen das offizielle GPX-1.1-Schema. */
function validateAgainstXsd(xml: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'peakr-gpx-'));
  const file = join(dir, 'route.gpx');
  writeFileSync(file, xml);
  // wirft bei Schemafehlern (Exit-Code ≠ 0) samt Meldung
  execFileSync('xmllint', ['--noout', '--schema', XSD, file], { stdio: 'pipe' });
}

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml');
const trkpts = (xml: string) => [...xml.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"(?:\/>|><ele>([^<]+)<\/ele><\/trkpt>)/g)];

const simple = (pts: GpxPoint[]) => buildGpx({ name: 'Test', track: pts, time: '2026-11-13T10:00:00Z' });

describe('buildGpx', () => {
  it('erzeugt GPX 1.1 mit Namespace, Metadaten und Grenzen', () => {
    const xml = simple([
      { lat: 47.1, lng: 8.5, ele: 1000 },
      { lat: 47.2, lng: 8.6, ele: 1100 },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Peakr"')).toBe(true);
    expect(xml).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(xml).toContain('<time>2026-11-13T10:00:00Z</time>');
    expect(xml).toContain('<bounds minlat="47.100000" minlon="8.500000" maxlat="47.200000" maxlon="8.600000"/>');
  });

  it('schreibt lat und lon korrekt (nicht vertauscht) mit 6 Nachkommastellen', () => {
    const xml = simple([
      { lat: 46.012345678, lng: 7.6543219 },
      { lat: 46.1, lng: 7.7 },
    ]);
    const [first] = trkpts(xml);
    expect(first[1]).toBe('46.012346');
    expect(first[2]).toBe('7.654322');
  });

  it('übernimmt den ganzen Track in Reihenfolge', () => {
    const pts = Array.from({ length: 500 }, (_, i) => ({ lat: 46.5 + i * 1e-4, lng: 8 + i * 2e-4, ele: 1500 + i }));
    const got = trkpts(simple(pts));
    expect(got).toHaveLength(500);
    expect(Number(got[0][1])).toBeCloseTo(46.5, 6);
    expect(Number(got[499][2])).toBeCloseTo(8 + 499 * 2e-4, 6);
    expect(got.map((m) => Number(m[3]))).toEqual(pts.map((p) => p.ele));
  });

  it('entfernt direkt aufeinanderfolgende Doppelpunkte, behält aber Rundwege', () => {
    const a = { lat: 46.5, lng: 8.1, ele: 1000 };
    const b = { lat: 46.51, lng: 8.11, ele: 1100 };
    const got = trkpts(simple([a, { ...a }, b, { ...b, lat: b.lat + 1e-8 }, a]));
    expect(got.map((m) => `${m[1]},${m[2]}`)).toEqual(['46.500000,8.100000', '46.510000,8.110000', '46.500000,8.100000']);
  });

  it('verwirft ungültige Koordinaten', () => {
    const got = cleanTrack([
      { lat: NaN, lng: 8 },
      { lat: 46.5, lng: Infinity },
      { lat: 95, lng: 8 },
      { lat: 46.5, lng: 180 }, // GPX: lon < 180
      { lat: 46.5, lng: 8.2 },
      { lat: 46.6, lng: 8.3 },
    ]);
    expect(got).toEqual([
      { lat: 46.5, lng: 8.2, ele: null },
      { lat: 46.6, lng: 8.3, ele: null },
    ]);
  });

  it('gibt nur vorhandene, plausible Höhen aus und erfindet keine', () => {
    const xml = simple([
      { lat: 46.5, lng: 8.1, ele: 1203.44 },
      { lat: 46.51, lng: 8.11, ele: null },
      { lat: 46.52, lng: 8.12, ele: NaN },
      { lat: 46.53, lng: 8.13, ele: 99_999 },
      { lat: 46.54, lng: 8.14 },
      { lat: 46.55, lng: 8.15, ele: 1300 },
    ]);
    const got = trkpts(xml);
    expect(got).toHaveLength(6);
    expect(got.map((m) => m[3] ?? null)).toEqual(['1203.4', null, null, null, null, '1300']);
  });

  it('kommt ganz ohne Höhen aus', () => {
    const xml = simple([
      { lat: 46.5, lng: 8.1 },
      { lat: 46.6, lng: 8.2 },
    ]);
    expect(xml).not.toContain('<ele>');
  });

  it('verlangt mindestens zwei gültige Punkte', () => {
    expect(() => simple([{ lat: 46.5, lng: 8.1 }])).toThrow();
    expect(() => simple([{ lat: 46.5, lng: 8.1 }, { lat: 46.5, lng: 8.1 }])).toThrow();
  });

  it('maskiert Sonderzeichen und entfernt in XML verbotene Steuerzeichen', () => {
    const xml = buildGpx({
      name: 'Hütte <Süd> & "Nord" \u0007\'s',
      desc: 'a < b & c',
      track: [
        { lat: 46.5, lng: 8.1 },
        { lat: 46.6, lng: 8.2 },
      ],
      waypoints: [{ lat: 46.55, lng: 8.15, name: 'Pass & Joch' }],
    });
    expect(xml).toContain('<name>Hütte &lt;Süd&gt; &amp; &quot;Nord&quot; &apos;s</name>');
    expect(xml).toContain('<name>Pass &amp; Joch</name>');
    expect(xml).not.toContain('\u0007');
    expect(parseXml(xml).getElementsByTagName('parsererror').length).toBe(0);
  });

  it.skipIf(!hasXmllint)('ist gültig gegen das GPX-1.1-Schema (xmllint)', () => {
    expect(() =>
      validateAgainstXsd(
        buildGpx({
          name: 'Schema & Test',
          desc: 'Beschreibung',
          time: '2026-11-13T10:00:00.123Z',
          link: { href: 'https://peakr-ch.vercel.app', text: 'Peakr' },
          copyright: { author: 'swisstopo, OpenStreetMap-Mitwirkende', license: 'https://www.openstreetmap.org/copyright' },
          keywords: 'Wanderung',
          waypoints: [{ lat: 46.5, lng: 8.1, ele: 1000, name: 'Start', desc: 'Parkplatz', sym: 'Parking Area', type: 'Start' }],
          track: [
            { lat: 46.5, lng: 8.1, ele: 1000 },
            { lat: 46.6, lng: 8.2 },
          ],
          trackType: 'hiking',
        }),
      ),
    ).not.toThrow();
  });
});

describe('gpxFileName', () => {
  it.each([
    ['Rigi Kulm', 'peakr_wanderroute_rigi_kulm.gpx'],
    ['Säntis', 'peakr_wanderroute_saentis.gpx'],
    ['Piz Palü / Bellavista', 'peakr_wanderroute_piz_palue_bellavista.gpx'],
    ["Dent d'Hérens", 'peakr_wanderroute_dent_d_herens.gpx'],
    ['Großer Mythen', 'peakr_wanderroute_grosser_mythen.gpx'],
    ['../../etc/passwd', 'peakr_wanderroute_etc_passwd.gpx'],
    ['🏔️ Gipfel 2 ', 'peakr_wanderroute_gipfel_2.gpx'],
    ['', 'peakr_wanderroute_route.gpx'],
    ['***', 'peakr_wanderroute_route.gpx'],
  ])('%s → %s', (name, expected) => {
    expect(gpxFileName(name)).toBe(expected);
  });

  it('kürzt lange Namen und lässt nur sichere Zeichen zu', () => {
    const f = gpxFileName('A'.repeat(200) + ' Ende');
    expect(f).toMatch(/^peakr_wanderroute_[a-z0-9_]{1,60}\.gpx$/);
  });
});

describe('routeGpx (echte Route)', () => {
  const input: RouteGpxInput = { ...rigi, appUrl: 'https://peakr-ch.vercel.app', time: '2026-11-13T10:00:00Z' };
  const out = routeGpx(input);

  it('enthält den vollständigen Track mit den gespeicherten Höhen', () => {
    const expected = cleanTrack(rigi.route.line.map(([lng, lat], i) => ({ lat, lng, ele: rigi.route.elevations?.[i] ?? null })));
    const got = trkpts(out.xml);
    expect(got).toHaveLength(expected.length);
    expect(out.trackPoints).toBe(expected.length);
    got.forEach((m, i) => {
      expect(Number(m[1])).toBeCloseTo(expected[i].lat, 6);
      expect(Number(m[2])).toBeCloseTo(expected[i].lng, 6);
      expect(m[3] == null ? null : Number(m[3])).toBe(expected[i].ele == null ? null : Math.round(expected[i].ele! * 10) / 10);
    });
    expect(out.elevationShare).toBeGreaterThan(0.95);
  });

  it('setzt Start, Orte am Weg und Ziel als benannte Wegpunkte', () => {
    const names = [...out.xml.matchAll(/<wpt [^>]+>[\s\S]*?<name>([^<]+)<\/name>/g)].map((m) => m[1]);
    expect(names[0]).toMatch(/^Start: /);
    expect(names[names.length - 1]).toBe('Ziel: Rigi Kulm');
    expect(names.slice(1, -1)).toEqual((rigi.route.waypoints ?? []).map((w) => w.name.replace(/&/g, '&amp;')));
  });

  it('beschreibt die Route und nennt die Quellen', () => {
    expect(out.xml).toContain(`${rigi.route.distanceKm.toFixed(1)} km, Aufstieg ${rigi.route.ascentM} m`);
    expect(out.xml).toContain('DIN 33466');
    expect(out.xml).toContain('© swisstopo, © OpenStreetMap-Mitwirkende (ODbL)');
    expect(out.xml).toContain('<link href="https://peakr-ch.vercel.app">');
  });

  it('benennt die Datei nach dem Ziel, bei mehreren Varianten mit Variante', () => {
    expect(routeGpx({ ...input, variantCount: 1 }).fileName).toBe('peakr_wanderroute_rigi_kulm.gpx');
    expect(routeGpx({ ...input, variantCount: 3 }).fileName).toBe('peakr_wanderroute_rigi_kulm_variante_1.gpx');
  });

  it('lässt fehlende Höhen weg statt sie zu ergänzen', () => {
    const noEle = routeGpx({ ...input, route: { ...rigi.route, elevations: null } });
    expect(noEle.xml).not.toMatch(/<trkpt[^>]*><ele>/);
    expect(noEle.xml).toContain('Ohne Höhenangaben je Trackpunkt.');
    expect(noEle.elevationShare).toBe(0);
    // Höhen, die nicht zu den Punkten passen, werden ebenfalls nicht verwendet.
    const mismatch = routeGpx({ ...input, route: { ...rigi.route, elevations: [1000, 1001] } });
    expect(mismatch.elevationShare).toBe(0);
  });

  it.skipIf(!hasXmllint)('ist gültig gegen das GPX-1.1-Schema (xmllint)', () => {
    expect(() => validateAgainstXsd(out.xml)).not.toThrow();
  });

  it('entspricht der Referenzdatei (Änderungen am Format werden sichtbar)', async () => {
    await expect(out.xml).toMatchFileSnapshot('./fixtures/rigi-kulm-route.gpx');
  });

  it('wird von togeojson gelesen (verbreitet in Web-Kartenviewern)', () => {
    const fc = toGeoJson(parseXml(out.xml) as unknown as Document);
    const track = fc.features.find((f) => f.geometry?.type === 'LineString');
    const points = fc.features.filter((f) => f.geometry?.type === 'Point');
    expect(track?.properties?.name).toBe(out.xml.match(/<trk>\s*<name>([^<]+)/)?.[1]);
    const coords = (track!.geometry as GeoJSON.LineString).coordinates;
    expect(coords).toHaveLength(out.trackPoints);
    expect(coords[0][0]).toBeCloseTo(rigi.route.line[0][0], 6); // lon
    expect(coords[0][1]).toBeCloseTo(rigi.route.line[0][1], 6); // lat
    expect(points.map((p) => p.properties?.name)).toContain('Ziel: Rigi Kulm');
  });
});

describe('swisstopo-Link', () => {
  const gpxUrl = `https://peakr-ch.vercel.app${routeGpxPath(rigi.destination.id, 1)}`;
  const { url, withRoute } = swisstopoLink({ line: rigi.route.line, gpxUrl, viewport: { width: 1280, height: 800 } });
  const query = new URLSearchParams(url.split('#/map?')[1]);

  it('öffnet den offiziellen Viewer mit dokumentierten Parametern', () => {
    expect(url.startsWith('https://map.geo.admin.ch/#/map?')).toBe(true);
    expect([...query.keys()].sort()).toEqual(['bgLayer', 'center', 'lang', 'layers', 'z']);
    expect(query.get('bgLayer')).toBe('ch.swisstopo.pixelkarte-farbe');
    expect(query.get('lang')).toBe('de');
  });

  it('übergibt die Route als GPX-Ebene neben dem Wanderwegnetz', () => {
    expect(withRoute).toBe(true);
    // Zerlegung wie im Viewer (layersParamParser): «;» trennt Ebenen, «|» Typ und URL.
    const layers = query.get('layers')!.split(';').map((l) => l.split(','));
    expect(layers.map((l) => l[0])).toEqual(['ch.swisstopo.swisstlm3d-wanderwege', `GPX|${gpxUrl}`]);
    const [type, fileUrl] = layers[1][0].split('|');
    expect(type).toBe('GPX');
    expect(fileUrl).toBe(gpxUrl);
  });

  it('zentriert auf die Route (LV95) mit passender Zoomstufe', () => {
    const [e, n] = query.get('center')!.split(',').map(Number);
    expect(e).toBeGreaterThan(2_450_000);
    expect(n).toBeLessThan(1_350_000);
    const c = lv95ToWgs84(e, n);
    const lats = rigi.route.line.map((p) => p[1]);
    const lngs = rigi.route.line.map((p) => p[0]);
    expect(c.lat).toBeGreaterThanOrEqual(Math.min(...lats));
    expect(c.lat).toBeLessThanOrEqual(Math.max(...lats));
    expect(c.lng).toBeGreaterThanOrEqual(Math.min(...lngs));
    expect(c.lng).toBeLessThanOrEqual(Math.max(...lngs));
    const z = Number(query.get('z'));
    expect(z).toBeGreaterThanOrEqual(4);
    expect(z).toBeLessThanOrEqual(10);
    // Auf dem Handy (schmaler) nie näher als auf dem Desktop.
    const mobile = new URLSearchParams(
      swisstopoLink({ line: rigi.route.line, gpxUrl, viewport: { width: 390, height: 844 } }).url.split('#/map?')[1],
    );
    expect(Number(mobile.get('z'))).toBeLessThanOrEqual(z);
  });

  it('übergibt keine Route, die swisstopo nicht laden kann', () => {
    for (const bad of [
      'http://peakr-ch.vercel.app/x.gpx',
      'https://localhost:3000/x.gpx',
      'https://192.168.1.5/x.gpx',
      'https://peakr-ch.vercel.app/x.gpx?rank=1',
      'https://peakr-ch.vercel.app/a,b.gpx',
      'https://peakr-ch.vercel.app/a;b.gpx',
      'https://user@peakr-ch.vercel.app/x.gpx',
    ]) {
      expect(isViewerLoadableUrl(bad), bad).toBe(false);
      const link = swisstopoLink({ line: rigi.route.line, gpxUrl: bad });
      expect(link.withRoute).toBe(false);
      expect(link.url).not.toContain('GPX|');
    }
    expect(isViewerLoadableUrl(gpxUrl)).toBe(true);
  });
});

describe('swisstopo-App', () => {
  it('Routen-Link genau wie im Beispiel von swisstopo («QR-Codes für Touren»)', () => {
    expect(swisstopoAppUrl('https://cms.geo.admin.ch/fmc/Riederhorn.gpx')).toBe(
      'https://swisstopo.app/u/aHR0cHM6Ly9jbXMuZ2VvLmFkbWluLmNoL2ZtYy9SaWVkZXJob3JuLmdweA',
    );
  });

  it('Peakr-GPX-Adresse: nur Buchstaben und Ziffern im Pfad; zurückgerechnet die GPX-Adresse', () => {
    const gpx = `https://peakr-ch.vercel.app${routeGpxPath(rigi.destination.id, 1)}`;
    const url = swisstopoAppUrl(gpx)!;
    const code = url.replace('https://swisstopo.app/u/', '');
    expect(code).toMatch(/^[A-Za-z0-9]+$/);
    expect(Buffer.from(code, 'base64').toString('utf8')).toBe(gpx);
  });

  it('nur öffentliche HTTPS-Adressen', () => {
    expect(swisstopoAppUrl('http://peakr-ch.vercel.app/x.gpx')).toBeNull();
    expect(swisstopoAppUrl('https://localhost:3000/x.gpx')).toBeNull();
    expect(swisstopoAppUrl('https://192.168.1.5/x.gpx')).toBeNull();
  });

  it('Android: App-Link als Intent mit Webkarte als Ausweich', () => {
    const app = 'https://swisstopo.app/u/aHR0cHM6Ly9jbXMuZ2VvLmFkbWluLmNoL2ZtYy9SaWVkZXJob3JuLmdweA';
    const web = 'https://map.geo.admin.ch/#/map?lang=de&layers=a;b';
    const intent = swisstopoAndroidIntent(app, web);
    expect(intent).toBe(
      'intent://swisstopo.app/u/aHR0cHM6Ly9jbXMuZ2VvLmFkbWluLmNoL2ZtYy9SaWVkZXJob3JuLmdweA' +
        '#Intent;scheme=https;package=ch.admin.swisstopo;' +
        `S.browser_fallback_url=${encodeURIComponent(web)};end`,
    );
    // Ausweich-Adresse ohne «;» und «#», die den Intent beenden würden
    const fb = intent.split('S.browser_fallback_url=')[1].replace(/;end$/, '');
    expect(fb).not.toMatch(/[;#]/);
    expect(decodeURIComponent(fb)).toBe(web);
  });

  it('GPX nennt der swisstopo-App die Tourenart Wandern (Erweiterung wie in deren eigenen GPX-Dateien)', () => {
    const out = routeGpx({ ...rigi, appUrl: null, time: '2026-11-13T10:00:00Z' });
    expect(out.xml).toContain('xmlns:swisstopo="https://prod-static.swisstopo-app.ch/xmlschemas/SwisstopoExtensions"');
    expect(out.xml).toMatch(/<extensions>\s*<swisstopo:tour_type>0<\/swisstopo:tour_type>\s*<\/extensions>\s*<\/metadata>/);
  });
});

/**
 * Format der swisstopo-App – abgeleitet aus deren eigener Beispieldatei
 * (https://cms.geo.admin.ch/fmc/Riederhorn.gpx, verlinkt unter «QR-Codes für Touren»):
 * jeder Trackpunkt mit swisstopo:routepoint_id; jeder Wegpunkt liegt genau auf einem
 * Trackpunkt und trägt waypoint_id, waypoint_routepoint_id, waypoint_meters_into_tour,
 * waypoint_is_controlpoint (1) und – am Ziel mit Werten – waypoint_stage_before.
 */
describe('GPX für die swisstopo-App (Routen-Link)', () => {
  const out = routeGpx({ ...rigi, appUrl: 'https://peakr-ch.vercel.app/destinations/x', time: '2026-11-13T10:00:00Z', swisstopoApp: true });
  const xml = out.xml;
  const doc = parseXml(xml);
  const NS = 'https://prod-static.swisstopo-app.ch/xmlschemas/SwisstopoExtensions';
  const pts = [...doc.getElementsByTagName('trkpt')].map((t) => ({
    lat: t.getAttribute('lat'),
    lon: t.getAttribute('lon'),
    id: Number(t.getElementsByTagNameNS(NS, 'routepoint_id')[0]?.textContent),
  }));
  const wpts = [...doc.getElementsByTagName('wpt')].map((w) => {
    const ext = w.getElementsByTagName('extensions')[0];
    const kids = ext ? [...ext.childNodes].filter((n) => n.nodeType === 1).map((n) => (n as unknown as { localName: string }).localName) : [];
    const val = (name: string) => w.getElementsByTagNameNS(NS, name)[0];
    const stage = val('waypoint_stage_before');
    return {
      name: w.getElementsByTagName('name')[0]?.textContent ?? '',
      lat: w.getAttribute('lat'),
      lon: w.getAttribute('lon'),
      kids,
      id: Number(val('waypoint_id')?.textContent),
      ref: Number(val('waypoint_routepoint_id')?.textContent),
      meters: Number(val('waypoint_meters_into_tour')?.textContent),
      control: val('waypoint_is_controlpoint')?.textContent,
      stage: stage
        ? Object.fromEntries(['distance', 'duration', 'ascent', 'descent'].map((k) => [k, Number(stage.getAttribute(k))]))
        : null,
    };
  });

  it('jeder Trackpunkt hat eine eindeutige Routenpunkt-ID', () => {
    expect(pts.length).toBe(out.trackPoints);
    expect(pts.map((p) => p.id)).toEqual(pts.map((_, i) => i + 1));
  });

  it('Start, Orte am Weg und Ziel liegen genau auf ihrem Routenpunkt, in Gehrichtung', () => {
    expect(wpts[0].name).toMatch(/^Start: /);
    expect(wpts[wpts.length - 1].name).toBe('Ziel: Rigi Kulm');
    expect(wpts.length).toBeGreaterThan(2);
    for (const w of wpts) {
      const p = pts[w.ref - 1];
      expect(p, w.name).toBeDefined();
      expect([w.lat, w.lon]).toEqual([p.lat, p.lon]);
    }
    expect(wpts[0].ref).toBe(1);
    expect(wpts[wpts.length - 1].ref).toBe(pts.length);
    const meters = wpts.map((w) => w.meters);
    expect(meters[0]).toBe(0);
    expect([...meters].sort((a, b) => a - b)).toEqual(meters);
    expect(wpts.map((w) => w.id)).toEqual(wpts.map((_, i) => i + 1));
  });

  it('Erweiterungen wie in den Dateien der App: Reihenfolge, Kontrollpunkt, Etappe am Ziel', () => {
    for (const w of wpts) {
      expect(w.control).toBe('1');
      expect(w.kids.slice(0, 4)).toEqual(['waypoint_id', 'waypoint_routepoint_id', 'waypoint_meters_into_tour', 'waypoint_is_controlpoint']);
    }
    expect(wpts[0].stage).toBeNull();
    for (const w of wpts.slice(1, -1)) expect(w.stage).toEqual({ distance: 0, duration: 0, ascent: 0, descent: 0 });
    const goal = wpts[wpts.length - 1];
    expect(goal.stage!.distance).toBeCloseTo(goal.meters, 3);
    expect(goal.stage!.distance / 1000).toBeGreaterThan(rigi.route.distanceKm * 0.95);
    expect(goal.stage!.distance / 1000).toBeLessThan(rigi.route.distanceKm * 1.08);
    expect(goal.stage!.duration).toBe(rigi.route.durationUpMin * 60);
    expect(goal.stage!.ascent).toBe(rigi.route.ascentM);
    expect(goal.stage!.descent).toBe(rigi.route.descentM);
    expect(xml).toContain('<swisstopo:tour_type>0</swisstopo:tour_type>');
  });

  it.skipIf(!hasXmllint)('bleibt gültig gegen das GPX-1.1-Schema (xmllint)', () => {
    expect(() => validateAgainstXsd(xml)).not.toThrow();
  });

  it('Download/Webkarte bleiben unverändert: Start, Orte und Ziel an ihrer echten Lage, ohne Routenpunkt-IDs', () => {
    const plain = routeGpx({ ...rigi, appUrl: null, time: '2026-11-13T10:00:00Z' }).xml;
    expect(plain).not.toContain('swisstopo:routepoint_id');
    expect(plain).not.toContain('swisstopo:waypoint_id');
  });

  it('eigene Adresse für die App, sicher im Routen-Link', () => {
    const path = routeGpxAppPath(rigi.destination.id, 2);
    expect(path).toBe(`/api/destinations/${rigi.destination.id}/routes/2/gpx/swisstopo`);
    expect(swisstopoAppUrl(`https://peakr-ch.vercel.app${path}`)).toMatch(/^https:\/\/swisstopo\.app\/u\/[A-Za-z0-9]+$/);
  });
});
