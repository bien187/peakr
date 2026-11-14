/**
 * Wetterebene auf der Karte – imperativ, ausserhalb von React, damit die
 * Animation flüssig läuft, ohne die Oberfläche bei jedem Frame neu zu rendern.
 *
 * Aufbau im Ebenenstapel (von unten): Grundkarte → dunkler Schleier → Radar
 * (Messung) → Prognosefeld → Partikel → Beschriftungen der Grundkarte → eigene
 * Ebenen (Route, Zielpunkte). Beschriftungen werden für die dunkle Ansicht hell
 * gefärbt und beim Ausschalten wiederhergestellt.
 *
 * Die Zeitachse läuft fliessend: zwischen zwei Bildern wird im Byte-Raum der
 * Farbskala überblendet; zwischen Messung (Radar) und Prognose wird nur über
 * die Deckkraft gewechselt – ein Zwischenbild aus Messung und Prognose gibt es
 * nicht. Angehalten rastet die Zeit auf einem echten Daten-Zeitpunkt ein.
 */
import type * as maplibregl from 'maplibre-gl';
import { byteToValue, WEATHER_SCALES, type WeatherLayerKey } from '@ch-alpineroute/shared';
import {
  colorize,
  lerpGrid,
  palette,
  radarByteAt,
  radarValues,
  renderGrid,
  sampleGrid,
  smoothstep,
  type Corners,
  type GridGeom,
  type Palette,
  type WindField,
} from './weatherField';
import { mapShade, type MapShade } from './mapShade';
import { particleLayer, ParticleSystem, type FieldProbe } from './weatherParticles';

export type Step = { kind: 'radar'; time: number; frame: number } | { kind: 'forecast'; time: number; hour: number };

export interface RadarData {
  width: number;
  height: number;
  corners: Corners;
  /** Weichgezeichnete Bilder (Byte × 256), Reihenfolge wie die Radar-Schritte. */
  frames: Uint16Array[];
}

export interface GridData {
  geom: GridGeom;
  /** Rohwerte je Stunde (für den Wert unter dem Zeiger). */
  raw: Float32Array[];
  /** Byte-Werte je Stunde (für Farbe und Überblendung). */
  bytes: Float32Array[];
  wind: WindField | null;
}

export interface Scene {
  layer: WeatherLayerKey;
  steps: Step[];
  radar: RadarData | null;
  grid: GridData | null;
}

export interface EngineEvents {
  /** Gerundeter Zeitschritt – nur bei Wechsel (Beschriftungen). */
  step(idx: number): void;
  /** Laufende Position – jeden Animationsframe (Zeitregler, ohne React). */
  pos(pos: number): void;
  playing(p: boolean): void;
  error(): void;
}

export interface Readout {
  value: number;
  kind: Step['kind'];
  time: number;
}

const ID = { radar: 'wx-radar', grid: 'wx-grid', particles: 'wx-particles' } as const;
const ORDER = [ID.radar, ID.grid, ID.particles];
/** ~30 Bilder pro Sekunde: flüssig, aber schonend für Akku und Grafik. */
const FRAME_MS = 33;
/** Dunkler Schleier unter dem Wetter (gemeinsam mit dem dunklen Modus, siehe mapShade). */
const VEIL_OPACITY = 0.7;
const FADE_MS = 320;
/** Dauer je Schritt beim Abspielen. */
const STEP_MS = { radar: 360, forecast: 460, boundary: 760 };
/** Am Ende der Zeitachse kurz stehen bleiben, dann von vorn. */
const HOLD_MS = 1400;

/** Leichtes Abbremsen um jeden echten Daten-Zeitpunkt: die Bilder selbst sind kurz zu sehen. */
const ease = (t: number): number => 0.35 * t + 0.65 * t * t * (3 - 2 * t);

