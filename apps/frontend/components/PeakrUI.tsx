'use client';

import { memo, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { AVAILABILITY_LABEL, type Availability, type SearchResponse } from '@ch-alpineroute/shared';
import { Icon } from './Icon';
import {
  AVALANCHE,
  classLabel,
  fmtAge,
  fmtDate,
  fmtDrive,
  fmtDuration,
  KIND_META,
  planLabel,
  reasonSummary,
  scoreColor,
  SORTS,
  trailheadHint,
  trailheadLabel,
  weatherInfo,
  type DestKind,
  type PCard,
  type SortKey,
} from '@/lib/peakr';

type CSSVars = CSSProperties & Record<string, string | number>;
const dash = (v: number | null | undefined): string | number => (v == null ? '–' : v);
const nf = new Intl.NumberFormat('de-CH');

export function ScoreDot({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={'score-dot score-' + size}
      style={{ '--sc': scoreColor(score) } as CSSVars}
      title={`Bewertung ${score} von 100 – aus Bedingungen, Bedeutung des Ziels und Datenlage`}
    >
      <span className="score-num">{score}</span>
    </span>
  );
}

/** Zeigt die Zielart (Gipfel/See/Hütte/…). */
export function TypeChip({ kind }: { kind: DestKind }) {
  const m = KIND_META[kind];
  return (
    <span className="type-chip" title={m.label}>
      <Icon name={m.icon} size={13} stroke={2} />
      <span>{m.label}</span>
    </span>
  );
}

/** Sich drehender Kompass als Ladeanzeige. */
export function CompassLoader({ label }: { label?: string }) {
  return (
    <div className="compass-loader" role="status" aria-live="polite">
      <Icon name="Compass" size={34} stroke={1.75} className="compass-spin" />
      {label && <p className="compass-loader-t">{label}</p>}
    </div>
  );
}

export function AvalancheTag({ level, compact }: { level: number | null; compact?: boolean }) {
  if (level == null)
    return (
      <span className="ava-tag ava-na" title="Für diese Region liegt aktuell kein SLF-Lawinenbulletin vor.">
        Lawine: kein Bulletin
      </span>
    );
  const a = AVALANCHE[level] ?? AVALANCHE[1];
  return (
    <span
      className="ava-tag"
      style={{ '--av': a.color, '--avt': a.text } as CSSVars}
      title={`Lawinengefahr Stufe ${level} – ${a.label} (SLF). Ersetzt nicht das Bulletin.`}
    >
      <span className="ava-pips">
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} data-on={i <= level ? '1' : '0'} />
        ))}
      </span>
      {!compact && (
        <span>
          Stufe {level} · {a.label}
        </span>
      )}
    </span>
  );
}

export function WeatherChip({
  code,
  temp,
  approx,
}: {
  code: number | null;
  temp: number | null;
  /** Temperatur ist aus dem Wetterraster auf die Zielhöhe umgerechnet. */
  approx?: boolean;
}) {
  const w = weatherInfo(code, temp);
  return (
    <span className="wx-chip" title={approx ? 'Temperatur aus dem Wetterraster auf die Zielhöhe umgerechnet (Näherung)' : undefined}>
      <Icon name={w.icon} size={15} stroke={1.75} />
      <span>{w.label}</span>
      {temp != null && (
        <span className="wx-temp">
          {approx ? '≈ ' : ''}
          {Math.round(temp)}°
        </span>
      )}
    </span>
  );
}

export function Stat({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {unit && value !== '–' && <span className="stat-unit"> {unit}</span>}
      </span>
    </div>
  );
}

