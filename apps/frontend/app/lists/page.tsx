'use client';

import type { ListSummary } from '@ch-alpineroute/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { countLabel, loginHref, NewListDialog } from '@/components/Lists';
import { CompassLoader } from '@/components/PeakrUI';
import { TopBar } from '@/components/PeakrChrome';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export default function ListsPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [mounted, setMounted] = useState(false);
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !token) router.replace(loginHref('/lists'));
  }, [mounted, token, router]);
  useEffect(() => {
    if (!token) return;
    api
      .lists()
      .then(setLists)
      .catch(() => setError(true));
  }, [token]);

  if (!mounted || !token) return null;

  return (
    <>
      <TopBar />
      <div className="dash">
        <div className="dash-head list-head">
          <div>
            <p className="detail-kicker">Dein Konto</p>
            <h1 className="dash-title">Listen</h1>
            <p className="dash-sub">Ziele sammeln und gemeinsam planen</p>
          </div>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Icon name="Plus" size={16} stroke={2} /> Neue Liste
          </button>
        </div>

        {error ? (
          <p className="detail-note is-plain">Die Listen konnten nicht geladen werden.</p>
        ) : !lists ? (
          <CompassLoader label="Listen werden geladen …" />
        ) : lists.length === 0 ? (
          <div className="empty empty-lg">
            <Icon name="List" size={28} stroke={1.5} />
            <p className="empty-title">Noch keine Listen</p>
            <p className="empty-sub">Lege eine Liste an, z. B. für eine Wanderwoche, und lade Freunde dazu ein.</p>
            <button type="button" className="btn" onClick={() => setCreating(true)}>
              <Icon name="Plus" size={16} stroke={2} /> Neue Liste
            </button>
          </div>
        ) : (
          <div className="dash-grid">
            {lists.map((l) => (
              <article key={l.id} className="fav-card list-card" onClick={() => router.push(`/lists/${l.id}`)}>
                <div className="fav-card-top">
                  <span className="list-card-ico">
                    <Icon name="List" size={16} stroke={2} />
                  </span>
                  {l.memberCount > 1 && (
                    <span className="list-shared">
                      <Icon name="Users" size={13} stroke={2} /> {l.role === 'owner' ? 'geteilt' : 'mit dir geteilt'}
                    </span>
                  )}
                </div>
                <h3 className="fav-name">{l.name}</h3>
                <p className="fav-meta">
                  {countLabel(l.itemCount, 'Ziel', 'Ziele')} · {countLabel(l.memberCount, 'Person', 'Personen')}
                </p>
                <div className="fav-stats list-preview">{l.preview.length > 0 ? l.preview.join(' · ') : 'Noch leer'}</div>
              </article>
            ))}
          </div>
        )}
      </div>
      <NewListDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