/** Letzter Schritt bis jetzt (Start der Ansicht); 0, wenn alles in der Zukunft liegt. */
export function nowIndex(steps: Step[], now = Date.now()): number {
  let idx = 0;
  for (let i = 0; i < steps.length; i++) if (steps[i].time <= now + 5 * 60_000) idx = i;
  return idx;
}

function nearestIndex(steps: Step[], time: number): number {
  let best = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i].time - time) < Math.abs(steps[best].time - time)) best = i;
  return best;
}

export class WeatherEngine {
  private readonly map: maplibregl.Map;
  private readonly ev: EngineEvents;
  /** Erste eigene Ebene der App: alles Wetter liegt darunter. */
  private readonly appLayer: string;
  private reduced = false;

  private scene: Scene | null = null;
  private pending: Scene | null = null;
  private pal: Palette | null = null;
  private version = 0;

  private readonly radarCanvas: HTMLCanvasElement;
  private readonly gridCanvas: HTMLCanvasElement;
  private radarImg: ImageData | null = null;
  private radarVals = new Float32Array(0);
  private gridImg: ImageData | null = null;
  private gridVals = new Float32Array(0);
  private gridCov = new Float32Array(0);
  private gridTmp = new Float32Array(0);
  private gridCoarse = new Float32Array(0);
  private radarKey = '';
  private gridKey = '';
  private corners: Record<'radar' | 'grid', string> = { radar: '', grid: '' };

  private active = false;
  private installed = false;
  private pos = 0;
  private playing = false;
  private settleTo: number | null = null;
  private holdUntil = 0;
  private master = 0;
  private masterTarget = 0;
  private veil = 0;
  private veilTarget = 0;
  private weights = { radar: 0, grid: 0 };
  private applied: Record<'radar' | 'grid', number> = { radar: -1, grid: -1 };
  /** Stundenpaar der Prognose an der aktuellen Position (für Partikel); null bei Radar. */
  private hours: { a: number; b: number | null; t: number } | null = null;
  private dirty = true;
  private raf = 0;
  private last = 0;
  private lastStep = -1;
  private particles: ParticleSystem | null = null;
  private readonly shade: MapShade;
  private destroyed = false;

  constructor(map: maplibregl.Map, ev: EngineEvents, appLayer: string) {
    this.map = map;
    this.ev = ev;
    this.appLayer = appLayer;
    this.radarCanvas = document.createElement('canvas');
    this.gridCanvas = document.createElement('canvas');
    this.shade = mapShade(map, appLayer);
    map.on('moveend', this.onMoveEnd);
    map.on('style.load', this.onStyleLoad);
  }

  // ── Steuerung ──────────────────────────────────────────────────────────────

  setReducedMotion(r: boolean): void {
    this.reduced = r;
    this.syncParticles();
  }

  activate(): void {
    if (this.destroyed) return;
    this.active = true;
    this.masterTarget = this.pending ? 0 : 1;
    this.veilTarget = VEIL_OPACITY;
    this.install();
    this.restyleLabels(true);
    this.dirty = true;
    this.schedule();
  }

  deactivate(): void {
    this.active = false;
    this.masterTarget = 0;
    this.veilTarget = 0;
    if (this.playing) {
      this.playing = false;
      this.ev.playing(false);
    }
    this.restyleLabels(false);
    if (this.reduced) {
      this.master = 0;
      this.veil = 0;
    }
    this.schedule();
  }

  setScene(scene: Scene | null): void {
    const prev = this.scene;
    // Ebenenwechsel bei sichtbarer Karte: aus-, umschalten, einblenden.
    if (prev && scene && prev.layer !== scene.layer && this.active && this.master > 0.02 && !this.reduced) {
      this.pending = scene;
      this.masterTarget = 0;
      this.schedule();
      return;
    }
    if (this.pending) {
      // Wechsel zurück, bevor ausgeblendet war: wieder einblenden.
      this.pending = null;
      if (this.active) this.masterTarget = 1;
    }
    this.applyScene(scene, prev);
  }

