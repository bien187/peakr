'use client';

import type {
  LiftStatusDetail,
  LiftStatusItem,
  LiftStatusSummary,
  SlopeCounts,
  StatusCounts,
} from '@ch-alpineroute/shared';
import { Icon } from './Icon';
import {
  FRESHNESS,
  isReporting,
  LIFT_TYPE,
  linkLabel,
  OP_STATUS,
  snowLines,
  reportStamp,
  reportTime,
  requiredCredits,
  RESORT_STATUS,
  SLOPE_DIFFICULTY,
  slopeColor,
} from '@/lib/liftStatus';

const nf = new Intl.NumberFormat('de-CH');

/** Kurzzeile auf der Ergebniskarte: Zeitpunkt des Berichts, Quelle, Aktualität. */
export function CardLiftStatus({ s }: { s: LiftStatusSummary }) {
  const reporting = isReporting(s);
  return (
    <p
      className={'rcard-ops is-' + (reporting ? s.freshness : 'unknown')}
      title={reporting ? FRESHNESS[s.freshness].hint : undefined}
    >
      <Icon name="CableCar" size={12} stroke={2} />
      <span>
        {reporting ? reportStamp(s) : 'Liftstatus: kein aktueller Bericht'} · {s.sourceName}
      </span>
      {reporting && s.freshness !== 'fresh' && (
        <span className="ops-tag">{FRESHNESS[s.freshness].label}</span>
      )}
    </p>
  );
}

/** Balken und Legende einer Zählung (Lifte oder Pisten). */
function CountBlock({ title, c }: { title: string; c: StatusCounts | SlopeCounts }) {
  const parts = (['open', 'preparation', 'closed', 'unknown'] as const).filter(
    (k) => (c[k] ?? 0) > 0,
  );
  const total = c.total ?? 0;
  const km = 'openKm' in c && c.openKm !== null ? c.openKm : null;
  return (
    <div className="ops-count">
      <div className="ops-count-head">
        <span className="ops-count-title">{title}</span>
        <span className="ops-count-main">
          <span className="mono ops-big">{c.open ?? '–'}</span>
          {c.total !== null && <span className="ops-of"> / {c.total} offen</span>}
          {c.total === null && c.open !== null && <span className="ops-of"> offen</span>}
        </span>
      </div>
      {total > 0 && c.open !== null && (
        <div className="ops-bar" role="img" aria-label={`${c.open} von ${c.total} ${title} offen`}>
          {parts.map((k) => (
            <span
              key={k}
              className={'ops-seg is-' + k}
              style={{ width: `${((c[k] ?? 0) / total) * 100}%` }}
            />
          ))}
          {parts.length === 0 && (
            <span
              className="ops-seg is-closed"
              style={{ width: `${((total - (c.open ?? 0)) / total) * 100}%` }}
            />
          )}
        </div>
      )}
      <p className="ops-legend">
        {parts.length > 0 ? (
          parts.map((k) => (
            <span key={k} className={'ops-leg is-' + k}>
              <i aria-hidden /> {c[k]} {OP_STATUS[k].label}
            </span>
          ))
        ) : c.open !== null && c.total !== null && c.total > c.open ? (
          <span className="ops-leg is-closed">
            <i aria-hidden /> {c.total - c.open} nicht offen (geschlossen oder in Vorbereitung –
            keine Einzelliste)
          </span>
        ) : null}
        {km !== null && 'totalKm' in c && (
          <span className="ops-leg">
            {nf.format(km)}
            {c.totalKm !== null ? ` von ${nf.format(c.totalKm)}` : ''} km offen
          </span>
        )}
      </p>
    </div>
  );
}

function ItemRow({ i, kind }: { i: LiftStatusItem; kind: 'lift' | 'slope' }) {
  const meta = OP_STATUS[i.status];
  const typeLabel =
    kind === 'lift'
      ? (LIFT_TYPE[i.type ?? 'other'] ?? LIFT_TYPE.other)
      : (SLOPE_DIFFICULTY[i.type ?? 'other'] ?? SLOPE_DIFFICULTY.other).label;
  return (
    <li className={'ops-item is-' + i.status}>
      <span className="ops-item-state">
        <Icon name={meta.icon} size={11} stroke={2.6} />
        {meta.label}
      </span>
      <span className="ops-item-name">
        {kind === 'slope' && (
          <i
            className="ops-diff"
            style={{ background: slopeColor(i.type, i.colour) }}
            aria-hidden
          />
        )}
        {i.name}
      </span>
      <span className="ops-item-meta">
        {typeLabel}
        {i.lengthM !== null && <span className="mono"> · {nf.format(i.lengthM)} m</span>}
      </span>
    </li>
  );
}

