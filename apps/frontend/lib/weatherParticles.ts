/**
 * Kleine bewegte Details über der Wetterkarte: Windböen als kurze, auslaufende
 * Striche, die mit dem Wind ziehen, und Schneeflocken als weiche Punkte, die
 * langsam fallen. Beides folgt den Prognosedaten – wo kein Wind bzw. kein
 * Schnee erwartet wird, bewegt sich nichts.
 *
 * Gezeichnet wird als eigene MapLibre-Ebene (WebGL) in Bildschirm-Pixeln: die
 * Striche bleiben bei jedem Zoom fein, liegen aber im Ebenenstapel unter
 * Beschriftungen, Route und Zielpunkten. Positionen werden in geografischen
 * Koordinaten geführt (Länge, Mercator-y), damit sie beim Verschieben der Karte
 * an ihrem Ort bleiben.
 */
import type * as maplibregl from 'maplibre-gl';
import { latOfMercY, mercY, smoothstep } from './weatherField';

export type ParticleMode = 'wind' | 'snow';

/**
 * Feldabfrage an einem Ort. Wind: out = [u, v] in km/h (wohin; u nach Osten,
 * v nach Norden). Schnee: out[0] = Intensität 0–1. false = keine Daten.
 */
export type FieldProbe = (lng: number, lat: number, out: Float64Array) => boolean;

/** Projektion eines Frames: (Länge, Mercator-y) ↔ Bildschirm in CSS-Pixeln. */
export interface View {
  w: number;
  h: number;
  /** Weltgrösse in CSS-Pixeln (512 · 2^Zoom). */
  world: number;
  project(lng: number, my: number, out: Float64Array): void;
  unproject(x: number, y: number, out: Float64Array): void;
  /** Bildschirmrichtung eines Schritts (Ost, Nord) in Pixeln. */
  dir(east: number, north: number, out: Float64Array): void;
}

/**
 * Ansicht der Karte für einen Frame. Ohne Neigung ist Web-Mercator auf dem
 * Bildschirm exakt affin in (Länge, Mercator-y) – drei Projektionen genügen für
 * alle Partikel. Mit Neigung rechnet MapLibre jeden Punkt.
 */
export function mapView(map: maplibregl.Map): View {
  const canvas = map.getCanvas();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const world = 512 * 2 ** map.getZoom();
  const c = map.getCenter();
  if (map.getPitch() < 0.5) {
    const my0 = mercY(c.lat);
    const p0 = map.project([c.lng, c.lat]);
    const p1 = map.project([c.lng + 1, c.lat]);
    const p2 = map.project([c.lng, latOfMercY(my0 + 0.02)]);
    const a = p1.x - p0.x;
    const d = p1.y - p0.y;
    const b = (p2.x - p0.x) / 0.02;
    const e = (p2.y - p0.y) / 0.02;
    const cx = p0.x - a * c.lng - b * my0;
    const cy = p0.y - d * c.lng - e * my0;
    const det = a * e - b * d || 1;
    return {
      w, h, world,
      project(lng, my, out) {
        out[0] = a * lng + b * my + cx;
        out[1] = d * lng + e * my + cy;
      },
      unproject(x, y, out) {
        const X = x - cx;
        const Y = y - cy;
        out[0] = (e * X - b * Y) / det;
        out[1] = (-d * X + a * Y) / det;
      },
      dir(east, north, out) {
        const dl = (east * 360) / world;
        const dm = (north * 2 * Math.PI) / world;
        out[0] = a * dl + b * dm;
        out[1] = d * dl + e * dm;
      },
    };
  }
  const beta = (map.getBearing() * Math.PI) / 180;
  const cb = Math.cos(beta);
  const sb = Math.sin(beta);
  return {
    w, h, world,
    project(lng, my, out) {
      const p = map.project([lng, latOfMercY(my)]);
      out[0] = p.x;
      out[1] = p.y;
    },
    unproject(x, y, out) {
      const ll = map.unproject([x, y]);
      out[0] = ll.lng;
      out[1] = mercY(ll.lat);
    },
    dir(east, north, out) {
      out[0] = east * cb - north * sb;
      out[1] = -(north * cb + east * sb);
    },
  };
}