  play(): void {
    // Auch bei «Bewegung reduzieren» auf ausdrücklichen Wunsch – nur nicht von selbst.
    const n = this.scene?.steps.length ?? 0;
    if (n < 2) return;
    if (this.pos >= n - 1.001) this.pos = 0;
    this.playing = true;
    this.settleTo = null;
    this.holdUntil = 0;
    this.ev.playing(true);
    this.schedule();
  }

  pause(): void {
    const wasPlaying = this.playing;
    this.playing = false;
    this.holdUntil = 0;
    this.settleTo = Math.round(this.pos);
    if (wasPlaying) this.ev.playing(false);
    this.schedule();
  }

  /** Zeitregler ziehen: hält an und folgt direkt. */
  scrub(pos: number): void {
    if (this.playing) {
      this.playing = false;
      this.ev.playing(false);
    }
    const n = this.scene?.steps.length ?? 0;
    this.pos = Math.min(Math.max(0, pos), Math.max(0, n - 1));
    this.settleTo = null;
    this.holdUntil = 0;
    this.dirty = true;
    this.emitPos();
    this.schedule();
  }

  /** Auf den nächsten echten Daten-Zeitpunkt einrasten. */
  settle(): void {
    this.settleTo = Math.round(this.pos);
    this.schedule();
  }

  stepBy(delta: number): void {
    const n = this.scene?.steps.length ?? 0;
    if (n === 0) return;
    if (this.playing) {
      this.playing = false;
      this.ev.playing(false);
    }
    this.settleTo = Math.min(n - 1, Math.max(0, Math.round(this.pos) + delta));
    this.schedule();
  }

