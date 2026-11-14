/**
 * Dunkle Karte: ein Schleier zwischen Grundkarte und deren Beschriftungen,
 * dazu helle Beschriftungen. Mehrere «Besitzer» können ihn anfordern – der
 * dunkle Modus der App und die Wetterkarte. Es gilt der stärkste Wunsch; so
 * dunkeln sich die beiden nie doppelt ab, und Ausschalten des einen lässt den
 * anderen bestehen.
 */
import type * as maplibregl from 'maplibre-gl';

/** Schleier im dunklen Modus der App (Wetter: 0,7; es gilt der stärkere). */
export const DARK_MODE_VEIL = 0.8;
const VEIL_ID = 'shade-veil';
const VEIL_COLOR = '#0a1220';
/** Wetter-Ebenen liegen über dem Schleier (sonst würden sie mit abgedunkelt). */
const ABOVE_VEIL = ['wx-radar', 'wx-grid', 'wx-particles'];
const LABEL_TEXT = 'rgba(232, 238, 247, 0.94)';
const LABEL_HALO = 'rgba(10, 18, 34, 0.75)';

export class MapShade {
  private readonly veils = new Map<string, number>();
  private readonly labelOwners = new Set<string>();
  private readonly backup = new Map<string, { color: unknown; halo: unknown }>();
  private applied = 0;

  constructor(
    private readonly map: maplibregl.Map,
    /** Erste eigene Ebene der App: alles davor gehört zur Grundkarte. */
    private readonly appLayer: string,
  ) {
    map.on('style.load', this.onStyleLoad);
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
    const after = this.labelOwners.size > 0;
    if (before !== after) this.applyLabels(after);
  }

  private target(): number {
    let v = 0;
    for (const x of this.veils.values()) v = Math.max(v, x);
    return v;
  }

  /** Ebenen der Grundkarte (alles vor der ersten eigenen Ebene) mit Typ. */
  private baseLayers(): { id: string; type: string }[] {
    const order = this.map.getLayersOrder();
    const app = order.indexOf(this.appLayer);
    if (app < 0) return [];
    return order.slice(0, app).map((id) => ({ id, type: this.map.getLayer(id)?.type ?? '' }));
  }

  private beforeId(): string | undefined {
    for (const id of ABOVE_VEIL) if (this.map.getLayer(id)) return id;
    const sym = this.baseLayers().find((l) => l.type === 'symbol');
    if (sym) return sym.id;
    return this.map.getLayer(this.appLayer) ? this.appLayer : undefined;
  }

  private applyVeil(): void {
    const v = this.target();
    try {
      if (v <= 0.001) {
        if (this.map.getLayer(VEIL_ID)) this.map.removeLayer(VEIL_ID);
        this.applied = 0;
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
        this.applied = v;
        return;
      }
      if (Math.abs(this.applied - v) > 0.003) {
        this.map.setPaintProperty(VEIL_ID, 'background-opacity', v);
        this.applied = v;
      }
    } catch {
      /* Karte (noch) ohne Stil – beim nächsten Aufruf erneut */
    }
  }

  private applyLabels(dark: boolean): void {
    try {
      if (dark) {
        // Ohne eigene Ebenen ist unklar, was zur Grundkarte gehört – dann nichts umfärben.
        for (const l of this.baseLayers()) {
          if (l.type !== 'symbol' || this.backup.has(l.id)) continue;
          this.backup.set(l.id, {
            color: this.map.getPaintProperty(l.id, 'text-color'),
            halo: this.map.getPaintProperty(l.id, 'text-halo-color'),
          });
          this.map.setPaintProperty(l.id, 'text-color', LABEL_TEXT);
          this.map.setPaintProperty(l.id, 'text-halo-color', LABEL_HALO);
        }
      } else {
        for (const [id, orig] of this.backup) {
          if (!this.map.getLayer(id)) continue;
          this.map.setPaintProperty(id, 'text-color', orig.color as never);
          this.map.setPaintProperty(id, 'text-halo-color', orig.halo as never);
        }
        this.backup.clear();
      }
    } catch {
      /* Beschriftung bleibt, wie sie ist */
    }
  }

  /** Neuer Stil (Ersatzkarte): Schleier und Beschriftungen neu anlegen. */
  private onStyleLoad = (): void => {
    this.backup.clear();
    this.applied = 0;
    this.applyVeil();
    if (this.labelOwners.size > 0) this.applyLabels(true);
  };
}

const shades = new WeakMap<maplibregl.Map, MapShade>();

/** Gemeinsamer Schleier je Karte. */
export function mapShade(map: maplibregl.Map, appLayer = 'trails'): MapShade {
  let s = shades.get(map);
  if (!s) {
    s = new MapShade(map, appLayer);
    shades.set(map, s);
  }
  return s;
}
