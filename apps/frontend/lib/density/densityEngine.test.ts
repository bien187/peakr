import { describe, expect, it } from 'vitest';
import {
  buildDensityModel,
  densityAt,
  hotspotAt,
  intensityAt,
  intensityExpression,
  MAX_INTENSITY,
  metersPerPixel,
  preparePoints,
  radiusExpression,
  radiusKm,
  radiusPx,
  VISIBLE_DENSITY,
  type DensityPoint,
} from './densityEngine';

// ── Testdaten ────────────────────────────────────────────────────────────────

/** Reproduzierbarer Zufall (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KM_LAT = 1 / 110.57;
const KM_LNG = 1 / (111.32 * Math.cos((46.8 * Math.PI) / 180));

/** Ziele normalverteilt um einen Ort (Streuung in km). */
function cluster(prefix: string, lat: number, lng: number, n: number, spreadKm: number, rand: () => number, kind = 'peak'): DensityPoint[] {
  const out: DensityPoint[] = [];
  for (let i = 0; i < n; i++) {
    // Box-Muller
    const r = Math.sqrt(-2 * Math.log(1 - rand())) * spreadKm;
    const a = rand() * 2 * Math.PI;
    out.push({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, lat: lat + r * Math.sin(a) * KM_LAT, lng: lng + r * Math.cos(a) * KM_LNG, kind, weight: 1 });
  }
  return out;
}

function scatter(prefix: string, n: number, rand: () => number): DensityPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `${prefix} ${i}`,
    lat: 45.9 + rand() * 1.8,
    lng: 6.0 + rand() * 4.4,
    kind: 'hut',
    weight: 1,
  }));
}

const INTERLAKEN = { lat: 46.686, lng: 7.863 };
const ENGELBERG = { lat: 46.82, lng: 8.4 };

function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.hypot((a.lat - b.lat) / KM_LAT, (a.lng - b.lng) / KM_LNG);
}

// ── Radius ───────────────────────────────────────────────────────────────────

describe('Radius: geografisch, nicht als feste Pixelgrösse', () => {
  it('Meter je Pixel wie MapLibre (512-px-Kacheln)', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78_271.5, 0);
    expect(metersPerPixel(10) / metersPerPixel(11)).toBeCloseTo(2, 6);
  });

  it('beim Hineinzoomen geografisch enger, auf dem Bildschirm grösser', () => {
    for (let z = 4; z < 13; z += 0.25) {
      expect(radiusKm(z + 0.25)).toBeLessThan(radiusKm(z));
      const grow = radiusPx(z + 1) / radiusPx(z);
      expect(grow).toBeGreaterThan(1); // wächst mit der Karte mit …
      expect(grow).toBeLessThan(2); // … aber weniger als der Massstab: präzisere Hotspots
    }
    expect(radiusKm(6.5)).toBeGreaterThan(10); // ganze Schweiz: Regionen
    expect(radiusKm(10)).toBeLessThan(3.5); // nah: Täler und Gebiete
  });

  it('Ausdruck mit streng aufsteigenden Stützstellen', () => {
    const e = radiusExpression();
    expect(e.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    const stops = e.slice(3) as number[];
    for (let i = 2; i < stops.length; i += 2) {
      expect(stops[i]).toBeGreaterThan(stops[i - 2]);
      expect(stops[i + 1]).toBeGreaterThan(stops[i - 1]);
    }
  });
});

// ── Eingabe ──────────────────────────────────────────────────────────────────

describe('Doppelte vermeiden', () => {
  const p = (id: string, name: string, lat: number, lng: number): DensityPoint => ({ id, name, lat, lng, kind: 'lake', weight: 1 });

  it('gleiche ID nur einmal, gleicher Ort mit gleichem Namen nur einmal', () => {
    const pts = preparePoints([
      p('a', 'Trübsee', 46.793111, 8.390159),
      p('a', 'Trübsee', 46.793111, 8.390159),
      p('b', ' trübsee ', 46.793111, 8.390159),
    ]);
    expect(pts.n).toBe(1);
  });

  it('verschiedene Ziele am selben Ort bleiben; ungültige Koordinaten fallen weg', () => {
    const pts = preparePoints([
      p('a', 'Oeschinensee', 46.4984, 7.7268),
      p('b', 'Berghotel Oeschinensee', 46.4984, 7.7268),
      p('c', 'kaputt', Number.NaN, 7.7),
    ]);
    expect(pts.n).toBe(2);
  });
});