function ItemList({
  title,
  items,
  kind,
}: {
  title: string;
  items: LiftStatusItem[];
  kind: 'lift' | 'slope';
}) {
  const open = items.filter((i) => i.status === 'open').length;
  return (
    <details className="ops-list">
      <summary>
        <Icon name="ChevronDown" size={14} stroke={2} className="ops-caret" />
        {title} einzeln{' '}
        <span className="ops-list-count">
          ({items.length}, davon {open} offen)
        </span>
      </summary>
      <ul>
        {items.map((i) => (
          <ItemRow key={`${i.areaId}:${i.id}`} i={i} kind={kind} />
        ))}
      </ul>
    </details>
  );
}

/** Abschnitt «Betriebsstatus» der Detailansicht. */
export function OperationCard({ s }: { s: LiftStatusDetail | null }) {
  if (!s) {
    return (
      <section className="detail-card ops-card">
        <h2 className="detail-h2">Betriebsstatus</h2>
        <p className="detail-note is-plain">
          <Icon name="CircleHelp" size={13} stroke={2} />
          Lift- und Pistenstatus derzeit nicht verfügbar: Für dieses Skigebiet liegt kein
          Statusbericht vor.
        </p>
      </section>
    );
  }
  const reporting = isReporting(s);
  const meta = RESORT_STATUS[s.status];
  const websites = s.areaDetails.flatMap((a) => (a.websiteUrl ? [a.websiteUrl] : []));
  const credits = requiredCredits(s.areaDetails.flatMap((a) => a.sourceLinks));
  const snow = reporting ? snowLines(s.areaDetails) : [];
  const checkedAt =
    s.areaDetails
      .map((a) => a.checkedAt)
      .filter((t): t is string => t !== null)
      .sort()[0] ?? null;
  return (
    <section className="detail-card ops-card">
      <h2 className="detail-h2">Betriebsstatus</h2>
      <div className="ops-head">
        <span className={'ops-badge is-' + meta.tone}>
          <Icon name={meta.icon} size={13} stroke={2.6} />
          {meta.label}
        </span>
        {reporting && s.dataAt && (
          <span className={'ops-fresh is-' + s.freshness} title={FRESHNESS[s.freshness].hint}>
            {reportStamp(s)} · {FRESHNESS[s.freshness].label}
          </span>
        )}
      </div>

      {s.areaDetails.length > 1 && (
        <p className="ops-areas">
          Berichte für{' '}
          {s.areaDetails
            .map((a) =>
              a.status === 'open' || a.status === 'closed'
                ? `${a.name} (${RESORT_STATUS[a.status].short}${a.reportAt ? `, Bericht ${reportTime(a.reportAt)}` : ''})`
                : `${a.name} (kein aktueller Bericht)`,
            )
            .join(' · ')}
        </p>
      )}
      {s.coverageNote && (
        <p className="ops-note">
          <Icon name="Info" size={13} stroke={2} />
          {s.coverageNote}
        </p>
      )}
      {reporting && s.freshness !== 'fresh' && (
        <p className="ops-note is-warn">
          <Icon name="TriangleAlert" size={13} stroke={2} />
          Letzter verfügbarer Status, möglicherweise veraltet: {FRESHNESS[s.freshness].hint}.
        </p>
      )}

      {reporting ? (
        <div className="ops-counts">
          <CountBlock title="Lifte" c={s.lifts} />
          <CountBlock title="Pisten" c={s.slopes} />
        </div>
      ) : (
        <p className="detail-note is-plain">
          <Icon name="CircleHelp" size={13} stroke={2} />
          Das Skigebiet hat derzeit keinen aktuellen Statusbericht veröffentlicht. Ob Anlagen offen
          sind, ist unbekannt.
        </p>
      )}

      {snow.length > 0 && (
        <p className="ops-snow">
          <Icon name="Snowflake" size={13} stroke={2} />
          <span>Schnee laut Bericht: {snow.join(' · ')}</span>
        </p>
      )}

      {s.liftItems.length > 0 && <ItemList title="Lifte" items={s.liftItems} kind="lift" />}
      {s.slopeItems.length > 0 && <ItemList title="Pisten" items={s.slopeItems} kind="slope" />}

      <div className="ops-source">
        <p>
          Quelle:{' '}
          <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
            {s.sourceName}
          </a>
          {credits.length > 0 && <> · Originaldaten: {credits.join(', ')}</>}
        </p>
        <p>
          Zuletzt von Peakr abgerufen: {reportTime(s.fetchedAt)}
          {checkedAt && <> · von LiftRadar gelesen: {reportTime(checkedAt)}</>}
          {s.areaDetails.length === 1 &&
            (s.areaDetails[0].reportAt ? (
              <> · Bericht des Skigebiets: {reportTime(s.areaDetails[0].reportAt)}</>
            ) : (
              <> · Bericht des Skigebiets ohne Zeitangabe</>
            ))}
        </p>
        <p>
          LiftRadar ist keine offizielle Quelle: Statusberichte erscheinen etwa zweimal täglich und
          können verzögert oder fehlerhaft sein. Vor der Fahrt die Website des Skigebiets prüfen.
        </p>
        {websites.length > 0 && (
          <p className="ops-links">
            {websites.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                <Icon name="ExternalLink" size={12} stroke={2} /> {linkLabel(url)}
              </a>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}
