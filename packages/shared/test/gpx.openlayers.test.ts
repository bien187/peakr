// @vitest-environment jsdom
/**
 * Der swisstopo-Kartenviewer (map.geo.admin.ch) liest GPX mit OpenLayers
 * (`ol/format/GPX`, Version wie im Viewer). OpenLayers braucht die DOM-API eines
 * Browsers – deshalb läuft dieser Test in jsdom.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import GPX from 'ol/format/GPX.js';
import type MultiLineString from 'ol/geom/MultiLineString.js';
import type Point from 'ol/geom/Point.js';
import { describe, expect, it } from 'vitest';
import type { HikeRouteDetail } from '../src/destination';
import { routeGpx, type RouteGpxInput } from '../src/gpx';

const here = dirname(fileURLToPath(import.meta.url));
const rigi = JSON.parse(readFileSync(join(here, 'fixtures/rigi-kulm-route.json'), 'utf8')) as {
  destination: RouteGpxInput['destination'];
  route: HikeRouteDetail;
  variantCount: number;
};

describe('GPX im Parser des swisstopo-Kartenviewers (OpenLayers)', () => {
  const out = routeGpx({ ...rigi, appUrl: 'https://peakr-ch.vercel.app', time: '2026-11-13T10:00:00Z' });
  const format = new GPX();
  const features = format.readFeatures(out.xml);

  it('liest den Track vollständig, mit lon/lat/Höhe in der richtigen Reihenfolge', () => {
    const trk = features.find((f) => f.getGeometry()?.getType() === 'MultiLineString');
    expect(trk?.get('name')).toBe(`Rigi Kulm ab ${rigi.route.trailhead.name ?? `Parkplatz auf ${rigi.route.trailhead.elevationM} m`}`);
    const lines = (trk!.getGeometry() as MultiLineString).getLineStrings();
    expect(lines).toHaveLength(1); // ein Segment, keine Lücken
    const coords = lines[0].getCoordinates();
    expect(coords).toHaveLength(out.trackPoints);
    const last = rigi.route.line[rigi.route.line.length - 1];
    expect(coords[0][0]).toBeCloseTo(rigi.route.line[0][0], 6); // lon
    expect(coords[0][1]).toBeCloseTo(rigi.route.line[0][1], 6); // lat
    expect(coords[0][2]).toBe(rigi.route.elevations?.[0]); // Höhe
    expect(coords[coords.length - 1][0]).toBeCloseTo(last[0], 6);
    expect(coords[coords.length - 1][2]).toBe(1797); // amtliche Gipfelhöhe am Ziel
  });

  it('liest Start, Orte am Weg und Ziel als benannte Punkte', () => {
    const points = features.filter((f) => f.getGeometry()?.getType() === 'Point');
    const names = points.map((p) => p.get('name') as string);
    expect(names[0]).toMatch(/^Start: /);
    expect(names).toContain('Rigi Kulm Hotel');
    expect(names[names.length - 1]).toBe('Ziel: Rigi Kulm');
    const goal = (points[points.length - 1].getGeometry() as Point).getCoordinates();
    expect(goal[0]).toBeCloseTo(rigi.destination.location.lng, 6);
    expect(goal[1]).toBeCloseTo(rigi.destination.location.lat, 6);
  });

  it('liest die Metadaten, aus denen der Viewer den Ebenennamen bildet', () => {
    expect(format.readMetadata(out.xml)?.name).toMatch(/^Rigi Kulm ab /);
  });
});