  /** Wert am Ort für den gerundeten Zeitschritt (gezeigter Datenstand). */
  readout(lng: number, lat: number): Readout | null {
    const s = this.scene;
    if (!s || s.steps.length === 0 || !this.active) return null;
    const st = s.steps[Math.min(s.steps.length - 1, Math.max(0, Math.round(this.pos)))];
    const scale = WEATHER_SCALES[s.layer];
    if (st.kind === 'radar') {
      const r = s.radar;
      if (!r) return null;
      const b = radarByteAt(r.frames[st.frame], r.width, r.height, r.corners, lng, lat);
      if (Number.isNaN(b)) return null;
      return { value: b < 1 ? 0 : byteToValue(scale, b), kind: 'radar', time: st.time };
    }
    const g = s.grid;
    if (!g) return null;
    const v = sampleGrid(g.geom, g.raw[st.hour], lng, lat);
    if (Number.isNaN(v)) return null;
    return { value: v, kind: 'forecast', time: st.time };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      this.map.off('moveend', this.onMoveEnd);
      this.map.off('style.load', this.onStyleLoad);
      this.restyleLabels(false);
      this.uninstall();
    } catch {
      /* Karte bereits abgebaut */
    }
  }

  // ── Szene ──────────────────────────────────────────────────────────────────

  private applyScene(scene: Scene | null, prev: Scene | null): void {
    const sameLayer = !!prev && !!scene && prev.layer === scene.layer;
    const oldTime = sameLayer && prev!.steps.length > 0 ? prev!.steps[Math.min(prev!.steps.length - 1, Math.round(this.pos))]?.time : undefined;
    this.scene = scene;
    this.version++;
    this.pal = scene ? palette(WEATHER_SCALES[scene.layer]) : null;
    const n = scene?.steps.length ?? 0;
    // Erste Daten nach dem Einschalten: weich einblenden statt aufploppen.
    if (n > 0 && (!prev || prev.steps.length === 0) && !this.reduced) this.master = 0;
    if (n === 0) this.pos = 0;
    else if (oldTime !== undefined) this.pos = nearestIndex(scene!.steps, oldTime);
    else this.pos = nowIndex(scene!.steps);
    this.settleTo = null;
    this.holdUntil = 0;
    if (this.playing && n < 2) {
      this.playing = false;
      this.ev.playing(false);
    }
    this.radarKey = '';
    this.gridKey = '';
    this.lastStep = -1;
    this.syncParticles();
    this.dirty = true;
    this.emitPos();
    this.schedule();
  }

  private syncParticles(): void {
    const s = this.scene;
    // Bei «Bewegung reduzieren» bleiben Striche/Flocken stehen (frozen) – die Richtung ist trotzdem zu sehen.
    const mode = s?.grid ? (s.layer === 'gust' && s.grid.wind ? 'wind' : s.layer === 'snowfall' ? 'snow' : null) : null;
    if (!mode) {
      this.particles = null;
      this.removeLayer(ID.particles);
      return;
    }
    if (!this.particles || this.particles.mode !== mode) this.particles = new ParticleSystem(mode);
    this.particles.reset();
    this.particles.setProbe(mode === 'wind' ? this.probeWind : this.probeSnow);
    if (this.installed) this.ensureParticleLayer();
  }

  private probeWind: FieldProbe = (lng, lat, out) => {
    const g = this.scene?.grid;
    const w = g?.wind;
    const hs = this.hours;
    if (!g || !w || !hs) return false;
    let u = sampleGrid(g.geom, w.u[hs.a], lng, lat);
    if (Number.isNaN(u)) return false;
    let v = sampleGrid(g.geom, w.v[hs.a], lng, lat);
    if (hs.b !== null && hs.t > 0) {
      const u1 = sampleGrid(g.geom, w.u[hs.b], lng, lat);
      const v1 = sampleGrid(g.geom, w.v[hs.b], lng, lat);
      if (!Number.isNaN(u1) && !Number.isNaN(v1)) {
        u += (u1 - u) * hs.t;
        v += (v1 - v) * hs.t;
      }
    }
    out[0] = u;
    out[1] = v;
    return true;
  };

  private probeSnow: FieldProbe = (lng, lat, out) => {
    const g = this.scene?.grid;
    const hs = this.hours;
    if (!g || !hs) return false;
    let b = sampleGrid(g.geom, g.bytes[hs.a], lng, lat);
    if (Number.isNaN(b)) return false;
    if (hs.b !== null && hs.t > 0) {
      const b1 = sampleGrid(g.geom, g.bytes[hs.b], lng, lat);
      if (!Number.isNaN(b1)) b += (b1 - b) * hs.t;
    }
    out[0] = Math.min(1, Math.max(0, b / 200));
    return true;
  };

  // ── Karte ──────────────────────────────────────────────────────────────────

  /** Ebenen der Grundkarte (alles vor der ersten eigenen Ebene) mit Typ. */
  private baseLayers(): { id: string; type: string }[] {
    const order = this.map.getLayersOrder();
    const app = order.indexOf(this.appLayer);
    if (app < 0) return [];
    return order.slice(0, app).map((id) => ({ id, type: this.map.getLayer(id)?.type ?? '' }));
  }

  /** Erste Beschriftungsebene der Grundkarte (Wetter liegt darunter) bzw. erste eigene Ebene. */
  private beforeId(): string | undefined {
    const first = this.baseLayers().find((l) => l.type === 'symbol' && !(ORDER as readonly string[]).includes(l.id));
    if (first) return first.id;
    return this.map.getLayer(this.appLayer) ? this.appLayer : undefined;
  }

  /** Wetter-Ebenen in fester Reihenfolge einfügen, auch wenn sie nacheinander entstehen. */
  private addInOrder(layer: maplibregl.LayerSpecification | maplibregl.CustomLayerInterface): void {
    if (this.map.getLayer(layer.id)) return;
    const k = (ORDER as readonly string[]).indexOf(layer.id);
    let before: string | undefined;
    for (let i = k + 1; i < ORDER.length; i++) {
      if (this.map.getLayer(ORDER[i])) {
        before = ORDER[i];
        break;
      }
    }
    this.map.addLayer(layer, before ?? this.beforeId());
  }

  private install(): void {
    if (this.installed) return;
    try {
      if (!this.map.isStyleLoaded() && this.map.getLayersOrder().length === 0) return;
      this.applied = { radar: -1, grid: -1 };
      this.corners = { radar: '', grid: '' };
      this.radarKey = '';
      this.gridKey = '';
      this.installed = true;
      if (this.particles) this.ensureParticleLayer();
    } catch {
      this.ev.error();
    }
  }

  private uninstall(): void {
    for (const id of [ID.particles, ID.grid, ID.radar]) this.removeLayer(id);
    for (const id of [ID.grid, ID.radar]) if (this.map.getSource(id)) this.map.removeSource(id);
    this.shade.setVeil('weather', 0);
    this.installed = false;
    this.applied = { radar: -1, grid: -1 };
  }

  private removeLayer(id: string): void {
    try {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    } catch {
      /* bereits entfernt */
    }
  }

  private ensureParticleLayer(): void {
    if (this.map.getLayer(ID.particles)) return;
    try {
      this.addInOrder(particleLayer(ID.particles, this.map, () => this.particles));
    } catch {
      /* ohne Partikel weiter */
    }
  }

  /** Canvas-Quelle samt Rasterebene anlegen bzw. Ecken nachführen. */
  private ensureCanvas(kind: 'radar' | 'grid', canvas: HTMLCanvasElement, corners: Corners): void {
    const id = ID[kind];
    const key = JSON.stringify(corners);
    const src = this.map.getSource(id) as maplibregl.CanvasSource | undefined;
    if (!src) {
      this.map.addSource(id, { type: 'canvas', canvas, coordinates: corners, animate: false });
      this.corners[kind] = key;
    } else if (this.corners[kind] !== key) {
      src.setCoordinates(corners);
      this.corners[kind] = key;
    }
    if (!this.map.getLayer(id)) {
      this.addInOrder({
        id,
        type: 'raster',
        source: id,
        paint: {
          'raster-opacity': 0,
          'raster-opacity-transition': { duration: 0, delay: 0 },
          'raster-resampling': 'linear',
          'raster-fade-duration': 0,
        },
      });
      this.applied[kind] = -1;
    }
  }

  /** Neuen Inhalt der Canvas an MapLibre übergeben (einmalig, kein Dauer-Upload). */
  private upload(id: string): void {
    const src = this.map.getSource(id) as maplibregl.CanvasSource | undefined;
    if (src && typeof src.play === 'function') {
      src.play();
      src.pause();
    }
  }

  private onMoveEnd = (): void => {
    // Lag die Quelle beim letzten Upload ausserhalb des Bilds, hat MapLibre ihn verworfen.
    if (!this.installed) return;
    this.upload(ID.radar);
    this.upload(ID.grid);
  };

  private onStyleLoad = (): void => {
    // Neuer Stil (z. B. Ersatzkarte): alle Wetter-Ebenen sind weg – neu anlegen
    // (Schleier und Beschriftungen stellt mapShade selbst wieder her).
    this.installed = false;
    if (!this.active) return;
    this.install();
    this.dirty = true;
    this.schedule();
  };

  /** Beschriftungen der Grundkarte hell (gemeinsam mit dem dunklen Modus, siehe mapShade). */
  private restyleLabels(dark: boolean): void {
    this.shade.setLabels('weather', dark);
  }

  // ── Animation ──────────────────────────────────────────────────────────────

  private schedule(): void {
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = 0;
    const dt = this.last ? Math.min(200, now - this.last) : FRAME_MS;
    if (dt < FRAME_MS - 3) {
      this.schedule();
      return;
    }
    this.last = now;
    let busy = false;
    try {
      busy = this.fade(dt) || busy;
      if (!this.installed) {
        this.last = 0;
        return;
      }
      busy = this.advance(now, dt) || busy;
      if (this.dirty) this.renderField();
      this.applyOpacities();
      if (this.particles) {
        this.particles.opacity = this.master;
        // Angehalten bewegt sich nichts – dann zeichnet die Karte nur bei Bedarf (Verschieben, Zoomen).
        this.particles.frozen = !this.playing || this.reduced;
        if (this.hours && this.master > 0.01 && !this.particles.frozen) {
          this.map.triggerRepaint();
          busy = true;
        }
      }
    } catch {
      this.ev.error();
      busy = false;
    }
    if (busy) this.schedule();
    else this.last = 0;
  };

  /** Ein-/Ausblenden (Gesamtdeckkraft, Schleier); Ebenenwechsel in der Mitte. */
  private fade(dt: number): boolean {
    const k = this.reduced ? 1 : dt / FADE_MS;
    this.master += Math.max(-k, Math.min(k, this.masterTarget - this.master));
    this.veil += Math.max(-k * VEIL_OPACITY, Math.min(k * VEIL_OPACITY, this.veilTarget - this.veil));
    if (this.pending && this.master <= 0.001) {
      const next = this.pending;
      this.pending = null;
      this.applyScene(next, this.scene);
      if (this.active) this.masterTarget = 1;
    }
    if (!this.active && this.master <= 0.001 && this.veil <= 0.001 && this.installed) {
      this.uninstall();
      return false;
    }
    return Math.abs(this.master - this.masterTarget) > 0.001 || Math.abs(this.veil - this.veilTarget) > 0.001 || !!this.pending;
  }

  private advance(now: number, dt: number): boolean {
    const steps = this.scene?.steps ?? [];
    const n = steps.length;
    if (n === 0) return false;
    if (this.playing) {
      if (this.holdUntil) {
        if (now < this.holdUntil) return true;
        // Von vorn – kurz aus- und wieder einblenden statt hart springen.
        this.holdUntil = 0;
        this.pos = 0;
        this.master = 0;
        this.dirty = true;
        this.emitPos();
        return true;
      }
      const i = Math.min(n - 2, Math.floor(this.pos));
      const a = steps[i];
      const b = steps[i + 1];
      const ms = a.kind !== b.kind ? STEP_MS.boundary : STEP_MS[a.kind];
      this.pos = Math.min(n - 1, this.pos + dt / ms);
      if (this.pos >= n - 1) this.holdUntil = now + HOLD_MS;
      this.dirty = true;
      this.emitPos();
      return true;
    }
    if (this.settleTo !== null) {
      const d = this.settleTo - this.pos;
      if (Math.abs(d) < 0.004) {
        this.pos = this.settleTo;
        this.settleTo = null;
      } else {
        this.pos += d * Math.min(1, dt / 110);
      }
      this.dirty = true;
      this.emitPos();
      return this.settleTo !== null;
    }
    return false;
  }

  private emitPos(): void {
    this.ev.pos(this.pos);
    const n = this.scene?.steps.length ?? 0;
    const idx = n ? Math.min(n - 1, Math.max(0, Math.round(this.pos))) : 0;
    if (idx !== this.lastStep) {
      this.lastStep = idx;
      this.ev.step(idx);
    }
  }

  private renderField(): void {
    this.dirty = false;
    const s = this.scene;
    if (!s || s.steps.length === 0 || !this.pal) {
      this.weights = { radar: 0, grid: 0 };
      this.hours = null;
      return;
    }
    const n = s.steps.length;
    const p = Math.min(Math.max(this.pos, 0), n - 1);
    const i = Math.min(Math.floor(p), n - 1);
    const j = Math.min(i + 1, n - 1);
    const frac = p - i;
    const A = s.steps[i];
    const B = s.steps[j];
    if (i === j || A.kind === B.kind) {
      const t = i === j ? 0 : ease(frac);
      if (A.kind === 'radar') {
        this.drawRadar(A.frame, B.kind === 'radar' && i !== j ? B.frame : null, t);
        this.weights = { radar: 1, grid: 0 };
        this.hours = null;
      } else {
        const hb = B.kind === 'forecast' && i !== j ? B.hour : null;
        this.drawGrid(A.hour, hb, t);
        this.weights = { radar: 0, grid: 1 };
        this.hours = { a: A.hour, b: hb, t };
      }
      return;
    }
    // Wechsel zwischen Messung und Prognose: beide Bilder, über die Deckkraft überblendet.
    const r = A.kind === 'radar' ? A : (B as Extract<Step, { kind: 'radar' }>);
    const f = A.kind === 'forecast' ? A : (B as Extract<Step, { kind: 'forecast' }>);
    this.drawRadar(r.frame, null, 0);
    this.drawGrid(f.hour, null, 0);
    const e = smoothstep(0.2, 0.8, frac);
    const radarW = A.kind === 'radar' ? 1 - e : e;
    this.weights = { radar: radarW, grid: 1 - radarW };
    this.hours = 1 - radarW > 0.5 ? { a: f.hour, b: null, t: 0 } : null;
  }

  private drawRadar(a: number, b: number | null, t: number): void {
    const r = this.scene?.radar;
    if (!r || !this.pal || !r.frames[a]) return;
    const key = `${this.version}|${a}|${b}|${t.toFixed(3)}`;
    if (key === this.radarKey) return;
    this.radarKey = key;
    const c = this.radarCanvas;
    if (c.width !== r.width || c.height !== r.height || !this.radarImg) {
      c.width = r.width;
      c.height = r.height;
      this.radarImg = new ImageData(r.width, r.height);
      this.radarVals = new Float32Array(r.width * r.height);
    }
    radarValues(r.frames[a], b !== null ? r.frames[b] ?? null : null, t, this.radarVals);
    colorize(this.radarVals, null, this.pal, new Uint32Array(this.radarImg.data.buffer));
    c.getContext('2d')?.putImageData(this.radarImg, 0, 0);
    this.ensureCanvas('radar', c, r.corners);
    this.upload(ID.radar);
  }

  private drawGrid(a: number, b: number | null, t: number): void {
    const g = this.scene?.grid;
    if (!g || !this.pal || !g.bytes[a]) return;
    const key = `${this.version}|${a}|${b}|${t.toFixed(3)}`;
    if (key === this.gridKey) return;
    this.gridKey = key;
    const { W, H } = g.geom;
    const c = this.gridCanvas;
    if (c.width !== W || c.height !== H || !this.gridImg) {
      c.width = W;
      c.height = H;
      this.gridImg = new ImageData(W, H);
      this.gridVals = new Float32Array(W * H);
      this.gridCov = new Float32Array(W * H);
      this.gridTmp = new Float32Array(W * H);
    }
    if (this.gridCoarse.length !== g.geom.nx * g.geom.ny) this.gridCoarse = new Float32Array(g.geom.nx * g.geom.ny);
    lerpGrid(g.bytes[a], b !== null ? g.bytes[b] ?? null : null, t, this.gridCoarse);
    renderGrid(g.geom, this.gridCoarse, this.gridVals, this.gridCov, this.gridTmp);
    colorize(this.gridVals, this.gridCov, this.pal, new Uint32Array(this.gridImg.data.buffer));
    c.getContext('2d')?.putImageData(this.gridImg, 0, 0);
    this.ensureCanvas('grid', c, g.geom.corners);
    this.upload(ID.grid);
  }

  private applyOpacities(): void {
    const set = (kind: 'radar' | 'grid', v: number) => {
      if (Math.abs(this.applied[kind] - v) < 0.004) return;
      const id = ID[kind];
      if (!this.map.getLayer(id)) return;
      this.map.setPaintProperty(id, 'raster-opacity', v);
      this.applied[kind] = v;
    };
    this.shade.setVeil('weather', this.veil);
    set('radar', this.master * this.weights.radar);
    set('grid', this.master * this.weights.grid);
  }
}