// ── Normalisierung ───────────────────────────────────────────────────────────

describe('Intensität: normalisiert, Extremwerte begrenzt', () => {
  it('ein einzelnes Ziel ist nie ein Hotspot (höchstens knapp über «niedrig»)', () => {
    const m = buildDensityModel([{ id: 'x', name: 'x', lat: 46.8, lng: 8.2, kind: 'peak', weight: 1 }]);
    for (const [, v] of m.intensity) expect(v).toBe(MAX_INTENSITY);
    const pts = preparePoints([{ id: 'x', name: 'x', lat: 46.8, lng: 8.2, kind: 'peak', weight: 1 }]);
    expect(densityAt(pts, MAX_INTENSITY, 8, 8.2, 46.8)).toBeLessThan(0.35);
    for (const b of m.bands) expect(b.hotspots).toEqual([]); // Maximum unter «mittel»
  });

  it('die dichtesten 2 % erreichen die oberste Farbe – unabhängig von der Datenmenge', () => {
    const rand = rng(7);
    const base = [...cluster('a', INTERLAKEN.lat, INTERLAKEN.lng, 260, 2.5, rand), ...cluster('b', ENGELBERG.lat, ENGELBERG.lng, 120, 1.5, rand), ...scatter('s', 120, rand)];
    const m1 = buildDensityModel(base);
    const pts = preparePoints(base);
    const i8 = intensityAt(m1.intensity, 8);
    const dens = Array.from({ length: pts.n }, (_, i) => densityAt(pts, i8, 8, pts.lng[i], pts.lat[i])).sort((a, b) => a - b);
    const q98 = dens[Math.round(0.98 * (dens.length - 1))];
    expect(q98).toBeGreaterThan(0.8);
    expect(q98).toBeLessThan(1.25);

    // Doppelt so viele Ziele an denselben Orten → halbe Intensität, gleiches Bild.
    const doubled = [...base, ...base.map((p) => ({ ...p, id: p.id + '-2', name: p.name + ' (2)' }))];
    const m2 = buildDensityModel(doubled);
    expect(intensityAt(m2.intensity, 8) / i8).toBeCloseTo(0.5, 1);
  });

  it('Intensitäts-Ausdruck aufsteigend', () => {
    const e = intensityExpression([[5, 0.1], [6, 0.2], [7, 0.4]]);
    expect(e).toEqual(['interpolate', ['linear'], ['zoom'], 5, 0.1, 6, 0.2, 7, 0.4]);
  });
});

// ── Hotspots ─────────────────────────────────────────────────────────────────

