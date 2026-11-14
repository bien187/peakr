/**
 * Aussehen der Grundkarte – gemeinsam für den dunklen Modus der App und die
 * Wetterkarte:
 *
 *  - **Dunkler Modus:** echte dunkle Variante (lib/darkStyle.ts). Flächen
 *    dunkel, Strassen, Wege und Markierungen hell hervorgehoben, Beschriftungen
 *    hell – so gut lesbar wie im hellen Modus. Kein Schleier.
 *  - **Wetterkarte:** dunkler Schleier zwischen Grundkarte und Beschriftungen,
 *    Beschriftungen hell. Hier darf die Karte zurücktreten.
 *
 * Mehrere «Besitzer» können Schleier und helle Beschriftungen anfordern; es gilt
 * der stärkste Wunsch. Ist die Karte schon dunkel, fällt der Schleier schwächer
 * aus. Die Werte des hellen Stils werden gemerkt und beim Zurückschalten
 * wiederhergestellt.
 */
import type * as maplibregl from 'maplibre-gl';
import { COLOR_PROPS, darkRole, darkValue, PAINT_DEFAULT } from './darkStyle';

const VEIL_ID = 'shade-veil';
const VEIL_COLOR = '#0a1220';
/** Auf der schon dunklen Karte braucht das Wetter nur einen leichten Schleier. */
const VEIL_SCALE_DARK = 0.55;
/** Wetter-Ebenen liegen über dem Schleier (sonst würden sie mit abgedunkelt). */
const ABOVE_VEIL = ['wx-radar', 'wx-grid', 'wx-particles'];
const LABEL_TEXT = 'rgba(232, 238, 247, 0.94)';
const LABEL_HALO = 'rgba(10, 18, 34, 0.75)';

export class MapShade {
  private dark = false;
  private readonly veils = new Map<string, number>();
  private readonly labelOwners = new Set<string>();
  /** Werte des hellen Stils je «Ebene|Eigenschaft» (beim ersten Anfassen gemerkt). */
  private readonly originals = new Map<string, unknown>();
  /** Zuletzt gesetzter Wert (JSON) je «Ebene|Eigenschaft». */
  private readonly applied = new Map<string, string>();
  private veilApplied = 0;

  constructor(
    private readonly map: maplibregl.Map,
    /** Erste eigene Ebene der App: alles davor gehört zur Grundkarte. */
    private readonly appLayer: string,
  ) {
    map.on('style.load', this.onStyleLoad);
  }

  /** Dunkle Variante der Grundkarte an/aus. */
  setDark(on: boolean): void {
    if (on === this.dark) return;
    this.dark = on;
    this.applyPaint();
    this.applyVeil();
  }

  /** Schleier-Deckkraft eines Besitzers (0 = kein Wunsch). */
  setVeil(owner: string, opacity: number): void {
    if (opacity > 0.001) this.veils.set(owner, opacity);
    else this.veils.delete(owner);
    this.applyVeil();
  }

  /** Helle Beschriftungen für einen Besitzer an/aus. */
  setLabels(owner: string, on: boolean): void {
    const before = this.labelOwners.size > 0;
    if (on) this.labelOwners.add(owner);
    else this.labelOwners.delete(owner);
    if (before !== this.labelOwners.size > 0) this.applyPaint();
  }

  /** Ebenen der Grundkarte (alles vor der ersten eigenen Ebene) mit Typ. */
  private baseLayers(): { id: string; type: string }[] {
    const order = this.map.getLayersOrder();
    const app = order.indexOf(this.appLayer);
    if (app < 0) return []; // ohne eigene Ebenen ist unklar, was zur Grundkarte gehört
    return order.slice(0, app).map((id) => ({ id, type: this.map.getLayer(id)?.type ?? '' }));
  }

  private applyPaint(): void {
    const labels = this.labelOwners.size > 0;
    try {
      for (const { id, type } of this.baseLayers()) {
        if (id === VEIL_ID) continue;
        for (const prop of COLOR_PROPS[type] ?? []) {
          const key = `${id}|${prop}`;
          if (!this.originals.has(key)) this.originals.set(key, this.map.getPaintProperty(id, prop as never));
          const orig = this.originals.get(key);
          let want: unknown = orig;
          if (this.dark) {
            const role = darkRole(id, type, prop);
            if (role) {
              if (orig !== undefined) want = darkValue(role, orig);
              else if (PAINT_DEFAULT[prop]) want = darkValue(role, PAINT_DEFAULT[prop]);
            }
          } else if (labels && type === 'symbol') {
            if (prop === 'text-color') want = LABEL_TEXT;
            else if (prop === 'text-halo-color') want = LABEL_HALO;
          }
          const sig = JSON.stringify(want ?? null);
          const prev = this.applied.get(key) ?? JSON.stringify(orig ?? null);
          if (sig === prev) continue;
          this.map.setPaintProperty(id, prop as never, want as never);
          this.applied.set(key, sig);
        }
      }
    } catch {
      /* Karte (noch) ohne Stil – beim nächsten Aufruf erneut */
    }
  }

  private beforeId(): string | undefined {
    for (const id of ABOVE_VEIL) if (this.map.getLayer(id)) return id;
    const sym = this.baseLayers().find((l) => l.type === 'symbol');
    if (sym) return sym.id;
    return this.map.getLayer(this.appLayer) ? this.appLayer : undefined;
  }

  private applyVeil(): void {
    let v = 0;
    for (const x of this.veils.values()) v = Math.max(v, x);
    if (this.dark) v *= VEIL_SCALE_DARK;
    try {
      if (v <= 0.001) {
        if (this.map.getLayer(VEIL_ID)) this.map.removeLayer(VEIL_ID);
        this.veilApplied = 0;
        return;
      }
      if (!this.map.getLayer(VEIL_ID)) {
        this.map.addLayer(
          {
            id: VEIL_ID,
            type: 'background',
            paint: { 'background-color': VEIL_COLOR, 'background-opacity': v, 'background-opacity-transition': { duration: 0, delay: 0 } },
          },
          this.beforeId(),
        );
        this.veilApplied = v;
        return;
      }
      if (Math.abs(this.veilApplied - v) > 0.003) {
        this.map.setPaintProperty(VEIL_ID, 'background-opacity', v);
        this.veilApplied = v;
      }
    } catch {
      /* Karte (noch) ohne Stil */
    }
  }

  /** Neuer Stil (Ersatzkarte): alles neu anwenden. */
  private onStyleLoad = (): void => {
    this.originals.clear();
    this.applied.clear();
    this.veilApplied = 0;
    this.applyPaint();
    this.applyVeil();
  };
}

const shades = new WeakMap<maplibregl.Map, MapShade>();

/** Gemeinsames Kartenaussehen je Karte. */
export function mapShade(map: maplibregl.Map, appLayer = 'trails'): MapShade {
  let s = shades.get(map);
  if (!s) {
    s = new MapShade(map, appLayer);
    shades.set(map, s);
  }
  return s;
}
