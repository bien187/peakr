/**
 * Sammelmarkierungen («Pulse Cluster») als schlanke HTML-Marker über der Karte.
 *
 * Gruppieren tut weiterhin die Kartenquelle (MapLibre-Clustering der Ziele); eine
 * unsichtbare WebGL-Ebene liefert, welche Zähler gerade gezeichnet werden. Diese
 * Klasse gleicht die HTML-Marker damit ab – gedrosselt, nicht bei jedem Frame –,
 * blendet neue weich ein und aufgelöste weich aus. HTML statt WebGL, weil nur so
 * Lichtschein, Tiefe, Topo-Ringe, App-Schrift und weiche Übergänge möglich sind;
 * es sind immer nur wenige Dutzend Zähler gleichzeitig, die einzelnen Ziele
 * bleiben WebGL.
 *
 * Zustände: Überfahren (CSS), Antippen (`is-active`), ausgewählt (`is-selected`:
 * enthält das gewählte Ziel), Verlassen (`is-leaving`).
 */
import type * as maplibregl from 'maplibre-gl';
import {
  clusterAriaLabel,
  clusterCategories,
  clusterInfoLine,
  clusterSize,
  clusterTier,
  formatCount,
  CLUSTER_KINDS,
  type ClusterTier,
} from './clusterStyle';
import { mapLib } from './map';

/** Lucide «Mountain» – dasselbe Bergsymbol wie im PEAKR-Zeichen. */
const PEAK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>';
/** Höchstens so oft wird beim Bewegen abgeglichen. */
const SYNC_MS = 140;
const LEAVE_MS = 170;
/** Ein Tipp, der weiter wandert, war ein Verschieben der Karte – kein Klick. */
const TAP_SLOP = 6;
/** Zähler in diesem Abstand (px) um das gewählte Ziel kommen als «enthält es» infrage. */
const SELECT_REACH = 120;
const TIERS: ClusterTier[] = ['sm', 'md', 'lg', 'xl'];

interface Entry {
  id: number;
  el: HTMLElement;
  marker: maplibregl.Marker;
  lngLat: [number, number];
  key: string;
  tier: ClusterTier;
  leaving: boolean;
}

type Props = Record<string, unknown>;

export class ClusterMarkers {
  private readonly entries = new Map<number, Entry>();
  private readonly compactQuery = window.matchMedia('(max-width: 860px)');
  private readonly reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSync = 0;
  private destroyed = false;
  private selection: { id: string; lngLat: [number, number] } | null = null;
  private selected: number | null = null;
  /** Zähler-ID → enthält das gewählte Ziel (null = Abfrage läuft). */
  private readonly checked = new Map<number, boolean | null>();

  constructor(
    private readonly map: maplibregl.Map,
    private readonly sourceId: string,
    /** Unsichtbare Kreisebene der Zähler (Lage und Eigenschaften der gezeichneten Zähler). */
    private readonly hitLayer: string,
    /** Bis zu dieser Zoomstufe gruppiert die Quelle. */
    private readonly maxZoom: number,
  ) {
    map.on('render', this.onRender);
    map.on('moveend', this.sync);
    map.on('idle', this.sync);
    this.compactQuery.addEventListener('change', this.onCompact);
  }

  /** Gewähltes Ziel; der Zähler, der es enthält, wird hervorgehoben. */
  setSelection(sel: { id: string; lngLat: [number, number] } | null): void {
    if (sel?.id === this.selection?.id && sel?.lngLat[0] === this.selection?.lngLat[0]) return;
    this.selection = sel;
    this.checked.clear();
    this.mark(null);
    this.findSelected();
  }

  /** Neue Daten in der Quelle: Zähler-IDs bekommen neue Bedeutung. */
  dataChanged(): void {
    this.checked.clear();
    this.schedule(0);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.map.off('render', this.onRender);
    this.map.off('moveend', this.sync);
    this.map.off('idle', this.sync);
    this.compactQuery.removeEventListener('change', this.onCompact);
    for (const e of this.entries.values()) e.marker.remove();
    this.entries.clear();
  }

