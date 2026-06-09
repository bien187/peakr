'use client';

import type { DestinationWithStatus, GeocodeResult, LatLng } from '@ch-alpineroute/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ScoreDot } from '@/components/PeakrUI';
import { TopBar } from '@/components/PeakrChrome';
import { api } from '@/lib/api';
import { adaptFavorite } from '@/lib/peakr';
import { useAuthStore } from '@/lib/store';

function GeocodeField({ onPick }: { onPick: (loc: LatLng, label: string) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onQuery = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) return setResults([]);
    timer.current = setTimeout(async () => {
      try {
        const r = await api.geocode(text);
        setResults(r.results);
      } catch {
        setResults([]);
      }
    }, 300);
  };
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        value={q}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Ort suchen (z. B. Bern) …"
      />
      {results.length > 0 && (
        <div className="pop" style={{ position: 'absolute', insetInlineStart: 0, marginTop: 6, width: '100%', zIndex: 30 }}>
          <div className="pop-list">
            {results.map((r, i) => (
              <button
                key={`${r.label}-${i}`}
                type="button"
                className="pop-item"
                onClick={() => {
                  onPick({ lat: r.lat, lng: r.lng }, r.label);
                  setQ(r.label);
                  setResults([]);
                }}
              >
                <Icon name="MapPin" size={13} stroke={2} />
                <span>
                  {r.label}
                  {r.canton ? ` · ${r.canton}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { token, user, setUser } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [list, setList] = useState<DestinationWithStatus[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [openAiKey, setOpenAiKey] = useState('');

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !token) router.push('/login');
  }, [mounted, token, router]);

  useEffect(() => {
    if (token) api.favorites().then(setList).catch(() => undefined);
  }, [token]);

  if (!mounted || !token) return null;

  const cards = list.map(adaptFavorite);
  const name = user?.displayName ?? user?.email ?? '';

  const removeFav = async (id: string) => {
    setList((l) => l.filter((x) => x.id !== id));
    try {
      await api.removeFavorite(id);
    } catch {
      /* ignore */
    }
  };

  const saveHome = async (loc: LatLng, label: string) => {
    const u = await api.updateMe({ homeLocation: loc, homeLabel: label });
    setUser(u);
    setMsg('Startort gespeichert.');
  };

  return (
    <>
      <TopBar />
      <div className="dash">
        <div className="dash-head">
          <p className="detail-kicker">Dein Konto</p>
          <h1 className="dash-title">Gemerkte Ziele</h1>
          <p className="dash-sub">
            {name ? `Angemeldet als ${name}` : 'Konto'} · {cards.length}{' '}
            {cards.length === 1 ? 'Favorit' : 'Favoriten'}
          </p>
        </div>

        {cards.length === 0 ? (
          <div className="empty empty-lg">
            <Icon name="Star" size={28} stroke={1.5} />
            <p className="empty-title">Noch keine Favoriten</p>
            <p className="empty-sub">Markiere Ziele mit dem Stern, um sie hier zu sammeln.</p>
            <button type="button" className="btn" onClick={() => router.push('/')}>
              <Icon name="Compass" size={16} stroke={2} /> Ziele entdecken
            </button>
          </div>
        ) : (
          <div className="dash-grid">
            {cards.map((d) => {
              const isSki = d.type === 'ski';
              return (
                <article key={d.id} className="fav-card" onClick={() => router.push(`/destinations/${d.id}`)}>
                  <div className="fav-card-top">
                    <ScoreDot score={d.score} />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeFav(d.id);
                      }}
                      title="Favorit entfernen"
                    >
                      <Icon name="Star" size={17} stroke={2} style={{ fill: 'var(--accent)', color: 'var(--accent)' }} />
                    </button>
                  </div>
                  <h3 className="fav-name">{d.name}</h3>
                  <p className="fav-meta">
                    {isSki ? 'Skigebiet' : 'Wanderziel'}
                    {d.canton ? ` · ${d.canton}` : ''}
                  </p>
                  <div className="fav-stats">
                    {isSki ? (
                      <>
                        <span className="mono">{d.snowTop ?? '–'} cm</span>
                        <span className="dot-sep" />
                        <span>
                          {d.liftsTotal != null ? `${d.liftsOpen ?? 0}/${d.liftsTotal}` : '–'} Lifte
                        </span>
                      </>
                    ) : (
                      <>
                        <span>{d.sac ?? '–'}</span>
                        <span className="dot-sep" />
                        <span className="mono">{d.distance ?? '–'} km</span>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <section className="detail-card" style={{ marginTop: 'var(--gap)' }}>
          <h2 className="detail-h2">Standard-Startort</h2>
          <p className="detail-note" style={{ marginTop: 0 }}>
            Aktuell: {user?.homeLabel ?? 'nicht gesetzt'}
          </p>
          <GeocodeField onPick={saveHome} />
          {msg && (
            <p className="twk-hint" style={{ color: 'var(--accent-2)' }}>
              {msg}
            </p>
          )}
        </section>

        <section className="detail-card" style={{ marginTop: 'var(--gap)' }}>
          <h2 className="detail-h2">OpenAI-Key (optional)</h2>
          <p className="detail-note" style={{ marginTop: 0 }}>
            Status: {user?.hasOpenAiKey ? 'hinterlegt ✓' : 'nicht hinterlegt'}. Wird verschlüsselt
            gespeichert und nie angezeigt.
          </p>
          <div className="auth-form" style={{ flexDirection: 'row', gap: 8 }}>
            <input
              className="input"
              type="password"
              placeholder="sk-…"
              value={openAiKey}
              onChange={(e) => setOpenAiKey(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn"
              disabled={openAiKey.trim().length < 20}
              onClick={async () => {
                await api.setOpenAiKey(openAiKey);
                setOpenAiKey('');
                const me = await api.me();
                setUser(me);
                setMsg('OpenAI-Key gespeichert.');
              }}
            >
              Speichern
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
