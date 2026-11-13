'use client';

import type { LatLng, SearchResponse } from '@ch-alpineroute/shared';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResultsPanel } from '@/components/PeakrUI';
import { SearchControls, type PParams } from '@/components/SearchControls';
import { TopBar } from '@/components/PeakrChrome';
import { api, ApiError, type SearchRequest } from '@/lib/api';
import {
  adaptPoint,
  adaptResult,
  DEFAULT_ORIGIN,
  HIKE_KINDS,
  SAC,
  type MapSelection,
  type PCard,
  type PPoint,
  type SortKey,
} from '@/lib/peakr';
import { useFavorites } from '@/lib/useFavorites';
import { useSettings } from '@/lib/theme';
import { useAuthStore } from '@/lib/store';

// Echte MapLibre-Karte (swisstopo) → nur clientseitig laden.
const PeakrMap = dynamic(() => import('@/components/PeakrMap').then((m) => m.PeakrMap), {
  ssr: false,
  loading: () => <div className="map-wrap" />,
});

const PARAMS_KEY = 'peakr-params-v2';
const PAGE_SIZE = 60;

const DEFAULT_PARAMS: PParams = {
  origin: { lat: DEFAULT_ORIGIN.lat, lng: DEFAULT_ORIGIN.lng },
  originLabel: DEFAULT_ORIGIN.label,
  mode: 'hike',
  maxMin: 90,
  tolMin: 10,
  kinds: [],
  maxSac: '',
  includeUnknownSac: false,
  maxHikeMin: null,
  includeUnrouted: false,
  minElev: null,
  minSnow: null,
};