// Wind: Geschwindigkeit auf dem Bildschirm (px/s) = Basis + Faktor · Böe (km/h).
const WIND_BASE = 6;
const WIND_K = 0.55;
/** Unter dieser Böenstärke (km/h) entstehen keine neuen Striche. */
const WIND_MIN = 5;
// Schnee: Fallgeschwindigkeit (px/s) und seitliches Pendeln.
const SNOW_FALL = 9;
const SNOW_SWAY = 7;

const lifeFade = (x: number): number => smoothstep(0, 0.15, x) * (1 - smoothstep(0.68, 1, x));

/** Partikel als Struktur aus Arrays (keine Objekte je Frame). */
export class ParticleSystem {
  readonly mode: ParticleMode;
  /** Gesamt-Deckkraft (Ein-/Ausblenden der Wetterebene). */
  opacity = 1;
  /** Angehalten (Pause, «Bewegung reduzieren»): Striche/Flocken stehen still, bleiben aber sichtbar. */
  frozen = false;
  /** Vertexdaten (x, y in CSS-Pixeln, Deckkraft, Grösse) und Anzahl Vertices. */
  vertices = new Float32Array(0);
  vertexCount = 0;
  private probe: FieldProbe | null = null;
  private n = 0;
  private lng = new Float64Array(0);
  private my = new Float64Array(0);
  private age = new Float32Array(0);
  private life = new Float32Array(0);
  private seed = new Float32Array(0);
  private time = 0;
  private readonly s = new Float64Array(2);
  private readonly p = new Float64Array(2);
  private readonly q = new Float64Array(2);
  private readonly rnd: () => number;

  constructor(mode: ParticleMode, rnd: () => number = Math.random) {
    this.mode = mode;
    this.rnd = rnd;
  }

  setProbe(probe: FieldProbe | null): void {
    this.probe = probe;
  }

  /** Anzahl Partikel passend zur Bildschirmfläche. */
  private capacity(view: View): number {
    const area = Math.max(1, view.w * view.h);
    return this.mode === 'wind'
      ? Math.round(Math.min(1100, Math.max(180, area / 950)))
      : Math.round(Math.min(700, Math.max(100, area / 1600)));
  }

  private resize(n: number): void {
    const grow = <T extends Float64Array | Float32Array>(old: T, make: (k: number) => T): T => {
      const next = make(n);
      next.set(old.subarray(0, Math.min(old.length, n)));
      return next;
    };
    this.lng = grow(this.lng, (k) => new Float64Array(k));
    this.my = grow(this.my, (k) => new Float64Array(k));
    this.age = grow(this.age, (k) => new Float32Array(k));
    this.life = grow(this.life, (k) => new Float32Array(k));
    this.seed = grow(this.seed, (k) => new Float32Array(k));
    this.n = n;
    this.vertices = new Float32Array(n * (this.mode === 'wind' ? 6 : 1) * 4);
  }

  /** Stärke am Ort (für die Annahme beim Entstehen); null = keine Daten. */
  private strength(lng: number, lat: number): number | null {
    if (!this.probe || !this.probe(lng, lat, this.s)) return null;
    if (this.mode === 'wind') {
      const g = Math.hypot(this.s[0], this.s[1]);
      return g < WIND_MIN ? 0 : Math.min(1, Math.max(0.04, (g - WIND_MIN) / 45));
    }
    const s = this.s[0];
    return s < 0.02 ? 0 : Math.min(1, Math.max(0.06, s));
  }

  /** Neues Partikel an einer zufälligen Stelle im Bild; dichter, wo mehr los ist. */
  private spawn(i: number, view: View): boolean {
    view.unproject(this.rnd() * view.w, this.rnd() * view.h, this.q);
    const lng = this.q[0];
    const my = this.q[1];
    const st = this.strength(lng, latOfMercY(my));
    if (st === null || st <= 0 || this.rnd() > st) return false;
    this.lng[i] = lng;
    this.my[i] = my;
    this.life[i] = this.mode === 'wind' ? 1.1 + this.rnd() * 1.7 : 2.6 + this.rnd() * 2.6;
    // Angehalten mitten im Leben entstehen (sichtbar), sonst sanft einblenden.
    this.age[i] = this.frozen ? (0.25 + 0.4 * this.rnd()) * this.life[i] : 0;
    this.seed[i] = this.rnd();
    return true;
  }