/** Zeile «Auto → Ausgangspunkt»: Fahrzeit, Strecke und wohin sie führt. */
export function DriveLine({ r }: { r: PCard }) {
  if (r.driveMin == null) {
    const why =
      r.routingStatus === 'unavailable'
        ? 'Fahrzeit derzeit nicht berechenbar'
        : r.type === 'ski'
          ? 'Keine Strassenzufahrt gefunden'
          : 'Keine Wanderroute bekannt – Fahrzeit nicht berechnet';
    return (
      <p className="rcard-drive is-none">
        <Icon name="CircleAlert" size={14} stroke={2} />
        <span>{why}</span>
        {r.airKm > 0 && <span className="mono rcard-air">Luftlinie {nf.format(r.airKm)} km</span>}
      </p>
    );
  }
  const th = r.trailhead;
  return (
    <p className="rcard-drive" title={th ? trailheadHint(th) : undefined}>
      <Icon name="Car" size={14} stroke={2} />
      <span className="mono rcard-drive-t">{fmtDrive(r.driveMin)}</span>
      {r.driveKm != null && <span className="mono rcard-drive-km">{nf.format(Math.round(r.driveKm))} km</span>}
      {th && (
        <>
          <Icon name="ArrowRight" size={12} stroke={2} className="rcard-drive-arrow" />
          <Icon name={th.kind === 'valley_station' ? 'CableCar' : 'SquareParking'} size={14} stroke={2} />
          <span className="rcard-drive-th">{trailheadLabel(th)}</span>
        </>
      )}
      {r.section === 'suggestion' && r.over > 0 && <span className="over-pill">+{r.over} min</span>}
    </p>
  );
}

const AV_ICON: Record<string, string> = { available: 'Check', uncertain: 'CircleHelp', unavailable: 'CircleAlert' };

/** Verfügbarkeit als Symbol + Text (nie nur Farbe). */
export function AvailabilityBadge({ a, compact = false }: { a: Availability; compact?: boolean }) {
  const label = AVAILABILITY_LABEL[a.status];
  return (
    <span className={'av-badge is-' + a.status} title={a.reason ?? (a.status === 'available' ? 'Alle Prüfungen bestanden' : label)}>
      <Icon name={AV_ICON[a.status]} size={compact ? 12 : 13} stroke={2.4} />
      <span>{label}</span>
    </span>
  );
}