/** Gespeicherte Parameter prüfen – ein veralteter oder beschädigter Eintrag darf die Suche nicht brechen. */
function sanitize(raw: unknown): PParams {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<PParams>;
  const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
  const optNum = (v: unknown, lo: number, hi: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;
  const origin =
    p.origin && typeof p.origin.lat === 'number' && typeof p.origin.lng === 'number' ? p.origin : DEFAULT_PARAMS.origin;
  return {
    origin,
    originLabel: typeof p.originLabel === 'string' && p.originLabel ? p.originLabel : DEFAULT_PARAMS.originLabel,
    mode: p.mode === 'ski' ? 'ski' : 'hike',
    maxMin: num(p.maxMin, 15, 240, DEFAULT_PARAMS.maxMin),
    tolMin: num(p.tolMin, 0, 60, DEFAULT_PARAMS.tolMin),
    kinds: Array.isArray(p.kinds) ? HIKE_KINDS.filter((k) => (p.kinds as string[]).includes(k)) : [],
    maxSac: typeof p.maxSac === 'string' && SAC.includes(p.maxSac) ? (p.maxSac as PParams['maxSac']) : '',
    includeUnknownSac: p.includeUnknownSac === true,
    maxHikeMin: optNum(p.maxHikeMin, 10, 720),
    includeUnrouted: p.includeUnrouted === true,
    minElev: optNum(p.minElev, 0, 4700),
    minSnow: optNum(p.minSnow, 0, 500),
  };
}

function toRequest(p: PParams, origin: LatLng, sort: SortKey): SearchRequest {
  const hike = p.mode === 'hike';
  return {
    origin,
    mode: p.mode,
    maxMinutes: p.maxMin,
    toleranceMinutes: p.tolMin,
    kinds: hike && p.kinds.length > 0 ? p.kinds : undefined,
    maxSac: hike && p.maxSac ? p.maxSac : undefined,
    includeUnknownSac: hike && p.includeUnknownSac,
    maxHikeMinutes: hike && p.maxHikeMin != null ? p.maxHikeMin : undefined,
    includeUnrouted: hike && p.includeUnrouted,
    minElevationM: p.minElev ?? undefined,
    minSnowCm: !hike && p.minSnow != null ? p.minSnow : undefined,
    sort,
  };
}

export default function HomePage() {
  const router = useRouter();
  const { favs, toggle: onFav } = useFavorites();
  const { setAppMode } = useSettings();
  const { user } = useAuthStore();

  const [params, setParams] = useState<PParams>(DEFAULT_PARAMS);
  const [sort, setSort] = useState<SortKey>('score');
  const [items, setItems] = useState<PCard[]>([]);
  const [pointSet, setPointSet] = useState<{ list: PPoint[]; token: string }>({ list: [], token: '' });
  const [totals, setTotals] = useState<SearchResponse['totals'] | null>(null);
  const [meta, setMeta] = useState<SearchResponse['meta'] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinned, setPinned] = useState<PCard | null>(null);
  const [routeLine, setRouteLine] = useState<{ id: string; line: [number, number][] } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [retry, setRetry] = useState(0);
  const restored = useRef(false);
  const homeApplied = useRef(false);
  const hadSavedOrigin = useRef(false);
  /** Anfrage der aktuell angezeigten Liste – Grundlage fürs Nachladen und für Kartenklicks. */
  const current = useRef<{ req: SearchRequest; token: string } | null>(null);
  const itemsRef = useRef<PCard[]>([]);
  itemsRef.current = items;
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  // gespeicherte Parameter wiederherstellen
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(PARAMS_KEY);
      if (raw) {
        const p = sanitize(JSON.parse(raw));
        hadSavedOrigin.current = true;
        setParams(p);
        setAppMode(p.mode);
      } else {
        // Erstbesuch: in der Skisaison (Dezember bis April) mit Skigebieten beginnen.
        const month = new Date().getMonth();
        const mode = month === 11 || month <= 3 ? 'ski' : 'hike';
        setParams((p) => ({ ...p, mode }));
        setAppMode(mode);
      }
    } catch {
      /* ignore */
    } finally {
      setHydrated(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Gespeicherten Heimatort einmalig übernehmen, wenn noch kein eigener Startort gewählt wurde.
  useEffect(() => {
    if (!hydrated || homeApplied.current) return;
    if (!user?.homeLocation || !user?.homeLabel) return;
    homeApplied.current = true;
    if (!hadSavedOrigin.current) {
      setParams((p) => ({ ...p, origin: user.homeLocation!, originLabel: user.homeLabel! }));
    }
  }, [user, hydrated]);

  // Parameter erst NACH dem Wiederherstellen speichern, sonst überschreibt der erste Render die gespeicherten Werte.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(PARAMS_KEY, JSON.stringify(params));
    } catch {
      /* ignore */
    }
  }, [params, hydrated]);

  const set = useCallback(
    (patch: Partial<PParams>) => {
      if (patch.mode) {
        setAppMode(patch.mode);
        setSort('score'); // «Gehzeit» bzw. «Schnee» gibt es nur in einem der beiden Modi
      }
      setParams((p) => ({ ...p, ...patch }));
    },
    [setAppMode],
  );

  // Suche bei Parameter- oder Sortierwechsel (leicht entprellt, damit Schieberegler nicht jede Stufe abfragen).
  useEffect(() => {
    if (!hydrated || !params.origin) return;
    const req = toRequest(params, params.origin, sort);
    // Die Kartenpunkte hängen nur von den Filtern ab, nicht von der Sortierung.
    const token = JSON.stringify({ ...req, sort: undefined });
    const ctrl = new AbortController();
    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .search({ ...req, offset: 0, limit: PAGE_SIZE }, ctrl.signal)
        .then((res) => {
          const sameFilters = current.current?.token === token;
          current.current = { req, token };
          setItems(res.items.map(adaptResult));
          setTotals(res.totals);
          setMeta(res.meta);
          setHasMore(res.page.hasMore);
          if (!sameFilters) {
            setPointSet({ list: res.points.map(adaptPoint), token });
            setSelectedId(null);
            setPinned(null);
            setRouteLine(null);
          }
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setError(e instanceof ApiError ? e.message : 'Der Server ist nicht erreichbar.');
          setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [params, sort, hydrated, retry]);

  const loadMore = useCallback(() => {
    const cur = current.current;
    if (!cur || loadingMore || loading) return;
    setLoadingMore(true);
    api
      .search({ ...cur.req, offset: itemsRef.current.length, limit: PAGE_SIZE })
      .then((res) => {
        // Zwischenzeitlich neu gesucht → diese Seite gehört nicht mehr zur Liste.
        if (current.current !== cur) return;
        const seen = new Set(itemsRef.current.map((c) => c.id));
        setItems((prev) => [...prev, ...res.items.map(adaptResult).filter((c) => !seen.has(c.id))]);
        setHasMore(res.page.hasMore);
      })
      .catch(() => setHasMore(false))
      .finally(() => setLoadingMore(false));
  }, [loading, loadingMore]);

  const onLocate = () => {
    if (!('geolocation' in navigator)) {
      setLocateError('Dieser Browser kann den Standort nicht ermitteln.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({ origin: { lat: pos.coords.latitude, lng: pos.coords.longitude }, originLabel: 'Mein Standort' });
        setLocating(false);
      },
      (err) => {
        setLocateError(
          err.code === err.PERMISSION_DENIED ? 'Standortzugriff wurde nicht erlaubt.' : 'Standort konnte nicht ermittelt werden.',
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  /** Auswahl setzen. Ist die Karte des Ziels noch nicht geladen, wird genau sie nachgeholt. */
  const select = useCallback((id: string) => {
    selectedRef.current = id;
    setSelectedId(id);
    setRouteLine(null);
    const known = itemsRef.current.find((c) => c.id === id);
    if (known) {
      setPinned(known);
      return;
    }
    setPinned(null);
    const cur = current.current;
    if (!cur) return;
    api
      .search({ ...cur.req, ids: [id] })
      .then((res) => {
        const card = res.items[0];
        if (card && current.current === cur && selectedRef.current === id) setPinned(adaptResult(card));
      })
      .catch(() => undefined);
  }, []);

  const handleMapSelect = useCallback(
    (id: string) => {
      select(id);
      setSheetOpen(true);
    },
    [select],
  );

  // Verlauf der gewählten Wanderroute für die Karte laden.
  const pinnedRouteId = pinned?.hike?.routeId ?? null;
  const pinnedId = pinned?.id ?? null;
  useEffect(() => {
    if (!pinnedId || pinnedRouteId == null) return;
    const ctrl = new AbortController();
    api
      .destination(pinnedId, null, ctrl.signal)
      .then((d) => {
        const route = d.routes.find((r) => r.routeId === pinnedRouteId) ?? null;
        if (route) setRouteLine({ id: pinnedId, line: route.line });
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [pinnedId, pinnedRouteId]);

  const originPt: LatLng = params.origin ?? { lat: DEFAULT_ORIGIN.lat, lng: DEFAULT_ORIGIN.lng };

  const selection = useMemo<MapSelection | null>(() => {
    if (!selectedId) return null;
    const point = pointSet.list.find((p) => p.id === selectedId);
    const card = pinned?.id === selectedId ? pinned : null;
    if (!point && !card) return null;
    return {
      id: selectedId,
      lat: card?.lat ?? point!.lat,
      lng: card?.lng ?? point!.lng,
      trailhead: card?.trailhead ?? null,
      line: routeLine?.id === selectedId ? routeLine.line : null,
    };
  }, [selectedId, pinned, pointSet, routeLine]);

  const handleOpen = useCallback(
    (id: string) => {
      const card = itemsRef.current.find((c) => c.id === id) ?? (pinned?.id === id ? pinned : null);
      const q = new URLSearchParams({ from: `${originPt.lat.toFixed(5)},${originPt.lng.toFixed(5)}` });
      if (params.originLabel) q.set('label', params.originLabel);
      if (card?.hike) q.set('route', String(card.hike.routeId));
      router.push(`/destinations/${id}?${q.toString()}`);
    },
    [router, originPt.lat, originPt.lng, params.originLabel, pinned],
  );

  return (
    <>
      <TopBar
        centerSlot={
          <SearchControls params={params} set={set} onLocate={onLocate} locating={locating} locateError={locateError} />
        }
      />
      <div className="stage">
        <PeakrMap
          points={pointSet.list}
          fitToken={pointSet.token}
          originPt={originPt}
          selection={selection}
          onSelect={handleMapSelect}
        />
        <ResultsPanel
          items={items}
          pinned={pinned}
          totals={totals}
          hasMore={hasMore}
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          onRetry={() => setRetry((n) => n + 1)}
          onLoadMore={loadMore}
          meta={meta}
          toleranceMin={params.tolMin}
          selectedId={selectedId}
          onSelect={select}
          onOpen={handleOpen}
          favs={favs}
          onFav={onFav}
          originLabel={params.originLabel || 'Start'}
          mode={params.mode}
          sort={sort}
          onSort={setSort}
          sheetOpen={sheetOpen}
          onSheetToggle={() => setSheetOpen((v) => !v)}
        />
      </div>
      {loading && items.length > 0 && <div className="search-status">Suche läuft …</div>}
    </>
  );
}