  /** Einen Zeitschritt rechnen und die Vertices für diesen Frame aufbauen. */
  update(dt: number, view: View): void {
    this.vertexCount = 0;
    if (!this.probe || view.w <= 0 || view.h <= 0) return;
    const cap = this.capacity(view);
    if (cap !== this.n) this.resize(cap);
    if (this.frozen) dt = 0;
    this.time += dt;
    const { s, p, q } = this;
    const pxLng = 360 / view.world;
    const pxMy = (2 * Math.PI) / view.world;
    const margin = 40;
    const out = this.vertices;
    let o = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i] && !this.spawn(i, view)) continue;
      this.age[i] += dt;
      const x01 = this.age[i] / this.life[i];
      if (!this.probe(this.lng[i], latOfMercY(this.my[i]), s)) {
        this.age[i] = this.life[i];
        continue;
      }
      if (this.mode === 'wind') {
        const g = Math.hypot(s[0], s[1]);
        if (g < 0.5) {
          this.age[i] = this.life[i];
          continue;
        }
        const ue = s[0] / g;
        const vn = s[1] / g;
        const speed = WIND_BASE + WIND_K * g;
        this.lng[i] += ue * speed * dt * pxLng;
        this.my[i] += vn * speed * dt * pxMy;
        view.project(this.lng[i], this.my[i], p);
        if (p[0] < -margin || p[0] > view.w + margin || p[1] < -margin || p[1] > view.h + margin) {
          this.age[i] = this.life[i];
          continue;
        }
        view.dir(ue, vn, q);
        const ql = Math.hypot(q[0], q[1]) || 1;
        const dx = q[0] / ql;
        const dy = q[1] / ql;
        const len = Math.min(36, Math.max(10, 8 + 0.28 * g));
        const alpha = Math.min(0.95, 0.38 + g / 90) * lifeFade(x01) * this.opacity;
        const hx = p[0];
        const hy = p[1];
        const tx = hx - dx * len;
        const ty = hy - dy * len;
        // Spitz zulaufender Strich: vorne gut 2 px breit, hinten fast 0, hinten durchsichtig.
        const wh = 1.1;
        const wt = 0.2;
        const nx = -dy;
        const ny = dx;
        o = quad(out, o, hx + nx * wh, hy + ny * wh, hx - nx * wh, hy - ny * wh, tx + nx * wt, ty + ny * wt, tx - nx * wt, ty - ny * wt, alpha);
      } else {
        const inten = s[0];
        if (inten < 0.01) {
          this.age[i] = Math.max(this.age[i], this.life[i] * 0.7);
        }
        const sway = Math.sin(this.time * 1.6 + this.seed[i] * 6.283) * SNOW_SWAY;
        this.lng[i] += sway * dt * pxLng;
        this.my[i] -= (SNOW_FALL + 10 * inten) * dt * pxMy;
        view.project(this.lng[i], this.my[i], p);
        if (p[0] < -margin || p[0] > view.w + margin || p[1] < -margin || p[1] > view.h + margin) {
          this.age[i] = this.life[i];
          continue;
        }
        const twinkle = 0.85 + 0.15 * Math.sin(this.time * 3 + this.seed[i] * 40);
        out[o++] = p[0];
        out[o++] = p[1];
        out[o++] = (0.35 + 0.6 * Math.min(1, inten)) * lifeFade(x01) * twinkle * this.opacity;
        out[o++] = 2 + this.seed[i] * 2.8;
      }
    }
    this.vertexCount = o / 4;
  }

  /** Alles zurücksetzen (neue Ebene oder neue Daten). */
  reset(): void {
    this.age.fill(0);
    this.life.fill(0);
  }
}