export const ResultCard = memo(function ResultCard({
  r,
  selected,
  onSelect,
  onOpen,
  isFav,
  onFav,
}: {
  r: PCard;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  isFav: boolean;
  onFav: (id: string) => void;
}) {
  const isSki = r.type === 'ski';
  const cls = classLabel(r.objectClass);
  const th = r.trailhead;
  const notes: string[] = [];
  if (th?.kind === 'road_access') notes.push('Parkplatz nicht bestätigt');
  if (r.routingStatus === 'partial' && th?.roadGapM != null) {
    notes.push(`Strasse endet ${(th.roadGapM / 1000).toFixed(1)} km vor der Talstation (autofrei)`);
  }
  if (r.blockedReason) notes.push(r.blockedReason);
  if (isSki && r.liftsOpen == null && r.liftsTotal != null) notes.push('Liftstatus: keine Live-Quelle');

  return (
    <article
      className={'rcard' + (selected ? ' is-sel' : '') + (r.section !== 'result' ? ' is-sug' : '')}
      onClick={() => onSelect(r.id)}
    >
      <div className="rcard-top">
        <div className="rcard-rank">
          <ScoreDot score={r.score} />
        </div>
        <div className="rcard-head">
          <h3 className="rcard-name">{r.name}</h3>
          <p className="rcard-sub">
            {r.canton && <span>{r.canton}</span>}
            {r.canton && r.topM != null && <span className="dot-sep" />}
            {r.topM != null && <span className="mono">{nf.format(r.topM)} m</span>}
            {cls && cls !== KIND_META[r.kind].label && (
              <>
                <span className="dot-sep" />
                <span>{cls}</span>
              </>
            )}
          </p>
        </div>
        <TypeChip kind={r.kind} />
      </div>

      <DriveLine r={r} />

      {r.availability && (
        <p className={'rcard-av is-' + r.availability.status}>
          <AvailabilityBadge a={r.availability} compact />
          {r.availability.reason && <span className="rcard-av-why">{r.availability.reason}</span>}
        </p>
      )}

      <div className="rcard-stats is-4">
        {isSki ? (
          <>
            <Stat label="Schnee Berg" value={dash(r.snowTop)} unit="cm" />
            <Stat label="Neuschnee" value={dash(r.fresh)} unit="cm" />
            {r.liftsOpen != null ? (
              <Stat label="Lifte offen" value={`${r.liftsOpen}/${dash(r.liftsTotal)}`} />
            ) : (
              <Stat label="Anlagen" value={dash(r.liftsTotal)} />
            )}
            <Stat label="Pisten" value={r.pisteKm != null ? nf.format(Math.round(r.pisteKm)) : '–'} unit="km" />
          </>
        ) : r.hike ? (
          <>
            <Stat label="Gehzeit ↑" value={fmtDuration(r.hike.minUp)} />
            <Stat label="Strecke" value={r.hike.km.toFixed(1)} unit="km" />
            <Stat label="Aufstieg" value={nf.format(r.hike.up)} unit="m" />
            <Stat label="SAC" value={r.hike.sacKnown ? r.hike.sacLabel : 'unbekannt'} />
          </>
        ) : (
          <>
            <Stat label="Gehzeit ↑" value="–" />
            <Stat label="Strecke" value="–" />
            <Stat label="Aufstieg" value="–" />
            <Stat label="SAC" value="unbekannt" />
          </>
        )}
      </div>

      {notes.length > 0 && (
        <p className="rcard-note">
          <Icon name="Info" size={12} stroke={2} />
          <span>{notes.join(' · ')}</span>
        </p>
      )}

      <div className="rcard-foot">
        <WeatherChip code={r.weather} temp={r.temp} approx={r.tempAdjusted} />
        {isSki && <AvalancheTag level={r.avalanche} compact />}
        {!isSki && r.hike && r.hike.variants > 0 && (
          <span className="rcard-more" title="Weitere Routenvarianten, die zu den Filtern passen">
            +{r.hike.variants} {r.hike.variants === 1 ? 'Variante' : 'Varianten'}
          </span>
        )}
        {r.quality != null && (
          <span
            className="q-tag"
            title="Datenlage: wie vollständig die Angaben zu diesem Ziel sind. Sagt nichts über Existenz oder Wanderbarkeit."
          >
            Daten {r.quality}
          </span>
        )}
        <div className="rcard-actions">
          <button
            type="button"
            className="icon-btn"
            title={isFav ? 'Favorit entfernen' : 'Zu Favoriten'}
            aria-pressed={isFav}
            onClick={(e) => {
              e.stopPropagation();
              onFav(r.id);
            }}
          >
            <Icon
              name="Star"
              size={17}
              stroke={2}
              style={{ fill: isFav ? 'var(--accent)' : 'none', color: isFav ? 'var(--accent)' : 'var(--ink-3)' }}
            />
          </button>
          <button
            type="button"
            className="btn-text"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(r.id);
            }}
          >
            Details <Icon name="ArrowRight" size={14} stroke={2} />
          </button>
        </div>
      </div>
    </article>
  );
});

const SECTION_HEAD: Record<string, { hike: string; ski: string; hint: (tol: number) => string }> = {
  suggestion: {
    hike: 'Knapp ausserhalb',
    ski: 'Knapp ausserhalb',
    hint: (tol) => `Bis ${tol} min über deinem Fahrzeit-Limit.`,
  },
  sac_unknown: {
    hike: 'Schwierigkeit unbekannt',
    ski: 'Schwierigkeit unbekannt',
    hint: () => 'In Reichweite, aber die Route hat keine bekannte SAC-Einstufung – deshalb nicht bei den Treffern.',
  },
  unrouted: {
    hike: 'Ohne bekannte Route',
    ski: 'Ohne Strassenzufahrt',
    hint: () => 'Reale Ziele ohne berechenbare Anreise. Fahrzeit und Route werden nicht geschätzt.',
  },
};

