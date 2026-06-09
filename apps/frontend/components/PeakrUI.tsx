'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { Icon } from './Icon';
import {
  AVALANCHE,
  fmtDrive,
  scoreColor,
  SORTS,
  weatherInfo,
  type PCard,
  type TrendDir,
} from '@/lib/peakr';

type CSSVars = CSSProperties & Record<string, string | number>;
const dash = (v: number | null | undefined): string | number => (v == null ? '–' : v);

export function ScoreDot({ score, size = 'md' }: { score: number; size?: 'md' | 'lg' }) {
  return (
    <span className={'score-dot score-' + size} style={{ '--sc': scoreColor(score) } as CSSVars}>
      <span className="score-num">{score}</span>
    </span>
  );
}

export function TrendTag({ dir, fame }: { dir: TrendDir; fame: number }) {
  const map: Record<TrendDir, [string, string]> = {
    up: ['TrendingUp', 'im Trend'],
    down: ['TrendingDown', 'rückläufig'],
    flat: ['Minus', 'stabil'],
  };
  const [icon, label] = map[dir] ?? map.flat;
  return (
    <span className="trend-tag" title={`Bekanntheit ${fame}/100 · ${label}`}>
      <Icon name={icon} size={13} stroke={2} />
      <span>{fame}</span>
    </span>
  );
}

export function AvalancheTag({ level, compact }: { level: number | null; compact?: boolean }) {
  if (level == null) return <span className="ava-tag ava-na">Lawine k.A.</span>;
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

export function WeatherChip({ code, temp }: { code: number | null; temp: number | null }) {
  const w = weatherInfo(code);
  return (
    <span className="wx-chip">
      <Icon name={w.icon} size={15} stroke={1.75} />
      <span>{w.label}</span>
      {temp != null && <span className="wx-temp">{Math.round(temp)}°</span>}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {unit && <span className="stat-unit"> {unit}</span>}
      </span>
    </div>
  );
}

export function ResultCard({
  r,
  selected,
  onSelect,
  onOpen,
  isFav,
  onFav,
  innerRef,
}: {
  r: PCard;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  isFav: boolean;
  onFav: (id: string) => void;
  innerRef?: (el: HTMLElement | null) => void;
}) {
  const isSki = r.type === 'ski';
  return (
    <article
      ref={innerRef}
      className={'rcard' + (selected ? ' is-sel' : '') + (r.suggestion ? ' is-sug' : '')}
      onClick={() => onSelect(r.id)}
    >
      <div className="rcard-top">
        <div className="rcard-rank">
          <ScoreDot score={r.score} />
        </div>
        <div className="rcard-head">
          <h3 className="rcard-name">{r.name}</h3>
          <p className="rcard-sub">
            <span>{r.canton}</span>
            <span className="dot-sep" />
            <Icon name="Clock" size={12} stroke={2} />
            <span className="mono">{fmtDrive(r.driveMin)}</span>
            <span className="dot-sep" />
            <span>{r.km} km</span>
            {r.suggestion && <span className="over-pill">+{r.over} min</span>}
          </p>
        </div>
        {r.fame != null && <TrendTag dir={r.trendDir} fame={r.fame} />}
      </div>

      <div className="rcard-stats">
        {isSki ? (
          <>
            <Stat label="Schnee Berg" value={dash(r.snowTop)} unit="cm" />
            <Stat label="Neuschnee" value={dash(r.fresh)} unit="cm" />
            <Stat
              label="Lifte"
              value={r.liftsTotal != null ? `${r.liftsOpen ?? 0}/${r.liftsTotal}` : '–'}
            />
          </>
        ) : (
          <>
            <Stat label="SAC" value={r.sac ?? '–'} />
            <Stat label="Aufstieg" value={dash(r.ascent)} unit="hm" />
            <Stat label="Distanz" value={dash(r.distance)} unit="km" />
          </>
        )}
      </div>

      <div className="rcard-foot">
        <WeatherChip code={r.weather} temp={r.temp} />
        {isSki && <AvalancheTag level={r.avalanche} compact />}
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
              style={{
                fill: isFav ? 'var(--accent)' : 'none',
                color: isFav ? 'var(--accent)' : 'var(--ink-3)',
              }}
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
}

export function ResultsPanel({
  results,
  suggestions,
  selectedId,
  onSelect,
  onOpen,
  favs,
  onFav,
  originLabel,
  mode,
  sort,
  onSort,
  count,
  sheetOpen,
  onSheetToggle,
}: {
  results: PCard[];
  suggestions: PCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  favs: Set<string>;
  onFav: (id: string) => void;
  originLabel: string;
  mode: 'ski' | 'hike';
  sort: string;
  onSort: (s: string) => void;
  count: number;
  sheetOpen: boolean;
  onSheetToggle: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!selectedId) return;
    const el = cardRefs.current[selectedId];
    const sc = scrollRef.current;
    if (el && sc) {
      const top = el.offsetTop - sc.offsetTop - 12;
      sc.scrollTo({ top, behavior: 'smooth' });
    }
  }, [selectedId]);

  const all = [...results, ...suggestions];

  return (
    <div className={'panel' + (sheetOpen ? ' sheet-open' : '')}>
      <div className="panel-handle" onClick={onSheetToggle}>
        <span />
      </div>

      <div className="panel-head">
        <div>
          <p className="panel-eyebrow">
            {mode === 'ski' ? 'Skigebiete' : 'Wanderziele'} · ab {originLabel}
          </p>
          <h2 className="panel-title">
            {count} {count === 1 ? 'Ziel' : 'Ziele'}{' '}
            <span className="panel-title-sub">in Reichweite</span>
          </h2>
        </div>
        <button type="button" className="sheet-close" onClick={onSheetToggle} aria-label="Liste schliessen">
          <Icon name="ChevronDown" size={20} />
        </button>
      </div>

      <div className="panel-sort">
        <span className="sort-label">Sortieren</span>
        <div className="seg">
          {SORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={'seg-btn' + (sort === s.value ? ' is-on' : '')}
              onClick={() => onSort(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-scroll" ref={scrollRef}>
        {all.length === 0 && (
          <div className="empty">
            <Icon name="MapPinOff" size={26} stroke={1.5} />
            <p className="empty-title">Keine Ziele in Reichweite</p>
            <p className="empty-sub">Erhöhe die Fahrzeit oder Toleranz, um mehr zu sehen.</p>
          </div>
        )}

        {results.map((r) => (
          <ResultCard
            key={r.id}
            r={r}
            innerRef={(el) => (cardRefs.current[r.id] = el)}
            selected={r.id === selectedId}
            onSelect={onSelect}
            onOpen={onOpen}
            isFav={favs.has(r.id)}
            onFav={onFav}
          />
        ))}

        {suggestions.length > 0 && (
          <div className="sug-head">
            <span>Knapp ausserhalb</span>
            <span className="sug-rule" />
          </div>
        )}
        {suggestions.map((r) => (
          <ResultCard
            key={r.id}
            r={r}
            innerRef={(el) => (cardRefs.current[r.id] = el)}
            selected={r.id === selectedId}
            onSelect={onSelect}
            onOpen={onOpen}
            isFav={favs.has(r.id)}
            onFav={onFav}
          />
        ))}

        <p className="panel-foot">
          <Icon name="TriangleAlert" size={13} stroke={2} />
          Lawinenangaben orientierend – immer das offizielle SLF-Bulletin prüfen.
        </p>
      </div>
    </div>
  );
}
