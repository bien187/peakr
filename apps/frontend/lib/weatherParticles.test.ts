import { describe, expect, it } from 'vitest';
import { nowIndex, type Step } from './weatherEngine';
import { mercY } from './weatherField';
import { ParticleSystem, type FieldProbe, type View } from './weatherParticles';

/** Karte ohne Drehung um Bern, Zoom 8: 1 Grad Länge = world/360 Pixel. */
function view(w = 400, h = 300): View {
  const world = 512 * 2 ** 8;
  const lng0 = 7.45;
  const my0 = mercY(46.95);
  const kx = world / 360;
  const ky = world / (2 * Math.PI);
  return {
    w, h, world,
    project(lng, my, out) {
      out[0] = w / 2 + (lng - lng0) * kx;
      out[1] = h / 2 - (my - my0) * ky;
    },
    unproject(x, y, out) {
      out[0] = lng0 + (x - w / 2) / kx;
      out[1] = my0 - (y - h / 2) / ky;
    },
    dir(east, north, out) {
      out[0] = east;
      out[1] = -north;
    },
  };
}

/** Zufall mit Startwert (reproduzierbar). */
function rng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe('Windböen', () => {
  const westwind: FieldProbe = (_lng, _lat, out) => {
    out[0] = 60; // km/h nach Osten
    out[1] = 0;
    return true;
  };

  it('Striche entstehen und ziehen mit dem Wind (nach Osten = nach rechts)', () => {
    const sys = new ParticleSystem('wind', rng(3));
    sys.setProbe(westwind);
    const v = view();
    sys.update(0.03, v);
    sys.update(0.03, v);
    expect(sys.vertexCount).toBeGreaterThan(0);
    expect(sys.vertexCount % 6).toBe(0);
    // Kopf (Vertex 0) liegt rechts vom Schwanz (Vertex 2): Bewegung nach Osten
    const head = sys.vertices[0];
    const tail = sys.vertices[2 * 4];
    expect(head).toBeGreaterThan(tail);
    // Schwanz durchsichtig, Kopf sichtbar
    expect(sys.vertices[2 * 4 + 2]).toBe(0);
  });

  it('angehalten: Striche bleiben sichtbar, bewegen sich aber nicht', () => {
    const sys = new ParticleSystem('wind', rng(9));
    sys.setProbe(westwind);
    sys.frozen = true;
    const v = view();
    sys.update(0.03, v);
    expect(sys.vertexCount).toBeGreaterThan(0);
    const before = Array.from(sys.vertices.subarray(0, sys.vertexCount * 4));
    expect(Math.max(...before.filter((_, i) => i % 4 === 2))).toBeGreaterThan(0.1); // sichtbar
    sys.update(0.5, v);
    expect(Array.from(sys.vertices.subarray(0, sys.vertexCount * 4))).toEqual(before);
  });

  it('Windstille: keine Striche', () => {
    const sys = new ParticleSystem('wind', rng(4));
    sys.setProbe((_a, _b, out) => {
      out[0] = 2;
      out[1] = 1;
      return true;
    });
    for (let i = 0; i < 5; i++) sys.update(0.03, view());
    expect(sys.vertexCount).toBe(0);
  });

  it('ohne Daten keine Striche', () => {
    const sys = new ParticleSystem('wind', rng(5));
    sys.setProbe(() => false);
    sys.update(0.03, view());
    expect(sys.vertexCount).toBe(0);
  });
});

describe('Schneeflocken', () => {
  it('fallen langsam nach Süden (auf dem Bildschirm nach unten) und blinken nur sanft', () => {
    const sys = new ParticleSystem('snow', rng(7));
    sys.setProbe((_a, _b, out) => {
      out[0] = 0.8;
      return true;
    });
    const v = view();
    sys.update(0.03, v);
    sys.update(0.5, v);
    const n = sys.vertexCount;
    expect(n).toBeGreaterThan(0);
    const y1 = sys.vertices[1];
    sys.update(0.1, v);
    expect(sys.vertices[1]).toBeGreaterThan(y1);
    for (let i = 0; i < sys.vertexCount; i++) {
      const a = sys.vertices[i * 4 + 2];
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});

describe('Zeitachse', () => {
  it('Start bei «jetzt»: letztes Radarbild bzw. laufende Prognosestunde', () => {
    const t0 = Date.parse('2026-11-14T10:00:00Z');
    const steps: Step[] = [
      { kind: 'radar', time: t0 - 10 * 60_000, frame: 0 },
      { kind: 'radar', time: t0 - 5 * 60_000, frame: 1 },
      { kind: 'forecast', time: t0 + 3_600_000, hour: 1 },
    ];
    expect(nowIndex(steps, t0)).toBe(1);
    expect(nowIndex(steps.slice(2), t0)).toBe(0);
  });
});