export function ResultsPanel({
  items,
  pinned,
  totals,
  hasMore,
  loading,
  loadingMore,
  error,
  onRetry,
  onLoadMore,
  meta,
  toleranceMin,
  selectedId,
  onSelect,
  onOpen,
  favs,
  onFav,
  originLabel,
  mode,
  sort,
  onSort,
  sheetOpen,
  onSheetToggle,
  includeUncertain,
  onIncludeUncertain,
}: {
  items: PCard[];
  /** Ausgewähltes Ziel – steht zuoberst, auch wenn seine Seite noch nicht geladen ist. */
  pinned: PCard | null;
  totals: SearchResponse['totals'] | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  meta: SearchResponse['meta'] | null;
  toleranceMin: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  favs: Set<string>;
  onFav: (id: string) => void;
  originLabel: string;
  mode: 'ski' | 'hike';
  sort: SortKey;
  onSort: (s: SortKey) => void;
  sheetOpen: boolean;
  onSheetToggle: () => void;
  includeUncertain: boolean;
  onIncludeUncertain: (v: boolean) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Nachladen, sobald das Listenende in Sicht kommt.
  useEffect(() => {
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && onLoadMore(), {
      root,
      rootMargin: '600px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore, items.length]);

  // Auswahl (z. B. per Klick auf die Karte) steht zuoberst → dorthin scrollen.
  useEffect(() => {
    if (selectedId) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedId]);

  const count = totals?.results ?? 0;
  const unavailable = meta?.routing.status === 'unavailable';
  const total = totals ? totals.results + totals.suggestions + totals.sacUnknown + totals.unrouted : 0;
  const hiddenUncertain = totals?.hiddenUncertain ?? 0;
  const excluded = totals?.excludedUnavailable ?? 0;

  const rows: ReactNode[] = [];
  let lastSection: string | null = pinned ? 'pinned' : null;
  if (pinned) {
    rows.push(
      <div className="sug-head" key="h-pinned">
        <span>Ausgewählt</span>
        <span className="sug-rule" />
      </div>,
      <ResultCard
        key={'pin-' + pinned.id}
        r={pinned}
        selected
        onSelect={onSelect}
        onOpen={onOpen}
        isFav={favs.has(pinned.id)}
        onFav={onFav}
      />,
    );
  }
  for (const card of items) {
    if (card.id === pinned?.id) continue;
    if (card.section !== lastSection) {
      const head = SECTION_HEAD[card.section];
      const n =
        card.section === 'suggestion'
          ? totals?.suggestions
          : card.section === 'sac_unknown'
            ? totals?.sacUnknown
            : card.section === 'unrouted'
              ? totals?.unrouted
              : totals?.results;
      if (head) {
        rows.push(
          <div className="sec-head" key={'h-' + card.section}>
            <div className="sug-head">
              <span>
                {head[mode]}
                {n != null ? ` · ${nf.format(n)}` : ''}
              </span>
              <span className="sug-rule" />
            </div>
            <p className="sec-hint">{head.hint(toleranceMin)}</p>
          </div>,
        );
      } else if (lastSection === 'pinned') {
        rows.push(
          <div className="sug-head" key="h-result">
            <span>In Reichweite{n != null ? ` · ${nf.format(n)}` : ''}</span>
            <span className="sug-rule" />
          </div>,
        );
      }
      lastSection = card.section;
    }
    rows.push(
      <ResultCard
        key={card.id}
        r={card}
        selected={card.id === selectedId}
        onSelect={onSelect}
        onOpen={onOpen}
        isFav={favs.has(card.id)}
        onFav={onFav}
      />,
    );
  }

  const extra: string[] = [];
  if (totals && totals.suggestions > 0) extra.push(`${nf.format(totals.suggestions)} knapp ausserhalb`);
  if (totals && totals.sacUnknown > 0) extra.push(`${nf.format(totals.sacUnknown)} mit unbekannter Schwierigkeit`);
  if (totals && totals.unrouted > 0) extra.push(`${nf.format(totals.unrouted)} ohne Route`);

  return (
    <div className={'panel' + (sheetOpen ? ' sheet-open' : '')}>
      <div className="panel-handle" onClick={onSheetToggle}>
        <span />
      </div>

      <div className="panel-head" onClick={sheetOpen ? undefined : onSheetToggle}>
        <div>
          <p className="panel-eyebrow">
            {mode === 'ski' ? 'Skigebiete' : 'Wanderziele'} · ab {originLabel}
            {meta?.plan ? ` · ${planLabel(mode === 'ski' ? { ...meta.plan, startHour: 9 } : meta.plan)}` : ''}
          </p>
          <h2 className="panel-title">
            {loading && !totals ? '…' : nf.format(count)} {count === 1 ? 'Ziel' : 'Ziele'}{' '}
            <span className="panel-title-sub">{includeUncertain ? 'in Reichweite' : 'verfügbar'}</span>
          </h2>
          {extra.length > 0 && <p className="panel-extra">+ {extra.join(' · ')}</p>}
        </div>
        <button type="button" className="sheet-close" onClick={onSheetToggle} aria-label="Liste schliessen">
          <Icon name="ChevronDown" size={20} />
        </button>
      </div>

      <div className="panel-sort">
        <span className="sort-label">Sortieren</span>
        <div className="seg">
          {SORTS[mode].map((s) => (
            <button
              key={s.value}
              type="button"
              className={'seg-btn' + (sort === s.value ? ' is-on' : '')}
              onClick={() => onSort(s.value)}
              aria-pressed={sort === s.value}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className={'panel-scroll' + (loading ? ' is-loading' : '')} ref={scrollRef}>
        {error ? (
          <div className="empty">
            <Icon name="CircleAlert" size={26} stroke={1.5} />
            <p className="empty-title">Suche fehlgeschlagen</p>
            <p className="empty-sub">{error}</p>
            <button type="button" className="btn btn-sm" onClick={onRetry} style={{ marginTop: 10 }}>
              Erneut versuchen
            </button>
          </div>
        ) : unavailable ? (
          <div className="empty">
            <Icon name="CircleAlert" size={26} stroke={1.5} />
            <p className="empty-title">Fahrzeiten nicht verfügbar</p>
            <p className="empty-sub">
              Strassennetz oder Suchdaten sind auf dem Server nicht geladen. Peakr zeigt dann lieber keine Treffer als
              geschätzte Fahrzeiten.
            </p>
          </div>
        ) : (loading || !totals) && items.length === 0 ? (
          // Auch vor der ersten Antwort laden statt kurz «keine Ziele» zu zeigen.
          <CompassLoader label="Fahrzeiten werden berechnet …" />
        ) : total === 0 && hiddenUncertain > 0 ? (
          <div className="empty">
            <Icon name="CircleHelp" size={26} stroke={1.5} />
            <p className="empty-title">Keine Ziele mit gesicherter Verfügbarkeit</p>
            <p className="empty-sub">
              {mode === 'ski'
                ? 'Für kein Skigebiet in Reichweite gibt es einen frei nutzbaren Live-Betriebsstatus. Peakr zeigt deshalb keines als geöffnet an.'
                : `${nf.format(hiddenUncertain)} Ziele sind in Reichweite, aber die Datenlage reicht nicht für «verfügbar».`}
            </p>
            <button type="button" className="btn btn-sm" onClick={() => onIncludeUncertain(true)} style={{ marginTop: 10 }}>
              Unsichere Ziele zeigen
            </button>
          </div>
        ) : total === 0 ? (
          <div className="empty">
            <Icon name="MapPinOff" size={26} stroke={1.5} />
            <p className="empty-title">Keine Ziele in Reichweite</p>
            <p className="empty-sub">
              {excluded > 0
                ? `${nf.format(excluded)} Ziele in Reichweite sind zur geplanten Zeit nicht verfügbar (${reasonSummary(totals?.hiddenReasons)}).`
                : 'Erhöhe die Fahrzeit oder lockere die Filter, um mehr zu sehen.'}
            </p>
          </div>
        ) : (
          <>
            {rows}
            {hasMore && (
              <div ref={sentinelRef} className="panel-more">
                <button type="button" className="btn btn-soft btn-sm" onClick={onLoadMore} disabled={loadingMore}>
                  {loadingMore ? 'Lädt …' : `Weitere laden (${nf.format(items.length)} von ${nf.format(total)})`}
                </button>
              </div>
            )}
          </>
        )}

        {(hiddenUncertain > 0 || excluded > 0) && total > 0 && (
          <div className="panel-foot av-foot">
            <Icon name="CircleHelp" size={13} stroke={2} />
            <span>
              Ausgeblendet{hiddenUncertain > 0 ? `: ${nf.format(hiddenUncertain)} unsicher` : ''}
              {excluded > 0 ? `${hiddenUncertain > 0 ? ',' : ':'} ${nf.format(excluded)} nicht verfügbar` : ''}
              {totals?.hiddenReasons && Object.keys(totals.hiddenReasons).length > 0 ? ` (${reasonSummary(totals.hiddenReasons)})` : ''}.
              {hiddenUncertain > 0 && (
                <>
                  {' '}
                  <button type="button" className="btn-link" onClick={() => onIncludeUncertain(true)}>
                    Unsichere zeigen
                  </button>
                </>
              )}
            </span>
          </div>
        )}
        {includeUncertain && (
          <p className="panel-foot">
            <Icon name="Info" size={13} stroke={2} />
            <span>
              Unsichere Ziele werden angezeigt (Symbol «?»). Nicht verfügbare – gesperrt, verschneit, Sturm, zu wenig
              Tageslicht – bleiben ausgeblendet.{' '}
              <button type="button" className="btn-link" onClick={() => onIncludeUncertain(false)}>
                Nur verfügbare
              </button>
            </span>
          </p>
        )}
        {meta && !unavailable && meta.liveData === 'unavailable' && (
          <p className="panel-foot panel-foot-warn">
            <Icon name="CircleAlert" size={13} stroke={2} />
            <span>
              Live-Daten (Wetter, Schnee, Lawinenstufe) sind gerade nicht abrufbar. Treffer und Fahrzeiten stimmen,
              die Bedingungen fehlen vorübergehend.
            </span>
          </p>
        )}
        {meta && meta.excludedUnknownSnow > 0 && (
          <p className="panel-foot">
            <Icon name="Info" size={13} stroke={2} />
            {nf.format(meta.excludedUnknownSnow)} Gebiete ohne Schneemesswert wurden wegen des Schneefilters nicht
            berücksichtigt.
          </p>
        )}
        {mode === 'ski' && (
          <p className="panel-foot">
            <Icon name="TriangleAlert" size={13} stroke={2} />
            Lawinenangaben orientierend – immer das offizielle SLF-Bulletin prüfen.
          </p>
        )}
        {meta && !unavailable && (
          <p className="panel-foot">
            <Icon name="Info" size={13} stroke={2} />
            <span>
              Fahrzeiten über das Strassennetz (OpenStreetMap, Stand {fmtDate(meta.routing.osmTimestamp)}) ohne
              Verkehrslage. {nf.format(meta.candidatesEvaluated)} Kandidaten geprüft
              {meta.generatedAt ? `, ${fmtAge(meta.generatedAt) ?? 'soeben'}` : ''}.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