describe('Hotspots: echte Anzahl, jedes Ziel höchstens einmal', () => {
  const rand = rng(42);
  const a = cluster('a', INTERLAKEN.lat, INTERLAKEN.lng, 300, 2, rand);
  const b = cluster('b', ENGELBERG.lat, ENGELBERG.lng, 120, 1.2, rand, 'lake');
  const s = scatter('s', 80, rand);
  const model = buildDensityModel([...a, ...b, ...s]);

  it('zwei Hotspots an den richtigen Orten, Zahlen = Ziele im leuchtenden Bereich', () => {
    for (const band of model.bands) {
      const [first, second] = band.hotspots;
      expect(distKm(first, INTERLAKEN)).toBeLessThan(2.5);
      expect(distKm(second, ENGELBERG)).toBeLessThan(2.5);
      // Der Haufen zählt mit, soweit er sichtbar leuchtet (die äussersten Ausreisser
      // liegen bei engem Kern darunter); dazu höchstens zufällig nahe Streupunkte.
      expect(first.count).toBeGreaterThanOrEqual(270);
      expect(first.count).toBeLessThanOrEqual(300 + 80);
      expect(second.count).toBeGreaterThanOrEqual(108);
      expect(second.count).toBeLessThanOrEqual(120 + 80);
      expect(second.kinds.lake).toBeGreaterThanOrEqual(108);
    }
  });

  it('jede Zahl = genau die Ziele, deren Ort im Bereich des Hotspots liegt', () => {
    const all = [...a, ...b, ...s];
    for (const band of model.bands) {
      for (const h of band.hotspots.slice(0, 5)) {
        const inside = all.filter((p) => hotspotAt(band, p.lng, p.lat) === h);
        expect(inside.length).toBe(h.count);
        const kinds: Record<string, number> = {};
        for (const p of inside) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
        expect(kinds).toEqual(h.kinds);
      }
    }
  });

  it('Summe aller Hotspots nie grösser als die Zahl der Ziele', () => {
    for (const band of model.bands) {
      const sum = band.hotspots.reduce((t, h) => t + h.count, 0);
      expect(sum).toBeLessThanOrEqual(model.points);
    }
  });

  it('Ausdehnung umfasst die Ziele des Hotspots', () => {
    const h = model.bands[1].hotspots[0];
    const [w, south, e, n] = h.bbox;
    expect(w).toBeLessThan(INTERLAKEN.lng);
    expect(e).toBeGreaterThan(INTERLAKEN.lng);
    expect(south).toBeLessThan(INTERLAKEN.lat);
    expect(n).toBeGreaterThan(INTERLAKEN.lat);
  });

  it('Tippen: Hotspot unter dem Ort, ausserhalb des Leuchtens keiner', () => {
    const only = buildDensityModel([...cluster('a', INTERLAKEN.lat, INTERLAKEN.lng, 200, 2, rng(1))]);
    const band = only.bands[1];
    expect(hotspotAt(band, INTERLAKEN.lng, INTERLAKEN.lat)?.count).toBeGreaterThanOrEqual(195);
    // 40 km östlich: kein Ziel, kein Leuchten, kein Hotspot.
    expect(hotspotAt(band, INTERLAKEN.lng + 40 * KM_LNG, INTERLAKEN.lat)).toBeNull();
    // Genau dort, wo die Karte nicht mehr leuchtet, endet auch der Hotspot.
    const pts = preparePoints([...cluster('a', INTERLAKEN.lat, INTERLAKEN.lng, 200, 2, rng(1))]);
    const i = intensityAt(only.intensity, band.zoom);
    for (let km = 0; km < 30; km += 0.5) {
      const lng = INTERLAKEN.lng + km * KM_LNG;
      const dens = densityAt(pts, i, band.zoom, lng, INTERLAKEN.lat);
      const hit = hotspotAt(band, lng, INTERLAKEN.lat);
      if (dens < VISIBLE_DENSITY * 0.7) expect(hit).toBeNull();
      if (dens > VISIBLE_DENSITY * 1.5) expect(hit).not.toBeNull();
    }
  });

  it('leere Eingabe: keine Bänder, keine Hotspots', () => {
    const m = buildDensityModel([]);
    expect(m.points).toBe(0);
    expect(m.bands).toEqual([]);
  });
});

// ── Leistung ─────────────────────────────────────────────────────────────────

describe('Leistung', () => {
  it('20 000 Ziele in deutlich unter einer Sekunde', () => {
    const rand = rng(3);
    const pts: DensityPoint[] = [];
    const centers = Array.from({ length: 40 }, () => ({ lat: 45.9 + rand() * 1.8, lng: 6.0 + rand() * 4.4 }));
    centers.forEach((c, k) => pts.push(...cluster(`c${k}`, c.lat, c.lng, 400, 1 + rand() * 6, rand)));
    pts.push(...scatter('s', 4000, rand));
    const m = buildDensityModel(pts);
    expect(m.points).toBe(20_000);
    // Grosszügige Grenze für langsame Testrechner; typisch ein Bruchteil davon.
    expect(m.ms).toBeLessThan(1500);
    console.info(`Dichtemodell: ${m.points} Ziele in ${m.ms} ms`);
  });
});