  // ── Abgleich ───────────────────────────────────────────────────────────────

  private onRender = (): void => {
    const since = performance.now() - this.lastSync;
    if (since >= SYNC_MS) this.sync();
    else this.schedule(SYNC_MS - since);
  };

  private schedule(ms: number): void {
    if (this.timer) return;
    this.timer = setTimeout(this.sync, ms);
  }

  private sync = (): void => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lastSync = performance.now();
    if (this.destroyed || !this.map.getLayer(this.hitLayer)) return;
    let features: maplibregl.MapGeoJSONFeature[];
    try {
      features = this.map.queryRenderedFeatures({ layers: [this.hitLayer] });
    } catch {
      return; // Stil wird gerade ersetzt
    }
    const seen = new Set<number>();
    for (const f of features) {
      const p = f.properties as Props;
      const id = p.cluster_id;
      if (typeof id !== 'number' || seen.has(id) || f.geometry.type !== 'Point') continue;
      seen.add(id);
      const lngLat = f.geometry.coordinates as [number, number];
      const existing = this.entries.get(id);
      if (!existing) this.entries.set(id, this.create(id, lngLat, p));
      else {
        if (existing.leaving) {
          existing.leaving = false;
          existing.el.classList.remove('is-leaving');
        }
        this.apply(existing, p);
      }
    }
    for (const [id, e] of this.entries) if (!seen.has(id) && !e.leaving) this.leave(id, e);
    this.findSelected();
  };

  // ── Marker ─────────────────────────────────────────────────────────────────

  private create(id: number, lngLat: [number, number], p: Props): Entry {
    const el = document.createElement('div');
    el.className = 'pk-cl';
    el.innerHTML =
      `<span class="pk-cl-body"><span class="pk-cl-rings" aria-hidden="true"></span>${PEAK_SVG}` +
      '<span class="pk-cl-n"></span></span><span class="pk-cl-info" aria-hidden="true"></span>';
    const marker = new (mapLib().Marker)({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(this.map);
    // Nach dem Anhängen setzen: MapLibre vergibt eigene Werte (z. B. aria-label «Map marker»).
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    const entry: Entry = { id, el, marker, lngLat, key: '', tier: 'sm', leaving: false };
    this.apply(entry, p);

    // Antippen/Klicken über Pointer-Ereignisse: auf dem Handy unterdrückt die Karte das
    // synthetische «click» nach einem Tipp. Wer die Karte verschiebt, löst nichts aus.
    let down: { x: number; y: number; t: number } | null = null;
    let suppressClickUntil = 0;
    const release = () => setTimeout(() => el.classList.remove('is-active'), 140);
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0) return;
      down = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
      el.classList.add('is-active');
    });
    el.addEventListener('pointerup', (ev) => {
      release();
      const d = down;
      down = null;
      if (!d) return;
      suppressClickUntil = performance.now() + 500;
      const moved = Math.hypot(ev.clientX - d.x, ev.clientY - d.y);
      if (moved > TAP_SLOP || ev.timeStamp - d.t > 700) return;
      this.zoomInto(entry);
    });
    el.addEventListener('pointercancel', () => {
      down = null;
      release();
    });
    el.addEventListener('click', (ev) => {
      // Nicht an die Karte weitergeben (sonst gälte es als Tipp ins Leere).
      ev.stopPropagation();
      // Schon über pointerup erledigt – «click» nur für Tastatur und Screenreader.
      if (performance.now() < suppressClickUntil) return;
      this.zoomInto(entry);
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this.zoomInto(entry);
      }
    });
    return entry;
  }

  /** Inhalt, Grösse und Stufe aus den Eigenschaften des Zählers. */
  private apply(e: Entry, p: Props): void {
    const count = typeof p.point_count === 'number' ? p.point_count : Number(p.point_count) || 0;
    const compact = this.compactQuery.matches;
    const key = `${count}|${compact}|${CLUSTER_KINDS.map((k) => p[k] ?? 0).join(',')}`;
    if (key === e.key) return;
    e.key = key;
    const tier = clusterTier(count);
    e.tier = tier;
    const size = clusterSize(count, compact);
    const cats = clusterCategories(p);
    const el = e.el;
    for (const t of TIERS) el.classList.toggle(`is-${t}`, t === tier);
    el.classList.toggle('is-ski', typeof p.ski === 'number' && p.ski > 0);
    el.style.setProperty('--d', `${size}px`);
    el.style.setProperty('--fs', `${Math.min(18, Math.max(12, Math.round(size * 0.27)))}px`);
    el.style.setProperty('--ic', `${Math.max(8, Math.round(size * 0.19))}px`);
    // Grössere Zähler liegen über kleineren, der ausgewählte über allen.
    el.style.zIndex = this.selected === e.id ? '10' : String(TIERS.indexOf(tier) + 1);
    (el.querySelector('.pk-cl-n') as HTMLElement).textContent = formatCount(count);
    (el.querySelector('.pk-cl-info') as HTMLElement).textContent = compact ? '' : (clusterInfoLine(count, cats) ?? '');
    el.setAttribute('aria-label', clusterAriaLabel(count, cats));
  }

  private leave(id: number, e: Entry): void {
    e.leaving = true;
    e.el.classList.add('is-leaving');
    if (this.selected === id) this.selected = null;
    setTimeout(
      () => {
        if (!e.leaving || this.entries.get(id) !== e) return;
        e.marker.remove();
        this.entries.delete(id);
        this.checked.delete(id);
      },
      this.reducedQuery.matches ? 0 : LEAVE_MS,
    );
  }

  private zoomInto(e: Entry): void {
    const src = this.map.getSource(this.sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    void src
      .getClusterExpansionZoom(e.id)
      .then((zoom) => this.map.easeTo({ center: e.lngLat, zoom: zoom + 0.3 }))
      .catch(() => undefined);
  }

  private onCompact = (): void => {
    for (const e of this.entries.values()) e.key = '';
    this.sync();
  };

  // ── Auswahl ────────────────────────────────────────────────────────────────

  private mark(id: number | null): void {
    if (this.selected === id) return;
    const prev = this.selected !== null ? this.entries.get(this.selected) : undefined;
    if (prev) {
      prev.el.classList.remove('is-selected');
      prev.el.style.zIndex = String(TIERS.indexOf(prev.tier) + 1);
    }
    this.selected = id;
    const el = id !== null ? this.entries.get(id)?.el : null;
    if (el) {
      el.classList.add('is-selected');
      el.style.zIndex = '10';
    }
  }

  /** Welcher Zähler enthält das gewählte Ziel? Nur nahe Kandidaten, Ergebnis gemerkt. */
  private findSelected(): void {
    const sel = this.selection;
    if (!sel || this.map.getZoom() >= this.maxZoom + 1) {
      this.mark(null);
      return;
    }
    if (this.selected !== null && this.entries.has(this.selected) && !this.entries.get(this.selected)!.leaving) return;
    const src = this.map.getSource(this.sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const at = this.map.project(sel.lngLat);
    const near = [...this.entries.values()]
      .filter((e) => !e.leaving)
      .map((e) => {
        const p = this.map.project(e.lngLat);
        return { e, d: Math.hypot(p.x - at.x, p.y - at.y) };
      })
      .filter((x) => x.d <= SELECT_REACH)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    this.mark(null);
    for (const { e } of near) {
      const known = this.checked.get(e.id);
      if (known === true) {
        this.mark(e.id);
        return;
      }
      if (known !== undefined) continue; // false oder Abfrage läuft
      this.checked.set(e.id, null);
      void src
        .getClusterLeaves(e.id, Infinity, 0)
        .then((leaves) => {
          const has = leaves.some((f) => (f.properties as Props | null)?.id === sel.id);
          this.checked.set(e.id, has);
          if (has && this.selection === sel && this.entries.has(e.id)) this.mark(e.id);
        })
        .catch(() => this.checked.delete(e.id));
    }
  }
}