/** Zwei Dreiecke (Kopf links/rechts, Schwanz links/rechts); Schwanz durchsichtig. */
function quad(
  out: Float32Array, o: number,
  hlx: number, hly: number, hrx: number, hry: number,
  tlx: number, tly: number, trx: number, try_: number,
  alpha: number,
): number {
  const v = (x: number, y: number, a: number) => {
    out[o++] = x;
    out[o++] = y;
    out[o++] = a;
    out[o++] = 0;
  };
  v(hlx, hly, alpha);
  v(hrx, hry, alpha);
  v(tlx, tly, 0);
  v(tlx, tly, 0);
  v(hrx, hry, alpha);
  v(trx, try_, 0);
  return o;
}

const VERT = `#version 300 es
in vec2 a_pos;
in float a_alpha;
in float a_size;
uniform vec2 u_scale;
uniform float u_dpr;
out float v_alpha;
void main() {
  v_alpha = a_alpha;
  gl_Position = vec4(a_pos.x * u_scale.x - 1.0, 1.0 - a_pos.y * u_scale.y, 0.0, 1.0);
  gl_PointSize = a_size * u_dpr;
}`;

const FRAG = `#version 300 es
precision mediump float;
in float v_alpha;
uniform int u_points;
uniform vec3 u_color;
out vec4 frag;
void main() {
  float a = v_alpha;
  if (u_points == 1) {
    float d = length(gl_PointCoord - vec2(0.5));
    a *= 1.0 - smoothstep(0.12, 0.5, d);
  }
  frag = vec4(u_color * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'Shader');
  return sh;
}

/**
 * MapLibre-Ebene, die das Partikelsystem bei jedem Kartenframe weiterrechnet
 * und zeichnet. Neu gezeichnet wird nur, wenn die Karte rendert – den Takt
 * gibt die Wetterebene vor (triggerRepaint), nicht diese Ebene.
 */
export function particleLayer(id: string, map: maplibregl.Map, system: () => ParticleSystem | null): maplibregl.CustomLayerInterface {
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let buffer: WebGLBuffer | null = null;
  let uScale: WebGLUniformLocation | null = null;
  let uDpr: WebGLUniformLocation | null = null;
  let uPoints: WebGLUniformLocation | null = null;
  let uColor: WebGLUniformLocation | null = null;
  let last = 0;
  return {
    id,
    type: 'custom',
    renderingMode: '2d',
    onAdd(_map, gl) {
      try {
        const prog = gl.createProgram();
        if (!prog) return;
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
        program = prog;
        uScale = gl.getUniformLocation(prog, 'u_scale');
        uDpr = gl.getUniformLocation(prog, 'u_dpr');
        uPoints = gl.getUniformLocation(prog, 'u_points');
        uColor = gl.getUniformLocation(prog, 'u_color');
        buffer = gl.createBuffer();
        vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const attr = (name: string, size: number, offset: number) => {
          const loc = gl.getAttribLocation(prog, name);
          if (loc < 0) return;
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 16, offset);
        };
        attr('a_pos', 2, 0);
        attr('a_alpha', 1, 8);
        attr('a_size', 1, 12);
        gl.bindVertexArray(null);
      } catch {
        program = null; // ohne Partikel weiter – die Karte bleibt nutzbar
      }
    },
    render(gl) {
      const sys = system();
      const now = performance.now();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (!sys || !program || !vao) return;
      const view = mapView(map);
      sys.update(dt, view);
      if (sys.vertexCount === 0) return;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, sys.vertices.subarray(0, sys.vertexCount * 4), gl.DYNAMIC_DRAW);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(uScale, 2 / view.w, 2 / view.h);
      gl.uniform1f(uDpr, gl.drawingBufferWidth / Math.max(1, view.w));
      const points = sys.mode === 'snow';
      gl.uniform1i(uPoints, points ? 1 : 0);
      if (points) gl.uniform3f(uColor, 0.97, 0.98, 1);
      else gl.uniform3f(uColor, 1, 1, 1);
      gl.drawArrays(points ? gl.POINTS : gl.TRIANGLES, 0, sys.vertexCount);
      gl.bindVertexArray(null);
    },
    onRemove(_map, gl) {
      if (buffer) gl.deleteBuffer(buffer);
      if (vao) gl.deleteVertexArray(vao);
      if (program) gl.deleteProgram(program);
      program = null;
      vao = null;
      buffer = null;
      last = 0;
    },
  };
}
